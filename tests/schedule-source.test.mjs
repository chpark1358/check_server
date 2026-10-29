import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require=createRequire(import.meta.url);
const SOURCE_ID="1nrcMefriNnjcizsrhXGYKHbZhkRHT6VR1j-V7f_d7xY";
const rows=(account="A")=>{
  const h=Array(17).fill("");Object.assign(h,{2:"시리얼번호",3:"고객사명",6:"유지보수 계약 시작일",7:"유지보수 계약 만료일",8:"특이사항",10:"점검예정시기",11:"점검회차",12:"완료여부",13:"점검일자",14:"점검 주체",16:"비고"});
  const r=Array(17).fill("");Object.assign(r,{2:"24123103",3:"합성 일정 "+account,6:"2026-01-01",7:"2026-12-31",10:"2026-10-28",11:"1"});return [[],[],[],h,r];
};

class GoogleOAuthError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}

function harness() {
  let clock=Date.parse("2026-10-28T00:00:00Z"),failure=0,mode="normal",revision="A",oauthFailure=null,oauthCalls=0,valuesPause=null,onValues=null;
  const calls=[],env={};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[clock]));} static now(){return clock;} }
  const oauth={GoogleOAuthError,async getGoogleOAuthAccessToken(){oauthCalls++;if(oauthFailure)throw oauthFailure;return {accessToken:"access-"+revision,revision};}};
  const fetch=async(url,init)=>{
    calls.push({url:String(url),init});
    const token=init.headers.authorization.replace(/^Bearer access-/,"");
    if(failure)return new Response("private upstream error",{status:failure});
    if(String(url).includes("/values/")){
      if(valuesPause?.token===token){valuesPause.started();await valuesPause.wait;}
      onValues?.();
      const values=rows(token);
      if(mode==="bad-headers")values[3][10]="wrong";
      if(mode==="bad-date")values[4][10]="2025-02-29";
      if(mode==="bad-row")values[4]="not a row";
      if(mode==="missing-values")return Response.json({});
      if(mode==="oversized-response")return new Response("{}",{headers:{"content-length":String(9*1024*1024)}});
      return Response.json({values});
    }
    return Response.json({sheets:[{properties:{sheetId:mode==="wrong-tab"?123:1027882150,title:"Source's tab",gridProperties:{rowCount:mode==="too-many"?20001:mode==="beyond-grid"?4:100,columnCount:mode==="short-columns"?16:23}}}]});
  };
  const loaded=new Map();
  function load(file,mocks={}) {
    if(loaded.has(file))return loaded.get(file);
    const compiled=ts.transpileModule(readFileSync(new URL("../"+file,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const mod={exports:{}};loaded.set(file,mod.exports);
    new Function("require","module","exports","process","fetch","Date",compiled)(name=>name in mocks?mocks[name]:name==="server-only"?{}:name==="@/lib/server/google-oauth"?oauth:name.startsWith("@/")?load("src/"+name.slice(2)+".ts"):require(name),mod,mod.exports,{env},fetch,Clock);
    return mod.exports;
  }
  const source=load("src/lib/server/schedule-source.ts"),data=load("src/lib/schedule-data.ts");
  return {source,data,calls,env,load,oauthCalls:()=>oauthCalls,advance(ms){clock+=ms;},fail(code){failure=code;},mode(value){mode=value;},connect(next){revision=next;oauthFailure=null;},oauthError(error){oauthFailure=error;},duringValues(callback){onValues=callback;},pauseValues(token){
    let release,started;
    const wait=new Promise(resolve=>{release=resolve;});
    const began=new Promise(resolve=>{started=resolve;});
    valuesPause={token,wait,started};return {started:began,release};
  }};
}
const filter=f=>f.data.parseScheduleQuery(new URLSearchParams({range:"all",category:"all"}));

test("unconfigured, disconnected and unavailable OAuth fail before any Sheets request and clear earlier rows",async()=>{
  for(const [status,code] of [["unconfigured","OAUTH_NOT_CONFIGURED"],["access_denied","GOOGLE_NOT_CONNECTED"],["upstream_error","CONNECTION_STORE_UNAVAILABLE"]]){
    const f=harness();f.oauthError(new GoogleOAuthError(status,code,"Google 연결을 확인해 주세요."));
    const initial=await f.source.loadScheduleOverview(filter(f));
    assert.equal(initial.status,status);assert.deepEqual(initial.items,[]);assert.equal(f.calls.length,0);assert.equal(initial.setup,undefined);
    f.connect("A");assert.equal((await f.source.loadScheduleOverview(filter(f))).total,1);
    f.oauthError(new GoogleOAuthError(status,code,"Google 연결을 확인해 주세요."));
    const blocked=await f.source.loadScheduleOverview(filter(f));
    assert.equal(blocked.status,status);assert.deepEqual(blocked.items,[]);assert.equal(blocked.fetchedAt,null);assert.equal(f.calls.length,2);
  }
});

test("opaque OAuth failures never expose internal credentials or upstream messages",async()=>{
  const f=harness();f.oauthError(new Error("secret test-access-token invalid credentials payload"));
  const result=await f.source.loadScheduleOverview(filter(f));
  assert.equal(result.status,"upstream_error");assert.equal(f.calls.length,0);
  assert.doesNotMatch(JSON.stringify(result),/secret|test-access-token|credentials payload/);
});

test("data requests are fixed-source readonly GET A:Q and OAuth tokens stay server-side",async()=>{
  const f=harness();const result=await f.source.loadScheduleOverview(filter(f));
  assert.equal(result.status,"ready");assert.equal(result.items.length,1);assert.equal(f.calls.length,2);
  for(const call of f.calls){
    assert.equal(call.init.method,"GET");assert.equal(call.init.cache,"no-store");assert.equal(call.init.redirect,"error");
    assert.ok(call.init.signal);assert.equal(call.init.headers.authorization,"Bearer access-A");
    const url=new URL(call.url);assert.equal(url.origin,"https://sheets.googleapis.com");assert.ok(url.pathname.startsWith("/v4/spreadsheets/"+SOURCE_ID));
    assert.doesNotMatch(call.url,/oauth2|batchUpdate|:update/);
  }
  assert.match(decodeURIComponent(f.calls[1].url),/values\/'Source''s tab'!A1:Q100/);
  assert.doesNotMatch(f.calls[1].url,/A1:V|A1:W/);
  assert.equal(result.source.sheetId,1027882150);assert.equal(result.source.title,"Source's tab");
  assert.equal(f.oauthCalls(),2);assert.doesNotMatch(JSON.stringify(result),/access-A|refresh_token|PRIVATE KEY/);
});

test("concurrent loads singleflight while cached search and page loads still validate the connection",async()=>{
  const f=harness();const results=await Promise.all(Array.from({length:8},()=>f.source.loadScheduleOverview(filter(f))));
  assert.ok(results.every(x=>x.total===1));assert.equal(f.calls.length,2);assert.equal(f.oauthCalls(),16);
  const empty=await f.source.loadScheduleOverview({...filter(f),q:"unknown"});assert.equal(empty.total,0);assert.equal(f.calls.length,2);assert.equal(f.oauthCalls(),18);
  const page=await f.source.loadScheduleOverview({...filter(f),page:2});assert.equal(page.filters.page,1);assert.equal(f.calls.length,2);
  f.advance(301000);await f.source.loadScheduleOverview(filter(f));assert.equal(f.calls.length,4);
});

test("transient Sheet failure serves a labeled recent snapshot with backoff and then expires it",async()=>{
  const f=harness();await f.source.loadScheduleOverview(filter(f));f.advance(301000);f.fail(503);
  const stale=await f.source.loadScheduleOverview(filter(f));assert.equal(stale.status,"ready");assert.equal(stale.stale,true);assert.equal(stale.items.length,1);assert.match(stale.message,/마지막으로 확인한/);assert.equal(stale.refreshAfterSeconds,60);
  const calls=f.calls.length;await f.source.loadScheduleOverview(filter(f));assert.equal(f.calls.length,calls);
  f.advance(31*60000);const expired=await f.source.loadScheduleOverview(filter(f));assert.equal(expired.status,"upstream_error");assert.deepEqual(expired.items,[]);assert.equal(expired.fetchedAt,null);
});

test("Sheet permission denial clears cached customer rows and suppresses raw errors",async()=>{
  for(const code of [401,403,404]){
    const f=harness();await f.source.loadScheduleOverview(filter(f));f.advance(301000);f.fail(code);
    const denied=await f.source.loadScheduleOverview(filter(f));assert.equal(denied.status,"access_denied");assert.deepEqual(denied.items,[]);assert.equal(denied.fetchedAt,null);assert.doesNotMatch(JSON.stringify(denied),/private upstream error/);
    assert.deepEqual((await f.source.loadScheduleOverview(filter(f))).items,[]);
  }
});

test("schema changes and size boundaries discard cached rows rather than returning truncated or stale data",async()=>{
  for(const mode of ["bad-headers","too-many","wrong-tab","short-columns","beyond-grid","bad-row","missing-values","oversized-response"]){
    const f=harness();await f.source.loadScheduleOverview(filter(f));f.advance(301000);f.mode(mode);
    const result=await f.source.loadScheduleOverview(filter(f));assert.equal(result.status,"schema_error",mode);assert.deepEqual(result.items,[],mode);assert.equal(result.fetchedAt,null,mode);
  }
});

test("a new OAuth revision cannot reuse the previous connected account's fresh snapshot",async()=>{
  const f=harness();const first=await f.source.loadScheduleOverview(filter(f));assert.equal(first.items[0].companyName,"합성 일정 A");
  f.connect("B");const second=await f.source.loadScheduleOverview(filter(f));assert.equal(second.items[0].companyName,"합성 일정 B");assert.equal(f.calls.length,4);
});

test("disconnect during a Google read is caught by the final credential check before returning rows",async()=>{
  const f=harness();f.duringValues(()=>f.oauthError(new GoogleOAuthError("access_denied","GOOGLE_NOT_CONNECTED","연결이 해제되었습니다.")));
  const result=await f.source.loadScheduleOverview(filter(f));assert.equal(result.status,"access_denied");assert.deepEqual(result.items,[]);assert.equal(result.fetchedAt,null);
  const calls=f.calls.length;assert.deepEqual((await f.source.loadScheduleOverview(filter(f))).items,[]);assert.equal(f.calls.length,calls);
});

test("reconnect during a read returns no old rows and a subsequent request loads the new account",async()=>{
  const f=harness();f.duringValues(()=>f.connect("B"));
  const old=await f.source.loadScheduleOverview(filter(f));assert.equal(old.status,"access_denied");assert.deepEqual(old.items,[]);assert.match(old.message,/연결 계정이 변경/);
  f.duringValues(null);const next=await f.source.loadScheduleOverview(filter(f));assert.equal(next.items[0].companyName,"합성 일정 B");assert.equal(f.calls.length,4);
});

test("a delayed old-account read neither exposes old rows nor clears a newer account's valid cache",async()=>{
  const f=harness(),pause=f.pauseValues("A");
  const oldJob=f.source.loadScheduleOverview(filter(f));await pause.started;
  f.connect("B");const newResult=await f.source.loadScheduleOverview(filter(f));assert.equal(newResult.items[0].companyName,"합성 일정 B");
  pause.release();const old=await oldJob;assert.equal(old.status,"access_denied");assert.deepEqual(old.items,[]);
  const calls=f.calls.length;const cached=await f.source.loadScheduleOverview(filter(f));assert.equal(cached.items[0].companyName,"합성 일정 B");assert.equal(f.calls.length,calls);
});

test("invalid planned dates stay source-wide warnings without being counted inside dated filters",async()=>{
  const f=harness();f.mode("bad-date");const filters=f.data.parseScheduleQuery(new URLSearchParams(),new Date("2026-10-28T00:00:00Z"));
  const result=await f.source.loadScheduleOverview(filters);assert.equal(result.total,0);assert.equal(result.counts.issues,0);assert.match(result.message,/원본 전체.*1건.*전체 기간/);
});

test("minimum role and query validation fail closed before loading data; every route response is no-store",async()=>{
  const f=harness();assert.equal(f.source.scheduleMinimumRole(),"admin");f.env.SCHEDULE_MIN_ROLE="viewer";assert.equal(f.source.scheduleMinimumRole(),"admin");f.env.SCHEDULE_MIN_ROLE="operator ";assert.equal(f.source.scheduleMinimumRole(),"admin");f.env.SCHEDULE_MIN_ROLE="operator";assert.equal(f.source.scheduleMinimumRole(),"operator");
  let allow=false,loads=0,minimum;
  class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
  const api={ApiError,async requireRole(request,id,role){minimum=role;if(!allow)throw new ApiError(403,"FORBIDDEN","denied");return {role:"admin"};},apiOk(id,data){return Response.json(data);},async withApiHandler(request,handler){try{return await handler("test");}catch(e){return Response.json({code:e.code},{status:e.status??500});}}};
  const route=f.load("src/app/api/schedules/route.ts",{"@/lib/server/api":api,"@/lib/server/schedule-source":{...f.source,async loadScheduleOverview(){loads++;return {status:"unconfigured"};}}});
  const request={nextUrl:new URL("https://app.example/api/schedules?range=all")};
  const denied=await route.GET(request);assert.equal(denied.status,403);assert.equal(loads,0);assert.equal(minimum,"operator");assert.match(denied.headers.get("cache-control"),/no-store/);
  allow=true;const ok=await route.GET(request);assert.equal(ok.status,200);assert.equal(loads,1);assert.match(ok.headers.get("cache-control"),/no-store/);
  for(const method of ["POST","PUT","PATCH","DELETE"])assert.equal(route[method],undefined);
  const bad=await route.GET({nextUrl:new URL("https://app.example/api/schedules?pageSize=1000")});assert.equal(bad.status,400);assert.equal(loads,1);assert.match(bad.headers.get("cache-control"),/no-store/);
});
