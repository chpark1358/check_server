import "server-only";

import { createHash } from "node:crypto";
import { ApiError } from "@/lib/server/api";
import { isRealZendeskSendAllowed } from "@/lib/env";

const REQUIRED_KEYS = [
  "ZENDESK_SUBDOMAIN",
  "ZENDESK_OAUTH_CLIENT_ID",
  "ZENDESK_OAUTH_CLIENT_SECRET",
] as const;
const READ_SCOPES = [
  "groups:read",
  "organizations:read",
  "users:read",
  "account_settings:read",
  "tickets:read",
] as const;
const WRITE_SCOPES = ["tickets:write", "ticket_attachments:write"] as const;
const EXPIRY_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const REQUESTED_LIFETIME_SECONDS = 1800;
const MAX_LIFETIME_SECONDS = 172_800;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type OAuthConfig = {
  subdomain: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  fingerprint: string;
};
type CachedToken = {
  fingerprint: string;
  accessToken: string;
  expiresAt: number;
  grantedScopes: string[] | null;
};

let cachedToken: CachedToken | null = null;
const inFlight = new Map<string, Promise<CachedToken>>();

function configuredScopes(): string[] {
  return isRealZendeskSendAllowed()
    ? [...READ_SCOPES, ...WRITE_SCOPES]
    : [...READ_SCOPES];
}

function normalizedSubdomain(): string | null {
  const value = process.env.ZENDESK_SUBDOMAIN?.trim().toLowerCase();
  return value && SUBDOMAIN.test(value) ? value : null;
}

function missingKeys(): string[] {
  return REQUIRED_KEYS.filter((key) => !process.env[key]?.trim());
}

function configInvalid() {
  return new ApiError(500, "ZENDESK_OAUTH_CONFIG_INVALID", "Zendesk OAuth 설정 형식이 올바르지 않습니다. 관리자가 연결 설정을 확인해야 합니다.");
}

function tokenFailed() {
  // Never include provider bodies, headers, thrown messages, or credential values.
  return new ApiError(502, "ZENDESK_OAUTH_TOKEN_FAILED", "Zendesk OAuth 인증 정보를 발급받지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 연결 설정 확인을 요청하세요.");
}

function readConfig(): OAuthConfig {
  if (missingKeys().length > 0) {
    throw new ApiError(500, "ZENDESK_OAUTH_NOT_CONFIGURED", "Zendesk OAuth 연결 정보가 설정되지 않았습니다.");
  }
  const subdomain = normalizedSubdomain();
  const clientId = process.env.ZENDESK_OAUTH_CLIENT_ID!.trim();
  const clientSecret = process.env.ZENDESK_OAUTH_CLIENT_SECRET!.trim();
  if (!subdomain || clientId.length > 4096 || clientSecret.length > 8192 ||
      /[\u0000-\u001f\u007f]/.test(clientId + clientSecret)) {
    throw configInvalid();
  }
  const scopes = configuredScopes();
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([subdomain, clientId, clientSecret, scopes]))
    .digest("hex");
  return { subdomain, clientId, clientSecret, scopes, fingerprint };
}

/** A fixed Zendesk tenant URL; accepts a single DNS label, never a URL or host. */
export function getZendeskBaseUrl(): string {
  if (!process.env.ZENDESK_SUBDOMAIN?.trim()) {
    throw new ApiError(500, "ZENDESK_OAUTH_NOT_CONFIGURED", "Zendesk OAuth 연결 정보가 설정되지 않았습니다.");
  }
  const subdomain = normalizedSubdomain();
  if (!subdomain) throw configInvalid();
  return "https://" + subdomain + ".zendesk.com";
}

