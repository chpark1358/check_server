import type { HistoryAppliedFilters, HistoryItem, HistoryOverview } from "@/components/history-panel";

export const HISTORY_PAGE_SIZES = [20, 30, 50, 100] as const;
export const HISTORY_EXPORT_LIMIT = 5000;

export function historyExportParams(filters: HistoryAppliedFilters, cursor?: string | null) {
  const params = new URLSearchParams({
    range: filters.range, type: filters.type, status: filters.status,
    sort: filters.sort ?? "newest", limit: "200", includeSummary: "false",
  });
  if (filters.q) params.set("q", filters.q);
  if (filters.range === "custom") {
    params.set("from", filters.from ?? "");
    params.set("to", filters.to ?? "");
  }
  if (cursor) params.set("cursor", cursor);
  return params;
}

/** Start a fresh, owner-scoped cursor chain; never reuse the screen's page cursor. */
export async function collectHistoryExport(
  filters: HistoryAppliedFilters,
  fetchPage: (params: URLSearchParams, signal: AbortSignal) => Promise<HistoryOverview>,
  signal: AbortSignal,
  onProgress: (count: number) => void = () => {},
): Promise<{ items: HistoryItem[]; filters: HistoryAppliedFilters }> {
  const items: HistoryItem[] = [];
  const seenItems = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let snapshot: HistoryAppliedFilters | undefined;
  do {
    signal.throwIfAborted();
    const page = await fetchPage(historyExportParams(filters, cursor), signal);
    signal.throwIfAborted();
    if (!page.appliedFilters?.asOf || (snapshot && snapshot.asOf !== page.appliedFilters.asOf)) {
      throw new Error("조회 기준 시각이 변경되었습니다. 다시 다운로드해 주세요.");
    }
    snapshot ??= page.appliedFilters;
    for (const item of page.items) {
      const key = item.type + ":" + item.id;
      if (seenItems.has(key)) throw new Error("이력 페이지가 중복되었습니다. 다시 다운로드해 주세요.");
      seenItems.add(key);
      items.push(item);
    }
    if (items.length > HISTORY_EXPORT_LIMIT || (items.length === HISTORY_EXPORT_LIMIT && page.hasMore)) {
      throw new Error("전체 다운로드는 최대 5,000건입니다. 조회 기간이나 검색 조건을 좁혀 주세요. 일부만 저장하지 않았습니다.");
    }
    onProgress(items.length);
    cursor = page.hasMore ? page.nextCursor ?? null : null;
    if (page.hasMore && (!cursor || seenCursors.has(cursor) || page.items.length === 0)) {
      throw new Error("다음 이력 페이지를 확인할 수 없습니다. 다시 다운로드해 주세요.");
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return { items, filters: snapshot! };
}
