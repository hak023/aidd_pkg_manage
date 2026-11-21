/**
 * 요청별 로그인 사용자 문맥. 라우트 핸들러(respond)가 세션 쿠키로 사용자를 찾고
 * 그 사용자의 메일 설정(화면 입력값 + 관리자 환경 변수)을 넣는다. 메일 config 등 하위 함수가 이를 읽는다.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getAuthConfig, SESSION_COOKIE, verifySessionToken, type AuthUser, type UserMailEnv } from "./auth";

interface RequestContext {
  user: AuthUser | null;
  /** 이 요청에 쓸 메일 설정. null이면 (단일 계정 방식) 전역 환경 변수 */
  mail: UserMailEnv | null;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithUser<T>(user: AuthUser | null, fn: () => T, mail: UserMailEnv | null = user?.mail ?? null): T {
  return als.run({ user, mail }, fn);
}

/** 현재 요청의 로그인 사용자 (요청 문맥 밖이면 null) */
export function currentUser(): AuthUser | null {
  return als.getStore()?.user ?? null;
}

/** 현재 요청의 메일 설정 (요청 문맥 밖이거나 전역 설정을 쓰면 null) */
export function currentMail(): UserMailEnv | null {
  return als.getStore()?.mail ?? null;
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
