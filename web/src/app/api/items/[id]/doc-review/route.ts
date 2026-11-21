import type { NextRequest } from "next/server";
import { parseId, readJson, respond } from "@/lib/api";
import { badRequest } from "@/lib/repo/errors";
import { generateDocReport, isReviewKind } from "@/lib/repo/docs";

export const maxDuration = 60;

/** 검토 리포트 다시 생성 { kind } (최신 대상 문서 + 최신 PRD) */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/doc-review">) {
  return respond(async () => {
    const body = await readJson(req);
    if (!isReviewKind(body.kind)) throw badRequest("kind는 arch 또는 qa여야 합니다.");
    return { document: await generateDocReport(parseId((await ctx.params).id), body.kind) };
  });
}
