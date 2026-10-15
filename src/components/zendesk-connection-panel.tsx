"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PreviewApi } from "@/lib/preview/api";

type Connection = {
  configured: boolean;
  authentication: "oauth";
  grantType: "client_credentials";
  subdomain: string | null;
  missingKeys: string[];
  scopes: string[];
  accessTokenExpiresAt: string | null;
};
type Result = {
  ok: boolean;
  message?: string;
  connection: Connection;
  account?: { id: string; name: string | null; email: string | null; role: string | null };
  verifiedAt?: string;
};
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
    setResult(current => current ? { ...current, account: undefined, verifiedAt: undefined } : null);
    try {
      const data = await loadConnection(props, result?.connection.configured ? "POST" : "GET", controller.signal);
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
        <p className="mt-1 text-sm text-muted-foreground">공용 업무 계정으로 연결합니다. 연결 확인은 계정 정보를 조회하며 티켓을 발송하지 않습니다.</p></div>
      <Button type="button" variant="outline" disabled={busy} onClick={() => void verify()}>
        {busy ? "확인 중" : connection?.configured ? "연결 확인" : "설정 새로고침"}
      </Button>
    </div>
    <div role="status" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={error ? "destructive" : "secondary"}>
        {busy ? "확인 중" : error ? "확인 실패" : result?.verifiedAt ? "연결 확인됨" : connection?.configured ? "설정됨 · 연결 확인 전" : "OAuth 설정 필요"}
      </Badge>
      {connection?.subdomain && <span>{connection.subdomain}.zendesk.com</span>}
      {apiClient && <Badge variant="outline">가상 연결</Badge>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {result?.account && <p className="mt-3 text-sm">연결 계정: {result.account.name || "이름 없음"} · {result.account.email || result.account.id} · {result.account.role || "역할 확인 필요"}</p>}
    {connection && !connection.configured && <p className="mt-3 text-sm text-muted-foreground">
      {connection.missingKeys.length ? `서버 설정에 ${connection.missingKeys.join(", ")} 값이 필요합니다.` : "서버의 OAuth 설정 형식을 확인하세요."} 비밀값은 Vercel 환경변수에서 관리합니다.
    </p>}
    {connection?.configured && <p className="mt-3 text-xs text-muted-foreground">{connection.scopes.some(scope => scope.endsWith(":write")) ? "조회·티켓·첨부 권한 요청" : "조회 권한만 요청 · 실제 발송 차단"} · 연결 확인은 모든 기능의 권한 검증을 대신하지 않습니다.</p>}
  </section>;
}
