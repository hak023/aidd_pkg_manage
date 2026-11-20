import { DomainError } from "@/lib/repo/errors";

/** 라우트 핸들러 공통: DomainError는 해당 상태 코드로, 그 외는 500으로 응답 */
export async function respond(fn: () => Promise<unknown>): Promise<Response> {
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
