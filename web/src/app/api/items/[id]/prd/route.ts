import type { NextRequest } from "next/server";
import { parseId, respond } from "@/lib/api";
import { generatePrd } from "@/lib/repo/prd";
import { getItemDetail } from "@/lib/repo/tree";

export const maxDuration = 60;

/** L2 PRD 생성 → 새 버전 */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/items/[id]/prd">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const document = await generatePrd(id);
    return { document, item: await getItemDetail(id) };
  });
}
