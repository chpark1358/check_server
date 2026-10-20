export type CustomerMailMapping = {
  id: string;
  companyName: string;
  serial: string;
  zendeskOrgId: string;
  requesterName: string;
  requesterEmail: string;
  ccEmails: string;
  defaultEngineerName: string;
  memo: string;
};

export type CustomerMappingsSnapshot = {
  mappings: CustomerMailMapping[];
  revision: string;
};

const fields: Array<keyof CustomerMailMapping> = [
  "id", "companyName", "serial", "zendeskOrgId", "requesterName",
  "requesterEmail", "ccEmails", "defaultEngineerName", "memo",
];

export function assertCustomerMappings(value: unknown): asserts value is CustomerMailMapping[] {
  if (!Array.isArray(value) || value.some((row) =>
    !row || typeof row !== "object" || fields.some((key) => typeof row[key] !== "string") ||
    !row.id.trim() || (!row.companyName.trim() && !row.serial.trim()) ||
    !row.zendeskOrgId.trim() || !row.requesterEmail.trim(),
  )) {
    throw new Error("고객사 매핑 형식이 올바르지 않습니다. 입력값을 확인하세요. 기존 매핑은 변경하지 않았습니다.");
  }
}

export function readCustomerMappingsSnapshot(value: unknown): CustomerMappingsSnapshot {
  if (!value || typeof value !== "object" || !("mappings" in value) ||
      !("revision" in value) || typeof value.revision !== "string" || !value.revision) {
    throw new Error("서버 매핑 목록을 확인하지 못했습니다. 목록을 새로고침한 뒤 다시 시도하세요.");
  }
  assertCustomerMappings(value.mappings);
  return { mappings: value.mappings, revision: value.revision };
}

type MappingStorage = Pick<Storage, "getItem" | "setItem">;

function readStoredMappings(storage: MappingStorage, key: string) {
  const raw = storage.getItem(key);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  assertCustomerMappings(parsed);
  return parsed;
}

// The recovery copy is durable before the confirmed cache is replaced. On any
// read, parse or recovery-write failure, leave the original cache untouched.
export function cacheCustomerMappingSnapshot({
  storage, cacheKey, recoveryKey, legacyKey, mappings, confirmedBefore,
  identity, resolvedRecoveryIds = [],
}: {
  storage: MappingStorage;
  cacheKey: string;
  recoveryKey: string;
  legacyKey?: string;
  mappings: CustomerMailMapping[];
  confirmedBefore: CustomerMailMapping[];
  identity: (mapping: CustomerMailMapping) => string;
  resolvedRecoveryIds?: string[];
}): { cached: boolean; recoveryMappings: CustomerMailMapping[] } {
  let recoveryMappings: CustomerMailMapping[] = [];
  try {
    assertCustomerMappings(mappings);
    const priorRecovery = readStoredMappings(storage, recoveryKey);
    const priorCache = readStoredMappings(storage, cacheKey);
    const legacy = legacyKey && legacyKey !== cacheKey ? readStoredMappings(storage, legacyKey) : [];
    const knownServerKeys = new Set(confirmedBefore.map(identity));
    const resolved = new Set(resolvedRecoveryIds);
    const seen = new Set<string>();
    recoveryMappings = [...priorRecovery, ...priorCache, ...legacy].filter((row, index) => {
      const key = identity(row);
      const isPriorRecovery = index < priorRecovery.length;
      if (!key || resolved.has(row.id) || seen.has(key) || (!isPriorRecovery && knownServerKeys.has(key))) return false;
      seen.add(key);
      return true;
    });
    storage.setItem(recoveryKey, JSON.stringify(recoveryMappings));
    storage.setItem(cacheKey, JSON.stringify(mappings));
    return { cached: true, recoveryMappings };
  } catch {
    return { cached: false, recoveryMappings };
  }
}

// Do not update the confirmed UI or its cache until the server has acknowledged
// the complete replacement. A cache failure cannot turn a server failure into success.
export async function saveCustomerMappings({
  mappings, authenticated, revision, allowEmpty, persist, cache,
}: {
  mappings: CustomerMailMapping[];
  authenticated: boolean;
  revision: string | null;
  allowEmpty: boolean;
  persist: (body: { mappings: CustomerMailMapping[]; expectedRevision: string; allowEmpty: boolean }) => Promise<unknown>;
  cache: (mappings: CustomerMailMapping[]) => boolean;
}): Promise<{ mappings: CustomerMailMapping[]; revision: string | null; cached: boolean }> {
  assertCustomerMappings(mappings);
  if (mappings.length === 0 && !allowEmpty) {
    throw new Error("전체 매핑 삭제는 마지막 매핑의 삭제 버튼에서 확인해 주세요.");
  }
  if (!authenticated) {
    if (!cache(mappings)) throw new Error("이 브라우저에 매핑을 저장하지 못했습니다. 입력값을 유지했습니다.");
    return { mappings, revision: null, cached: true };
  }
  if (!revision) {
    throw new Error("최신 서버 매핑 목록을 먼저 불러와야 합니다. 목록을 새로고침한 뒤 다시 저장하세요.");
  }
  const saved = readCustomerMappingsSnapshot(await persist({ mappings, expectedRevision: revision, allowEmpty }));
  let cached = false;
  try { cached = cache(saved.mappings); } catch { /* The server already confirmed the save. */ }
  return { ...saved, cached };
}
