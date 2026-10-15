export type ZendeskReadCapability = {
  id: "groups" | "organizations" | "organizationSearch" | "users" | "ticketHistory" | "ticketFields";
  label: string;
  endpoint: string;
  status: "available" | "forbidden" | "unavailable";
  message: string | null;
};

export type ZendeskConnectionResult = {
  ok: boolean;
  message?: string;
  connection: {
    configured: boolean;
    authentication: "oauth";
    grantType: "client_credentials";
    subdomain: string | null;
    missingKeys: string[];
    scopes: string[];
    grantedScopes: string[] | null;
    accessTokenExpiresAt: string | null;
  };
  account?: { id: string; name: string | null; email: string | null; role: string | null };
  capabilities?: ZendeskReadCapability[];
  readAccess?: "ready" | "partial" | "unavailable";
  verifiedAt?: string;
};
