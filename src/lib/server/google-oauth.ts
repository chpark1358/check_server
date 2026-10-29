import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { NextRequest } from "next/server";
import type { UserRole } from "@/lib/server/api";
import type { GoogleConnectionStatus } from "@/lib/google-oauth-types";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SCOPES = ["openid", "email", SHEETS_SCOPE];
const CALLBACK_PATH = "/api/google/oauth/callback";
const COOKIE_PATH = "/api/google/oauth";
const FLOW_SECONDS = 600;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SOURCE_ID = "1nrcMefriNnjcizsrhXGYKHbZhkRHT6VR1j-V7f_d7xY";
const SOURCE_GID = 1027882150;
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^[\x21-\x7e]{1,16384}$/;

export class GoogleOAuthError extends Error {
  constructor(
    public status: "unconfigured" | "access_denied" | "upstream_error",
    public code: string,
    message: string,
    public httpStatus = status === "upstream_error" ? 503 : 400,
  ) { super(message); }
}

type Config = { clientId: string; clientSecret: string; redirectUri: string; origin: string; secure: boolean; key: Buffer; namespace: string; fingerprint: string; redis: Redis };
type Flow = { version: 1; userId: string; nonceHash: string; verifier: string; fingerprint: string; generation: string; createdAt: number };
type Credentials = { accessToken: string; refreshToken: string; expiresAt: number; refreshExpiresAt: number | null; scopes: string[] };
type Pending = Flow & Credentials & { email: string; subject: string };
type Connection = Credentials & { version: 1; revision: string; fingerprint: string; email: string; subject: string; connectedBy: string; connectedAt: string; needsReauth: boolean };
export type GoogleOAuthCookie = { name: string; value: string; secure: boolean };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = () => randomBytes(32).toString("base64url");
const connectionKey = (config: Config) => config.namespace + ":connection";
const generationKey = (config: Config) => config.namespace + ":generation";
const cookieName = (config: Config) => config.secure ? "__Secure-checksrv_google_oauth" : "checksrv_google_oauth_dev";

// Compare-and-delete prevents replay without consuming another browser's valid flow.
const CONSUME = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 else return 0 end";
const REPLACE = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 else return 0 end";
const CONNECT = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[2], ARGV[2]); redis.call('SET', KEYS[1], ARGV[3]); return 1 else return 0 end";
const DISCONNECT = "redis.call('DEL', KEYS[1]); redis.call('SET', KEYS[2], ARGV[1]); return 1";

function failure(code = "GOOGLE_OAUTH_STORAGE_UNAVAILABLE", message = "Google 연결 정보를 안전하게 저장하거나 읽지 못했습니다. 잠시 후 다시 확인해 주세요.") {
  return new GoogleOAuthError("upstream_error", code, message);
}
function denied(code: string, message: string) { return new GoogleOAuthError("access_denied", code, message); }

