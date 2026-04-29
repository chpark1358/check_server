import "server-only";

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

export const userRoles = ["viewer", "operator", "admin"] as const;

export type UserRole = (typeof userRoles)[number];

export type AuthContext = {
  requestId: string;
  supabase: SupabaseClient;
  user: User;
  role: UserRole;
  email: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
};

const roleRank: Record<UserRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
};

export class ApiError extends Error {
  status: number;
  code: string;
  publicMessage: string;

  constructor(status: number, code: string, publicMessage: string) {
    super(publicMessage);
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

export function apiOk<T extends Record<string, unknown>>(
  requestId: string,
  payload: T,
  status = 200,
) {
  return NextResponse.json(
    {
      ok: true,
      requestId,
      ...payload,
    },
    { status },
  );
}

export async function withApiHandler(
  request: NextRequest,
  handler: (requestId: string) => Promise<NextResponse>,
) {
  const requestId = getRequestId(request);

  try {
    return await handler(requestId);
  } catch (error) {
    return apiErrorResponse(error, requestId);
  }
}

export async function requireRole(
  request: NextRequest,
  requestId: string,
  minimumRole: UserRole,
): Promise<AuthContext> {
  const token = getBearerToken(request);

  if (!token) {
    throw new ApiError(401, "AUTH_REQUIRED", "로그인이 필요합니다.");
  }

  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new ApiError(401, "AUTH_INVALID", "인증 정보를 확인할 수 없습니다.");
  }

  const profile = await loadProfile(supabase, data.user.id);
  const role = normalizeRole(
    profile?.role ??
      data.user.app_metadata?.role ??
      data.user.user_metadata?.role ??
      "viewer",
  );

  if (!hasRole(role, minimumRole)) {
    throw new ApiError(403, "FORBIDDEN", "요청한 작업을 수행할 권한이 없습니다.");
  }

  return {
    requestId,
    supabase,
    user: data.user,
    role,
    email: profile?.email ?? data.user.email ?? null,
  };
}

export async function readJsonObject(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON 요청 본문이 필요합니다.");
  }

  if (!isRecord(body)) {
    throw new ApiError(400, "INVALID_BODY", "요청 본문 형식이 올바르지 않습니다.");
  }

  return body;
}

export function assertNonEmptyString(
  value: unknown,
  code: string,
  message: string,
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, code, message);
  }

  return value.trim();
}

export function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeErrorMetadata(metadata: Record<string, unknown>) {
  const sensitivePattern = /(token|secret|password|authorization|service_role|api_key)/i;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key,
      sensitivePattern.test(key) ? "[redacted]" : value,
    ]),
  );
}

function getBearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

function getRequestId(request: NextRequest) {
  return request.headers.get("x-request-id") ?? crypto.randomUUID();
}

function normalizeRole(role: unknown): UserRole {
  return userRoles.includes(role as UserRole) ? (role as UserRole) : "viewer";
}

function hasRole(actual: UserRole, required: UserRole) {
  return roleRank[actual] >= roleRank[required];
}

async function loadProfile(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,display_name,role")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw new ApiError(500, "PROFILE_LOOKUP_FAILED", "사용자 권한을 확인할 수 없습니다.");
  }

  return data;
}

function apiErrorResponse(error: unknown, requestId: string) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        ok: false,
        code: error.code,
        message: error.publicMessage,
        requestId,
      },
      { status: error.status },
    );
  }

  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

  return NextResponse.json(
    {
      ok: false,
      code: "INTERNAL_SERVER_ERROR",
      message: "요청 처리 중 오류가 발생했습니다.",
      requestId,
    },
    { status: 500 },
  );
}
