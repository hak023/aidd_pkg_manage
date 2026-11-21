import type { NextRequest } from "next/server";
import { parseId, readJson, respond } from "@/lib/api";
import { addManualReply } from "@/lib/repo/mail";
import { getItemDetail } from "@/lib/repo/tree";

/** 수집 회신 직접 입력 { text } — Gmail을 쓸 수 없을 때 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/manual-reply">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    const mail = await addManualReply(id, body.text);
    return { mail, item: await getItemDetail(id) };
  });
}
