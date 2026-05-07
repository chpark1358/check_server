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
import { enforceRateLimit } from "@/lib/server/rate-limit";

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

    await enforceRateLimit(`admin-invite:${auth.user.id}`, 10, 60 * 60_000);
    await enforceRateLimit(`admin-invite-email:${email}`, 3, 60 * 60_000);

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
        await writeAuditLog(auth.supabase, auth.user, "admin.user.invite_failed", "user_invite", email, {
          email,
          role,
          errorSummary: error?.message ?? "Supabase 초대 응답에 사용자 정보가 없습니다.",
        });
        throw new ApiError(502, "INVITE_FAILED", summarizeInviteError(error?.message));
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

function summarizeInviteError(message?: string) {
  if (!message) {
    return "초대 요청을 처리할 수 없습니다.";
  }
  if (/already|registered|exists/i.test(message)) {
    return "이미 등록된 사용자입니다. 사용자 목록에서 권한을 확인하세요.";
  }
  return `초대 요청을 처리할 수 없습니다: ${message}`;
}
