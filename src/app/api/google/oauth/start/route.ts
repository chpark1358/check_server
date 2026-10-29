import { NextResponse, type NextRequest } from "next/server";
import { ApiError, apiOk, requireRole, withApiHandler } from "@/lib/server/api";
import { beginGoogleOAuth, GoogleOAuthError, googleOAuthCookieOptions, googleOAuthResponseHeaders } from "@/lib/server/google-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const response = await withApiHandler(request, async requestId => {
    const auth = await requireRole(request,requestId,"admin");
    try {
      const {authorizationUrl,cookie}=await beginGoogleOAuth(request,auth.user.id);
      const result=apiOk(requestId,{authorizationUrl});
      result.cookies.set(cookie.name,cookie.value,googleOAuthCookieOptions(cookie));
      return result;
    } catch(error) { if(error instanceof GoogleOAuthError)throw new ApiError(error.httpStatus,error.code,error.message);throw new ApiError(503,"GOOGLE_OAUTH_UNAVAILABLE","Google 연결을 시작하지 못했습니다. 다시 시도해 주세요."); }
  });
  for(const [name,value] of Object.entries(googleOAuthResponseHeaders()))response.headers.set(name,value);
  return response as NextResponse;
}
