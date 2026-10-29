import type { NextRequest } from "next/server";
import { ApiError, apiOk, readJsonObject, requireRole, withApiHandler } from "@/lib/server/api";
import { completeGoogleOAuth, getGoogleConnectionStatus, GoogleOAuthError, googleOAuthCookieOptions, googleOAuthCookieToClear, googleOAuthResponseHeaders } from "@/lib/server/google-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response=await withApiHandler(request,async requestId=>{
    const auth=await requireRole(request,requestId,"admin");
    const body=await readJsonObject(request);
    try {
      await completeGoogleOAuth(request,auth.user.id,body.result);
      const result=apiOk(requestId,{connection:await getGoogleConnectionStatus(auth.role)});
      const cookie=googleOAuthCookieToClear();result.cookies.set(cookie.name,"",googleOAuthCookieOptions(cookie,true));
      return result;
    } catch(error){if(error instanceof GoogleOAuthError)throw new ApiError(error.httpStatus,error.code,error.message);throw new ApiError(503,"GOOGLE_OAUTH_COMPLETE_UNAVAILABLE","Google 연결 저장 결과를 확인하지 못했습니다. 연결 상태를 다시 확인해 주세요.");}
  });
  for(const [name,value] of Object.entries(googleOAuthResponseHeaders()))response.headers.set(name,value);
  return response;
}
