import type { NextRequest } from "next/server";
import {
  ApiError,
  apiOk,
  assertNonEmptyString,
  readJsonObject,
  requireRole,
  userRoles,
  withApiHandler,
  type UserRole,
} from "@/lib/server/api";
import { writeAuditLog } from "@/lib/server/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function POST(request: NextRequest) {
  return withApiHandler(request, async (requestId) => {
    const auth = await requireRole(request, requestId, "admin");
    const body = await readJsonObject(request);
    const email = assertNonEmptyString(body.email, "EMAIL_REQUIRED", "초대할 이메일을 입력하세요.").toLowerCase();
    const role = normalizeInviteRole(body.role);
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";

    if (!emailPattern.test(email)) {
      throw new ApiError(400, "EMAIL_INVALID", "이메일 형식이 올바르지 않습니다.");
    }

    try {
      const { data, error } = await auth.supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo: getInviteRedirectUrl(),
        data: {
          role,
          display_name: displayName || undefined,
          password_set: false,
        },
      });

      if (error || !data.user) {
        const detail = describeInviteError(error);
        console.error(
          JSON.stringify({
            level: "warn",
            message: "admin_invite_supabase_error",
            email,
            role,
            errorMessage: detail.message,
            errorStatus: detail.status,
            errorCode: detail.code,
            errorRaw: detail.raw,
          }),
        );
        await writeAuditLog(auth.supabase, auth.user, "admin.user.invite_failed", "user_invite", email, {
          email,
          role,
          errorSummary: detail.message ?? "Supabase 초대 응답에 사용자 정보가 없습니다.",
          errorStatus: detail.status,
          errorCode: detail.code,
        });
        throw new ApiError(502, "INVITE_FAILED", summarizeInviteError(detail));
      }

      const { error: profileError } = await auth.supabase.from("profiles").upsert({
        id: data.user.id,
        email,
        display_name: displayName || data.user.user_metadata?.display_name || null,
        role,
      });

      if (profileError) {
        await writeAuditLog(auth.supabase, auth.user, "admin.user.invite_profile_failed", "user", data.user.id, {
          email,
          role,
          errorSummary: profileError.message,
        });
        throw new ApiError(500, "INVITE_PROFILE_FAILED", "초대는 발송됐지만 사용자 권한 저장에 실패했습니다.");
      }

      await writeAuditLog(auth.supabase, auth.user, "admin.user.invite", "user", data.user.id, {
        email,
        role,
        invitedUserId: data.user.id,
      });

      return apiOk(requestId, {
        invitation: {
          userId: data.user.id,
          email,
          role,
          invitedAt: data.user.invited_at ?? null,
        },
      }, 201);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      await writeAuditLog(auth.supabase, auth.user, "admin.user.invite_failed", "user_invite", email, {
        email,
        role,
        errorSummary: error instanceof Error ? error.message : String(error),
      });
      throw new ApiError(500, "INVITE_FAILED", "초대 처리 중 오류가 발생했습니다.");
    }
  });
}

function normalizeInviteRole(value: unknown): UserRole {
  if (typeof value === "string" && userRoles.includes(value as UserRole)) {
    return value as UserRole;
  }
  return "viewer";
}

function getInviteRedirectUrl() {
  const configured =
    process.env.SUPABASE_AUTH_INVITE_REDIRECT_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL;

  if (configured) {
    return configured;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

type InviteErrorDetail = {
  message: string | null;
  status: number | null;
  code: string | null;
  raw: string | null;
};

function describeInviteError(error: unknown): InviteErrorDetail {
  if (!error) {
    return { message: null, status: null, code: null, raw: null };
  }
  const record = error as Record<string, unknown>;
  const messageRaw = typeof record.message === "string" ? record.message.trim() : "";
  const status = typeof record.status === "number" ? record.status : null;
  const code = typeof record.code === "string" ? record.code : null;
  let raw: string | null = null;
  try {
    raw = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
  } catch {
    raw = null;
  }
  return {
    message: messageRaw && messageRaw !== "{}" ? messageRaw : null,
    status,
    code,
    raw,
  };
}

function summarizeInviteError(detail: InviteErrorDetail) {
  if (detail.message) {
    if (/already|registered|exists/i.test(detail.message)) {
      return "이미 등록된 사용자입니다. 사용자 목록에서 권한을 확인하세요.";
    }
    if (/rate.*exceeded|too many/i.test(detail.message)) {
      return "Supabase/SMTP 발송 한도에 걸렸습니다. 잠시 후 다시 시도하거나 Custom SMTP 설정을 확인하세요.";
    }
    return `초대 요청을 처리할 수 없습니다: ${detail.message}`;
  }
  if (detail.status) {
    if (detail.status === 422) {
      return "Supabase 입력 검증 실패 (422). 이메일/도메인 형식 또는 SMTP sender 설정을 확인하세요.";
    }
    if (detail.status >= 500) {
      return `Supabase 응답 오류 (HTTP ${detail.status}). SMTP 설정 또는 Supabase 상태 페이지를 확인하세요.`;
    }
    return `초대 요청 실패 (HTTP ${detail.status}). 관리자에게 Vercel 로그 확인을 요청하세요.`;
  }
  return "초대 요청을 처리할 수 없습니다. Vercel 함수 로그에서 상세 사유를 확인하세요.";
}
