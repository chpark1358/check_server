// Roster changes apply to new work; existing document and audit records keep their original names.
const RETIRED_ENGINEERS = new Set(["류은석", "박장현"]);
const PENDING_ENGINEERS = ["이석진"];

export function isRetiredEngineerName(name: string | null | undefined) {
  return RETIRED_ENGINEERS.has((name ?? "").normalize("NFKC").trim());
}

export function normalizeActiveEngineerName(name: string | null | undefined) {
  const normalized = (name ?? "").trim();
  return isRetiredEngineerName(normalized) ? "" : normalized;
}

export function buildEngineerRoster(rows: Array<{ id: string; name: string; updated_at: string; storage_path: string | null }>) {
  const active = rows.filter((row) => !isRetiredEngineerName(row.name)).map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    hasSignature: Boolean(row.storage_path),
  }));
  for (const name of PENDING_ENGINEERS) {
    if (!active.some((row) => row.name.trim() === name)) {
      active.push({ id: `pending:${name}`, name, updatedAt: "", hasSignature: false });
    }
  }
  return active.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
