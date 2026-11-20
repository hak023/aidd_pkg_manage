import { NextResponse } from "next/server";
import { checkCredentials, createSessionToken, getAuthConfig, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/lib/auth";
import { readJson } from "@/lib/api";

export async function POST(req: Request) {
  const cfg = getAuthConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "로그인 설정(LOGIN_ID, LOGIN_PASSWORD, AUTH_SECRET)이 없습니다." },
      { status: 503 },
    );
  }
  const body = await readJson(req);
  if (!checkCredentials(cfg, body.id, body.password)) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 맞지 않습니다." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(cfg), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
