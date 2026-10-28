import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/history-export.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = {exports:{}};
new Function("module", "exports", compiled)(mod, mod.exports);
const {collectHistoryExport, historyExportParams} = mod.exports;
const filters = {range:"custom",from:"2026-10-01",to:"2026-10-28",type:"mail",status:"all",q:"회사",sort:"oldest",limit:20,asOf:"2026-10-28T00:00:00.000Z"};
const item = id => ({id:String(id),type:"mail"});
const page = (items, nextCursor = null, asOf = filters.asOf) => ({items,hasMore:Boolean(nextCursor),nextCursor,appliedFilters:{...filters,limit:200,asOf},summary:null});

test("all export starts a new 200-row cursor chain with applied filters, not screen pagination", async () => {
  const calls=[], progress=[];
  const result=await collectHistoryExport(filters, async params => {
    calls.push(Object.fromEntries(params));
    return calls.length===1 ? page([item(1),item(2)],"next") : page([item(3)]);
  },new AbortController().signal,count=>progress.push(count));
  assert.deepEqual(result.items.map(x=>x.id),["1","2","3"]);
  assert.equal(calls[0].cursor,undefined); assert.equal(calls[1].cursor,"next");
  assert.equal(calls[0].limit,"200"); assert.equal(calls[0].includeSummary,"false");
  assert.equal(calls[0].q,"회사"); assert.equal(calls[0].from,filters.from); assert.equal(calls[0].sort,"oldest");
  assert.deepEqual(progress,[2,3]); assert.equal(result.filters.limit,200);
  assert.equal(historyExportParams({...filters,range:"all"}).has("from"),false);
});

test("5000 rows is allowed only when the entire result is complete", async () => {
  for (const extra of [false,true]) {
    let calls=0;
    const job=collectHistoryExport(filters,async()=>{
      const offset=calls++*200;
      return page(Array.from({length:200},(_,i)=>item(offset+i)),calls<25||extra?String(calls):null);
    },new AbortController().signal);
    if(extra) await assert.rejects(job,/5,000건/); else assert.equal((await job).items.length,5000);
    assert.equal(calls,25);
  }
});

test("cancellation before or during collection discards all rows", async () => {
  const controller=new AbortController(); controller.abort(); let calls=0;
  await assert.rejects(collectHistoryExport(filters,async()=>{calls++;return page([]);},controller.signal),{name:"AbortError"});
  assert.equal(calls,0);
  const second=new AbortController();
  await assert.rejects(collectHistoryExport(filters,async()=>{second.abort();return page([item(1)]);},second.signal),{name:"AbortError"});
});

test("errors, duplicate rows, stalled cursors and changed snapshot never yield partial output", async () => {
  const cases=[
    [page([item(1)],"a"),page([item(1)])],
    [page([item(1)],"a"),page([item(2)],"a")],
    [{...page([]),hasMore:true,nextCursor:"a"}],
    [{...page([item(1)]),hasMore:true,nextCursor:null}],
    [page([item(1)],"a"),page([item(2)],null,"2026-10-28T01:00:00.000Z")],
    [{...page([item(1)]),appliedFilters:undefined}],
  ];
  for(const pages of cases){let i=0;await assert.rejects(collectHistoryExport(filters,async()=>pages[i++],new AbortController().signal));}
  let calls=0;
  await assert.rejects(collectHistoryExport(filters,async()=>{if(calls++)throw new Error("network unavailable");return page([item(1)],"a");},new AbortController().signal),/network unavailable/);
});

test("identical UUIDs across distinct event types are valid, and empty exports stay empty", async () => {
  const result=await collectHistoryExport(filters,async()=>page([item(1),{...item(1),type:"check"}]),new AbortController().signal);
  assert.equal(result.items.length,2);
  assert.equal((await collectHistoryExport(filters,async()=>page([]),new AbortController().signal)).items.length,0);
});