function configFields() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "",
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ?? "",
    encryptionKey: process.env.GOOGLE_OAUTH_ENCRYPTION_KEY?.trim() ?? "",
    redisUrl: process.env.KV_REST_API_URL?.trim() || process.env.UPSTASH_REDIS_REST_URL?.trim() || "",
    redisToken: process.env.KV_REST_API_TOKEN?.trim() || process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "",
  };
}
function missingConfig() {
  const values = configFields();
  return Object.entries({ GOOGLE_OAUTH_CLIENT_ID: values.clientId, GOOGLE_OAUTH_CLIENT_SECRET: values.clientSecret,
    GOOGLE_OAUTH_REDIRECT_URI: values.redirectUri, GOOGLE_OAUTH_ENCRYPTION_KEY: values.encryptionKey,
    KV_REST_API_URL: values.redisUrl, KV_REST_API_TOKEN: values.redisToken }).filter(([,value]) => !value).map(([key]) => key);
}
function readConfig(): Config {
  const values = configFields();
  if (missingConfig().length) throw new GoogleOAuthError("unconfigured", "GOOGLE_OAUTH_NOT_CONFIGURED", "Google OAuth 서버 설정이 필요합니다. 관리자에게 연결 설정을 요청해 주세요.");
  let redirect: URL;
  try { redirect = new URL(values.redirectUri); } catch { throw new GoogleOAuthError("unconfigured", "GOOGLE_OAUTH_CALLBACK_INVALID", "Google OAuth 콜백 주소 설정을 확인해 주세요."); }
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(redirect.hostname) && redirect.protocol === "http:";
  if ((!local && redirect.protocol !== "https:") || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== CALLBACK_PATH || redirect.href !== values.redirectUri) {
    throw new GoogleOAuthError("unconfigured", "GOOGLE_OAUTH_CALLBACK_INVALID", "Google OAuth 콜백 주소 설정을 확인해 주세요.");
  }
  const key = Buffer.from(values.encryptionKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== values.encryptionKey) throw new GoogleOAuthError("unconfigured", "GOOGLE_OAUTH_ENCRYPTION_INVALID", "Google 연결 암호화 키 설정을 확인해 주세요.");
  if (!/^https:\/\//.test(values.redisUrl)) throw new GoogleOAuthError("unconfigured", "GOOGLE_OAUTH_STORAGE_INVALID", "Google 연결 저장소 설정을 확인해 주세요.");
  const environment = process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_APP_ENV || "development";
  if (!["production", "preview", "development"].includes(environment)) throw new GoogleOAuthError("unconfigured", "GOOGLE_OAUTH_ENVIRONMENT_INVALID", "Google 연결 환경 설정을 확인해 주세요.");
  const namespace = `checksrv:google-oauth:v1:${environment}:${hash(redirect.origin).slice(0,24)}:${hash(values.clientId).slice(0,24)}`;
  return { clientId: values.clientId, clientSecret: values.clientSecret, redirectUri: values.redirectUri, origin: redirect.origin, secure: !local, key, namespace,
    fingerprint: hash(JSON.stringify([values.clientId,values.clientSecret,values.encryptionKey,values.redirectUri,environment])),
    redis: new Redis({url:values.redisUrl,token:values.redisToken,automaticDeserialization:false,retry:{retries:0},signal:()=>AbortSignal.timeout(8000)}) };
}

function encrypt(config: Config, purpose: string, value: unknown) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(Buffer.from(config.namespace + ":" + purpose));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),encrypted.toString("base64url")].join(".");
}
function decrypt<T>(config: Config, purpose: string, value: string): T {
  try {
    const [version,iv,tag,data,...extra] = value.split(".");
    if (version !== "v1" || extra.length || !iv || !tag || !data || value.length > 100_000) throw new Error();
    const nonce=Buffer.from(iv,"base64url"),auth=Buffer.from(tag,"base64url");
    if(nonce.length!==12||auth.length!==16)throw new Error();
    const decipher=createDecipheriv("aes-256-gcm",config.key,nonce);
    decipher.setAAD(Buffer.from(config.namespace+":"+purpose));decipher.setAuthTag(auth);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8")) as T;
  } catch { throw denied("GOOGLE_OAUTH_RECORD_INVALID", "저장된 Google 연결 정보를 확인할 수 없습니다. 관리자가 다시 연결해 주세요."); }
}
async function storage<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { if(error instanceof GoogleOAuthError)throw error;throw failure(); }
}
async function readRecord(config: Config, key: string) {
  const value=await storage(()=>config.redis.get<string>(key));
  if(value!==null&&typeof value!=="string")throw denied("GOOGLE_OAUTH_RECORD_INVALID","저장된 Google 연결 정보를 확인할 수 없습니다. 관리자가 다시 연결해 주세요.");
  return value;
}
async function generation(config: Config) {
  await storage(()=>config.redis.set(generationKey(config),randomUUID(),{nx:true}));
  const value=await readRecord(config,generationKey(config));
  if(!value)throw failure();return value;
}
function equal(left: string, right: string) {
  const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);
}
function assertOrigin(request: NextRequest, config: Config, callback=false) {
  if(request.nextUrl.origin!==config.origin || (!callback && request.headers.get("origin")!==config.origin)) {
    throw new GoogleOAuthError("access_denied","GOOGLE_OAUTH_ORIGIN_MISMATCH","Google 연결은 설정된 사이트 주소에서 진행해 주세요.",403);
  }
}
function readNonce(request: NextRequest, config: Config) {
  const value=request.cookies.get(cookieName(config))?.value??"";
  if(!OPAQUE.test(value))throw denied("GOOGLE_OAUTH_STATE_INVALID","연결 요청이 만료되었거나 다른 브라우저에서 열렸습니다. 다시 연결해 주세요.");
  return value;
}
function validateFlow(config: Config, value: Flow, nonce: string) {
  if(!value||value.version!==1||typeof value.userId!=="string"||!value.userId||typeof value.nonceHash!=="string"||typeof value.generation!=="string"||
    value.fingerprint!==config.fingerprint||!Number.isFinite(value.createdAt)||value.createdAt>Date.now()+5000||Date.now()-value.createdAt>FLOW_SECONDS*1000||!equal(value.nonceHash,hash(nonce))) {
    throw denied("GOOGLE_OAUTH_STATE_INVALID","연결 요청이 만료되었거나 변경되었습니다. 다시 연결해 주세요.");
  }
}
async function consume(config: Config, key: string, encrypted: string) {
  const result=await storage(()=>config.redis.eval<unknown[],number>(CONSUME,[key],[encrypted]));
  if(result!==1)throw denied("GOOGLE_OAUTH_ALREADY_USED","이미 처리되었거나 만료된 연결 요청입니다. 연결 상태를 확인해 주세요.");
}
function responseHeaders() { return {"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer"}; }
export const googleOAuthResponseHeaders = responseHeaders;
export function googleOAuthCookieOptions(cookie: GoogleOAuthCookie, clear=false) {
  return {httpOnly:true,secure:cookie.secure,sameSite:"lax" as const,path:COOKIE_PATH,maxAge:clear?0:FLOW_SECONDS};
}
export function googleOAuthCookieToClear(): GoogleOAuthCookie {
  const config=readConfig();return {name:cookieName(config),value:"",secure:config.secure};
}

