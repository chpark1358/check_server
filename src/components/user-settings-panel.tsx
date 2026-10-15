"use client";

import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Check, FileText, Info, Loader2, Mail, RotateCcw, Save, Settings2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { normalizeActiveEngineerName } from "@/lib/engineer-roster";

export type UserSettingsPreferences = {
  defaultEngineerName: string;
  defaultServerModel: string;
  defaultIptablesStatus: "auto" | "Y" | "N";
  defaultAgentStatus: "auto" | "Y" | "N";
  defaultSendMode: "real" | "dry-run";
  defaultAutoSolved: boolean;
  mailBodyTemplate: string;
};

type Props = {
  preferences: UserSettingsPreferences;
  signatures: Array<{ id: string; name: string; updatedAt: string; hasSignature?: boolean }>;
  canRealSend: boolean;
  onSave: (preferences: UserSettingsPreferences) => void | Promise<void>;
  saving?: boolean;
  defaultTemplate: string;
  renderPreview: (template: string) => string;
  hasCurrentDraft?: boolean;
};

const sections = [
  { id: "settings-documents", label: "문서 기본값", icon: FileText },
  { id: "settings-sending", label: "발송 기본값", icon: Mail },
  { id: "settings-template", label: "메일 템플릿", icon: Type },
] as const;
const selectClassName = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

function equalPreferences(first: UserSettingsPreferences, second: UserSettingsPreferences) {
  return (Object.keys(first) as Array<keyof UserSettingsPreferences>).every((key) => first[key] === second[key]);
}

