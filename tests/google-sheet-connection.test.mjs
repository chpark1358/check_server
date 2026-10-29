import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require=createRequire(import.meta.url),root=fileURLToPath(new URL("../",import.meta.url));
const noop=()=>{};
function loader(options={}) {
  const cache=new Map();let stateCall=0;
  const dialog=options.dialog;
  function load(file){
    const path=resolve(root,file);if(cache.has(path))return cache.get(path);
    const compiled=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
    const mod={exports:{}};cache.set(path,mod.exports);
    new Function("require","module","exports",compiled)(name=>{
      if(name==="react"&&options.confirmTarget!==undefined)return {...React,useState(initial){return React.useState(stateCall++===0 ? options.confirmTarget : initial);}};
      if(name==="@/components/ui/dialog"&&dialog)return dialog;
      if(!name.startsWith("@/"))return require(name);
      const base="src/"+name.slice(2),candidate=[base+".tsx",base+".ts"].find(p=>existsSync(resolve(root,p)));
      assert.ok(candidate,name);return load(candidate);
    },mod,mod.exports);
    return mod.exports;
  }
  return load("src/components/google-sheet-connection.tsx").GoogleSheetConnection;
}
const Component=loader();
const email="reader@example.invalid",connectedAt="2026-10-29T00:30:00Z";
function connection(overrides={}){return {status:"connected",accountEmail:email,connectedAt,message:null,canManage:true,...overrides};}
function props(overrides={}){return {connection:connection(),role:"admin",loading:false,busy:false,error:null,notice:null,onRefresh:noop,onConnect:noop,onDisconnect:noop,...overrides};}
const render=(overrides={})=>renderToStaticMarkup(React.createElement(Component,props(overrides)));
const text=html=>html.replace(/<[^>]*>/g,"");
function button(html,label){return html.match(new RegExp(`<button\\b[^>]*>(?:(?!<\\/button>)[\\s\\S])*${label}(?:(?!<\\/button>)[\\s\\S])*<\\/button>`))?.[0];}

test("admin sees shared read-only account, KST time and explicit management actions",()=>{
  const html=render();
  assert.match(html,/Google 계정 연결됨/);assert.match(html,/reader@example.invalid/);
  assert.match(text(html),/2026\. 10\. 29\. 09:30 KST/);
  assert.match(text(html),/관리자·operator가 함께 조회/);assert.match(html,/시트 읽기 전용/);
  assert.ok(button(html,"다른 Google 계정 연결"));assert.ok(button(html,"연결 해제"));
  assert.doesNotMatch(html,/일정 조회 성공|메일 발송 완료|<input|<textarea/);
});

test("operator receives shared connection metadata but cannot manage even with a forged canManage flag",()=>{
  const html=render({role:"operator",connection:connection({callbackUrl:"https://app.example/api/google/oauth/callback",missing:["SECRET_CONFIG_NAME"]})});
  assert.match(html,/reader@example.invalid/);assert.match(html,/공유 연결을 조회 중/);
  assert.equal(button(html,"다른 Google 계정 연결"),undefined);assert.equal(button(html,"연결 해제"),undefined);
  assert.doesNotMatch(html,/SECRET_CONFIG_NAME|app\.example|콜백 주소 복사/);
});

test("viewer, unknown and restoring roles do not expose prior account data, errors or management controls",()=>{
  for(const role of ["viewer",null,"unexpected"]){
    const html=render({role,error:"private old error",notice:"private old notice",connection:connection({callbackUrl:"https://app.example/api/google/oauth/callback",missing:["SECRET_CONFIG_NAME"]})});
    assert.doesNotMatch(html,/reader@example.invalid|private old|app\.example|SECRET_CONFIG_NAME|<button/);
    assert.match(html,/권한을 확인|조회 권한이 필요/);
  }
});

test("missing setup is distinct from disconnected and shows only admin configuration names and safe callback",()=>{
  const html=render({connection:connection({status:"unconfigured",accountEmail:null,connectedAt:null,missing:["GOOGLE_OAUTH_CLIENT_ID","GOOGLE_OAUTH_CLIENT_SECRET"],callbackUrl:"https://app.example/api/google/oauth/callback"})});
  assert.match(html,/OAuth 설정 필요|관리자 연결 설정/);assert.match(html,/GOOGLE_OAUTH_CLIENT_SECRET/);
  assert.match(html,/https:\/\/app\.example\/api\/google\/oauth\/callback/);
  assert.match(button(html,"Google 계정 연결"),/disabled=""/);
  assert.ok(button(html,"복사"));assert.doesNotMatch(html,/<input|<textarea|reader@example.invalid/);
  assert.doesNotMatch(render({role:"operator",connection:connection({status:"unconfigured",missing:["GOOGLE_OAUTH_CLIENT_SECRET"],callbackUrl:"https://app.example/api/google/oauth/callback"})}),/GOOGLE_OAUTH_CLIENT_SECRET|app\.example/);
});

