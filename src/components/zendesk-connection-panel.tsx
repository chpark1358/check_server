"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PreviewApi } from "@/lib/preview/api";
import type { ZendeskConnectionResult as Result } from "@/lib/zendesk-connection";

type Props = { accessToken: string; apiClient?: PreviewApi };

async function loadConnection(props: Props, method: "GET" | "POST", signal: AbortSignal): Promise<Result> {
  const init: RequestInit = { method, signal, cache: "no-store" };
  const data = props.apiClient
    ? await props.apiClient("/api/zendesk/connection", init) as Result
    : await fetch("/api/zendesk/connection", {
      ...init, headers: { authorization: `Bearer ${props.accessToken}` },
    }).then(response => response.json()) as Result;
  if (!data.ok || !data.connection) throw new Error(data.message || "연결 상태를 확인할 수 없습니다.");
  return data;
}

export function ZendeskConnectionPanel(props: Props) {
  return <ConnectionPanel key={props.accessToken} {...props} />;
}

function ConnectionPanel(props: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const { accessToken, apiClient } = props;

  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    void loadConnection({ accessToken, apiClient }, "GET", controller.signal)
      .then(data => { if (!controller.signal.aborted) setResult(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "상태 조회 실패"); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [accessToken, apiClient]);

  async function verify() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(null);
    // A failed recheck must not retain the previous verified-account badge.
    setResult(current => current ? { ...current, account: undefined, capabilities: undefined, readAccess: undefined, verifiedAt: undefined } : null);
    try {
      const data = await loadConnection(props, "GET", controller.signal);
      if (!controller.signal.aborted) setResult(data);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "연결 확인 실패");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const connection = result?.connection;
  return <section aria-labelledby="zendesk-connection-title" className="rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 id="zendesk-connection-title" className="font-semibold">Zendesk OAuth 연결</h3>
        <p className="mt-1 text-sm text-muted-foreground">서버가 공용 업무 계정으로 자동 인증하고 만료 전에 갱신합니다. 조직·수신자·그룹의 조회 권한도 자동 확인합니다.</p></div>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void verify()}>
        {busy ? "자동 확인 중" : connection?.configured ? "다시 확인" : "설정 새로고침"}
      </Button>
    </div>
    <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={error || result?.readAccess === "unavailable" ? "destructive" : "secondary"}>
        {busy ? "자동 확인 중" : error ? "확인 실패" : result?.readAccess === "ready" ? "자동 연결 · 조회 가능" : result?.readAccess === "partial" ? "자동 인증됨 · 일부 조회 제한" : result?.readAccess === "unavailable" ? "자동 인증됨 · 조회 권한 확인 필요" : connection?.configured ? "설정됨 · 조회 확인 전" : "OAuth 설정 필요"}
      </Badge>
      {connection?.subdomain && <span>{connection.subdomain}.zendesk.com</span>}
      {apiClient && <Badge variant="outline">가상 연결</Badge>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {result?.account && <p className="mt-3 text-sm">연결 계정: {result.account.name || "이름 없음"} · {result.account.email || result.account.id} · {result.account.role || "역할 확인 필요"}</p>}
    {result?.capabilities && <ul aria-label="Zendesk 기능별 조회 권한" className="mt-4 grid gap-2 sm:grid-cols-2">
      {result.capabilities.map(capability => <li key={capability.id} className="rounded-md border bg-background/50 p-3 text-sm">
        <div className="flex items-center justify-between gap-2"><span>{capability.label}</span><Badge variant={capability.status === "available" ? "secondary" : "outline"}>
          {capability.status === "available" ? "조회 가능" : capability.status === "forbidden" ? "권한 부족" : "확인 실패"}
        </Badge></div>
        {capability.message && <p className="mt-2 text-xs text-destructive">{capability.message}</p>}
      </li>)}
    </ul>}
    {connection && !connection.configured && <p className="mt-3 text-sm text-muted-foreground">
      {connection.missingKeys.length ? `서버 설정에 ${connection.missingKeys.join(", ")} 값이 필요합니다.` : "서버의 OAuth 설정 형식을 확인하세요."} 비밀값은 Vercel 환경변수에서 관리합니다.
    </p>}
    {connection?.configured && <p className="mt-3 text-xs text-muted-foreground">{connection.scopes.some(scope => scope.endsWith(":write")) ? "조회·티켓·첨부 권한 요청" : "조회 권한만 요청 · 실제 발송 차단"} · 이 검사는 데이터를 변경하지 않으며 티켓 발송·첨부 쓰기 권한은 검증하지 않습니다.</p>}
    {connection?.configured && <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">권한 범위 상세</summary>
      <p className="mt-2 break-words">요청 범위: {connection.scopes.join(" · ")}</p>
      <p className="mt-1 break-words">발급된 토큰 범위: {connection.grantedScopes?.join(" · ") || "Zendesk 응답에 제공되지 않음"}</p>
    </details>}
  </section>;
}
