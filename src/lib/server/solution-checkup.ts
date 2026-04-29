import "server-only";

import { ApiError } from "@/lib/server/api";
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
    throw new ApiError(500, "SOLUTION_API_NOT_CONFIGURED", "Solution API 연동 정보가 설정되지 않았습니다.");
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
    throw new ApiError(502, "SOLUTION_API_UNREACHABLE", "Solution API에 연결할 수 없습니다.");
  }

  if (response.status === 401) {
    throw new ApiError(401, "SOLUTION_TOKEN_EXPIRED", "Solution API 토큰이 만료되었습니다. 다시 로그인하세요.");
  }

  const payload = await readJsonSafe(response);

  if (!response.ok) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "solution_checkup_failed",
        status: response.status,
        serial: trimmedSerial,
      }),
    );
    throw new ApiError(502, "SOLUTION_CHECKUP_FAILED", "Solution API 점검 결과 조회에 실패했습니다.");
  }

  const result = normalizeCheckResult(payload);

  return {
    result,
    rawPayload: payload,
  };
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
