import { loadEnvConfig } from "@next/env";
import { existsSync } from "node:fs";
import path from "node:path";

loadLocalEnv();

const requiredServerEnv = [
  "ZENDESK_SUBDOMAIN",
  "ZENDESK_EMAIL",
  "ZENDESK_API_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export type ServerEnvKey = (typeof requiredServerEnv)[number];

export function getMissingServerEnv(env: NodeJS.ProcessEnv = process.env) {
  return requiredServerEnv.filter((key) => !env[key]);
}

export function isRealZendeskSendAllowed(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === "production" && env.ALLOW_REAL_ZENDESK_SEND === "true";
}

function loadLocalEnv() {
  const candidates = [
    process.env.INIT_CWD,
    process.env.NEXT_PRIVATE_ORIGINAL_CWD,
    process.cwd(),
    process.argv[1],
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const root = findEnvRoot(candidate);
    if (root) {
      loadEnvConfig(root);
      return;
    }
  }

  loadEnvConfig(process.cwd());
}

function findEnvRoot(candidate: string) {
  let current = existsSync(candidate) && candidate.match(/\.[cm]?js$/) ? path.dirname(candidate) : candidate;
  current = path.resolve(current);

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(path.join(current, ".env.local"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return null;
}
