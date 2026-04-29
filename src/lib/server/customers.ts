import "server-only";

import { ApiError } from "@/lib/server/api";

export async function searchCustomers(params: { serial: string | null; name: string | null }) {
  const baseUrl = process.env.SOLUTION_API_BASE_URL;

  if (!baseUrl) {
    throw new ApiError(500, "CUSTOMER_API_NOT_CONFIGURED", "고객사 조회 API가 설정되지 않았습니다.");
  }

  const url = new URL("/api/customers", baseUrl);

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
      "고객사 정보를 조회할 수 없습니다.",
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
