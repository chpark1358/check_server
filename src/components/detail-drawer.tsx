"use client";

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const desktopQuery = "(min-width: 1440px)";
function subscribeToViewport(callback: () => void) {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export type DetailDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  returnFocus?: () => HTMLElement | null;
  id?: string;
};

/** Use beside a list in a two-column grid at 1440px; mobile stays a focus-trapped dialog. */
export function DetailDrawer({ open, onOpenChange, title, description, children, returnFocus, id }: DetailDrawerProps) {
  const isDesktop = useSyncExternalStore(subscribeToViewport, () => window.matchMedia(desktopQuery).matches, () => false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open || !isDesktop) return;
    const frame = window.requestAnimationFrame(() => headingRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, isDesktop]);

  function closeDesktop() {
    onOpenChange(false);
    window.requestAnimationFrame(() => returnFocus?.()?.focus());
  }

  if (isDesktop) {
    if (!open) return null;
    return (
      <aside id={id} aria-labelledby={titleId} className="sticky top-20 flex max-h-[calc(100dvh-6rem)] min-w-0 flex-col self-start overflow-hidden rounded-xl border bg-card" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closeDesktop(); } }}>
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div><h2 ref={headingRef} id={titleId} tabIndex={-1} className="text-base font-semibold outline-none">{title}</h2>{description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}</div>
          <Button variant="ghost" size="icon" className="-mr-2 -mt-2 min-h-11 min-w-11 shrink-0" aria-label={`${title} 닫기`} onClick={closeDesktop}><X aria-hidden /></Button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-5">{children}</div>
      </aside>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id={id} className="fixed inset-y-0 right-0 left-auto flex h-dvh max-h-dvh w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-[480px]" finalFocus={returnFocus}>
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-14"><DialogTitle>{title}</DialogTitle><DialogDescription>{description || "선택한 항목의 상세 정보입니다."}</DialogDescription></DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