export async function beginGoogleOAuth(request: NextRequest, userId: string) {
  const config=readConfig();assertOrigin(request,config);
  const state=opaque(),nonce=opaque(),verifier=opaque();
  const flow: Flow={version:1,userId,nonceHash:hash(nonce),verifier,fingerprint:config.fingerprint,generation:await generation(config),createdAt:Date.now()};
  const saved=await storage(()=>config.redis.set(config.namespace+":state:"+hash(state),encrypt(config,"state",flow),{nx:true,ex:FLOW_SECONDS}));
  if(saved!=="OK")throw failure();
  const url=new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:"code",scope:SCOPES.join(" "),access_type:"offline",prompt:"consent select_account",include_granted_scopes:"false",state,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"}).toString();
  return {authorizationUrl:url.href,cookie:{name:cookieName(config),value:nonce,secure:config.secure}};
}

async function jsonBody(response: Response) {
  if(Number(response.headers.get("content-length")??0)>128*1024){await response.body?.cancel();throw failure("GOOGLE_OAUTH_RESPONSE_INVALID","Google 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");}
  const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
  try { if(reader)while(true){const result=await reader.read();if(result.done)break;length+=result.value.byteLength;if(length>128*1024){await reader.cancel();throw failure();}chunks.push(result.value);} }
  catch {throw failure("GOOGLE_OAUTH_RESPONSE_INVALID","Google 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");}
  finally {reader?.releaseLock();}
  try {const body:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();return body as Record<string,unknown>;}
  catch {throw failure("GOOGLE_OAUTH_RESPONSE_INVALID","Google 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.");}
}
async function googleFetch(url: string, init: RequestInit={}) {
  try {return await fetch(url,{...init,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15_000)});}
  catch {throw failure("GOOGLE_OAUTH_NETWORK","Google 연결에 일시적으로 실패했습니다. 잠시 후 다시 확인해 주세요.");}
}
function scopesFrom(raw: unknown, previous?: string[]) {
  const scopes=typeof raw==="string"?raw.split(/\s+/).filter(Boolean):previous;
  if(!scopes||!scopes.includes(SHEETS_SCOPE)||!scopes.includes("openid")||!scopes.some(s=>s==="email"||s==="https://www.googleapis.com/auth/userinfo.email"))throw denied("GOOGLE_OAUTH_SCOPE_REQUIRED","Google 시트 읽기 및 계정 확인 권한을 모두 허용해 주세요.");
  const allowed=new Set([...SCOPES,"https://www.googleapis.com/auth/userinfo.email"]);
  if(scopes.some(scope=>!allowed.has(scope)))throw denied("GOOGLE_OAUTH_SCOPE_EXCESSIVE","요청한 읽기 권한 외의 권한이 반환됐습니다. 관리자에게 OAuth 클라이언트 설정 확인을 요청해 주세요.");
  return [...new Set(scopes)];
}
function tokenFields(body: Record<string,unknown>, previous?: Connection): Credentials {
  if(typeof body.access_token!=="string"||!TOKEN.test(body.access_token)||typeof body.token_type!=="string"||body.token_type.toLowerCase()!=="bearer"||typeof body.expires_in!=="number"||!Number.isFinite(body.expires_in)||body.expires_in<=0||body.expires_in>86400)throw failure("GOOGLE_OAUTH_TOKEN_INVALID","Google 인증 응답을 확인할 수 없습니다. 다시 연결해 주세요.");
  const refreshToken=body.refresh_token??previous?.refreshToken;
  if(typeof refreshToken!=="string"||!TOKEN.test(refreshToken)||refreshToken.length>8192)throw denied("GOOGLE_OAUTH_REFRESH_REQUIRED","자동 갱신 권한을 받지 못했습니다. Google 계정 연결을 다시 진행해 주세요.");
  let refreshExpiresAt=previous?.refreshExpiresAt??null;
  if(body.refresh_token_expires_in!==undefined){if(typeof body.refresh_token_expires_in!=="number"||!Number.isFinite(body.refresh_token_expires_in)||body.refresh_token_expires_in<=0)throw failure("GOOGLE_OAUTH_TOKEN_INVALID");refreshExpiresAt=Date.now()+Math.min(body.refresh_token_expires_in,315360000)*1000;}
  return {accessToken:body.access_token,refreshToken,expiresAt:Date.now()+body.expires_in*1000,refreshExpiresAt,scopes:scopesFrom(body.scope,previous?.scopes)};
}
function redirectResult(config:Config,key:"google_oauth_result"|"google_oauth_error",value:string){const url=new URL("/",config.origin);url.searchParams.set(key,value);return url.href;}
function callbackErrorCode(error: unknown) {
  if(!(error instanceof GoogleOAuthError))return "unavailable";
  if(error.code.includes("SCOPE"))return "scope";
  if(error.code.includes("REFRESH_REQUIRED"))return "offline_access";
  if(error.code.includes("STATE")||error.code.includes("ALREADY_USED"))return "expired";
  if(error.code.includes("ACCOUNT"))return "account";
  if(error.status==="unconfigured")return "configuration";
  return "unavailable";
}

