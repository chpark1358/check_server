import "server-only";

import { ApiError } from "@/lib/server/api";

export async function searchCustomers(params: { serial: string | null; name: string | null }) {
  const baseUrl = process.env.SOLUTION_API_BASE_URL;
  const customerPath = process.env.CUSTOMER_API_PATH;

  if (!baseUrl) {
    throw new ApiError(500, "CUSTOMER_API_NOT_CONFIGURED", "고객사 조회 API가 설정되지 않았습니다.");
  }

  if (!customerPath) {
    throw new ApiError(
      501,
      "CUSTOMER_API_PATH_NOT_CONFIGURED",
      "고객사/시리얼 검색 API 경로가 아직 설정되지 않았습니다. 시리얼 기반 점검 수집은 왼쪽의 점검 흐름을 사용하세요.",
    );
  }

  const url = new URL(customerPath, baseUrl);

  if (params.serial) {
    url.searchParams.set("serial", params.serial);
  }

  if (params.name) {
    url.searchParams.set("name", params.name);
  }

  const response = await fetch(url, {
    headers: buildCustomerHeaders(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ApiError(
      response.status >= 500 ? 502 : response.status,
      "CUSTOMER_API_FAILED",
      `고객사 검색 API 호출에 실패했습니다. CUSTOMER_API_PATH=${customerPath}, status=${response.status}`,
    );
  }

  return response.json() as Promise<unknown>;
}

function buildCustomerHeaders() {
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  const token = process.env.SOLUTION_API_TOKEN;

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  return headers;
}
