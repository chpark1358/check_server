"use client";

import { useId, useRef, useState } from "react";
import { CheckCircle2, Copy, Eye, Link2, Loader2, LockKeyhole, RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GoogleConnectionStatus } from "@/lib/google-oauth-types";

export type GoogleSheetConnectionProps = {
  connection: GoogleConnectionStatus | null;
  role: string | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onRefresh: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
};

const stateLabels: Record<GoogleConnectionStatus["status"], string> = {
  unconfigured: "OAuth 설정 필요", disconnected: "연결 전", connected: "Google 계정 연결됨",
  reauth_required: "Google 재연결 필요", unavailable: "연결 상태 확인 불가",
};
const stateDescriptions: Record<GoogleConnectionStatus["status"], string> = {
  unconfigured: "관리자가 Google OAuth 설정을 등록하면 계정을 연결할 수 있습니다.",
  disconnected: "일정 시트를 볼 수 있는 Google 계정으로 연결해 주세요.",
  connected: "연결 계정으로 지정된 일정 시트를 읽습니다. 실제 조회 결과는 아래 일정 목록에서 확인하세요.",
  reauth_required: "Google 인증이 만료되었거나 접근이 해제되었습니다. 관리자가 다시 연결해 주세요.",
  unavailable: "연결 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.",
};

function dateLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "연결 시각 기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(value)) + " KST";
}

function callbackLabel(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowedProtocol = url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
    return allowedProtocol && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/api/google/oauth/callback" ? url.href : null;
  } catch { return null; }
}

