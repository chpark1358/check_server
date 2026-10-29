import "server-only";
import { getGoogleOAuthAccessToken, GoogleOAuthError } from "@/lib/server/google-oauth";
import type { ScheduleFilters, ScheduleItem, ScheduleOverview, ScheduleSource } from "@/lib/schedule-types";
import { filterScheduleItems, parseScheduleRows, ScheduleDataError } from "@/lib/schedule-data";

export const SCHEDULE_SOURCE: ScheduleSource = {
  spreadsheetId: "1nrcMefriNnjcizsrhXGYKHbZhkRHT6VR1j-V7f_d7xY",
  sheetId: 1027882150,
  title: "★오피스키퍼 정기점검(2024~)",
  url: "https://docs.google.com/spreadsheets/d/1nrcMefriNnjcizsrhXGYKHbZhkRHT6VR1j-V7f_d7xY/edit?gid=1027882150#gid=1027882150",
};
const API_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SCHEDULE_SOURCE.spreadsheetId}`;
const CACHE_MS = 5 * 60_000, STALE_MS = 30 * 60_000, RETRY_MS = 60_000;
const MAX_ROWS = 20_000, MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
type FailureStatus = Exclude<ScheduleOverview["status"], "ready">;
class SourceError extends Error {
  constructor(public status: FailureStatus, message: string) { super(message); }
}
type Snapshot = { items: ScheduleItem[]; fetchedAt: string; source: ScheduleSource };
type SourceState = {
  fingerprint: string;
  snapshot: Snapshot | null;
  failure: SourceError | null;
  retryAt: number;
  pending: Promise<void> | null;
};
let state: SourceState | null = null;

export function scheduleMinimumRole(): "admin" | "operator" {
  return process.env.SCHEDULE_MIN_ROLE === "operator" ? "operator" : "admin";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new SourceError("schema_error", "일정 자료가 조회 한도를 초과했습니다. 관리자에게 조회 범위 확인을 요청해 주세요."); }
  // Bound decoding as well as HTTP timeout; do not retain Google error bodies.
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (reader) {
    try {
      while (true) {
        const {done,value} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new SourceError("schema_error", "일정 자료가 조회 한도를 초과했습니다. 관리자에게 조회 범위 확인을 요청해 주세요."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new SourceError("upstream_error", "Google 응답을 읽지 못했습니다. 잠시 후 다시 조회해 주세요."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SourceError("upstream_error", "Google 응답 형식을 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.");
  return body as Record<string,unknown>;
}

async function googleGet(url: string, token: string) {
  const response = await fetch(url, {method:"GET",headers:{authorization:`Bearer ${token}`},cache:"no-store",redirect:"error",signal:AbortSignal.timeout(15_000)});
  if (!response.ok) {
    await response.body?.cancel();
    if ([401,403,404].includes(response.status)) throw new SourceError("access_denied", "연결 계정이 원본 시트를 읽을 수 없습니다. 관리자에게 파일 공유 권한과 Google Sheets API 설정 확인을 요청해 주세요.");
    throw new SourceError("upstream_error", "Google 일정 조회에 실패했습니다. 잠시 후 다시 조회해 주세요.");
  }
  return readJson(response);
}

async function refresh(current: SourceState, token: string) {
  try {
    const metadata = await googleGet(API_URL + "?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))",token);
    const sheets = Array.isArray(metadata.sheets) ? metadata.sheets : [];
    const sheet = sheets.find((candidate: {properties?:{sheetId?:number}}) => candidate?.properties?.sheetId === SCHEDULE_SOURCE.sheetId) as {properties?:{title?:unknown;gridProperties?:{rowCount?:unknown;columnCount?:unknown}}} | undefined;
    const title = sheet?.properties?.title, grid = sheet?.properties?.gridProperties;
    if (typeof title !== "string" || !title || !Number.isSafeInteger(grid?.rowCount) || !Number.isSafeInteger(grid?.columnCount) || Number(grid?.rowCount) < 4 || Number(grid?.columnCount) < 17) {
      throw new SourceError("schema_error", "연결한 원본 탭이나 열 구조를 확인할 수 없습니다. 관리자에게 원본 탭 확인을 요청해 주세요.");
    }
    if (Number(grid?.rowCount) > MAX_ROWS) throw new SourceError("schema_error", "원본 탭이 20,000행 조회 한도를 초과했습니다. 일부만 표시하지 않았습니다. 관리자에게 조회 범위 조정을 요청해 주세요.");
    // Needed fields end at Q; V contains contact information and is never requested.
    const range = `'${title.replace(/'/g,"''")}'!A1:Q${grid!.rowCount}`;
    const body = await googleGet(API_URL + "/values/" + encodeURIComponent(range) + "?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE",token);
    if (!Array.isArray(body.values) || body.values.length > Number(grid?.rowCount) || body.values.some(row => !Array.isArray(row))) throw new SourceError("schema_error", "원본 일정 행을 읽을 수 없습니다. 관리자에게 시트 구조 확인을 요청해 주세요.");
    const items = parseScheduleRows(body.values);
    current.snapshot = {items,fetchedAt:new Date().toISOString(),source:{...SCHEDULE_SOURCE,title}};
    current.failure = null; current.retryAt = 0;
  } catch (cause) {
    const error = cause instanceof SourceError ? cause : cause instanceof ScheduleDataError ? new SourceError("schema_error",cause.message) : new SourceError("upstream_error","Google 일정 서비스에 연결하지 못했습니다. 잠시 후 다시 조회해 주세요.");
    current.failure = error; current.retryAt = Date.now() + RETRY_MS;
    if (error.status !== "upstream_error") current.snapshot = null;
  }
}