export async function handleGoogleOAuthCallback(request: NextRequest) {
  const config=readConfig();assertOrigin(request,config,true);
  try {
    const params=request.nextUrl.searchParams,state=params.get("state")??"";
    if(params.getAll("state").length!==1||!OPAQUE.test(state))throw denied("GOOGLE_OAUTH_STATE_INVALID","연결 요청을 확인할 수 없습니다.");
    const nonce=readNonce(request,config),key=config.namespace+":state:"+hash(state),encrypted=await readRecord(config,key);
    if(!encrypted)throw denied("GOOGLE_OAUTH_STATE_INVALID","연결 요청이 만료되었습니다.");
    const flow=decrypt<Flow>(config,"state",encrypted);validateFlow(config,flow,nonce);
    if(!OPAQUE.test(flow.verifier))throw denied("GOOGLE_OAUTH_STATE_INVALID","연결 요청을 확인할 수 없습니다.");
    if(params.getAll("error").length>1||params.getAll("error_subtype").length>1||(params.has("error")&&params.has("code")))throw denied("GOOGLE_OAUTH_STATE_INVALID","Google 인증 응답을 확인할 수 없습니다.");
    await consume(config,key,encrypted);
    if(params.has("error")){
      const cancelled=params.get("error")==="access_denied"&&!params.has("error_subtype");
      return {redirectUrl:redirectResult(config,"google_oauth_error",cancelled?"cancelled":"configuration"),clearCookie:true};
    }
    const code=params.get("code")??"";
    if(params.getAll("code").length!==1||!code||code.length>8192)throw denied("GOOGLE_OAUTH_STATE_INVALID","Google 인증 응답을 확인할 수 없습니다.");
    const response=await googleFetch(TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,redirect_uri:config.redirectUri,grant_type:"authorization_code",code,code_verifier:flow.verifier})});
    if(!response.ok){await response.body?.cancel();throw failure("GOOGLE_OAUTH_EXCHANGE_FAILED","Google 인증을 완료하지 못했습니다. 다시 연결해 주세요.");}
    const credentials=tokenFields(await jsonBody(response));
    const identity=await googleFetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{authorization:"Bearer "+credentials.accessToken}});
    if(!identity.ok){await identity.body?.cancel();throw denied("GOOGLE_OAUTH_ACCOUNT_INVALID","연결할 Google 계정을 확인하지 못했습니다.");}
    const profile=await jsonBody(identity);
    if(typeof profile.sub!=="string"||!profile.sub||profile.sub.length>255||typeof profile.email!=="string"||profile.email.length>254||!/^\S+@\S+\.\S+$/.test(profile.email)||profile.email_verified!==true)throw denied("GOOGLE_OAUTH_ACCOUNT_INVALID","확인된 Google 이메일 계정으로 다시 연결해 주세요.");
    const result=opaque(),pending:Pending={...flow,...credentials,email:profile.email,subject:profile.sub,createdAt:Date.now()};
    const saved=await storage(()=>config.redis.set(config.namespace+":pending:"+hash(result),encrypt(config,"pending",pending),{nx:true,ex:FLOW_SECONDS}));
    if(saved!=="OK")throw failure();
    return {redirectUrl:redirectResult(config,"google_oauth_result",result),clearCookie:false};
  } catch(error) { return {redirectUrl:redirectResult(config,"google_oauth_error",callbackErrorCode(error)),clearCookie:false}; }
}

