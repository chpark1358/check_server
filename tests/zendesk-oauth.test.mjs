import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import * as crypto from "node:crypto";

const require = createRequire(import.meta.url), ts = require("typescript");
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const response = (data, status = 200) => new Response(JSON.stringify(data), {status});
const grant = (token = "test-access", expires = 1800) => response({access_token:token, token_type:"bearer", expires_in:expires});

function harness(handler = () => grant(), overrides = {}) {
  let now = Date.parse("2026-10-15T00:00:00Z");
  class Clock extends Date { static now() {return now;} }
  const env = {ZENDESK_SUBDOMAIN:"example",ZENDESK_OAUTH_CLIENT_ID:"test-client",ZENDESK_OAUTH_CLIENT_SECRET:"test-secret",VERCEL_ENV:"preview",ALLOW_REAL_ZENDESK_SEND:"true",...overrides};
  const calls=[], logs=[];
  const imports = {
    "server-only":{}, "node:crypto":crypto,
    "@/lib/env":{isRealZendeskSendAllowed:()=>env.VERCEL_ENV==="production" && env.ALLOW_REAL_ZENDESK_SEND==="true"},
    "@/lib/server/api":{ApiError,isRecord:value=>Boolean(value && typeof value==="object" && !Array.isArray(value))},
    "@/lib/server/mail-signature":{getMailSignaturePublicUrl:()=>null},
  };
  function load(file) {
    const exports={};
    const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{
      exports,process:{env},Date:Clock,Headers,Response,AbortSignal,URLSearchParams,Buffer,crypto,console:{error:(...args)=>logs.push(args)},
      fetch:async(url,init)=>{calls.push({url,init});return handler(url,init,calls.length);},
      require:name=>{assert.ok(Object.hasOwn(imports,name),"Unexpected dependency "+name);return imports[name];},
    });
    return exports;
  }
  const oauth=load("../src/lib/server/zendesk-oauth.ts");
  imports["@/lib/server/zendesk-oauth"]=oauth;
  return {oauth,env,calls,logs,load,advance:ms=>now+=ms};
}

test("status never issues a token or leaks credentials, even with invalid config",()=>{
  const f=harness();const status=f.oauth.getZendeskOAuthStatus();
  assert.equal(status.configured,true);assert.equal(f.calls.length,0);
  assert.equal(JSON.stringify(status).includes("test-secret"),false);
  assert.equal(JSON.stringify(status).includes("test-client"),false);
  f.env.ZENDESK_SUBDOMAIN="example.zendesk.com@evil.test";
  assert.equal(f.oauth.getZendeskOAuthStatus().configured,false);
  assert.throws(()=>f.oauth.getZendeskBaseUrl(),{code:"ZENDESK_OAUTH_CONFIG_INVALID"});
});

test("legacy API token alone cannot authenticate or trigger a request",async()=>{
  const f=harness(undefined,{ZENDESK_OAUTH_CLIENT_SECRET:"",ZENDESK_API_TOKEN:"legacy",ZENDESK_EMAIL:"example@example.test"});
  await assert.rejects(f.oauth.getZendeskOAuthAccessToken(),{code:"ZENDESK_OAUTH_NOT_CONFIGURED"});
  assert.equal(f.calls.length,0);
});

test("client credentials exchange is bounded, redirect-safe, cached and read-only in preview",async()=>{
  const f=harness();
  assert.equal(await f.oauth.getZendeskOAuthAccessToken(),"test-access");
  assert.equal(await f.oauth.getZendeskOAuthAccessToken(),"test-access");
  assert.equal(f.calls.length,1);
  const {url,init}=f.calls[0],body=JSON.parse(init.body);
  assert.equal(url,"https://example.zendesk.com/oauth/tokens");
  assert.equal(init.redirect,"error");assert.equal(init.cache,"no-store");assert.ok(init.signal);
  assert.equal(body.grant_type,"client_credentials");assert.equal(body.client_id,"test-client");
  assert.equal(body.expires_in,1800);assert.equal(body.scope.includes(":write"),false);
  assert.equal("refresh_token" in body,false);assert.equal("redirect_uri" in body,false);
  assert.equal(f.oauth.getZendeskOAuthStatus().accessTokenExpiresAt,"2026-10-15T00:30:00.000Z");
});

test("production write scopes require both production and explicit real-send enable",async()=>{
  const f=harness(undefined,{VERCEL_ENV:"production",ALLOW_REAL_ZENDESK_SEND:"false"});
  await f.oauth.getZendeskOAuthAccessToken();
  assert.equal(JSON.parse(f.calls[0].init.body).scope.includes(":write"),false);
  f.env.ALLOW_REAL_ZENDESK_SEND="true";await f.oauth.getZendeskOAuthAccessToken();
  assert.equal(f.calls.length,2);
  const scopes=JSON.parse(f.calls[1].init.body).scope.split(" ");
  assert.ok(scopes.includes("tickets:write"));assert.ok(scopes.includes("ticket_attachments:write"));
  assert.equal(scopes.includes("write"),false);assert.equal(scopes.includes("users:write"),false);
});

test("concurrent requests share a single exchange; expiry renews within the safety window",async()=>{
  let release; const gate=new Promise(resolve=>release=resolve);
  const f=harness(async()=>{await gate;return grant();});
  const pending=Array.from({length:10},()=>f.oauth.getZendeskOAuthAccessToken());
  assert.equal(f.calls.length,1);release();await Promise.all(pending);
  f.advance(1739_000);await f.oauth.getZendeskOAuthAccessToken();assert.equal(f.calls.length,1);
  f.advance(1000);await f.oauth.getZendeskOAuthAccessToken();assert.equal(f.calls.length,2);
});

