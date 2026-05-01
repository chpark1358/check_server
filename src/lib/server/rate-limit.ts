import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { ApiError } from "@/lib/server/api";

let cachedRedis: Redis | null = null;
let redisProbed = false;
const limiterCache = new Map<string, Ratelimit>();

function getRedis(): Redis | null {
  if (redisProbed) {
    return cachedRedis;
  }
  redisProbed = true;
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    cachedRedis = null;
    return null;
  }
  cachedRedis = new Redis({ url, token });
  return cachedRedis;
}

function getLimiter(limit: number, windowMs: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) {
    return null;
  }
  const key = `${limit}:${windowMs}`;
  let limiter = limiterCache.get(key);
  if (!limiter) {
    const windowSeconds = Math.max(1, Math.floor(windowMs / 1000));
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
      prefix: "checksrv:rl",
      analytics: false,
    });
    limiterCache.set(key, limiter);
  }
  return limiter;
}

// Process-local fallback for development. NOT distributed-safe.
type Bucket = { count: number; resetAt: number };
const memoryBuckets = new Map<string, Bucket>();

function memoryEnforce(scope: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = memoryBuckets.get(scope);
  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(scope, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    throw rateLimitError();
  }
  bucket.count += 1;
}

function rateLimitError(): ApiError {
  return new ApiError(429, "RATE_LIMITED", "요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
}

export async function enforceRateLimit(
  scope: string,
  limit: number,
  windowMs: number,
): Promise<void> {
  const limiter = getLimiter(limit, windowMs);
  if (limiter) {
    try {
      const result = await limiter.limit(scope);
      if (!result.success) {
        throw rateLimitError();
      }
      return;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      // KV 호출 자체가 실패하면 운영을 막지 말고 in-memory로 fallback.
      console.error(
        JSON.stringify({
          level: "warn",
          message: "rate_limit_kv_failed",
          scope,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  memoryEnforce(scope, limit, windowMs);
}

export function isDistributedRateLimitEnabled(): boolean {
  return getRedis() !== null;
}
