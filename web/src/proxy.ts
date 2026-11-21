import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/** 로그인 없이 접근 가능한 경로 */
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p)) return NextResponse.next();

  const cfg = getAuthConfig();
  const ok = cfg ? !!(await verifySessionToken(cfg, request.cookies.get(SESSION_COOKIE)?.value)) : false;
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // 정적 파일과 Next 내부 경로는 제외
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