/** Configuration presence/shape only. This is not a verified connection check. */
export function getZendeskOAuthStatus(): {
  configured: boolean;
  authentication: "oauth";
  grantType: "client_credentials";
  subdomain: string | null;
  missingKeys: string[];
  scopes: string[];
  grantedScopes: string[] | null;
  accessTokenExpiresAt: string | null;
} {
  let config: OAuthConfig | null = null;
  try {
    config = readConfig();
  } catch {
    // Status remains safe to return even when credentials are absent or malformed.
  }
  return {
    configured: config !== null,
    authentication: "oauth",
    grantType: "client_credentials",
    subdomain: normalizedSubdomain(),
    missingKeys: missingKeys(),
    scopes: configuredScopes(),
    grantedScopes: config && cachedToken?.fingerprint === config.fingerprint ? cachedToken.grantedScopes : null,
    accessTokenExpiresAt: config && cachedToken?.fingerprint === config.fingerprint
      ? new Date(cachedToken.expiresAt).toISOString()
      : null,
  };
}

async function issueToken(config: OAuthConfig): Promise<CachedToken> {
  const requestedAt = Date.now();
  try {
    const response = await fetch("https://" + config.subdomain + ".zendesk.com/oauth/tokens", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: config.scopes.join(" "),
        expires_in: REQUESTED_LIFETIME_SECONDS,
      }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok || response.redirected) {
      const errorBody: unknown = await response.json().catch(() => null);
      if (errorBody && typeof errorBody === "object" && !Array.isArray(errorBody) &&
          (errorBody as Record<string, unknown>).error === "invalid_scope") {
        throw new ApiError(502, "ZENDESK_OAUTH_SCOPE_NOT_ALLOWED", "Zendesk OAuth 클라이언트의 허용 범위에 필요한 조회 권한이 없습니다. 관리자가 클라이언트의 Allowed scopes를 확인해야 합니다.");
      }
      throw tokenFailed();
    }
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw tokenFailed();
    const value = payload as Record<string, unknown>;
    if (typeof value.access_token !== "string" || value.access_token.length === 0 ||
        value.access_token.length > 16_384 || /\s|[\u0000-\u001f\u007f]/.test(value.access_token) ||
        typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer" ||
        typeof value.expires_in !== "number" || !Number.isFinite(value.expires_in) ||
        value.expires_in <= 0 || value.expires_in > MAX_LIFETIME_SECONDS) {
      throw tokenFailed();
    }
    const expiresAt = requestedAt + value.expires_in * 1000;
    if (expiresAt <= Date.now()) throw tokenFailed();
    const grantedScopes = typeof value.scope === "string"
      ? value.scope.split(/\s+/).filter(scope => /^[a-z_]+(?::[a-z_]+)*$/.test(scope)).slice(0, 100)
      : null;
    return { fingerprint: config.fingerprint, accessToken: value.access_token, expiresAt, grantedScopes };
  } catch (error) {
    if (error instanceof ApiError && error.code === "ZENDESK_OAUTH_SCOPE_NOT_ALLOWED") throw error;
    throw tokenFailed();
  }
}

export async function getZendeskOAuthAccessToken(): Promise<string> {
  const config = readConfig();
  if (cachedToken?.fingerprint === config.fingerprint &&
      cachedToken.expiresAt > Date.now() + EXPIRY_SKEW_MS) {
    return cachedToken.accessToken;
  }

  let pending = inFlight.get(config.fingerprint);
  if (!pending) {
    pending = issueToken(config);
    inFlight.set(config.fingerprint, pending);
  }
  try {
    const token = await pending;
    // A secret, tenant or scope rotation must not install/return an old response.
    if (readConfig().fingerprint !== config.fingerprint) throw tokenFailed();
    cachedToken = token;
    return token.accessToken;
  } finally {
    if (inFlight.get(config.fingerprint) === pending) inFlight.delete(config.fingerprint);
  }
}

/** A delayed 401 for an older token must not evict its newer replacement. */
export function invalidateZendeskOAuthAccessToken(token: string): void {
  if (cachedToken?.accessToken === token) cachedToken = null;
}
