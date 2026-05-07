"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const MIN_PASSWORD_LENGTH = 8;

export function PasswordSetupDialog({
  open,
  supabase,
}: {
  open: boolean;
  supabase: SupabaseClient;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`);
      return;
    }
    if (password !== confirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: { password_set: true },
      });
      if (updateError) {
        setError(updateError.message || "비밀번호를 저장할 수 없습니다.");
        return;
      }
      setPassword("");
      setConfirm("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "비밀번호 저장 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>비밀번호 설정</DialogTitle>
          <DialogDescription>
            정기점검 자동화 사이트에 초대되었습니다. 다음 로그인을 위해 사용할 비밀번호를 설정해주세요.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="setup-password">새 비밀번호</Label>
            <Input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">최소 {MIN_PASSWORD_LENGTH}자.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="setup-password-confirm">비밀번호 확인</Label>
            <Input
              id="setup-password-confirm"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "저장 중…" : "비밀번호 설정"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