export async function completeGoogleOAuth(request: NextRequest, userId: string, result: unknown) {
  const config=readConfig();assertOrigin(request,config);
  if(typeof result!=="string"||!OPAQUE.test(result))throw denied("GOOGLE_OAUTH_RESULT_INVALID","연결 완료 요청이 올바르지 않습니다. 다시 연결해 주세요.");
  const nonce=readNonce(request,config),key=config.namespace+":pending:"+hash(result),encrypted=await readRecord(config,key);
  if(!encrypted)throw denied("GOOGLE_OAUTH_ALREADY_USED","이미 처리되었거나 만료된 연결 요청입니다. 연결 상태를 확인해 주세요.");
  const pending=decrypt<Pending>(config,"pending",encrypted);validateFlow(config,pending,nonce);
  if(pending.userId!==userId)throw new GoogleOAuthError("access_denied","GOOGLE_OAUTH_USER_MISMATCH","연결을 시작한 관리자 계정으로 로그인해 주세요.",403);
  await consume(config,key,encrypted);
  if(await generation(config)!==pending.generation)throw denied("GOOGLE_OAUTH_CONNECTION_CHANGED","다른 관리자가 연결 상태를 변경했습니다. 현재 연결을 확인한 뒤 다시 진행해 주세요.");
  if(typeof pending.accessToken!=="string"||!TOKEN.test(pending.accessToken)||typeof pending.refreshToken!=="string"||!TOKEN.test(pending.refreshToken)||!Number.isFinite(pending.expiresAt)||pending.expiresAt<=Date.now()||!Array.isArray(pending.scopes)||typeof pending.email!=="string"||typeof pending.subject!=="string")throw denied("GOOGLE_OAUTH_RESULT_EXPIRED","연결 완료 시간이 지났습니다. Google 계정을 다시 연결해 주세요.");
  const response=await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SOURCE_ID}?fields=spreadsheetId,sheets.properties(sheetId)`,{headers:{authorization:"Bearer "+pending.accessToken}});
  if(!response.ok){await response.body?.cancel();throw new GoogleOAuthError(response.status>=500||response.status===429?"upstream_error":"access_denied","GOOGLE_OAUTH_SHEET_ACCESS","선택한 Google 계정이 점검 일정 시트를 읽을 수 없습니다. 해당 계정의 시트 보기 권한을 확인해 주세요.",403);}
  const sheet=await jsonBody(response);
  if(sheet.spreadsheetId!==SOURCE_ID||!Array.isArray(sheet.sheets)||!sheet.sheets.some((entry:{properties?:{sheetId?:unknown}})=>entry?.properties?.sheetId===SOURCE_GID))throw denied("GOOGLE_OAUTH_SHEET_INVALID","연결 대상의 점검 일정 탭을 확인할 수 없습니다.");
  const connection:Connection={version:1,revision:randomUUID(),fingerprint:config.fingerprint,email:pending.email,subject:pending.subject,connectedBy:userId,connectedAt:new Date().toISOString(),needsReauth:false,
    accessToken:pending.accessToken,refreshToken:pending.refreshToken,expiresAt:pending.expiresAt,refreshExpiresAt:pending.refreshExpiresAt,scopes:pending.scopes};
  const saved=await storage(()=>config.redis.eval<unknown[],number>(CONNECT,[generationKey(config),connectionKey(config)],[pending.generation,encrypt(config,"connection",connection),randomUUID()]));
  if(saved!==1)throw denied("GOOGLE_OAUTH_CONNECTION_CHANGED","연결 상태가 변경되었습니다. 현재 연결을 확인한 뒤 다시 진행해 주세요.");
}

function validateConnection(config: Config, record: Connection) {
  if(!record||record.version!==1||typeof record.revision!=="string"||typeof record.email!=="string"||typeof record.connectedAt!=="string"||typeof record.subject!=="string"||typeof record.connectedBy!=="string"||typeof record.needsReauth!=="boolean"||!Array.isArray(record.scopes)||!Number.isFinite(record.expiresAt)||(record.refreshExpiresAt!==null&&!Number.isFinite(record.refreshExpiresAt)))throw denied("GOOGLE_OAUTH_RECORD_INVALID","저장된 Google 연결 정보를 확인할 수 없습니다. 다시 연결해 주세요.");
  if(record.fingerprint!==config.fingerprint)throw denied("GOOGLE_OAUTH_CLIENT_CHANGED","Google OAuth 설정이 변경되었습니다. 관리자가 다시 연결해 주세요.");
  if(!record.needsReauth&&(typeof record.accessToken!=="string"||typeof record.refreshToken!=="string"||!TOKEN.test(record.accessToken)||!TOKEN.test(record.refreshToken)))throw denied("GOOGLE_OAUTH_RECORD_INVALID","저장된 Google 연결 정보를 확인할 수 없습니다. 다시 연결해 주세요.");
  return record;
}
async function storedConnection(config: Config) {
  const encrypted=await readRecord(config,connectionKey(config));
  return encrypted?{encrypted,record:validateConnection(config,decrypt<Connection>(config,"connection",encrypted))}:null;
}
async function markReauth(config:Config,stored:{encrypted:string;record:Connection}) {
  const replacement={...stored.record,needsReauth:true,accessToken:"",refreshToken:"",expiresAt:0};
  await storage(()=>config.redis.eval<unknown[],number>(REPLACE,[connectionKey(config)],[stored.encrypted,encrypt(config,"connection",replacement)]));
}

export async function getGoogleOAuthAccessToken(): Promise<{accessToken:string;revision:string}> {
  const config=readConfig();let stored=await storedConnection(config);
  if(!stored)throw denied("GOOGLE_OAUTH_DISCONNECTED","관리자가 Google 계정을 연결해야 점검 일정을 조회할 수 있습니다.");
  if(stored.record.needsReauth||(stored.record.refreshExpiresAt!==null&&stored.record.refreshExpiresAt<=Date.now())){
    if(!stored.record.needsReauth)await markReauth(config,stored);
    throw denied("GOOGLE_OAUTH_REAUTH_REQUIRED","Google 연결 권한이 만료되거나 철회되었습니다. 관리자가 다시 연결해 주세요.");
  }
  if(stored.record.expiresAt>Date.now()+60_000)return {accessToken:stored.record.accessToken,revision:stored.record.revision};
  const lockKey=config.namespace+":refresh-lock",owner=opaque();
  const acquired=await storage(()=>config.redis.set(lockKey,owner,{nx:true,ex:30}));
  if(acquired!=="OK")throw failure("GOOGLE_OAUTH_REFRESH_BUSY","Google 연결을 갱신하고 있습니다. 잠시 후 다시 조회해 주세요.");
  try {
    // Re-read after acquiring the lock: another invocation may have refreshed or disconnected.
    stored=await storedConnection(config);
    if(!stored||stored.record.needsReauth)throw denied("GOOGLE_OAUTH_DISCONNECTED","Google 연결이 변경되었습니다. 다시 확인해 주세요.");
    if(stored.record.expiresAt>Date.now()+60_000)return {accessToken:stored.record.accessToken,revision:stored.record.revision};
    const response=await googleFetch(TOKEN_URL,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:"refresh_token",refresh_token:stored.record.refreshToken})});
    if(!response.ok){
      if(response.status>=500||response.status===429){await response.body?.cancel();throw failure("GOOGLE_OAUTH_REFRESH_UNAVAILABLE","Google 인증 갱신에 일시적으로 실패했습니다. 다시 조회해 주세요.");}
      const error=await jsonBody(response);
      if(error.error==="invalid_grant"){await markReauth(config,stored);throw denied("GOOGLE_OAUTH_REAUTH_REQUIRED","Google 연결 권한이 만료되거나 철회되었습니다. 관리자가 다시 연결해 주세요.");}
      throw new GoogleOAuthError("unconfigured","GOOGLE_OAUTH_REFRESH_REJECTED","Google OAuth 클라이언트 설정을 확인해 주세요.");
    }
    const fields=tokenFields(await jsonBody(response),stored.record);
    const refreshed={...stored.record,...fields};
    const previousCiphertext=stored.encrypted;
    const saved=await storage(()=>config.redis.eval<unknown[],number>(REPLACE,[connectionKey(config)],[previousCiphertext,encrypt(config,"connection",refreshed)]));
    if(saved!==1)throw denied("GOOGLE_OAUTH_CONNECTION_CHANGED","갱신 중 Google 연결이 변경되었습니다. 다시 조회해 주세요.");
    return {accessToken:refreshed.accessToken,revision:refreshed.revision};
  } finally {
    // A timed-out/expired lock must never remove a newer invocation's lock.
    await storage(()=>config.redis.eval<unknown[],number>(CONSUME,[lockKey],[owner]));
  }
}

export async function disconnectGoogleOAuth(request: NextRequest) {
  const config=readConfig();assertOrigin(request,config);
  await storage(()=>config.redis.eval<unknown[],number>(DISCONNECT,[connectionKey(config),generationKey(config)],[randomUUID()]));
  // Deliberately do not call Google's revoke endpoint: this OAuth client may serve an existing wiki.
}

export async function getGoogleConnectionStatus(role: UserRole): Promise<GoogleConnectionStatus> {
  const canManage=role==="admin";
  const empty=(status:GoogleConnectionStatus["status"],message:string|null):GoogleConnectionStatus=>({status,accountEmail:null,connectedAt:null,message,canManage});
  try {
    const config=readConfig(),stored=await storedConnection(config);
    const metadata=canManage?{callbackUrl:config.redirectUri}:{};
    if(!stored)return {...empty("disconnected","관리자가 Google 계정을 연결하면 팀의 점검 일정을 조회할 수 있습니다."),...metadata};
    const reauth=stored.record.needsReauth||(stored.record.refreshExpiresAt!==null&&stored.record.refreshExpiresAt<=Date.now());
    return {status:reauth?"reauth_required":"connected",accountEmail:stored.record.email,connectedAt:stored.record.connectedAt,message:reauth?"Google 계정 권한을 다시 확인해야 합니다. 관리자가 재연결해 주세요.":null,canManage,...metadata};
  } catch(error) {
    if(error instanceof GoogleOAuthError){
      const status=error.status==="unconfigured"?"unconfigured":error.status==="access_denied"?"reauth_required":"unavailable";
      const result=empty(status,error.message);
      if(canManage&&status==="unconfigured"){result.missing=missingConfig();const uri=configFields().redirectUri;try {const u=new URL(uri);if(u.protocol==="https:"&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname===CALLBACK_PATH)result.callbackUrl=uri;}catch{}}
      return result;
    }
    return empty("unavailable","Google 연결 상태를 확인하지 못했습니다. 다시 확인해 주세요.");
  }
}
