import { NextResponse, type NextRequest } from "next/server";
import { GoogleOAuthError, googleOAuthCookieOptions, googleOAuthCookieToClear, googleOAuthResponseHeaders, handleGoogleOAuthCallback } from "@/lib/server/google-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let response: NextResponse;
  try {
    const outcome=await handleGoogleOAuthCallback(request);
    response=NextResponse.redirect(outcome.redirectUrl,303);
    if(outcome.clearCookie){const cookie=googleOAuthCookieToClear();response.cookies.set(cookie.name,"",googleOAuthCookieOptions(cookie,true));}
  } catch(error) {
    response=NextResponse.json({ok:false,code:error instanceof GoogleOAuthError?error.code:"GOOGLE_OAUTH_CALLBACK_FAILED",message:"Google 연결을 완료하지 못했습니다. 설정된 점검 사이트에서 다시 연결해 주세요."},{status:400});
  }
  for(const [name,value] of Object.entries(googleOAuthResponseHeaders()))response.headers.set(name,value);
  return response;
}
