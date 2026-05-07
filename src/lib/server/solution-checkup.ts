import "server-only";

import { ApiError, isRecord } from "@/lib/server/api";
import { normalizeCheckResult, type CheckResult } from "@/lib/server/check-result";

const SERIAL_PATTERN = /^LO\d{4,}$/i;

export type CheckupFetchResult = {
  result: CheckResult;
  rawPayload: unknown;
};

export async function fetchCheckup(
  serial: string,
  token: string,
  tokenType = "Bearer",
): Promise<CheckupFetchResult> {
  const baseUrl = process.env.SOLUTION_API_BASE_URL;

  if (!baseUrl) {
    throw new ApiError(500, "SOLUTION_API_NOT_CONFIGURED", "솔루션 연동 정보가 설정되지 않았습니다.");
  }

  const trimmedSerial = serial.trim().toUpperCase();
  if (!SERIAL_PATTERN.test(trimmedSerial)) {
    throw new ApiError(400, "SERIAL_INVALID", "시리얼은 LO + 4자리 이상 숫자 형식이어야 합니다.");
  }

  const url = new URL(`/api/solution/checkup/${encodeURIComponent(trimmedSerial)}`, baseUrl);
  url.searchParams.set("_ts", String(Date.now()));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `${tokenType} ${token}`,
        "cache-control": "no-cache, no-store, must-revalidate",
        pragma: "no-cache",
        expires: "0",
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "solution_checkup_network_failed",
        serial: trimmedSerial,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw new ApiError(502, "SOLUTION_API_UNREACHABLE", "솔루션 서버에 연결할 수 없습니다.");
  }

  const payload = await readJsonSafe(response);

  if (response.status === 401) {
    throw new ApiError(401, "SOLUTION_TOKEN_EXPIRED", "솔루션 로그인 시간이 만료되었습니다. 다시 로그인하세요.");
  }

  if (!response.ok) {
    const detail = classifyCheckupFailure(payload, response.status);
    console.error(
      JSON.stringify({
        level: "warn",
        message: "solution_checkup_failed",
        status: response.status,
        serial: trimmedSerial,
        errorCode: detail.code,
      }),
    );
    throw new ApiError(detail.status, detail.code, detail.message);
  }

  const result = normalizeCheckResult(payload);

  return {
    result,
    rawPayload: payload,
  };
}

function classifyCheckupFailure(payload: unknown, status: number) {
  const code = extractPayloadCode(payload);
  const message = extractPayloadMessage(payload);
  const text = `${code} ${message}`.toLowerCase();

  if (status === 400) {
    return {
      status: 400,
      code: code || "SOLUTION_CHECKUP_BAD_REQUEST",
      message: "점검 데이터 조회 요청 형식이 올바르지 않습니다. 시리얼을 확인하세요.",
    };
  }

  if (status === 403 || /forbidden|permission|권한/.test(text)) {
    return {
      status: 403,
      code: code || "SOLUTION_CHECKUP_FORBIDDEN",
      message: "해당 계정에 점검 데이터 조회 권한이 없습니다.",
    };
  }

  if (status === 404 || /not.*found|missing|no.*data|없/.test(text)) {
    return {
      status: 404,
      code: code || "SOLUTION_CHECKUP_NOT_FOUND",
      message: "해당 시리얼의 점검 데이터를 찾을 수 없습니다.",
    };
  }

  if (status === 429 || /too many|rate|limit|요청.*많/.test(text)) {
    return {
      status: 429,
      code: code || "SOLUTION_CHECKUP_RATE_LIMITED",
      message: "점검 데이터 조회 요청이 많습니다. 잠시 후 다시 시도하세요.",
    };
  }

  if (status >= 500) {
    return {
      status: 502,
      code: code || "SOLUTION_CHECKUP_UPSTREAM_FAILED",
      message: "솔루션 서버에서 점검 데이터 조회를 처리하지 못했습니다.",
    };
  }

  return {
    status: 502,
    code: code || "SOLUTION_CHECKUP_FAILED",
    message: "점검 데이터 조회에 실패했습니다. 시리얼과 솔루션 계정을 확인하세요.",
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
