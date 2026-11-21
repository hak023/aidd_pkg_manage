import { connection, type NextRequest } from "next/server";
import { optionalId, parseId, readJson, respond } from "@/lib/api";
import { getReviewState, runCollectReview } from "@/lib/repo/prd";
import { getItemDetail } from "@/lib/repo/tree";

export const maxDuration = 60;

/** 최신 점검 결과와 수집 회신 목록 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/items/[id]/review">) {
  await connection();
  return respond(async () => getReviewState(parseId((await ctx.params).id)));
}

/** L1 점검 실행 { mailId? } */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/review">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    const review = await runCollectReview(id, optionalId(body.mailId));
    return { review, state: await getReviewState(id), item: await getItemDetail(id) };
  });
}