export function GoogleSheetConnection({connection,role,loading,busy,error,notice,onRefresh,onConnect,onDisconnect}: GoogleSheetConnectionProps) {
  const titleId = useId();
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const permitted = role === "admin" || role === "operator";
  const canManage = role === "admin" && connection?.canManage === true;
  const pending = loading || busy;
  const status = connection?.status;
  const hasAccount = status === "connected" || status === "reauth_required";
  const identity = (connection?.accountEmail ?? "") + "\0" + (connection?.connectedAt ?? "");
  const dialogOpen = Boolean(canManage && hasAccount && confirmTarget === identity);
  const callbackUrl = canManage ? callbackLabel(connection?.callbackUrl) : null;
  const needsAttention = status === "reauth_required" || status === "unavailable" || Boolean(error);
  const canConnect = canManage && (status === "connected" || status === "disconnected" || status === "reauth_required");

  async function copyCallback() {
    if (!callbackUrl) return;
    try { await navigator.clipboard.writeText(callbackUrl); setCopyNotice("콜백 주소를 복사했습니다."); }
    catch { setCopyNotice("복사하지 못했습니다. 표시된 주소를 선택해 복사하세요."); }
  }

  if (!permitted) return <section aria-labelledby={titleId} className="rounded-xl border bg-card p-4 sm:p-5">
    <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="size-4" aria-hidden />Google 시트 연결</h2>
    <p role={role ? "alert" : "status"} className="mt-2 text-sm text-muted-foreground">{role ? "점검 일정 조회 권한이 필요합니다. 관리자에게 문의해 주세요." : "조회 권한을 확인하고 있습니다."}</p>
  </section>;

  return <section aria-labelledby={titleId} aria-busy={pending} className="rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id={titleId} className="flex items-center gap-2 font-semibold"><Link2 className="size-4 text-primary" aria-hidden />Google 시트 연결</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">연결된 Google 계정으로 지정된 일정 시트를 읽고, 관리자·operator가 함께 조회합니다.</p>
      </div>
      <Button ref={refreshRef} type="button" variant="outline" className="min-h-11 shrink-0" disabled={pending} onClick={onRefresh}><RefreshCw className="size-4" aria-hidden />{loading ? "확인 중" : "연결 상태 확인"}</Button>
    </div>

    {loading && !connection ? <div role="status" className="mt-4 space-y-2"><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />Google 연결 상태를 불러오고 있습니다.</p><div aria-hidden className="h-10 rounded-md bg-muted motion-safe:animate-pulse" /></div> : <>
      <div role="status" className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className={needsAttention ? "border-amber-500/40 text-amber-700 dark:text-amber-400" : "border-primary/20 text-primary"}>
          {busy || loading ? <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden /> : needsAttention ? <TriangleAlert className="size-3.5" aria-hidden /> : status === "connected" ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}
          {busy ? "연결 요청 처리 중" : loading ? "연결 상태 확인 중" : error ? "연결 상태 확인 필요" : status ? stateLabels[status] : "연결 상태 확인 전"}
        </Badge>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Eye className="size-3.5" aria-hidden />시트 읽기 전용</span>
      </div>
      {hasAccount && connection?.accountEmail && <div className="mt-3 min-w-0 space-y-1"><p className="break-all text-sm"><span className="text-muted-foreground">{loading || error ? "마지막 확인한 연결 계정: " : "연결 계정: "}</span>{connection.accountEmail}</p><p className="text-xs text-muted-foreground">{dateLabel(connection.connectedAt)}</p></div>}
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{connection?.message || (status ? stateDescriptions[status] : "연결 상태를 다시 확인해 주세요.")}</p>
    </>}

    {error && <p role="alert" className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm leading-relaxed text-primary">{notice}</p>}

    {canManage && status === "unconfigured" && <div className="mt-4 space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
      <p className="font-medium">관리자 연결 설정</p>
      {Boolean(connection?.missing?.length) && <div><p className="text-xs text-muted-foreground">필요한 서버 설정</p><ul className="mt-1 space-y-1">{connection!.missing!.map(name=><li key={name}><code className="break-all text-xs">{name}</code></li>)}</ul></div>}
      {callbackUrl && <div><p className="mb-1 text-xs text-muted-foreground">Google OAuth의 승인된 리디렉션 URI</p><div className="flex items-start gap-2"><code className="min-w-0 flex-1 break-all rounded-md border bg-background p-2 text-xs leading-relaxed">{callbackUrl}</code><Button type="button" variant="outline" className="min-h-11 shrink-0" aria-label="Google OAuth 콜백 주소 복사" onClick={()=>void copyCallback()}><Copy className="size-4" aria-hidden />복사</Button></div>{copyNotice && <p role="status" className="mt-2 text-xs text-muted-foreground">{copyNotice}</p>}</div>}
      <p className="text-xs leading-relaxed text-muted-foreground">웹 애플리케이션용 클라이언트에 콜백 주소를 추가하고 Vercel 서버 환경변수를 등록해 재배포합니다. Client Secret과 토큰은 이 화면이나 채팅에 입력하지 않습니다.</p>
    </div>}

    {canManage && <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button type="button" className="min-h-11" disabled={pending || !canConnect} onClick={onConnect}><Link2 className="size-4" aria-hidden />{status === "reauth_required" ? "Google 다시 연결" : status === "connected" ? "다른 Google 계정 연결" : "Google 계정 연결"}</Button>
      {hasAccount && <Button ref={disconnectRef} type="button" variant="ghost" className="min-h-11 text-muted-foreground" disabled={pending || Boolean(error)} onClick={()=>setConfirmTarget(identity)}><Unplug className="size-4" aria-hidden />연결 해제</Button>}
    </div>}
    {canManage ? <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Google 승인 화면에서 계정 정보와 시트 읽기 권한을 확인합니다. 원본 시트 수정이나 고객 발송은 실행하지 않습니다.</p> : <p className="mt-3 text-xs leading-relaxed text-muted-foreground">공유 연결을 조회 중입니다. Google 계정 연결·변경·해제는 관리자에게 요청해 주세요.</p>}

    <Dialog open={dialogOpen} onOpenChange={open=>{if(!open)setConfirmTarget(null);}}>
      <DialogContent showCloseButton={false} initialFocus={cancelRef} finalFocus={()=>disconnectRef.current?.isConnected ? disconnectRef.current : refreshRef.current}>
        <DialogHeader><DialogTitle>이 점검 사이트의 Google 연결을 해제할까요?</DialogTitle><DialogDescription>관리자·operator의 일정 조회가 중단됩니다. 이 점검 사이트에 저장된 연결만 해제하며, 원본 시트와 기존 위키 등 다른 앱의 Google 연결은 변경하지 않습니다.</DialogDescription></DialogHeader>
        {dialogOpen && <p className="break-all rounded-lg border bg-muted/30 p-3 text-sm">{connection?.accountEmail || "연결된 Google 계정"}</p>}
        {error && <p role="alert" className="text-sm text-destructive">연결 상태를 확인하지 못해 해제를 진행할 수 없습니다. 취소 후 연결 상태를 다시 확인해 주세요.</p>}
        <DialogFooter><Button ref={cancelRef} type="button" variant="outline" className="min-h-11" onClick={()=>setConfirmTarget(null)}>취소</Button><Button type="button" variant="destructive" className="min-h-11" disabled={pending || Boolean(error) || !dialogOpen} onClick={()=>{if(!pending && !error && dialogOpen){setConfirmTarget(null);onDisconnect();}}}>이 사이트 연결 해제</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