export function UserSettingsPanel({ preferences, signatures, canRealSend, onSave, saving = false, defaultTemplate, renderPreview, hasCurrentDraft = false }: Props) {
  // Only explicit edits overlay the saved values, so background updates cannot erase an unsaved field.
  const [edits, setEdits] = useState<Partial<UserSettingsPreferences>>({});
  const [activeSection, setActiveSection] = useState<string>(sections[0].id);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<UserSettingsPreferences | null>(null);
  const saveInFlight = useRef(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const values = { ...preferences, ...edits };
  const draft = { ...values, defaultEngineerName: normalizeActiveEngineerName(values.defaultEngineerName) };
  const changedCount = (Object.keys(preferences) as Array<keyof UserSettingsPreferences>).filter((key) => draft[key] !== preferences[key]).length;
  const dirty = changedCount > 0;
  const busy = saving || submitting;
  const confirmedSaved = submitted !== null && equalPreferences(submitted, preferences) && !dirty;

  function update<K extends keyof UserSettingsPreferences>(key: K, value: UserSettingsPreferences[K]) {
    setEdits((current) => ({ ...current, [key]: value }));
    setSaveError(null);
  }

  function insertPlaceholder(placeholder: string) {
    const source = draft.mailBodyTemplate;
    const start = Math.min(selection.current.start, source.length);
    const end = Math.min(selection.current.end, source.length);
    const next = source.slice(0, start) + placeholder + source.slice(end);
    update("mailBodyTemplate", next);
    const cursor = start + placeholder.length;
    selection.current = { start: cursor, end: cursor };
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(cursor, cursor);
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || busy || saveInFlight.current) return;
    saveInFlight.current = true;
    setSubmitting(true);
    setSaveError(null);
    const snapshot = { ...draft };
    setSubmitted(snapshot);
    try {
      await onSave(snapshot);
      // Successful UI state follows preferences returned by the parent after its API succeeds.
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "설정을 저장하지 못했습니다. 변경 내용은 유지됩니다.");
    } finally {
      saveInFlight.current = false;
      setSubmitting(false);
    }
  }

  return <section className="settings-workspace grid items-start gap-5 lg:grid-cols-[144px_minmax(0,920px)]">
    <nav className="flex flex-wrap gap-1 rounded-lg border bg-card p-2 lg:sticky lg:top-24 lg:flex-col" aria-label="설정 섹션">
      <p className="hidden px-3 py-2 text-xs font-medium text-muted-foreground lg:block">개인 설정</p>
      {sections.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? "location" : undefined} onClick={() => setActiveSection(id)} className={`flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${activeSection === id ? "bg-primary/8 text-primary" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}><Icon className="size-4 shrink-0" aria-hidden="true" />{label}</a>)}
    </nav>

    <form className="min-w-0 space-y-4" onSubmit={(event) => void save(event)}>
      <div className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3">
        <Settings2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div><p className="text-sm font-medium">내 작업에 적용할 기본값</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">문서와 메일을 준비할 때 사용할 개인 설정입니다. 변경 후 하단의 설정 저장을 눌러 적용하세요.</p></div>
      </div>

      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <legend className="sr-only">개인 문서, 발송 및 메일 템플릿 설정</legend>
        <SettingsSection id="settings-documents" title="문서 기본값" description="확인서를 준비할 때 사용할 점검자와 문서 반영값을 설정합니다.">
          <div className="grid gap-x-5 gap-y-5 sm:grid-cols-2">
            <SettingField id="default-engineer" label="기본 점검자" hint="선택한 점검자를 새 확인서의 기본값으로 사용합니다.">
              <select id="default-engineer" aria-describedby="default-engineer-hint" className={selectClassName} value={draft.defaultEngineerName || "__none"} onChange={(event) => update("defaultEngineerName", event.target.value === "__none" ? "" : event.target.value)}>
                <option value="__none">자동 선택</option>
                {draft.defaultEngineerName && !signatures.some((signature) => signature.name === draft.defaultEngineerName) ? <option value={draft.defaultEngineerName}>{draft.defaultEngineerName} (저장된 값)</option> : null}
                {signatures.map((signature) => <option key={signature.id} value={signature.name}>{signature.name}{signature.hasSignature === false ? " (서명 대기)" : ""}</option>)}
              </select>
              {signatures.some((signature) => signature.name === draft.defaultEngineerName && signature.hasSignature === false) ? <p className="mt-2 text-xs text-muted-foreground">점검자 이름은 사용할 수 있습니다. 서명을 등록하기 전까지 확인서에 서명 이미지는 들어가지 않습니다.</p> : null}
            </SettingField>
            <SettingField id="default-server-model" label="기본 서버 모델" hint="자동 판정은 조회된 서버 정보를 사용합니다.">
              <select id="default-server-model" aria-describedby="default-server-model-hint" className={selectClassName} value={draft.defaultServerModel} onChange={(event) => update("defaultServerModel", event.target.value)}>
                <option value="auto">자동 판정</option><option value="AWS">AWS</option><option value="VM">VM</option><option value="물리서버">물리서버</option>
                {!["auto", "AWS", "VM", "물리서버"].includes(draft.defaultServerModel) ? <option value={draft.defaultServerModel}>{draft.defaultServerModel}</option> : null}
              </select>
            </SettingField>
            <SettingField id="default-iptables" label="Iptables 상태" hint="수집값을 따르거나, 확인서에 반영할 정상·이상 값을 지정합니다.">
              <select id="default-iptables" aria-describedby="default-iptables-hint" className={selectClassName} value={draft.defaultIptablesStatus} onChange={(event) => update("defaultIptablesStatus", event.target.value as UserSettingsPreferences["defaultIptablesStatus"])}><option value="auto">수집값 사용</option><option value="Y">문서 적용: 정상</option><option value="N">문서 적용: 이상</option></select>
            </SettingField>
            <SettingField id="default-agent" label="에이전트 연결 상태" hint="문서에 적용하는 기본값이며 수집된 원본 결과는 바뀌지 않습니다.">
              <select id="default-agent" aria-describedby="default-agent-hint" className={selectClassName} value={draft.defaultAgentStatus} onChange={(event) => update("defaultAgentStatus", event.target.value as UserSettingsPreferences["defaultAgentStatus"])}><option value="auto">수집값 사용</option><option value="Y">문서 적용: 정상</option><option value="N">문서 적용: 이상</option></select>
            </SettingField>
          </div>
        </SettingsSection>

        <SettingsSection id="settings-sending" title="발송 기본값" description="메일 화면의 기본 동작을 정합니다. 실제 발송은 별도 확인 후 실행됩니다.">
          <div className="grid gap-5 sm:grid-cols-2">
            <SettingField id="default-send-mode" label="기본 발송 모드" hint={canRealSend ? "현재 서버 환경에서 실제 전송이 허용되어 있습니다." : "현재 서버 환경에서는 테스트 전송만 가능합니다. 실제 전송은 실행되지 않습니다."}>
              <select id="default-send-mode" aria-describedby="default-send-mode-hint" className={selectClassName} value={draft.defaultSendMode} onChange={(event) => update("defaultSendMode", event.target.value as UserSettingsPreferences["defaultSendMode"])}><option value="dry-run">테스트 전송</option><option value="real" disabled={!canRealSend}>실제 전송{!canRealSend ? " (서버에서 제한됨)" : ""}</option></select>
            </SettingField>
            <label className="flex min-h-11 items-start gap-3 rounded-md border bg-muted/20 p-3.5 text-sm">
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-primary" checked={draft.defaultAutoSolved} onChange={(event) => update("defaultAutoSolved", event.target.checked)} />
              <span><span className="block font-medium">발송 후 해결 상태 처리</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">메일 발송 화면의 해결 상태 처리 기본값으로 사용합니다.</span></span>
            </label>
          </div>
        </SettingsSection>

        <SettingsSection id="settings-template" title="메일 본문 템플릿" description="담당자명을 자동으로 넣고, 실제로 전달될 문장을 미리 확인하세요.">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">커서 위치에 삽입</span>{["{{requesterName}}", "{{담당자명}}"].map((placeholder) => <Button key={placeholder} type="button" size="sm" variant="outline" className="min-h-11 font-mono text-xs" onClick={() => insertPlaceholder(placeholder)}>{placeholder}</Button>)}</div>
            <Button type="button" variant="ghost" size="sm" className="min-h-11 gap-1.5 text-xs" onClick={() => setRestoreOpen(true)}><RotateCcw className="size-3.5" aria-hidden="true" />기본 템플릿 복원</Button>
          </div>
          {restoreOpen ? <div className="mb-4 rounded-md border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/5 p-3" role="alert">
            <p className="text-sm font-medium">편집 중인 템플릿을 기본 양식으로 바꿀까요?</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">현재 템플릿 초안을 덮어씁니다. 설정 저장 전까지 서버의 저장값과 작성 중인 메일은 유지됩니다.</p>
            <div className="mt-3 flex gap-2"><Button type="button" size="sm" className="min-h-11" onClick={() => { update("mailBodyTemplate", defaultTemplate); selection.current = { start: defaultTemplate.length, end: defaultTemplate.length }; setRestoreOpen(false); }}>기본 양식으로 바꾸기</Button><Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => setRestoreOpen(false)}>취소</Button></div>
          </div> : null}
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            <div className="min-w-0"><Label htmlFor="mail-template-editor" className="mb-2 block text-xs font-medium">템플릿 편집</Label><Textarea ref={editor} id="mail-template-editor" aria-describedby="mail-template-editor-hint" className="min-h-[310px] resize-y bg-background text-sm leading-7" value={draft.mailBodyTemplate} placeholder={defaultTemplate} onSelect={(event) => { selection.current = { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }; }} onChange={(event) => update("mailBodyTemplate", event.target.value)} /><p id="mail-template-editor-hint" className="mt-2 text-xs leading-relaxed text-muted-foreground">비워두면 기본 양식을 사용합니다. 치환자 버튼은 선택한 문자를 대체하거나 커서 위치에 삽입합니다.</p></div>
            <div className="min-w-0"><p className="mb-2 flex items-center justify-between gap-2 text-xs font-medium"><span>메일 미리보기</span><span className="font-normal text-muted-foreground">가상 담당자 기준</span></p><pre className="min-h-[310px] whitespace-pre-wrap break-words rounded-md border bg-muted/20 p-3.5 font-sans text-sm leading-7">{renderPreview(draft.mailBodyTemplate)}</pre><p className="mt-2 text-xs leading-relaxed text-muted-foreground">미리보기의 가상 담당자명은 템플릿에 저장되지 않습니다.</p></div>
          </div>
        </SettingsSection>
      </fieldset>

      {hasCurrentDraft ? <div className="flex items-start gap-2.5 rounded-md border border-primary/20 bg-primary/5 p-3.5"><Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /><div><p className="text-sm font-medium">현재 작성 중인 작업이 있습니다</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">저장하면 점검자·모델·문서 판정과 발송 기본값이 현재 작업에도 반영될 수 있습니다. 직접 편집한 메일 본문은 유지됩니다. 수집 원본과 이미 생성한 파일은 바뀌지 않습니다.</p></div></div> : null}

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
        <div role="status" aria-live="polite" className="min-w-0 text-sm">{busy ? <span className="inline-flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />설정 저장 중…</span> : saveError ? <span className="text-destructive">{saveError}</span> : dirty ? <><span className="font-medium">변경사항 {changedCount}개</span><span className="ml-2 text-xs text-muted-foreground">아직 저장되지 않았습니다.</span></> : confirmedSaved ? <span className="inline-flex items-center gap-1.5 text-primary"><Check className="size-4" aria-hidden="true" />저장됨</span> : <span className="text-muted-foreground">저장된 설정과 같습니다.</span>}</div>
        <div className="flex gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={busy || !dirty} onClick={() => { setEdits({}); setSaveError(null); setRestoreOpen(false); }}>변경 취소</Button><Button type="submit" className="min-h-11 gap-2" disabled={busy || !dirty}><Save className="size-4" aria-hidden="true" />{busy ? "저장 중" : "설정 저장"}</Button></div>
      </div>
    </form>
  </section>;
}

function SettingsSection({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 overflow-hidden rounded-lg border bg-card"><header className="border-b px-5 py-4"><h2 id={`${id}-title`} className="text-base font-semibold tracking-tight">{title}</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p></header><div className="p-5">{children}</div></section>;
}

function SettingField({ id, label, hint, children }: { id: string; label: string; hint: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-2"><Label htmlFor={id} className="text-sm font-medium">{label}</Label>{children}<p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">{hint}</p></div>;
}
