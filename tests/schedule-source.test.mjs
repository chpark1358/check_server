import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import ts from "typescript";

const require=createRequire(import.meta.url);
const privateKey=generateKeyPairSync("rsa",{modulusLength:2048,privateKeyEncoding:{format:"pem",type:"pkcs8"},publicKeyEncoding:{format:"pem",type:"spki"}}).privateKey;
const rows=()=>{
  const h=Array(17).fill("");Object.assign(h,{2:"시리얼번호",3:"고객사명",6:"유지보수 계약 시작일",7:"유지보수 계약 만료일",8:"특이사항",10:"점검예정시기",11:"점검회차",12:"완료여부",13:"점검일자",14:"점검 주체",16:"비고"});
  const r=Array(17).fill("");Object.assign(r,{2:"24123103",3:"합성 일정",6:"2026-01-01",7:"2026-12-31",10:"2026-10-28",11:"1"});return [[],[],[],h,r];
};
function harness() {
  let clock=Date.parse("2026-10-28T00:00:00Z"),failure=0,mode="normal";
  const calls=[]; const env={GOOGLE_SHEETS_CLIENT_EMAIL:"schedule@test-project.iam.gserviceaccount.com",GOOGLE_SHEETS_PRIVATE_KEY:privateKey};
  class Clock extends Date { constructor(...args){super(...(args.length?args:[clock]));} static now(){return clock;} }
  const fetch=async(url,init)=>{
    calls.push({url:String(url),init});
    if(failure)return new Response("private upstream error",{status:failure});
    if(String(url).includes("oauth2.googleapis.com"))return Response.json({access_token:"generated-test-token",expires_in:3600});
    if(String(url).includes("/values/")){
      const values=rows();if(mode==="bad-headers")values[3][10]="wrong";if(mode==="bad-date")values[4][10]="2025-02-29";
      return Response.json({values});
    }
    return Response.json({sheets:[{properties:{sheetId:1027882150,title:"Source's tab",gridProperties:{rowCount:mode==="too-many"?20001:100,columnCount:23}}}]});
  };
  const loaded=new Map();
  function load(file,mocks={}) {
    if(loaded.has(file))return loaded.get(file);
    const compiled=ts.transpileModule(readFileSync(new URL("../"+file,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const mod={exports:{}};loaded.set(file,mod.exports);
    new Function("require","module","exports","process","fetch","Date",compiled)((name)=>name in mocks?mocks[name]:name==="server-only"?{}:name.startsWith("@/")?load("src/"+name.slice(2)+".ts"):require(name),mod,mod.exports,{env},fetch,Clock);
    return mod.exports;
  }
  const source=load("src/lib/server/schedule-source.ts");const data=load("src/lib/schedule-data.ts");
  return {source,data,calls,env,advance(ms){clock+=ms;},fail(code){failure=code;},mode(value){mode=value;},load};
}
const filter=f=>f.data.parseScheduleQuery(new URLSearchParams({range:"all",category:"all"}));

test("missing/invalid server credentials never call Google and only administrators get setup names",async()=>{
  const f=harness();delete f.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const admin=await f.source.loadScheduleOverview(filter(f),"admin");assert.equal(admin.status,"unconfigured");assert.deepEqual(admin.setup.missing,["GOOGLE_SHEETS_PRIVATE_KEY"]);
  assert.equal((await f.source.loadScheduleOverview(filter(f),"operator")).setup,undefined);assert.equal(f.calls.length,0);
  f.env.GOOGLE_SHEETS_PRIVATE_KEY=privateKey;f.env.GOOGLE_SHEETS_CLIENT_EMAIL="ordinary@example.com";
  assert.equal((await f.source.loadScheduleOverview(filter(f),"admin")).status,"unconfigured");assert.equal(f.calls.length,0);
});

test("service-account JWT has readonly scope and no delegated user; data calls are fixed-source GET A:Q",async()=>{
  const f=harness();const result=await f.source.loadScheduleOverview(filter(f),"admin");
  assert.equal(result.status,"ready");assert.equal(result.items.length,1);assert.equal(f.calls.length,3);
  const claim=JSON.parse(Buffer.from(f.calls[0].init.body.get("assertion").split(".")[1],"base64url").toString());
  assert.equal(claim.scope,"https://www.googleapis.com/auth/spreadsheets.readonly");assert.equal(claim.aud,"https://oauth2.googleapis.com/token");assert.equal(claim.sub,undefined);assert.equal(claim.exp-claim.iat,3600);
  assert.equal(f.calls[0].init.method,"POST");for(const call of f.calls.slice(1))assert.equal(call.init.method,"GET");
  assert.match(decodeURIComponent(f.calls[2].url),/values\/'Source''s tab'!A1:Q100/);assert.doesNotMatch(f.calls[2].url,/A1:W|batchUpdate|update/);
  assert.equal(result.source.title,"Source's tab");assert.equal(JSON.stringify(result).includes("generated-test-token"),false);assert.equal(JSON.stringify(result).includes("PRIVATE KEY"),false);
});

test("concurrent loads singleflight, later search/page filters reuse the 5-minute cache",async()=>{
  const f=harness();const results=await Promise.all(Array.from({length:8},()=>f.source.loadScheduleOverview(filter(f),"admin")));
  assert.equal(results.every(x=>x.total===1),true);assert.equal(f.calls.length,3);
  const empty=await f.source.loadScheduleOverview({...filter(f),q:"unknown"},"admin");assert.equal(empty.total,0);assert.equal(f.calls.length,3);
  f.advance(301000);await f.source.loadScheduleOverview(filter(f),"admin");assert.equal(f.calls.length,5);
});

test("transient failure serves a labeled recent snapshot with backoff, then expires it",async()=>{
  const f=harness();await f.source.loadScheduleOverview(filter(f),"admin");f.advance(301000);f.fail(503);
  const stale=await f.source.loadScheduleOverview(filter(f),"admin");assert.equal(stale.status,"ready");assert.equal(stale.stale,true);assert.equal(stale.items.length,1);assert.match(stale.message,/마지막으로 확인한/);assert.equal(stale.refreshAfterSeconds,60);
  const calls=f.calls.length;await f.source.loadScheduleOverview(filter(f),"admin");assert.equal(f.calls.length,calls);
  f.advance(31*60000);const expired=await f.source.loadScheduleOverview(filter(f),"admin");assert.equal(expired.status,"upstream_error");assert.deepEqual(expired.items,[]);assert.equal(expired.fetchedAt,null);
});

test("permission denial drops cached records and does not expose raw upstream details",async()=>{
  const f=harness();await f.source.loadScheduleOverview(filter(f),"admin");f.advance(301000);f.fail(403);
  const denied=await f.source.loadScheduleOverview(filter(f),"admin");assert.equal(denied.status,"access_denied");assert.deepEqual(denied.items,[]);assert.equal(denied.fetchedAt,null);assert.doesNotMatch(JSON.stringify(denied),/private upstream error/);
  assert.deepEqual((await f.source.loadScheduleOverview(filter(f),"admin")).items,[]);
});

test("schema changes and oversized row grids fail closed instead of truncating or using stale data",async()=>{
  for(const mode of ["bad-headers","too-many"]){const f=harness();await f.source.loadScheduleOverview(filter(f),"admin");f.advance(301000);f.mode(mode);const result=await f.source.loadScheduleOverview(filter(f),"admin");assert.equal(result.status,"schema_error");assert.deepEqual(result.items,[]);}
});

test("credential rotation invalidates cached customer rows and malformed keys never reach Google",async()=>{
  const f=harness();await f.source.loadScheduleOverview(filter(f),"admin");f.env.GOOGLE_SHEETS_PRIVATE_KEY="invalid";
  const result=await f.source.loadScheduleOverview(filter(f),"admin");assert.equal(result.status,"unconfigured");assert.deepEqual(result.items,[]);assert.equal(f.calls.length,3);
});

test("invalid planned dates are counted as source warnings but not attributed to the selected date range",async()=>{
  const f=harness();f.mode("bad-date");const filters=f.data.parseScheduleQuery(new URLSearchParams(),new Date("2026-10-28T00:00:00Z"));
  const result=await f.source.loadScheduleOverview(filters,"admin");assert.equal(result.total,0);assert.equal(result.counts.issues,0);assert.match(result.message,/원본 전체.*1건.*전체 기간/);
});

test("minimum role fails closed and schedule route guards before query, with no-store on all responses",async()=>{
  const f=harness();assert.equal(f.source.scheduleMinimumRole(),"admin");f.env.SCHEDULE_MIN_ROLE="viewer";assert.equal(f.source.scheduleMinimumRole(),"admin");f.env.SCHEDULE_MIN_ROLE="operator";assert.equal(f.source.scheduleMinimumRole(),"operator");
  let allow=false, loads=0,minimum;
  class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
  const api={ApiError,async requireRole(request,id,role){minimum=role;if(!allow)throw new ApiError(403,"FORBIDDEN","denied");return {role:"admin"};},apiOk(id,data){return Response.json(data);},async withApiHandler(request,handler){try{return await handler("test");}catch(e){return Response.json({code:e.code},{status:e.status??500});}}};
  const route=f.load("src/app/api/schedules/route.ts",{"@/lib/server/api":api,"@/lib/server/schedule-source":{...f.source,async loadScheduleOverview(){loads++;return {status:"unconfigured"};}}});
  const request={nextUrl:new URL("https://app.example/api/schedules?range=all")};
  const denied=await route.GET(request);assert.equal(denied.status,403);assert.equal(loads,0);assert.equal(minimum,"operator");assert.match(denied.headers.get("cache-control"),/no-store/);
  allow=true;assert.equal((await route.GET(request)).status,200);assert.equal(loads,1);assert.equal(route.POST,undefined);assert.equal(route.PUT,undefined);assert.equal(route.DELETE,undefined);
  assert.equal((await route.GET({nextUrl:new URL("https://app.example/api/schedules?pageSize=1000")})).status,400);assert.equal(loads,1);
});
