import { connection, type NextRequest } from "next/server";
import { optionalId, parseId, readJson, respond } from "@/lib/api";
import { badRequest } from "@/lib/repo/errors";
import { getDocState, isReviewKind, registerDocument } from "@/lib/repo/docs";
import { getItemDetail } from "@/lib/repo/tree";

export const maxDuration = 60;

/** 등록된 Architecture/QA 버전, 검토 리포트 버전, 등록 후보 첨부 ?kind=arch|qa */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/items/[id]/docs">) {
  await connection();
  return respond(async () => {
    const kind = req.nextUrl.searchParams.get("kind");
    if (!isReviewKind(kind)) throw badRequest("kind는 arch 또는 qa여야 합니다.");
    return getDocState(parseId((await ctx.params).id), kind);
  });
}

/** 문서 등록 { kind, attachmentId } 또는 { kind, content, filename } → 단계 완료, 리포트 자동 생성 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/docs">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    if (!isReviewKind(body.kind)) throw badRequest("kind는 arch 또는 qa여야 합니다.");
    const r = await registerDocument(id, body.kind, {
      attachmentId: optionalId(body.attachmentId),
      content: body.content,
      filename: body.filename,
    });
    return { ...r, item: await getItemDetail(id) };
  });
}
