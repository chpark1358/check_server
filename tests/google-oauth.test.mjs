import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash, createCipheriv, randomBytes } from "node:crypto";
import test from "node:test";
import ts from "typescript";

const require=createRequire(import.meta.url);
const SOURCE="1nrcMefriNnjcizsrhXGYKHbZhkRHT6VR1j-V7f_d7xY";
const SCOPE="openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/spreadsheets.readonly";
const ORIGIN="https://preview.example";
const CALLBACK=ORIGIN+"/api/google/oauth/callback";
const admin="admin-a",otherAdmin="admin-b";

function harness() {
  const env={GOOGLE_OAUTH_CLIENT_ID:"test-client.apps.googleusercontent.com",GOOGLE_OAUTH_CLIENT_SECRET:"test-client-secret",GOOGLE_OAUTH_REDIRECT_URI:CALLBACK,
    GOOGLE_OAUTH_ENCRYPTION_KEY:Buffer.alloc(32,7).toString("base64"),KV_REST_API_URL:"https://redis.example",KV_REST_API_TOKEN:"test-kv-secret",VERCEL_ENV:"preview",NODE_ENV:"production"};
  let clock=Date.parse("2026-10-29T00:00:00Z");
  const records=new Map(),expires=new Map(),calls=[],writes=[];
  const mode={token:{},profile:{},sheetDenied:false,missingTab:false,refreshError:null,refreshHook:null,storageFailure:false};
  const read=key=>{if((expires.get(key)??Infinity)<=clock){records.delete(key);expires.delete(key);}return records.get(key)??null;};
  class MockRedis {
    async get(key){if(mode.storageFailure)throw new Error("private redis connection secret");return read(key);}
    async set(key,value,options={}){if(mode.storageFailure)throw new Error("private redis secret");if(options.nx&&read(key)!==null)return null;records.set(key,value);if(options.ex)expires.set(key,clock+options.ex*1000);else expires.delete(key);writes.push({key,value});return "OK";}
    async eval(script,keys,args){
      if(mode.storageFailure)throw new Error("private redis secret");
      if(script.startsWith("redis.call('DEL'")){records.delete(keys[0]);records.set(keys[1],args[0]);return 1;}
      if(script.includes("redis.call('SET', KEYS[2]")){
        if(read(keys[0])!==args[0])return 0;records.set(keys[1],args[1]);records.set(keys[0],args[2]);return 1;
      }
      if(script.includes("redis.call('SET', KEYS[1], ARGV[2])")){
        if(read(keys[0])!==args[0])return 0;records.set(keys[0],args[1]);return 1;
      }
      if(read(keys[0])!==args[0])return 0;records.delete(keys[0]);expires.delete(keys[0]);return 1;
    }
  }
  class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  const fetch=async(url,init)=>{
    calls.push({url:String(url),init});
    if(String(url)==="https://oauth2.googleapis.com/token"){
      const refresh=init.body.get("grant_type")==="refresh_token";
      if(refresh&&mode.refreshHook){const hook=mode.refreshHook;mode.refreshHook=null;await hook();}
      if(refresh&&mode.refreshError)return Response.json({error:mode.refreshError===503?"private-upstream":mode.refreshError,error_description:"private Google error"},{status:mode.refreshError===503?503:400});
      return Response.json({access_token:refresh?"refreshed-access-token":"initial-access-token",refresh_token:"secret-refresh-token",token_type:"Bearer",expires_in:3600,scope:SCOPE,...mode.token});
    }
    if(String(url)==="https://openidconnect.googleapis.com/v1/userinfo")return Response.json({sub:"google-subject",email:"reader@example.invalid",email_verified:true,...mode.profile});
    if(String(url).startsWith("https://sheets.googleapis.com/v4/spreadsheets/")){
      if(mode.sheetDenied)return Response.json({error:{message:"private sheet detail"}},{status:403});
      return Response.json({spreadsheetId:SOURCE,sheets:[{properties:{sheetId:mode.missingTab?9:1027882150}}]});
    }
    throw new Error("Unexpected outbound URL "+url);
  };
  const loaded=new Map();
  function load(file,mocks={}){
    const output=ts.transpileModule(readFileSync(new URL("../"+file,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const mod={exports:{}};
    new Function("require","module","exports","process","fetch","Date",output)(name=>name in mocks?mocks[name]:name==="server-only"?{}:name==="@upstash/redis"?{Redis:MockRedis}:name.startsWith("@/")?loaded.get(name):require(name),mod,mod.exports,{env},fetch,Clock);
    return mod.exports;
  }
  const oauth=load("src/lib/server/google-oauth.ts");loaded.set("@/lib/server/google-oauth",oauth);
  const request=(path="/api/google/oauth/start",nonce=null,origin=ORIGIN)=>({nextUrl:new URL(path,ORIGIN),headers:new Headers(origin?{origin}:{}),cookies:{get:()=>nonce?{value:nonce}:undefined}});
  async function start(user=admin){return oauth.beginGoogleOAuth(request(),user);}
  async function callback(flow,options={}){
    const params=new URLSearchParams({state:new URL(flow.authorizationUrl).searchParams.get("state"),code:"authorization-code",...options.params});
    if(options.params?.error)params.delete("code");
    return oauth.handleGoogleOAuthCallback(request("/api/google/oauth/callback?"+params,options.nonce??flow.cookie.value));
  }
  async function finish(flow,result,user=admin){return oauth.completeGoogleOAuth(request("/api/google/oauth/complete",flow.cookie.value),user,new URL(result.redirectUrl).searchParams.get("google_oauth_result"));}
  async function connect(){const flow=await start(),result=await callback(flow);await finish(flow,result);return {flow,result};}
  return {oauth,env,mode,records,calls,writes,request,start,callback,finish,connect,load,advance:ms=>{clock+=ms;},read};
}
const rejectsCode=(promise,code)=>assert.rejects(promise,error=>error?.code===code);

test("missing and malformed configuration fail closed without token or store exposure",async()=>{
  const f=harness();delete f.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const adminStatus=await f.oauth.getGoogleConnectionStatus("admin");assert.equal(adminStatus.status,"unconfigured");assert.ok(adminStatus.missing.includes("GOOGLE_OAUTH_CLIENT_SECRET"));
  const operatorStatus=await f.oauth.getGoogleConnectionStatus("operator");assert.equal(operatorStatus.missing,undefined);assert.equal(operatorStatus.callbackUrl,undefined);
  await rejectsCode(f.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_NOT_CONFIGURED");assert.equal(f.calls.length,0);assert.equal(f.records.size,0);
  const g=harness();g.env.GOOGLE_OAUTH_ENCRYPTION_KEY="short";assert.equal((await g.oauth.getGoogleConnectionStatus("admin")).status,"unconfigured");
});

test("callback configuration and request origin cannot introduce open redirects or cross-origin mutations",async()=>{
  for(const redirect of ["http://example.com/api/google/oauth/callback",CALLBACK+"?x=1",CALLBACK+"#x",ORIGIN+"/wrong",ORIGIN+"/api/google/oauth/callback/","https://user:pass@preview.example/api/google/oauth/callback"]){
    const f=harness();f.env.GOOGLE_OAUTH_REDIRECT_URI=redirect;await rejectsCode(f.start(),"GOOGLE_OAUTH_CALLBACK_INVALID");
  }
  const f=harness();await rejectsCode(f.oauth.beginGoogleOAuth(f.request(undefined,null,"https://evil.invalid"),admin),"GOOGLE_OAUTH_ORIGIN_MISMATCH");
  await rejectsCode(f.oauth.beginGoogleOAuth(f.request(undefined,null,null),admin),"GOOGLE_OAUTH_ORIGIN_MISMATCH");
  await rejectsCode(f.oauth.disconnectGoogleOAuth(f.request(undefined,null,"https://evil.invalid")),"GOOGLE_OAUTH_ORIGIN_MISMATCH");
  assert.equal(f.records.size,0);
});

test("start requests only read scopes, offline consent and PKCE, and stores no plaintext flow",async()=>{
  const f=harness(),flow=await f.start(),url=new URL(flow.authorizationUrl);
  assert.equal(url.origin,"https://accounts.google.com");assert.equal(url.searchParams.get("access_type"),"offline");assert.equal(url.searchParams.get("include_granted_scopes"),"false");
  assert.deepEqual(url.searchParams.get("scope").split(" "),["openid","email","https://www.googleapis.com/auth/spreadsheets.readonly"]);
  assert.equal(url.searchParams.get("redirect_uri"),CALLBACK);assert.equal(url.searchParams.get("code_challenge_method"),"S256");
  assert.equal(url.searchParams.get("client_secret"),null);assert.equal(flow.cookie.secure,true);
  const options=f.oauth.googleOAuthCookieOptions(flow.cookie);assert.equal(options.httpOnly,true);assert.equal(options.sameSite,"lax");assert.equal(options.path,"/api/google/oauth");
  assert.ok([...f.records].filter(([key])=>key.includes(":state:")).every(([,value])=>value.startsWith("v1.")&&!value.includes(admin)&&!value.includes(flow.cookie.value)));
  await f.callback(flow);const exchange=f.calls.find(c=>c.url.includes("oauth2.googleapis.com"));
  assert.equal(createHash("sha256").update(exchange.init.body.get("code_verifier")).digest("base64url"),url.searchParams.get("code_challenge"));
});

test("happy path persists shared encrypted credentials only after account and fixed-sheet access checks",async()=>{
  const f=harness(),{result}=await f.connect();
  const redirect=new URL(result.redirectUrl);assert.equal(redirect.origin,ORIGIN);assert.equal(redirect.searchParams.has("code"),false);assert.equal(redirect.searchParams.has("access_token"),false);
  const status=await f.oauth.getGoogleConnectionStatus("operator");assert.equal(status.status,"connected");assert.equal(status.accountEmail,"reader@example.invalid");assert.equal(status.canManage,false);assert.equal(status.callbackUrl,undefined);
  const token=await f.oauth.getGoogleOAuthAccessToken();assert.equal(token.accessToken,"initial-access-token");assert.match(token.revision,/^[a-f0-9-]{36}$/);
  for(const value of f.records.values())for(const secret of ["initial-access-token","secret-refresh-token","test-client-secret","reader@example.invalid"])assert.equal(value.includes(secret),false);
  assert.deepEqual(f.calls.map(c=>c.init.method??"GET"),["POST","GET","GET"]);assert.ok(f.calls[2].url.includes(SOURCE));assert.equal(f.calls.some(c=>/revoke|batchUpdate|values\//.test(c.url)),false);
});

test("wrong nonce, invalid state and duplicate query parameters cannot exchange a code or consume valid state",async()=>{
  const f=harness(),flow=await f.start();
  const bad=await f.callback(flow,{nonce:"x".repeat(43)});assert.equal(new URL(bad.redirectUrl).searchParams.get("google_oauth_error"),"expired");assert.equal(f.calls.length,0);
  const state=new URL(flow.authorizationUrl).searchParams.get("state");const request=f.request(`/api/google/oauth/callback?state=${state}&state=${state}&code=x`,flow.cookie.value);
  const duplicate=await f.oauth.handleGoogleOAuthCallback(request);assert.equal(new URL(duplicate.redirectUrl).searchParams.get("google_oauth_error"),"expired");assert.equal(f.calls.length,0);
  const valid=await f.callback(flow);assert.ok(new URL(valid.redirectUrl).searchParams.get("google_oauth_result"));
});

test("cancellation and callback replay preserve the old connection and never call Google revoke",async()=>{
  const f=harness();await f.connect();const old=(await f.oauth.getGoogleOAuthAccessToken()).revision;
  const cancel=await f.start(),cancelled=await f.callback(cancel,{params:{error:"access_denied"}});assert.equal(cancelled.clearCookie,true);assert.equal(new URL(cancelled.redirectUrl).searchParams.get("google_oauth_error"),"cancelled");
  const count=f.calls.length;await f.callback(cancel);assert.equal(f.calls.length,count);assert.equal((await f.oauth.getGoogleOAuthAccessToken()).revision,old);
  assert.equal(f.calls.some(c=>c.url.includes("revoke")),false);
});

test("expired start and pending flows fail without creating a shared connection",async()=>{
  const f=harness(),flow=await f.start();f.advance(601000);assert.equal(new URL((await f.callback(flow)).redirectUrl).searchParams.get("google_oauth_error"),"expired");assert.equal(f.calls.length,0);
  const g=harness(),fresh=await g.start(),result=await g.callback(fresh);g.advance(601000);await rejectsCode(g.finish(fresh,result),"GOOGLE_OAUTH_ALREADY_USED");assert.equal((await g.oauth.getGoogleConnectionStatus("admin")).status,"disconnected");
});

test("provider configuration failures are not mislabeled as user cancellation and raw provider errors are never reflected",async()=>{
  const f=harness(),flow=await f.start();const result=await f.callback(flow,{params:{error:"unauthorized_client",error_description:"private provider detail"}});
  assert.equal(new URL(result.redirectUrl).searchParams.get("google_oauth_error"),"configuration");assert.equal(result.redirectUrl.includes("private"),false);assert.equal(f.calls.length,0);
  const next=await f.start(),state=new URL(next.authorizationUrl).searchParams.get("state");
  const duplicate=await f.oauth.handleGoogleOAuthCallback(f.request(`/api/google/oauth/callback?state=${state}&error=access_denied&error=other`,next.cookie.value));
  assert.equal(new URL(duplicate.redirectUrl).searchParams.get("google_oauth_error"),"expired");
});

test("completion requires the initiating user and nonce; replay cannot replace a connection",async()=>{
  const f=harness(),flow=await f.start(),result=await f.callback(flow);
  await rejectsCode(f.finish(flow,result,otherAdmin),"GOOGLE_OAUTH_USER_MISMATCH");
  await rejectsCode(f.oauth.completeGoogleOAuth(f.request("/api/google/oauth/complete","y".repeat(43)),admin,new URL(result.redirectUrl).searchParams.get("google_oauth_result")),"GOOGLE_OAUTH_STATE_INVALID");
  await f.finish(flow,result);const revision=(await f.oauth.getGoogleOAuthAccessToken()).revision;
  await rejectsCode(f.finish(flow,result),"GOOGLE_OAUTH_ALREADY_USED");assert.equal((await f.oauth.getGoogleOAuthAccessToken()).revision,revision);
});

test("Google token, scope and account validation never persists partial or overly broad authorization",async()=>{
  const invalidTokens=[{token_type:"Basic"},{access_token:"bad\r\ntoken"},{expires_in:NaN},{refresh_token:null},{scope:"openid email"},{scope:SCOPE+" https://www.googleapis.com/auth/drive"}];
  for(const token of invalidTokens){const f=harness();f.mode.token=token;const result=await f.callback(await f.start());assert.ok(new URL(result.redirectUrl).searchParams.get("google_oauth_error"));assert.equal((await f.oauth.getGoogleConnectionStatus("admin")).status,"disconnected");}
  const f=harness();f.mode.profile={email_verified:false};const result=await f.callback(await f.start());assert.equal(new URL(result.redirectUrl).searchParams.get("google_oauth_error"),"account");
});

test("failed target-file verification preserves the previous authorized connection",async()=>{
  for(const mode of ["sheetDenied","missingTab"]){const f=harness();await f.connect();const old=(await f.oauth.getGoogleOAuthAccessToken()).revision;const flow=await f.start(),result=await f.callback(flow);f.mode[mode]=true;await assert.rejects(f.finish(flow,result));assert.equal((await f.oauth.getGoogleOAuthAccessToken()).revision,old);}
});

test("disconnect and parallel completion advance generation so stale consent cannot resurrect or replace a connection",async()=>{
  const f=harness(),flow=await f.start(),result=await f.callback(flow);await f.oauth.disconnectGoogleOAuth(f.request("/api/google/oauth/connection"));await rejectsCode(f.finish(flow,result),"GOOGLE_OAUTH_CONNECTION_CHANGED");assert.equal((await f.oauth.getGoogleConnectionStatus("admin")).status,"disconnected");
  const g=harness(),a=await g.start(),b=await g.start(),ra=await g.callback(a),rb=await g.callback(b);await g.finish(a,ra);const old=(await g.oauth.getGoogleOAuthAccessToken()).revision;await rejectsCode(g.finish(b,rb),"GOOGLE_OAUTH_CONNECTION_CHANGED");assert.equal((await g.oauth.getGoogleOAuthAccessToken()).revision,old);
});

test("refresh updates encrypted credentials and preserves connection revision",async()=>{
  const f=harness();await f.connect();const first=await f.oauth.getGoogleOAuthAccessToken();f.advance(3550000);const refreshed=await f.oauth.getGoogleOAuthAccessToken();assert.equal(refreshed.accessToken,"refreshed-access-token");assert.equal(refreshed.revision,first.revision);assert.equal(f.calls.at(-1).init.body.get("grant_type"),"refresh_token");
  assert.ok([...f.records.values()].every(value=>!value.includes("refreshed-access-token")));
});

test("invalid_grant and known refresh-token expiration require reauthentication, never stale token reuse",async()=>{
  const f=harness();await f.connect();f.advance(3550000);f.mode.refreshError="invalid_grant";await rejectsCode(f.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_REAUTH_REQUIRED");assert.equal((await f.oauth.getGoogleConnectionStatus("admin")).status,"reauth_required");const calls=f.calls.length;await rejectsCode(f.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_REAUTH_REQUIRED");assert.equal(f.calls.length,calls);
  const g=harness();g.mode.token={refresh_token_expires_in:100};await g.connect();g.advance(101000);const before=g.calls.length;await rejectsCode(g.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_REAUTH_REQUIRED");assert.equal(g.calls.length,before);
});

test("transient refresh errors preserve credentials but never return an expired access token",async()=>{
  const f=harness();await f.connect();f.advance(3550000);f.mode.refreshError=503;await rejectsCode(f.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_REFRESH_UNAVAILABLE");assert.equal((await f.oauth.getGoogleConnectionStatus("admin")).status,"connected");f.mode.refreshError=null;assert.equal((await f.oauth.getGoogleOAuthAccessToken()).accessToken,"refreshed-access-token");
});

test("in-flight refresh cannot resurrect a disconnected connection or overwrite a replacement",async()=>{
  const f=harness();await f.connect();f.advance(3550000);f.mode.refreshHook=()=>f.oauth.disconnectGoogleOAuth(f.request("/api/google/oauth/connection"));await rejectsCode(f.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_CONNECTION_CHANGED");assert.equal((await f.oauth.getGoogleConnectionStatus("admin")).status,"disconnected");
  const g=harness();await g.connect();g.advance(3550000);let replacement;g.mode.refreshHook=async()=>{await g.connect();replacement=(await g.oauth.getGoogleOAuthAccessToken()).revision;};await rejectsCode(g.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_CONNECTION_CHANGED");assert.equal((await g.oauth.getGoogleOAuthAccessToken()).revision,replacement);
});

test("tampering, client rotation, environment isolation and storage errors fail closed without plaintext errors",async()=>{
  const f=harness();await f.connect();const key=[...f.records.keys()].find(k=>k.endsWith(":connection"));f.records.set(key,f.records.get(key)+"broken");assert.equal((await f.oauth.getGoogleConnectionStatus("admin")).status,"reauth_required");await rejectsCode(f.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_RECORD_INVALID");
  const g=harness();await g.connect();g.env.GOOGLE_OAUTH_CLIENT_SECRET="changed";await rejectsCode(g.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_CLIENT_CHANGED");g.env.VERCEL_ENV="production";assert.equal((await g.oauth.getGoogleConnectionStatus("admin")).status,"disconnected");
  const h=harness();h.mode.storageFailure=true;const status=await h.oauth.getGoogleConnectionStatus("admin");assert.equal(status.status,"unavailable");assert.equal(JSON.stringify(status).includes("private redis"),false);
});

test("authenticated encryption does not make malformed stored credentials valid",async()=>{
  const f=harness();await f.connect();const key=[...f.records.keys()].find(k=>k.endsWith(":connection")),namespace=key.slice(0,-11);
  const malformed={version:1,revision:"revision",fingerprint:createHash("sha256").update(JSON.stringify([f.env.GOOGLE_OAUTH_CLIENT_ID,f.env.GOOGLE_OAUTH_CLIENT_SECRET,f.env.GOOGLE_OAUTH_ENCRYPTION_KEY,CALLBACK,"preview"])).digest("hex"),email:"x@example.invalid",subject:"x",connectedBy:admin,connectedAt:new Date().toISOString(),needsReauth:false,expiresAt:Date.now()+1e8,refreshExpiresAt:null,scopes:SCOPE.split(" ")};
  const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",Buffer.from(f.env.GOOGLE_OAUTH_ENCRYPTION_KEY,"base64"),iv);cipher.setAAD(Buffer.from(namespace+":connection"));const body=Buffer.concat([cipher.update(JSON.stringify(malformed)),cipher.final()]);f.records.set(key,["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),body.toString("base64url")].join("."));
  await rejectsCode(f.oauth.getGoogleOAuthAccessToken(),"GOOGLE_OAUTH_RECORD_INVALID");
});

test("API routes require admin mutations/operator reads and callback stays no-store without leaking input",async()=>{
  const f=harness();let actual="viewer";const guards=[];
  class ApiError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}
  const {NextResponse}=require("next/server");
  const api={ApiError,async requireRole(request,id,minimum){guards.push(minimum);if(({viewer:1,operator:2,admin:3})[actual]<({viewer:1,operator:2,admin:3})[minimum])throw new ApiError(403,"FORBIDDEN","denied");return {user:{id:admin},role:actual};},async readJsonObject(req){return req.json();},apiOk(id,payload){return NextResponse.json({ok:true,...payload});},async withApiHandler(req,handler){try{return await handler("test");}catch(e){return NextResponse.json({ok:false,code:e.code,message:e.message},{status:e.status??500});}}};
  const start=f.load("src/app/api/google/oauth/start/route.ts",{"@/lib/server/api":api});
  const connection=f.load("src/app/api/google/oauth/connection/route.ts",{"@/lib/server/api":api});
  const complete=f.load("src/app/api/google/oauth/complete/route.ts",{"@/lib/server/api":api});
  const callback=f.load("src/app/api/google/oauth/callback/route.ts");
  for(const action of [()=>start.POST(f.request()),()=>connection.GET(f.request()),()=>connection.DELETE(f.request()),()=>complete.POST({...f.request(),json:async()=>({result:"x"})})])assert.equal((await action()).status,403);
  assert.equal(f.records.size,0);actual="operator";assert.equal((await connection.GET(f.request())).status,200);assert.equal((await start.POST(f.request())).status,403);
  actual="admin";const started=await start.POST(f.request());assert.equal(started.status,200);assert.match(started.headers.get("set-cookie"),/HttpOnly/);assert.match(started.headers.get("set-cookie"),/Secure/);assert.match(started.headers.get("cache-control"),/no-store/);
  const bad=await callback.GET(f.request("/api/google/oauth/callback?code=must-not-be-echoed&state=bad"));assert.equal(bad.status,303);assert.equal(bad.headers.get("location").includes("must-not-be-echoed"),false);assert.equal(bad.headers.get("referrer-policy"),"no-referrer");
  assert.equal(start.GET,undefined);assert.equal(complete.GET,undefined);assert.equal(connection.POST,undefined);assert.ok(guards.includes("operator")&&guards.includes("admin"));
});
