import { connection, type NextRequest } from "next/server";
import { parseId, readJson, respond } from "@/lib/api";
import { getItemDetail, updateItemFields } from "@/lib/repo/tree";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/items/[id]">) {
  await connection();
  return respond(async () => ({ item: await getItemDetail(parseId((await ctx.params).id)) }));
}

/** 수집 조건 수정 { keywords?, searchPeriod?, memo? } */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/items/[id]">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    await updateItemFields(id, body as Record<string, string>);
    return { item: await getItemDetail(id) };
  });
}
