import "server-only";

import { ApiError } from "@/lib/server/api";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function enforceMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return;
  }

  if (bucket.count >= limit) {
    throw new ApiError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
  }

  bucket.count += 1;
}
