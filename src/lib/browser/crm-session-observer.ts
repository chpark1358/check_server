import { isCrmSessionStorageKey, readCrmSessionSnapshot, type CrmSession, type CrmSessionSnapshot } from "./crm-storage";

type EventSource = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type TimerHandle = ReturnType<typeof setTimeout> | number;
type SessionChange = "initial" | "storage" | "resume" | "expired";
type ObserverOptions = {
  read?: () => CrmSessionSnapshot;
  events?: EventSource;
  visibility?: EventSource & { visibilityState: string };
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
  cancel?: (timer: TimerHandle) => void;
};

/** Keep a mounted CRM panel in sync without reading or broadcasting credentials. */
export function observeCrmSession(
  userId: string,
  onSession: (session: CrmSession | null, reason: SessionChange) => void,
  options: ObserverOptions = {},
) {
  const read = options.read ?? (() => readCrmSessionSnapshot(userId));
  const events = options.events ?? window;
  const visibility = options.visibility ?? document;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? ((timer: TimerHandle) => clearTimeout(timer));
  let active = true;
  let snapshot = read();
  let current = snapshot.session;
  let localSnapshotUnavailable = false;
  let timer: TimerHandle | undefined;

  function armExpiry() {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
    if (!active || !current) return;
    const remaining = Date.parse(current.expiresAt) - now();
    const delay = Number.isFinite(remaining) ? remaining : 0;
    timer = schedule(() => sync("expired"), Math.max(0, Math.min(delay, 2_147_483_647)));
  }

  function apply(next: CrmSession | null, reason: SessionChange) {
    if (current?.expiresAt === next?.expiresAt && current?.username === next?.username && current?.masked === next?.masked) return;
    current = next;
    onSession(current, reason);
  }

  function sync(reason: SessionChange) {
    if (!active) return;
    const next = read();
    if (next.available) {
      // A local login may succeed while localStorage writes are blocked. An
      // unchanged storage value on focus must not erase that in-memory session.
      if (reason !== "storage" && localSnapshotUnavailable) {
        // If both reading and writing failed during a local login, the first
        // readable value may predate it. Establish a baseline without reviving
        // that older metadata; explicit cross-tab events remain authoritative.
        localSnapshotUnavailable = false;
      } else if (reason === "storage" || next.revision !== snapshot.revision) {
        apply(next.session, reason);
      }
      localSnapshotUnavailable = false;
      snapshot = next;
    }
    // Re-read the latest metadata BEFORE expiring: an older tab must not delete
    // a renewed session that another tab has just saved.
    if (current && !(Date.parse(current.expiresAt) > now())) apply(null, "expired");
    armExpiry();
  }

  const onStorage = (event: Event) => {
    const storageEvent = event as StorageEvent;
    if (isCrmSessionStorageKey(storageEvent.key, userId)) sync("storage");
  };
  const onFocus = () => sync("resume");
  const onVisibility = () => { if (visibility.visibilityState === "visible") sync("resume"); };
  events.addEventListener("storage", onStorage);
  events.addEventListener("focus", onFocus);
  visibility.addEventListener("visibilitychange", onVisibility);
  onSession(current, "initial");
  armExpiry();

  return {
    /** Call after a local login/logout write; storage events only reach other tabs. */
    setLocalSession(session: CrmSession | null) {
      if (!active) return;
      current = session;
      snapshot = read();
      localSnapshotUnavailable = !snapshot.available;
      armExpiry();
    },
    stop() {
      active = false;
      if (timer !== undefined) cancel(timer);
      events.removeEventListener("storage", onStorage);
      events.removeEventListener("focus", onFocus);
      visibility.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
