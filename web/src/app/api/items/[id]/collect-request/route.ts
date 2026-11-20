import { connection, type NextRequest } from "next/server";
import { parseId, respond } from "@/lib/api";
import { previewCollectRequest, sendCollectRequest } from "@/lib/repo/mail";
import { getItemDetail } from "@/lib/repo/tree";

export const maxDuration = 60;

/** 발송될 수집 요청 메일 미리보기 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/items/[id]/collect-request">) {
  await connection();
  return respond(async () => previewCollectRequest(parseId((await ctx.params).id)));
}

/** 수집 요청 메일 발송 (수신자는 config의 회사 주소로 고정) */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/items/[id]/collect-request">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const mail = await sendCollectRequest(id);
    return { mail, item: await getItemDetail(id) };
  });
}
