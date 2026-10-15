export type CrmSession = { expiresAt: string; masked: string; username: string };
export type CrmPreferences = { rememberUsername: boolean; username: string };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const legacyUsernameKey = "check-server:solution-username:v1";
const legacySessionKey = "check-server:solution-session:v1";
const preferencesKey = (userId: string) => `check-server:crm-preferences:v2:${userId}`;
const sessionKey = (userId: string) => `check-server:solution-session:v2:${userId}`;

function browserStorage(): StorageLike | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readCrmPreferences(userId: string, storage = browserStorage()): CrmPreferences {
  const empty = { rememberUsername: false, username: "" };
  if (!userId || !storage) return empty;
  try {
    const raw = storage.getItem(preferencesKey(userId));
    if (raw) {
      const value = JSON.parse(raw);
      return value.rememberUsername === true && typeof value.username === "string"
        ? { rememberUsername: true, username: value.username.trim() }
        : empty;
    }
    // Adopt the existing browser's saved identifier once. The former key had no
    // account owner; session metadata is deliberately not migrated with it.
    const legacy = storage.getItem(legacyUsernameKey)?.trim();
    if (legacy) {
      const migrated = { rememberUsername: true, username: legacy };
      storage.setItem(preferencesKey(userId), JSON.stringify(migrated));
      storage.removeItem(legacyUsernameKey);
      return migrated;
    }
  } catch { /* Restricted/corrupt storage must not prevent CRM login. */ }
  return empty;
}

export function writeCrmPreferences(userId: string, rememberUsername: boolean, username: string, storage = browserStorage()) {
  if (!userId || !storage) return false;
  try {
    storage.setItem(preferencesKey(userId), JSON.stringify({
      rememberUsername,
      username: rememberUsername ? username.trim() : "",
    }));
    storage.removeItem(legacyUsernameKey);
    return true;
  } catch { return false; }
}

export function readCrmSession(userId: string, storage = browserStorage(), now = Date.now()): CrmSession | null {
  if (!userId || !storage) return null;
  try {
    const raw = storage.getItem(sessionKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw);
    const expires = Date.parse(value.expiresAt);
    if (typeof value.expiresAt !== "string" || typeof value.masked !== "string" ||
        typeof value.username !== "string" || !Number.isFinite(expires) || expires <= now) {
      storage.removeItem(sessionKey(userId));
      return null;
    }
    return { expiresAt: value.expiresAt, masked: value.masked, username: value.username };
  } catch { return null; }
}

export function writeCrmSession(userId: string, session: CrmSession, storage = browserStorage()) {
  if (!userId || !storage) return;
  try {
    // Allowlist public connection metadata; never persist a CRM token/password.
    storage.setItem(sessionKey(userId), JSON.stringify({
      expiresAt: session.expiresAt, masked: session.masked, username: session.username,
    }));
    storage.removeItem(legacySessionKey);
  } catch { /* The server cookie can still support the current page session. */ }
}

export function clearCrmSession(userId: string, storage = browserStorage()) {
  if (!storage) return;
  try {
    if (userId) storage.removeItem(sessionKey(userId));
    storage.removeItem(legacySessionKey);
  } catch { /* Logout must proceed even when browser storage is unavailable. */ }
}