export async function loadScheduleOverview(filters: ScheduleFilters): Promise<ScheduleOverview> {
  const empty = (status: ScheduleOverview["status"], message: string, retry = 0): ScheduleOverview => ({status,items:[],total:0,counts:{review:0,hold:0,partner:0,completed:0,issues:0},filters,source:{...SCHEDULE_SOURCE},fetchedAt:null,stale:false,message,refreshAfterSeconds:retry});
  let credential: {accessToken:string;revision:string};
  try { credential = await getGoogleOAuthAccessToken(); }
  catch (cause) {
    state = null;
    return empty(cause instanceof GoogleOAuthError ? cause.status : "upstream_error", cause instanceof GoogleOAuthError ? cause.message : "Google 연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  // A reconnect/disconnect must never serve the previous Google account's cached rows.
  const fingerprint = credential.revision;
  if (!state || state.fingerprint !== fingerprint) state = {fingerprint,snapshot:null,failure:null,retryAt:0,pending:null};
  const current = state;
  const age = current.snapshot ? Date.now()-Date.parse(current.snapshot.fetchedAt) : Infinity;
  if (age >= CACHE_MS && current.retryAt <= Date.now()) {
    current.pending ??= refresh(current,credential.accessToken).finally(()=>{current.pending=null;});
    await current.pending;
  } else if (current.pending) await current.pending;
  try {
    const latest = await getGoogleOAuthAccessToken();
    if (latest.revision !== fingerprint) {
      if (state === current) state = null;
      return empty("access_denied", "Google 연결 계정이 변경되었습니다. 다시 조회해 주세요.");
    }
  } catch (cause) {
    if (state === current) state = null;
    return empty(cause instanceof GoogleOAuthError ? cause.status : "upstream_error", cause instanceof GoogleOAuthError ? cause.message : "Google 연결 상태를 다시 확인해 주세요.");
  }
  const snapshot = current.snapshot;
  const refreshedAge = snapshot ? Date.now()-Date.parse(snapshot.fetchedAt) : Infinity;
  if (!snapshot || refreshedAge > STALE_MS) return empty(current.failure?.status ?? "upstream_error",current.failure?.message ?? "일정 자료를 확인하지 못했습니다. 다시 조회해 주세요.",Math.max(0,Math.ceil((current.retryAt-Date.now())/1000)));
  const stale = Boolean(current.failure) || refreshedAge >= CACHE_MS;
  const invalidDates = snapshot.items.filter(item=>!item.plannedDate).length;
  const messages = [stale ? "새 자료를 불러오지 못해 마지막으로 확인한 자료를 표시합니다. 기준 시각을 확인해 주세요." : null,
    invalidDates ? `원본 전체에서 예정 시기 확인이 필요한 기록 ${invalidDates}건이 있습니다.${filters.range === "all" ? "" : " 날짜 범위 조회에는 포함되지 않으므로 전체 기간으로 확인해 주세요."}` : null].filter(Boolean);
  return {status:"ready",...filterScheduleItems(snapshot.items,filters),source:snapshot.source,fetchedAt:snapshot.fetchedAt,stale,message:messages.join(" ") || null,
    refreshAfterSeconds:Math.max(0,Math.ceil(((current.failure?current.retryAt:Date.parse(snapshot.fetchedAt)+CACHE_MS)-Date.now())/1000))};
}
