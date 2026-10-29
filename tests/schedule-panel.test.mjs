import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL("../",import.meta.url));
const loaded=new Map();
function load(file){
  const path=resolve(root,file);
  if(loaded.has(path))return loaded.get(path);
  const output=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const mod={exports:{}};loaded.set(path,mod.exports);
  new Function("require","module","exports",output)(name=>{
    if(!name.startsWith("@/"))return require(name);
    const relative="src/"+name.slice(2);
    const candidate=[relative+".tsx",relative+".ts"].find(item=>existsSync(resolve(root,item)));
    assert.ok(candidate,name);return load(candidate);
  },mod,mod.exports);
  return mod.exports;
}
const {SchedulePanel}=load("src/components/schedule-panel.tsx");
const filters={range:"30d",from:"",to:"",category:"review",q:"",page:1,pageSize:30};
const noop=()=>{};
const source={spreadsheetId:"safe-test-id",sheetId:12,title:"합성 일정 시트",url:"https://docs.google.com/spreadsheets/d/safe-test-id/edit?gid=12#gid=12"};
function item(overrides={}){return {id:"schedule-1",sourceRow:5,companyName:"합성 고객",serialRaw:"LO90000001",serial:"LO90000001",plannedDateRaw:"2026-10-28",plannedDate:"2026-10-28",round:"2차",completionRaw:"",completedDateRaw:"",executorRaw:"",contractStartRaw:"2026-01-01",contractEndRaw:"2026-12-31",notes:"",category:"review",issues:[],...overrides};}
function overview(overrides={}){return {status:"ready",items:[item()],total:1,counts:{review:1,hold:2,partner:3,completed:4,issues:1},filters,source,fetchedAt:"2026-10-28T00:00:00Z",stale:false,message:null,refreshAfterSeconds:300,...overrides};}
function render(overrides={}){return renderToStaticMarkup(createElement(SchedulePanel,{overview:overview(),filters,onFiltersChange:noop,onSearch:noop,onRefresh:noop,onPageChange:noop,loading:false,error:null,role:"admin",...overrides}));}
function button(html,name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");return html.match(new RegExp(`<button\\b[^>]*>(?:(?!<\\/button>)[\\s\\S])*${escaped}(?:(?!<\\/button>)[\\s\\S])*<\\/button>`))?.[0];}

test("ready schedule provides table and mobile cards with approximate dates and no execution controls",()=>{
  const html=render();
  assert.match(html,/<table/);assert.match(html,/<ul class="divide-y md:hidden"/);
  assert.equal((html.match(/합성 고객/g)||[]).length,2);
  assert.match(html,/대략 예정 시기/);assert.match(html,/확정 실행일이나 자동 실행 대상 수를 뜻하지 않습니다/);
  assert.doesNotMatch(html,/>자동 점검<|>발송<|>저장<|담당자 미배정/);
  assert.match(html,/공란을 사전 담당자 누락으로 판단하지/);
  assert.match(html,/2026\. 10\. 28\. 09:00 KST/);
});

test("missing connection never appears as an empty successful schedule",()=>{
  const html=render({overview:overview({status:"unconfigured",items:[],total:0,fetchedAt:null,message:"Google 연결 설정이 필요합니다.",setup:{missing:["GOOGLE_SHEETS_CLIENT_EMAIL","GOOGLE_SHEETS_PRIVATE_KEY"],serviceAccountEmail:null}})});
  assert.match(html,/일정 시트 연결이 필요/);assert.match(html,/Google 계정 연결/);
  assert.match(html,/OAuth 설정/);assert.doesNotMatch(html,/서비스 계정|GOOGLE_SHEETS_PRIVATE_KEY/);
  assert.doesNotMatch(html,/조회 조건에 맞는 0건|<table|합성 고객|원본 시트 열기/);
});

test("non-admin connection view does not expose setup account or field metadata",()=>{
  const html=render({role:"operator",overview:overview({status:"unconfigured",setup:{missing:["GOOGLE_SHEETS_PRIVATE_KEY"],serviceAccountEmail:"setup-only@example.invalid"}})});
  assert.match(html,/관리자에게 연결 설정/);
  assert.doesNotMatch(html,/setup-only@example.invalid|GOOGLE_SHEETS_PRIVATE_KEY/);
});

test("permission and expired-session errors conceal even previously loaded data and source links",()=>{
  for(const overrides of [{role:"viewer"},{error:{message:"forbidden",status:403}},{error:{message:"expired",status:401}}]){
    const html=render(overrides);
    assert.doesNotMatch(html,/합성 고객|LO90000001|safe-test-id|<table|기간과 검색어 기준 집계/);
    assert.match(html,/role="alert"/);assert.match(html,/권한이 필요|로그인 시간이 만료/);
  }
});

test("dirty filters keep applied results but disable page changes",()=>{
  const html=render({filters:{...filters,q:"새 조건"},overview:overview({total:80})});
  assert.match(html,/조건 변경됨/);assert.match(html,/합성 고객/);
  assert.match(button(html,"다음"),/disabled=""/);
  const clean=render({overview:overview({total:80})});
  assert.doesNotMatch(button(clean,"다음"),/disabled=""/);
});

test("stale and transport failure preserve prior results and timestamp with an explicit warning",()=>{
  const stale=render({overview:overview({stale:true,message:"원본 갱신에 실패했습니다."})});
  assert.match(stale,/최신 자료를 확인하지 못했습니다/);assert.match(stale,/마지막 정상 조회 자료/);
  assert.match(stale,/합성 고객/);assert.match(stale,/2026\. 10\. 28\. 09:00 KST/);
  const failed=render({error:{message:"네트워크 연결 실패"}});
  assert.match(failed,/마지막 조회 자료와 입력한 검색 조건을 유지/);assert.match(failed,/합성 고객/);
});

test("first load, refetch and empty results are distinct states",()=>{
  const first=render({overview:null,loading:true});
  assert.match(first,/점검 일정을 불러오고 있습니다/);assert.match(first,/aria-busy="true"/);
  assert.doesNotMatch(first,/예정 기록이 없습니다/);
  const refetch=render({loading:true});assert.match(refetch,/마지막 조회 자료를 표시/);assert.match(refetch,/합성 고객/);
  const empty=render({overview:overview({items:[],total:0})});assert.match(empty,/조건에 맞는 예정 기록이 없습니다/);assert.match(empty,/0–0건 표시/);
});

test("invalid custom range disables search and explains how to recover",()=>{
  const html=render({filters:{...filters,range:"custom",from:"2026-10-30",to:"2026-10-28"}});
  assert.match(button(html,"조회"),/disabled=""/);
  assert.match(html,/aria-invalid="true"/);assert.match(html,/종료일은 시작일보다 빠를 수 없습니다/);
});

test("source URL accepts only the declared Google spreadsheet and text stays escaped",()=>{
  const safe=render();assert.match(safe,/href="https:\/\/docs.google.com\/spreadsheets\/d\/safe-test-id\/edit/);
  for(const url of ["javascript:alert(1)","https://example.invalid/spreadsheets/d/safe-test-id/edit","https://docs.google.com/spreadsheets/d/other/edit"]){
    const html=render({overview:overview({source:{...source,url}})});assert.doesNotMatch(html,/원본 시트 열기/);
  }
  const escaped=render({overview:overview({items:[item({companyName:"<script>alert(1)</script>"})]})});
  assert.doesNotMatch(escaped,/<script>/);assert.match(escaped,/&lt;script&gt;/);
});

test("categories retain business meaning and count scope does not imply send eligibility",()=>{
  const html=render({overview:overview({items:[item({id:"x",category:"hold",completionRaw:"X"}),item({id:"p",category:"partner",executorRaw:"고은"}),item({id:"c",category:"completed",completionRaw:"O"})],total:3})});
  assert.match(html,/미실시 사유와 이후 계획/);assert.match(html,/협력사 수행 기록/);assert.match(html,/원본 시트의 완료 표기 기준/);
  assert.match(html,/모든 분류를 포함/);assert.match(html,/다른 분류와 중복될 수/);
  assert.doesNotMatch(html,/자동 발송 가능|자동 실행 가능/);
});

test("successful reads retain data quality messages even when the snapshot is fresh",()=>{
  const html=render({overview:overview({stale:false,message:"날짜를 확인할 수 없는 기록 2건은 기간 필터에서 제외됐습니다."})});
  assert.match(html,/날짜를 확인할 수 없는 기록 2건/);assert.match(html,/합성 고객/);
  assert.match(html,/role="status"/);assert.doesNotMatch(html,/최신 자료를 확인하지 못했습니다/);
});
