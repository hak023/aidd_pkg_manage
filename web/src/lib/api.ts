import { DomainError } from "@/lib/repo/errors";
import { getSessionUser, runWithUser } from "@/lib/session";
import type { UserMailEnv } from "@/lib/auth";

/**
 * 라우트 핸들러 공통: 로그인 사용자 문맥(사용자별 메일 설정 포함)에서 실행하고,
 * DomainError는 해당 상태 코드로, 그 외는 500으로 응답
 */
export async function respond(fn: () => Promise<unknown>): Promise<Response> {
  const user = await getSessionUser();
  let mail: UserMailEnv | null = user?.mail ?? null;
  if (user) {
    try {
      const { effectiveMailFor } = await import("@/lib/repo/user-settings");
      mail = await effectiveMailFor(user);
    } catch (e) {
      console.error("[settings] load failed", e);
      return Response.json({ error: "사용자 설정을 불러오지 못했습니다." }, { status: 500 });
    }
  }
  return runWithUser(user, () => respondInner(fn), mail);
}

async function respondInner(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const data = await fn();
    return Response.json(data ?? { ok: true });
  } catch (e) {
    if (e instanceof DomainError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    console.error(e);
    return Response.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DomainError(400, "잘못된 ID입니다.");
  return id;
}

export function optionalId(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new DomainError(400, "잘못된 상위 항목 ID입니다.");
  return id;
}
