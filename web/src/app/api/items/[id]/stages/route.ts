import type { NextRequest } from "next/server";
import { parseId, readJson, respond } from "@/lib/api";
import { isStageKey, isStageStatus } from "@/lib/domain/stages";
import { badRequest } from "@/lib/repo/errors";
import { getItemDetail, setStageStatus } from "@/lib/repo/tree";

/** 단계 상태 변경 { stage, status } — 순서는 강제하지 않는다 (Q-04) */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/items/[id]/stages">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    if (!isStageKey(body.stage)) throw badRequest("단계가 올바르지 않습니다.");
    if (!isStageStatus(body.status)) throw badRequest("상태가 올바르지 않습니다.");
    await setStageStatus(id, body.stage, body.status);
    return { item: await getItemDetail(id) };
  });
}
