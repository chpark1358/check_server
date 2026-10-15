"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, FileText, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type MailDocumentPreviewProps = {
  fileName: string;
  downloadUrl: string;
  resolvePreview: (url: string) => Promise<string | null>;
};

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "unavailable" }
  | { status: "error"; message: string };

/** Keyed by the document URL so changed files cannot retain an earlier preview. */
export function MailDocumentPreview(props: MailDocumentPreviewProps) {
  return <DocumentPreview key={props.downloadUrl} {...props} />;
}

function DocumentPreview({ fileName, downloadUrl, resolvePreview }: MailDocumentPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const requestVersion = useRef(0);
  const objectUrl = useRef<string | null>(null);
  const pending = useRef(false);

  useEffect(() => () => {
    requestVersion.current += 1;
    if (objectUrl.current?.startsWith("blob:")) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);

  async function loadPreview() {
    if (pending.current) return;
    pending.current = true;
    const request = ++requestVersion.current;
    setState({ status: "loading" });
    try {
      const url = await resolvePreview(downloadUrl);
      if (request !== requestVersion.current) {
        if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        return;
      }
      if (objectUrl.current?.startsWith("blob:")) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = url;
      setState(url ? { status: "ready", url } : { status: "unavailable" });
    } catch (error) {
      if (request === requestVersion.current) {
        setState({ status: "error", message: error instanceof Error ? error.message : "PDF를 불러오지 못했습니다. 다시 시도해 주세요." });
      }
    } finally {
      if (request === requestVersion.current) pending.current = false;
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-label="발송 문서 미리보기">
      <header className="flex items-start gap-2.5 border-b px-4 py-3">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0"><h3 className="text-sm font-semibold">발송 문서</h3><p className="mt-1 break-all text-xs leading-relaxed text-muted-foreground">{fileName}</p><p role="status" className="mt-1 text-xs text-muted-foreground">{state.status === "ready" ? "PDF 미리보기 준비됨" : state.status === "loading" ? "미리보기 불러오는 중" : state.status === "error" ? "미리보기 실패" : state.status === "unavailable" ? "가상 데이터" : "PDF 첨부"}</p></div>
      </header>
      {state.status === "ready" ? (
        <iframe title={fileName + " PDF 미리보기"} src={state.url + "#toolbar=0"} className="h-[260px] w-full border-0 bg-muted/30" />
      ) : (
        <div className="space-y-3 bg-muted/20 px-4 py-5">
          <div aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">
            {state.status === "idle" && "발송 전에 PDF의 고객사와 점검 내용을 확인하세요."}
            {state.status === "loading" && "PDF를 불러오고 있습니다."}
            {state.status === "unavailable" && "가상 화면에는 실제 PDF 파일이 없습니다."}
          </div>
          {state.status === "error" && <p role="alert" className="break-words text-xs leading-relaxed text-destructive">{state.message}</p>}
          {state.status !== "unavailable" && (
            <Button type="button" variant="outline" className="min-h-11 w-full" disabled={state.status === "loading"} onClick={() => void loadPreview()}>
              {state.status === "loading" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : state.status === "error" ? <RotateCcw className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              {state.status === "loading" ? "불러오는 중" : state.status === "error" ? "미리보기 다시 시도" : "PDF 미리보기"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