test("callback copy rejects unexpected protocols, userinfo, query, hash and paths",()=>{
  for(const callbackUrl of ["javascript:alert(1)","http://remote.example/api/google/oauth/callback","https://user:password@app.example/api/google/oauth/callback","https://app.example/api/google/oauth/callback?secret=value","https://app.example/api/google/oauth/callback#token","https://app.example/other"]){
    const html=render({connection:connection({status:"unconfigured",callbackUrl})});
    assert.doesNotMatch(html,/콜백 주소 복사|password|secret=value|javascript:/);
  }
  assert.match(render({connection:connection({status:"unconfigured",callbackUrl:"http://127.0.0.1:8810/api/google/oauth/callback"})}),/콜백 주소 복사/);
});

test("reauth is explicit and allows only a fresh connection attempt",()=>{
  const html=render({connection:connection({status:"reauth_required",message:"Google 연결을 다시 승인해 주세요."})});
  assert.match(html,/Google 재연결 필요/);assert.match(html,/reader@example.invalid/);
  assert.ok(button(html,"Google 다시 연결"));assert.doesNotMatch(html,/Google 계정 연결됨/);
  const pending=render({connection:connection({status:"reauth_required"}),busy:true});
  assert.match(button(pending,"Google 다시 연결"),/disabled=""/);
  assert.match(button(pending,"연결 해제"),/disabled=""/);
  assert.match(pending,/연결 요청 처리 중/);
});

test("initial loading and refetch preserve feedback without claiming a freshly verified connection",()=>{
  const initial=render({connection:null,loading:true});
  assert.match(initial,/Google 연결 상태를 불러오고/);assert.doesNotMatch(initial,/reader@example.invalid|Google 계정 연결됨/);
  const refresh=render({loading:true});
  assert.match(refresh,/마지막 확인한 연결 계정/);assert.match(refresh,/reader@example.invalid/);
  assert.match(refresh,/연결 상태 확인 중/);assert.doesNotMatch(refresh,/Google 계정 연결됨/);
  const failed=render({error:"연결 서버 응답 없음"});
  assert.match(failed,/role="alert"/);assert.match(failed,/연결 상태 확인 필요/);assert.match(failed,/마지막 확인한 연결 계정/);
  assert.match(button(failed,"연결 해제"),/disabled=""/);
});

test("unavailable does not claim a connected account or enable replacement",()=>{
  const html=render({connection:connection({status:"unavailable",message:"저장된 연결을 확인하지 못했습니다."})});
  assert.match(html,/연결 상태 확인 불가/);assert.doesNotMatch(html,/reader@example.invalid|Google 계정 연결됨/);
  assert.match(button(html,"Google 계정 연결"),/disabled=""/);assert.ok(button(html,"연결 상태 확인"));
});

test("notices and public error strings stay readable text rather than executable markup",()=>{
  const html=render({notice:"Google 연결을 취소했습니다.",error:"<script>bad()</script>",connection:connection({accountEmail:"<img src=x onerror=bad()>"})});
  assert.match(html,/Google 연결을 취소했습니다/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<script>|<img src=x/);
});

test("disconnect confirmation explains team impact, defaults focus to cancel and is scoped to the shown connection",()=>{
  let popup;
  const native=tag=>function DialogTestElement({children}){return React.createElement(tag,null,children);};
  const dialog={Dialog:({open,children})=>open?children:null,DialogContent:p=>{popup=p;return React.createElement("div",{role:"dialog"},p.children);},DialogHeader:native("header"),DialogTitle:native("h2"),DialogDescription:native("p"),DialogFooter:native("footer")};
  const Confirm=loader({dialog,confirmTarget:email+"\0"+connectedAt});
  const html=renderToStaticMarkup(React.createElement(Confirm,props()));
  assert.match(html,/이 점검 사이트의 Google 연결을 해제할까요/);assert.match(html,/관리자·operator의 일정 조회가 중단/);
  assert.match(html,/원본 시트와 기존 위키 등 다른 앱의 Google 연결은 변경하지/);
  assert.ok(button(html,"취소"));assert.ok(button(html,"이 사이트 연결 해제"));
  assert.ok(popup.initialFocus);assert.equal(typeof popup.finalFocus,"function");
  const Changed=loader({dialog,confirmTarget:"another-account\0old-time"});
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Changed,props())),/role="dialog"/);
});
