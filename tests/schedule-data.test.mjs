import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled=ts.transpileModule(readFileSync(new URL("../src/lib/schedule-data.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};new Function("module","exports",compiled)(mod,mod.exports);
const {parseScheduleRows,parseScheduleQuery,filterScheduleItems,scheduleDate}=mod.exports;
const headers=()=>{const r=Array(17).fill("");for(const [col,value]of Object.entries({2:"시리얼번호",3:"고객사명",6:"유지보수 계약 시작일",7:"유지보수 계약 만료일",8:"특이사항",10:"점검예정시기",11:"점검회차",12:"완료여부",13:"점검일자",14:"점검 주체",16:"비고"}))r[col]=value;return [[],[],[],r];};
const row=(overrides={})=>{const r=Array(23).fill("");Object.assign(r,{2:"24123103",3:"합성 고객",6:"2026-01-01",7:"2026-12-31",10:"2026-10-28",11:"1",21:"DO_NOT_EXPOSE_CONTACT",...overrides});return r;};
const now=new Date("2026-10-27T15:30:00Z");
const query=(values={})=>parseScheduleQuery(new URLSearchParams(values),now);

test("strict serial and dates preserve uncertainty, zeros and raw text",()=>{
  const items=parseScheduleRows([...headers(),row(),row({2:"LO24123103(2호기)",10:"2025-02-29",7:"2025-02-29"}),row({2:"00000001",10:"2026.10.29"})]);
  assert.equal(items[0].serial,"LO24123103");assert.equal(items[1].serial,null);assert.equal(items[1].plannedDate,null);
  assert.ok(items[1].issues.includes("계약 만료일 확인"));assert.equal(items[2].serial,"LO00000001");assert.equal(items[2].plannedDate,"2026-10-29");
  assert.equal(JSON.stringify(items).includes("DO_NOT_EXPOSE_CONTACT"),false);
  for(const date of ["2026-02-29","2026-04-31","2026-13-01","2026-00-10","2026-01-00","2026-10-28T10:00:00Z"])assert.equal(scheduleDate(date),null);
  assert.equal(scheduleDate("2024-02-29"),"2024-02-29");
});

test("X, partner and retrospective executor semantics are distinct and unknown markers never mean completion",()=>{
  const rows=[row(),row({12:"X"}),row({12:"x"}),row({14:"고은"}),row({12:"O",13:"2026-10-28"}),row({12:"o"}),row({12:"ㅇ"}),row({12:"예정"}),row({14:"rhdms"})];
  rows.forEach((r,i)=>r[11]=String(i+1));
  const items=parseScheduleRows([...headers(),...rows]);
  assert.deepEqual(items.map(x=>x.category),["review","hold","hold","partner","completed","completed","review","review","review"]);
  assert.deepEqual(items[0].issues,[]);assert.ok(items[5].issues.includes("완료 표기와 실제 점검일 확인"));
  assert.ok(items[6].issues.includes("완료 표기 확인"));assert.ok(items[8].issues.includes("수행 주체 표기 확인"));
});

test("headers fail closed on moved or missing fields and tolerate whitespace",()=>{
  const h=headers();h[3][14]="  점검\n 주체 ";assert.equal(parseScheduleRows([...h,row()]).length,1);
  const changed=headers();changed[3][10]="실행일";assert.throws(()=>parseScheduleRows([...changed,row()]),/열 구조/);
  assert.throws(()=>parseScheduleRows([[],[]]),/열 구조/);
  assert.deepEqual(parseScheduleRows(headers()),[]);
});

test("row ordering is not identity and occurrence collisions are flagged without merging",()=>{
  const a=row(),b=row({10:"2026-11-01"}),c=row({2:"00000002"});
  const first=parseScheduleRows([...headers(),a,b,c,a]);const second=parseScheduleRows([...headers(),c,a,b,a]);
  assert.equal(first.length,4);assert.deepEqual(first.map(x=>x.id).sort(),second.map(x=>x.id).sort());
  assert.equal(first.filter(x=>x.issues.includes("동일 회차 후보 확인")).length,3);
  assert.equal(new Set(first.map(x=>x.id)).size,4);assert.equal(first[0].sourceRow,5);
});

test("KST future ranges include today and custom dates validate without host timezone",()=>{
  assert.equal(query().from,"2026-10-28");assert.equal(query().to,"2026-11-26");assert.equal(query({range:"7d"}).to,"2026-11-03");
  assert.equal(query({range:"all"}).from,"");assert.equal(query({range:"custom",from:"2026-10-28",to:"2026-10-28"}).to,"2026-10-28");
  for(const params of [{range:"bad"},{category:"bad"},{page:"0"},{pageSize:"101"},{pageSize:"1.5"},{page:"10001"},{range:"custom",from:"2026-10-29",to:"2026-10-28"},{range:"custom",from:"2025-02-29",to:"2026-10-28"},{q:"a".repeat(201)}])assert.throws(()=>query(params));
});

test("filters count the selected date/search scope and paginate category without exposing all rows",()=>{
  const items=parseScheduleRows([...headers(),row(),row({12:"X",11:"2"}),row({14:"고은",11:"3"}),row({10:"bad",11:"4"}),row({10:"2022-01-01",11:"5"})]);
  const result=filterScheduleItems(items,query());
  assert.equal(result.total,1);assert.deepEqual(result.counts,{review:1,hold:1,partner:1,completed:0,issues:0});
  const all=filterScheduleItems(items,query({range:"all",category:"all",pageSize:"2",page:"2"}));
  assert.equal(all.total,5);assert.equal(all.items.length,2);assert.equal(all.counts.issues,1);
  assert.equal(filterScheduleItems(items,query({q:"NO_MATCH"})).total,0);
  assert.equal(filterScheduleItems(items,query({page:"999"})).filters.page,1);
});
