export type CrmSession = { expiresAt: string; masked: string; username: string };
export type CrmPreferences = { rememberUsername: boolean; username: string };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CrmSessionSnapshot = {
  available: boolean;
  revision: string | null;
  session: CrmSession | null;
};

const legacyUsernameKey = "check-server:solution-username:v1";
const legacySessionKey = "check-server:solution-session:v1";
const preferencesKey = (userId: string) => `check-server:crm-preferences:v2:${userId}`;
const sessionKey = (userId: string) => `check-server:solution-session:v2:${userId}`;

export function isCrmSessionStorageKey(key: string | null, userId: string): boolean {
  return key === null || key === sessionKey(userId);
}

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

/** A failed storage read is different from an explicitly removed session. */
export function readCrmSessionSnapshot(userId: string, storage = browserStorage(), now = Date.now()): CrmSessionSnapshot {
  if (!userId || !storage) return { available: false, revision: null, session: null };
  let raw: string | null;
  try {
    raw = storage.getItem(sessionKey(userId));
  } catch {
    return { available: false, revision: null, session: null };
  }
  if (!raw) return { available: true, revision: raw, session: null };
  try {
    const value = JSON.parse(raw);
    const expires = Date.parse(value.expiresAt);
    if (typeof value.expiresAt !== "string" || typeof value.masked !== "string" ||
        typeof value.username !== "string" || !Number.isFinite(expires) || expires <= now) {
      return { available: true, revision: raw, session: null };
    }
    return { available: true, revision: raw, session: { expiresAt: value.expiresAt, masked: value.masked, username: value.username } };
  } catch { return { available: true, revision: raw, session: null }; }
}

export function readCrmSession(userId: string, storage = browserStorage(), now = Date.now()): CrmSession | null {
  const snapshot = readCrmSessionSnapshot(userId, storage, now);
  if (snapshot.available && snapshot.revision && !snapshot.session) {
    try { storage?.removeItem(sessionKey(userId)); } catch { /* Expired metadata is already unusable. */ }
  }
  return snapshot.session;
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
