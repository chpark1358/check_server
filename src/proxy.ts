import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_PUBLIC_IP_RANGES = ["110.14.223.23/32"];

export function proxy(request: NextRequest) {
  if (isLocalRequest(request)) {
    return NextResponse.next();
  }

  const clientIp = getClientIp(request);

  if (clientIp && isAllowedPublicIp(clientIp)) {
    return NextResponse.next();
  }

  return new NextResponse("Access denied", {
    status: 403,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-ip-allowlist": "blocked",
    },
  });
}

function isLocalRequest(request: NextRequest) {
  const hostname = request.nextUrl.hostname;

  return (
    process.env.NODE_ENV === "development" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const rawIp =
    forwardedFor?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    "";

  return normalizeIp(rawIp);
}

function normalizeIp(value: string) {
  const trimmed = value.trim();

  if (trimmed.startsWith("::ffff:")) {
    return trimmed.slice(7);
  }

  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(trimmed)) {
    return trimmed.slice(0, trimmed.lastIndexOf(":"));
  }

  return trimmed.replace(/^\[|\]$/g, "");
}

function isAllowedPublicIp(ip: string) {
  return ALLOWED_PUBLIC_IP_RANGES.some((cidr) => ipv4InCidr(ip, cidr));
}

function ipv4InCidr(ip: string, cidr: string) {
  const [baseIp, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);

  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipNumber = ipv4ToNumber(ip);
  const baseNumber = ipv4ToNumber(baseIp);

  if (ipNumber === null || baseNumber === null) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipNumber & mask) === (baseNumber & mask);
}

function ipv4ToNumber(value: string) {
  const parts = value.split(".");

  if (parts.length !== 4) {
    return null;
  }

  let result = 0;

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const octet = Number(part);

    if (octet < 0 || octet > 255) {
      return null;
    }

    result = (result << 8) + octet;
  }

  return result >>> 0;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
