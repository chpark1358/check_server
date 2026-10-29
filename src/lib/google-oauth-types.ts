export type GoogleConnectionStatus = {
  status: "unconfigured" | "disconnected" | "connected" | "reauth_required" | "unavailable";
  accountEmail: string | null;
  connectedAt: string | null;
  message: string | null;
  canManage: boolean;
  callbackUrl?: string;
  missing?: string[];
};
