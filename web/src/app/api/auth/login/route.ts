import { NextResponse } from "next/server";
import {
  checkCredentials,
  clearLoginFailures,
  createSessionToken,
  getAuthConfig,
  isLoginBlocked,
  recordLoginFailure,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
} from "@/lib/auth";
import { readJson } from "@/lib/api";

export async function POST(req: Request) {
  const cfg = getAuthConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "로그인 설정(AUTH_SECRET과 계정 환경 변수)이 없습니다." },
      { status: 503 },
    );
  }
  const body = await readJson(req);
  const failKey = typeof body.id === "string" ? body.id.trim().toLowerCase() : "";
  if (isLoginBlocked(failKey)) {
    return NextResponse.json({ error: "로그인 실패가 많아 잠시 차단되었습니다. 15분 뒤 다시 시도하세요." }, { status: 429 });
  }
  const user = await checkCredentials(cfg, body.id, body.password);
  if (!user) {
    recordLoginFailure(failKey);
    return NextResponse.json({ error: "아이디 또는 비밀번호가 맞지 않습니다." }, { status: 401 });
  }
  clearLoginFailures(failKey);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(cfg, user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
