import type { NextRequest } from "next/server";
import { optionalId, parseId, readJson, respond } from "@/lib/api";
import { deleteNode, moveNode, renameNode } from "@/lib/repo/tree";

/** 이름 변경 { name } 또는 이동 { parentId } */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/nodes/[id]">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    if ("name" in body) await renameNode(id, body.name);
    if ("parentId" in body) await moveNode(id, optionalId(body.parentId));
    return { ok: true };
  });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/nodes/[id]">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    return { deleted: await deleteNode(id) };
  });
}
