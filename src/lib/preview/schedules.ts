import { filterScheduleItems, parseScheduleQuery } from "@/lib/schedule-data";
import type { ScheduleItem, ScheduleOverview } from "@/lib/schedule-types";

/** Synthetic UI data only. This helper has no Google, storage, or network access. */
export function previewScheduleOverview(params: URLSearchParams, now = new Date()): ScheduleOverview {
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0,10);
  const items: ScheduleItem[] = Array.from({length:84}, (_,index) => {
    const plannedDate = new Date(Date.parse(today + "T00:00:00Z") + (index % 35) * 86400000).toISOString().slice(0,10);
    const category = index % 13 === 1 ? "partner" : index % 13 === 2 ? "hold" : index % 13 === 3 ? "completed" : "review";
    const serial = "LO" + String(90000000 + index).padStart(8,"0");
    const ambiguous = index % 13 === 4;
    return {id:"preview-schedule-"+index,sourceRow:index+5,companyName:`샘플 예정 고객 ${index+1}`,
      serialRaw:index === 5 ? "미정 (합성 예시)" : serial,serial:index === 5 ? null : serial,
      plannedDateRaw:plannedDate,plannedDate,round:String(index % 3+1),
      completionRaw:category === "hold" ? "x" : category === "completed" ? "O" : ambiguous ? "ㅇ" : "",
      completedDateRaw:category === "completed" ? today : "",executorRaw:category === "partner" ? "고은" : category === "completed" ? "지란" : "",
      contractStartRaw:"2026-01-01",contractEndRaw:"2026-12-31",notes:"합성 데이터로 화면과 읽기 동작을 확인합니다.",
      category,issues:index === 5 ? ["시리얼 형식 확인"] : ambiguous ? ["완료 표기 확인"] : []};
  });
  const filters = parseScheduleQuery(params,now);
  return {status:"ready",...filterScheduleItems(items,filters),
    source:{spreadsheetId:"preview",sheetId:0,title:"합성 예정 일정 · 실제 시트 연결 아님",url:""},
    fetchedAt:now.toISOString(),stale:false,message:"합성 데이터입니다. 실제 시트 조회·수정·점검·발송은 실행하지 않습니다.",refreshAfterSeconds:0};
}
