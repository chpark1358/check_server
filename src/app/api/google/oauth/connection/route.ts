import type { NextRequest } from "next/server";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { disconnectGoogleOAuth, getGoogleConnectionStatus, GoogleOAuthError, googleOAuthCookieOptions, googleOAuthCookieToClear, googleOAuthResponseHeaders } from "@/lib/server/google-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const response=await withApiHandler(request,async requestId=>{
    const auth=await requireRole(request,requestId,"operator");
    return apiOk(requestId,{connection:await getGoogleConnectionStatus(auth.role)});
  });
  for(const [name,value] of Object.entries(googleOAuthResponseHeaders()))response.headers.set(name,value);
  return response;
}

export async function DELETE(request: NextRequest) {
  const response=await withApiHandler(request,async requestId=>{
    const auth=await requireRole(request,requestId,"admin");
    try {
      await disconnectGoogleOAuth(request);
      const result=apiOk(requestId,{connection:await getGoogleConnectionStatus(auth.role)});
      const cookie=googleOAuthCookieToClear();result.cookies.set(cookie.name,"",googleOAuthCookieOptions(cookie,true));
      return result;
    } catch(error){if(error instanceof GoogleOAuthError)throw new ApiError(error.httpStatus,error.code,error.message);throw new ApiError(503,"GOOGLE_OAUTH_DISCONNECT_UNAVAILABLE","Google 연결 해제 결과를 확인하지 못했습니다. 연결 상태를 다시 확인해 주세요.");}
  });
  for(const [name,value] of Object.entries(googleOAuthResponseHeaders()))response.headers.set(name,value);
  return response;
}