test("credential rotation cannot return an old in-flight token",async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const f=harness(async()=>{await gate;return grant();});
  const pending=f.oauth.getZendeskOAuthAccessToken();f.env.ZENDESK_OAUTH_CLIENT_SECRET="rotated-secret";release();
  await assert.rejects(pending,{code:"ZENDESK_OAUTH_TOKEN_FAILED"});
  await f.oauth.getZendeskOAuthAccessToken();assert.equal(f.calls.length,2);
});

test("a late invalidation for an old token does not remove its replacement",async()=>{
  let count=0;const f=harness(()=>grant("token-"+(++count)));
  const old=await f.oauth.getZendeskOAuthAccessToken();f.oauth.invalidateZendeskOAuthAccessToken(old);
  const current=await f.oauth.getZendeskOAuthAccessToken();f.oauth.invalidateZendeskOAuthAccessToken(old);
  assert.equal(await f.oauth.getZendeskOAuthAccessToken(),current);assert.equal(f.calls.length,2);
});

test("provider errors, missing expiry, malformed token and network errors are sanitized",async()=>{
  for (const handler of [()=>response({error:"test-secret"},401),()=>response({access_token:"test-secret",token_type:"bearer"}),()=>grant("bad\nheader"),()=>grant("test-access",Infinity),()=>{throw new Error("test-secret");}]) {
    const f=harness(handler);
    await assert.rejects(f.oauth.getZendeskOAuthAccessToken(),error=>error.code==="ZENDESK_OAUTH_TOKEN_FAILED" && !error.message.includes("test-secret"));
    assert.equal(f.logs.length,0);assert.equal(f.oauth.getZendeskOAuthStatus().accessTokenExpiresAt,null);
  }
});

test("business GET uses Bearer, retries 401 once with a new token, and rejects repeated 401",async()=>{
  let issued=0,reads=0;
  const f=harness(url=>url.endsWith("/oauth/tokens")?grant("token-"+(++issued)):++reads===1?response({},401):response({groups:[{id:1}]}));
  const zendesk=f.load("../src/lib/server/zendesk.ts");
  assert.equal((await zendesk.getZendeskGroups())[0].id,1);
  assert.equal(issued,2);assert.equal(reads,2);
  assert.equal(f.calls[1].init.headers.get("authorization"),"Bearer token-1");
  assert.equal(f.calls[3].init.headers.get("authorization"),"Bearer token-2");
  const denied=harness(url=>url.endsWith("/oauth/tokens")?grant():new Response("sensitive-provider-body",{status:401}));
  await assert.rejects(denied.load("../src/lib/server/zendesk.ts").getZendeskGroups(),{code:"ZENDESK_AUTH_FAILED"});
  assert.equal(denied.calls.length,4);assert.equal(denied.logs.length,0);
});

test("mutating upload never replays on 401 and preserves binary content type",async()=>{
  const f=harness(url=>url.endsWith("/oauth/tokens")?grant():response({},401),{VERCEL_ENV:"production"});
  const zendesk=f.load("../src/lib/server/zendesk.ts");
  await assert.rejects(zendesk.uploadZendeskFile(new File(["test"],"test.pdf",{type:"application/pdf"}),{dryRun:false}),{code:"ZENDESK_AUTH_FAILED"});
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].init.method,"POST");
  assert.equal(f.calls[1].init.headers.get("content-type"),"application/pdf");
});

test("dry-run upload performs no OAuth exchange or Zendesk call",async()=>{
  const f=harness(()=>{throw new Error("no network");});
  const result=await f.load("../src/lib/server/zendesk.ts").uploadZendeskFile(new File(["test"],"test.pdf"),{dryRun:false});
  assert.equal(result.dryRun,true);assert.equal(f.calls.length,0);
});

test("admin connection metadata is passive; verification requires admin and performs identity GET only",async()=>{
  let allow=true,checks=0;
  const f=harness(url=>url.endsWith("/oauth/tokens")?grant():response({user:{id:123,email:"agent@example.test",role:"admin"}}));
  const zendesk=f.load("../src/lib/server/zendesk.ts");
  const source=readFileSync(new URL("../src/app/api/zendesk/connection/route.ts",import.meta.url),"utf8");
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,Date,require:name=>({
      "@/lib/server/api":{withApiHandler:(_,fn)=>fn("id"),requireRole:async(_,__,role)=>{assert.equal(role,"admin");if(!allow)throw new Error("denied");return {user:{id:"admin"}};},apiOk:(_,body)=>({body,headers:new Headers()})},
      "@/lib/server/rate-limit":{enforceRateLimit:async()=>checks++},
      "@/lib/server/zendesk-oauth":f.oauth,"@/lib/server/zendesk":zendesk,
    })[name],
  });
  assert.equal((await exports.GET({})).body.connection.configured,true);assert.equal(f.calls.length,0);
  allow=false;await assert.rejects(exports.POST({}),/denied/);assert.equal(f.calls.length,0);
  allow=true;const result=await exports.POST({});assert.equal(result.body.account.id,"123");assert.equal(checks,1);
  assert.equal(f.calls.at(-1).url,"https://example.zendesk.com/api/v2/users/me.json");
  assert.equal(f.calls.at(-1).init.method,undefined);assert.equal(result.headers.get("cache-control"),"no-store");
});
