export type ScheduleCategory = "review" | "hold" | "partner" | "completed";
export type ScheduleFilters = {
  range: "7d" | "30d" | "all" | "custom";
  from: string;
  to: string;
  category: ScheduleCategory | "all";
  q: string;
  page: number;
  pageSize: number;
};
export type ScheduleItem = {
  id: string;
  sourceRow: number;
  companyName: string;
  serialRaw: string;
  serial: string | null;
  plannedDateRaw: string;
  plannedDate: string | null;
  round: string;
  completionRaw: string;
  completedDateRaw: string;
  executorRaw: string;
  contractStartRaw: string;
  contractEndRaw: string;
  notes: string;
  category: ScheduleCategory;
  issues: string[];
};
export type ScheduleSource = { spreadsheetId: string; sheetId: number; title: string; url: string };
export type ScheduleOverview = {
  status: "ready" | "unconfigured" | "access_denied" | "upstream_error" | "schema_error";
  items: ScheduleItem[];
  total: number;
  counts: { review: number; hold: number; partner: number; completed: number; issues: number };
  filters: ScheduleFilters;
  source: ScheduleSource;
  fetchedAt: string | null;
  stale: boolean;
  message: string | null;
  refreshAfterSeconds: number;
  setup?: { missing: string[]; serviceAccountEmail: string | null };
};

export const defaultScheduleFilters: ScheduleFilters = {
  range: "30d", from: "", to: "", category: "review", q: "", page: 1, pageSize: 30,
};
