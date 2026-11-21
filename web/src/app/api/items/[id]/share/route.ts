import { connection, type NextRequest } from "next/server";
import { parseId, readJson, respond } from "@/lib/api";
import { badRequest } from "@/lib/repo/errors";
import { isShareKind, shareDefaults, shareDocuments } from "@/lib/repo/docs";
import { progressShareDefaults, shareProgress } from "@/lib/repo/progress";

export const maxDuration = 60;

function kindOf(req: NextRequest) {
  const k = req.nextUrl.searchParams.get("kind");
  if (k === "progress") return k;
  if (!isShareKind(k)) throw badRequest("kind는 prd, arch, qa, progress 중 하나여야 합니다.");
  return k;
}

/** 공유 기본값 (수신자 = 관련자 이메일) ?kind=prd|arch|qa|progress */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/items/[id]/share">) {
  await connection();
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const kind = kindOf(req);
    return kind === "progress" ? progressShareDefaults(id) : shareDefaults(id, kind);
  });
}

/** 공유 발송 — 사용자가 확인 창에서 누른 경우만 호출 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/share">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    const kind = kindOf(req);
    if (kind === "progress") return shareProgress(id, { to: body.to, subject: body.subject, text: body.text });
    return shareDocuments(id, kind, { documentId: body.documentId, to: body.to, subject: body.subject, text: body.text });
  });
}
