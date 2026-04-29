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
