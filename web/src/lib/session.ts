/**
 * 요청별 로그인 사용자 문맥. 라우트 핸들러(respond)가 세션 쿠키로 사용자를 찾아 넣고,
 * 메일 config 등 하위 함수가 현재 사용자의 설정을 읽는다.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getAuthConfig, SESSION_COOKIE, verifySessionToken, type AuthUser } from "./auth";

const als = new AsyncLocalStorage<{ user: AuthUser | null }>();

export function runWithUser<T>(user: AuthUser | null, fn: () => T): T {
  return als.run({ user }, fn);
}

/** 현재 요청의 로그인 사용자 (요청 문맥 밖이면 null) */
export function currentUser(): AuthUser | null {
  return als.getStore()?.user ?? null;
}

/** 세션 쿠키로 로그인 사용자를 찾는다. 요청 문맥 밖(시험·CLI)이면 null */
export async function getSessionUser(): Promise<AuthUser | null> {
  const cfg = getAuthConfig();
  if (!cfg) return null;
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    return await verifySessionToken(cfg, store.get(SESSION_COOKIE)?.value);
  } catch {
    return null;
  }
}
