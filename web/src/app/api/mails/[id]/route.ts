import { connection, type NextRequest } from "next/server";
import { parseId, readJson, respond } from "@/lib/api";
import { badRequest } from "@/lib/repo/errors";
import { assignMail, getMail, ignoreMail, restoreMail } from "@/lib/repo/mail";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/mails/[id]">) {
  await connection();
  return respond(async () => ({ mail: await getMail(parseId((await ctx.params).id)) }));
}

/** 미분류함 처리: { action: "assign", itemId } | { action: "ignore" } | { action: "restore" } */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/mails/[id]">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    if (body.action === "assign") await assignMail(id, parseId(String(body.itemId ?? "")));
    else if (body.action === "ignore") await ignoreMail(id);
    else if (body.action === "restore") await restoreMail(id);
    else throw badRequest("action이 올바르지 않습니다.");
    return { mail: await getMail(id) };
  });
}
