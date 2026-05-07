import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { ApiError, isRecord } from "@/lib/server/api";

export type SolutionLoginResult = {
  token: string;
  tokenType: string;
  expiresAt: string;
  ttlSeconds: number;
  masked: string;
  username: string;
};

const TOKEN_TTL_SECONDS = 55 * 60;
const SOLUTION_TOKEN_COOKIE = "solution_token";
const SOLUTION_TOKEN_TYPE_COOKIE = "solution_token_type";
const SOLUTION_COOKIE_PATH = "/api/solution";

type CookieOptions = {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict";
  path: string;
  maxAge?: number;
};

function baseCookieOptions(): Omit<CookieOptions, "maxAge"> {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: SOLUTION_COOKIE_PATH,
  };
}

export function setSolutionSessionCookies(
  response: NextResponse,
  session: { token: string; tokenType: string; ttlSeconds: number },
): void {
  response.cookies.set(SOLUTION_TOKEN_COOKIE, session.token, {
    ...baseCookieOptions(),
    maxAge: session.ttlSeconds,
  });
  response.cookies.set(SOLUTION_TOKEN_TYPE_COOKIE, session.tokenType, {
    ...baseCookieOptions(),
    maxAge: session.ttlSeconds,
  });
}

export function clearSolutionSessionCookies(response: NextResponse): void {
  response.cookies.set(SOLUTION_TOKEN_COOKIE, "", {
    ...baseCookieOptions(),
    maxAge: 0,
  });
  response.cookies.set(SOLUTION_TOKEN_TYPE_COOKIE, "", {
    ...baseCookieOptions(),
    maxAge: 0,
  });
}

export function readSolutionSessionFromRequest(request: NextRequest): {
  token: string;
  tokenType: string;
} {
  const token = request.cookies.get(SOLUTION_TOKEN_COOKIE)?.value?.trim();
  if (!token) {
    throw new ApiError(
      401,
      "SOLUTION_NOT_AUTHENTICATED",
      "솔루션 계정 로그인이 필요합니다. 다시 로그인하세요.",
    );
  }
  const tokenType = request.cookies.get(SOLUTION_TOKEN_TYPE_COOKIE)?.value?.trim() || "Bearer";
  return { token, tokenType };
}

export async function solutionLogin(username: string, password: string): Promise<SolutionLoginResult> {
  const baseUrl = process.env.SOLUTION_API_BASE_URL;

  if (!baseUrl) {
    throw new ApiError(500, "SOLUTION_API_NOT_CONFIGURED", "솔루션 연동 정보가 설정되지 않았습니다.");
  }

  const url = new URL("/api/solution/login", baseUrl);
  let response: Response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "solution_login_network_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new ApiError(502, "SOLUTION_API_UNREACHABLE", "솔루션 서버에 연결할 수 없습니다.");
  }

  const payload = await readJsonSafe(response);

  if (response.status === 401) {
    const detail = classifyLoginFailure(payload, response.status);
    throw new ApiError(401, detail.code, detail.message);
  }

  if (!response.ok) {
    const detail = classifyLoginFailure(payload, response.status);
    console.error(
      JSON.stringify({
        level: "warn",
        message: "solution_login_failed",
        status: response.status,
        errorCode: detail.code,
        bodyPreview: typeof payload === "object" ? Object.keys(payload ?? {}).slice(0, 5) : null,
      }),
    );
    throw new ApiError(detail.status, detail.code, detail.message);
  }

  if (isRecord(payload) && payload.success === false) {
    const detail = classifyLoginFailure(payload, response.status);
    throw new ApiError(detail.status, detail.code, detail.message);
  }

  if (!isRecord(payload)) {
    throw new ApiError(502, "SOLUTION_LOGIN_BODY_INVALID", "솔루션 로그인 응답 형식이 올바르지 않습니다.");
  }

  const token = pickStringField(payload, ["token", "access_token", "accessToken"]);

  if (!token) {
    throw new ApiError(502, "SOLUTION_TOKEN_MISSING", "솔루션 로그인 응답에서 토큰을 찾을 수 없습니다.");
  }

  const tokenType = pickStringField(payload, ["token_type", "tokenType"]) || "Bearer";
  const expiresIn = pickNumberField(payload, ["expires_in", "expiresIn"]);
  const ttlSeconds = expiresIn > 0 && expiresIn < TOKEN_TTL_SECONDS ? expiresIn : TOKEN_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  return {
    token,
    tokenType,
    expiresAt,
    ttlSeconds,
    masked: maskToken(token),
    username,
  };
}

export function maskToken(token: string): string {
  if (token.length <= 8) {
    return "*".repeat(token.length);
  }
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

async function readJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pickStringField(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function pickNumberField(data: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return 0;
}

function classifyLoginFailure(payload: unknown, status: number) {
  const code = extractPayloadCode(payload);
  const message = extractPayloadMessage(payload);
  const text = `${code} ${message}`.toLowerCase();

  if (/(user|id|account).*(not.*found|unknown|missing)|no.*user|id_not_found|user_not_found/.test(text)) {
    return {
      status: 401,
      code: "SOLUTION_LOGIN_USER_NOT_FOUND",
      message: "아이디를 찾을 수 없습니다. 솔루션 아이디를 확인하세요.",
    };
  }

  if (/password|passwd|pwd|비밀번호/.test(text)) {
    return {
      status: 401,
      code: "SOLUTION_LOGIN_PASSWORD_INVALID",
      message: "비밀번호가 일치하지 않습니다. 다시 확인하세요.",
    };
  }

  if (/lock|disabled|inactive|blocked|제한|잠김|비활성/.test(text)) {
    return {
      status: 403,
      code: "SOLUTION_LOGIN_ACCOUNT_RESTRICTED",
      message: "해당 계정은 사용이 제한되어 있습니다. 관리자에게 확인하세요.",
    };
  }

  if (status === 403 || /forbidden|permission|권한/.test(text)) {
    return {
      status: 403,
      code: "SOLUTION_LOGIN_FORBIDDEN",
      message: "점검 데이터 조회 권한이 없는 계정입니다.",
    };
  }

  if (status === 429 || /too many|rate|limit|many attempts|요청.*많/.test(text)) {
    return {
      status: 429,
      code: "SOLUTION_LOGIN_RATE_LIMITED",
      message: "로그인 시도가 많습니다. 잠시 후 다시 시도하세요.",
    };
  }

  if (status >= 500) {
    return {
      status: 502,
      code: "SOLUTION_LOGIN_UPSTREAM_FAILED",
      message: "솔루션 서버 로그인 처리 중 오류가 발생했습니다.",
    };
  }

  return {
    status: 401,
    code: code || "SOLUTION_LOGIN_INVALID",
    message: "아이디 또는 비밀번호가 올바르지 않습니다.",
  };
}

function extractPayloadCode(payload: unknown) {
  if (!isRecord(payload)) {
    return "";
  }
  const value = payload.code ?? payload.errorCode ?? payload.error_code ?? payload.error;
  return typeof value === "string" ? value.trim() : "";
}

function extractPayloadMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return "";
  }
  const value = payload.message ?? payload.error_description ?? payload.errorMessage ?? payload.error_message;
  return typeof value === "string" ? value.trim() : "";
}
