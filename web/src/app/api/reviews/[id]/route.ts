import type { NextRequest } from "next/server";
import { parseId, readJson, respond } from "@/lib/api";
import { saveReviewInput } from "@/lib/repo/prd";

/** 추가 입력 저장 { answers?, extraNote? } */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/reviews/[id]">) {
  return respond(async () => {
    const body = await readJson(req);
    return { review: await saveReviewInput(parseId((await ctx.params).id), body) };
  });
}
