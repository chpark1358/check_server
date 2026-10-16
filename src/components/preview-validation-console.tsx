"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { observePersistedSession } from "@/lib/supabase/session-observer";
import { Button } from "@/components/ui/button";
import { runSearchLoad, type SearchLoadReport, type SearchLoadProgress, type SearchTransportInput, type SearchTransportResult } from "@/lib/validation/search-load";
import { readSearchResponse } from "@/lib/validation/search-response";

type Role = "admin" | "operator" | "viewer";
type Probe = { name: string; expected: string; actual: string; pass: boolean; ms: number; note?: string };
const verificationDocumentId = "efa0c196-6d8e-42f2-afcc-316f66d4c83b";
const knownPreviewHost = "check-server-site-git-codex-pre-778fb5-chpark425-3494s-projects.vercel.app";

export function PreviewValidationConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [report, setReport] = useState<SearchLoadReport | null>(null);
  const [progress, setProgress] = useState<SearchLoadProgress | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const runController = useRef<AbortController | null>(null);
  const runLock = useRef(false);

  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    try {
      const client = createBrowserSupabaseClient();
      stop = observePersistedSession(client.auth, next => {
        if (sessionRef.current?.user.id !== next?.user.id) {
          runController.current?.abort(); runController.current = null; runLock.current = false;
          setBusy(false); setProbes([]); setReport(null); setProgress(null); setRole(null);
        }
        sessionRef.current = next; setSession(next); setRestoring(false);
      }, () => { setError("로그인 상태를 복원하지 못했습니다."); setRestoring(false); });
    } catch { queueMicrotask(() => { if (active) { setError("로그인 설정을 확인할 수 없습니다."); setRestoring(false); } }); }
    return () => { active = false; stop?.(); runController.current?.abort(); runController.current = null; };
  }, []);

  useEffect(() => {
    if (!session?.access_token) return;
    const controller = new AbortController();
    void fetch("/api/health", { headers: { authorization: `Bearer ${session.access_token}` }, cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !["viewer", "operator", "admin"].includes(data.role)) throw new Error("로그인을 확인해 주세요.");
        if (!controller.signal.aborted) setRole(data.role);
      }).catch(() => { if (!controller.signal.aborted) setError("로그인을 확인해 주세요."); });
    return () => controller.abort();
  }, [session?.access_token]);

  function start() {
    if (runLock.current) return null;
    if (location.hostname !== knownPreviewHost && !["localhost", "127.0.0.1"].includes(location.hostname)) {
      setError("고정 Preview 주소에서만 검증할 수 있습니다."); return null;
    }
    if (!sessionRef.current || !role) { setError("현재 계정의 역할을 먼저 확인해 주세요."); return null; }
    runLock.current = true; setBusy(true); setError(null);
    const controller = new AbortController(); runController.current = controller;
    return { controller, userId: sessionRef.current.user.id };
  }
  function isCurrent(run: { controller: AbortController; userId: string }) { return runController.current === run.controller && sessionRef.current?.user.id === run.userId; }
  function finish(run: { controller: AbortController; userId: string }) { if (!isCurrent(run)) return; runLock.current = false; setBusy(false); runController.current = null; }

  async function verifyRoles() {
    const run = start(); if (!run) return;
    setProbes([]);
    const collected: Probe[] = [];
    const add = (row: Probe) => { if (isCurrent(run)) { collected.push(row); setProbes([...collected]); } };
    const cases = [
      { name: "비로그인 · 상태 조회", path: "/api/health", authenticated: false, expected: 401 },
      { name: "비로그인 · 문서 조회", path: "/api/documents?limit=1", authenticated: false, expected: 401 },
      { name: "비로그인 · 관리자 조회", path: "/api/admin/overview?section=audit&limit=1", authenticated: false, expected: 401 },
      { name: "현재 계정 · 상태 조회", path: "/api/health", authenticated: true, expected: 200 },
      { name: "현재 계정 · 개인 설정", path: "/api/user/preferences", authenticated: true, expected: 200 },
      { name: "현재 계정 · 문서 목록", path: "/api/documents?limit=1&q=24123103", authenticated: true, expected: role === "viewer" ? 403 : 200 },
      { name: "현재 계정 · 통합 이력", path: "/api/history/overview?limit=1&range=7d&q=24123103", authenticated: true, expected: role === "viewer" ? 403 : 200 },
      { name: "현재 계정 · 최근 발송 이력", path: "/api/history/ticket-sends?limit=1", authenticated: true, expected: role === "viewer" ? 403 : 200 },
      { name: "현재 계정 · 관리자 조회", path: "/api/admin/overview?section=audit&limit=1&range=7", authenticated: true, expected: role === "admin" ? 200 : 403 },
      { name: "관리자 소유 검증 문서 · 파일 접근", path: `/api/documents/${verificationDocumentId}/download?type=pdf`, authenticated: true, expected: role === "admin" ? 200 : 403 },
    ];
    try {
      for (const item of cases) {
        if (run.controller.signal.aborted || sessionRef.current?.user.id !== run.userId) throw new Error("검증이 중단되었습니다.");
        const begin = performance.now();
        const response = await fetch(item.path, { method: "GET", credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.any([run.controller.signal, AbortSignal.timeout(10000)]), headers: item.authenticated ? { authorization: `Bearer ${sessionRef.current.access_token}` } : {} });
        const text = response.headers.get("content-type")?.includes("application/json") ? await response.text() : null;
        if (text === null) await response.arrayBuffer();
        let ownerMismatch = false;
        if (response.status === 200 && item.path.startsWith("/api/documents?")) {
          const data = JSON.parse(text || "{}");
          ownerMismatch = !Array.isArray(data.documents) || data.documents.some((row: { createdBy?: string }) => row.createdBy !== run.userId);
        }
        if (response.status === 200 && role !== "admin" && item.path.startsWith("/api/history/ticket-sends")) {
          const data = JSON.parse(text || "{}");
          ownerMismatch = !Array.isArray(data.sends) || data.sends.some((row: { sent_by?: string }) => row.sent_by !== run.userId);
        }
        add({ name: item.name, expected: String(item.expected), actual: String(response.status), pass: response.status === item.expected && !ownerMismatch, ms: Math.round(performance.now() - begin), ...(ownerMismatch ? { note: "소유자 범위 확인 실패" } : {}) });
        if (response.status >= 500 || response.status === 429) return;
      }
      if (!run.controller.signal.aborted && isCurrent(run)) {
        const begin = performance.now();
        const { data, error: dbError } = await createBrowserSupabaseClient().from("generated_documents").select("id").eq("id", verificationDocumentId).abortSignal(AbortSignal.any([run.controller.signal, AbortSignal.timeout(10000)]));
        if (sessionRef.current?.user.id !== run.userId) throw new Error("계정이 변경되었습니다.");
        const expected = role === "admin" ? 1 : 0;
        add({ name: "DB RLS · 관리자 소유 검증 문서", expected: `${expected}행`, actual: dbError ? "오류" : `${data?.length ?? 0}행`, pass: !dbError && data?.length === expected, ms: Math.round(performance.now() - begin) });
      }
    } catch { if (isCurrent(run)) setError("검증 요청이 중단되었거나 응답을 확인할 수 없습니다. 완료된 결과만 표시합니다."); }
    finally { finish(run); }
  }

  async function measureSearch() {
    if (role !== "admin") { setError("검색 부하 측정은 관리자 계정에서 실행합니다."); return; }
    const run = start(); if (!run) return;
    setReport(null); setProgress(null);
    try {
      const transport = async (input: SearchTransportInput): Promise<SearchTransportResult> => {
        if (sessionRef.current?.user.id !== run.userId) throw new Error("Account changed");
        const response = await fetch(input.path, { method: "GET", headers: { authorization: `Bearer ${sessionRef.current.access_token}` }, signal: input.signal, credentials: "omit", redirect: "error", cache: "no-store" });
        return readSearchResponse(response, input.scenario.id);
      };
      const result = await runSearchLoad({ transport, onProgress: next => { if (isCurrent(run)) setProgress(next); }, signal: run.controller.signal });
      if (isCurrent(run)) setReport(result);
    } catch { if (isCurrent(run)) setError("측정이 중단되었습니다. 계정 또는 연결 상태를 확인해 주세요."); }
    finally { finish(run); }
  }

  function downloadEvidence() {
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), origin: location.origin, role, accountLabel: role ? `signed-in-${role}` : "unknown", probes, search: report }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "preview-access-search-validation.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <main className="mx-auto max-w-6xl space-y-6 p-5 sm:p-10">
    <header className="space-y-3"><p className="text-sm text-muted-foreground">Check Server · Preview 검증</p><h1 className="text-3xl font-semibold">권한과 검색 응답 검증</h1><p className="text-sm leading-6 text-muted-foreground">현재 로그인 계정으로 기존 API를 호출합니다. 결과에는 상태 코드·건수·시간만 저장하며 계정 토큰과 업무 응답 원문은 포함하지 않습니다.</p><Link className="text-sm underline" href="/">점검 사이트로 돌아가기</Link></header>
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">현재 검증 계정</h2><p className="mt-2 text-sm">{restoring ? "로그인 확인 중" : session ? `${session.user.email} · ${role ?? "역할 확인 중"}` : "로그인 필요 — 점검 사이트에서 로그인한 뒤 이 페이지로 돌아오세요."}</p></section>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
    <section className="space-y-4 rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">1. 역할·소유권 확인</h2><p className="text-sm text-muted-foreground">비로그인 요청과 현재 역할의 읽기 권한, 개인 문서 범위, 관리자 소유 검증 문서의 RLS 접근을 확인합니다. 다른 역할의 실제 로그인 검증은 해당 계정이 있어야 가능합니다.</p><Button disabled={busy || !role} onClick={() => void verifyRoles()}>현재 계정 권한 검증</Button>
      {probes.length > 0 && <div className="overflow-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr>{["검증 항목", "기대", "실제", "결과", "시간"].map(h => <th key={h} className="border-b p-2">{h}</th>)}</tr></thead><tbody>{probes.map(p => <tr key={p.name}><td className="border-b p-2">{p.name}{p.note && <small className="block text-destructive">{p.note}</small>}</td><td className="border-b p-2">{p.expected}</td><td className="border-b p-2">{p.actual}</td><td className="border-b p-2">{p.pass ? "통과" : "확인 필요"}</td><td className="border-b p-2 tabular-nums">{p.ms}ms</td></tr>)}</tbody></table></div>}
    </section>
    <section className="space-y-4 rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">2. 검색 응답 측정</h2><p className="text-sm text-muted-foreground">문서·이력·관리자 감사 검색 4종. 총 76회, 초당 최대 2회 시작, 최대 동시 요청 1→2→4로 진행합니다. 오류·10초 초과 응답은 측정을 중단합니다. 첫 관측 요청은 서버의 cold start를 뜻하지 않습니다.</p><div className="flex flex-wrap gap-2"><Button disabled={busy || role !== "admin" || probes.length !== 11 || probes.some(p => !p.pass)} onClick={() => void measureSearch()}>검색 부하 측정 시작</Button><Button variant="outline" disabled={!busy} onClick={() => runController.current?.abort()}>중단</Button><Button variant="outline" disabled={busy || (!report && !probes.length)} onClick={downloadEvidence}>검증 결과 JSON 다운로드</Button></div>
      {progress && <pre role="status" className="overflow-auto rounded-lg bg-muted p-3 text-xs">{JSON.stringify(progress, null, 2)}</pre>}
      {report && <div><h3 className="font-semibold">측정 결과</h3><p className="my-2 text-sm text-muted-foreground">같은 계정·현재 데이터 규모의 제한된 표본입니다. 대량 데이터 또는 여러 사용자의 수용량을 보장하지 않습니다.</p><pre className="max-h-[640px] overflow-auto rounded-lg bg-muted p-4 text-xs" aria-label="검색 측정 결과">{JSON.stringify(report, null, 2)}</pre></div>}
    </section>
  </main>;
}
