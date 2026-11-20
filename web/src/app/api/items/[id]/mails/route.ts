import { connection, type NextRequest } from "next/server";
import { parseId, respond } from "@/lib/api";
import { listItemMails } from "@/lib/repo/mail";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/items/[id]/mails">) {
  await connection();
  return respond(async () => ({ mails: await listItemMails(parseId((await ctx.params).id)) }));
}
