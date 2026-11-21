import { connection, type NextRequest } from "next/server";
import { optionalId, parseId, readJson, respond } from "@/lib/api";
import { badRequest } from "@/lib/repo/errors";
import { addManualProgress, getProgressState, reparseProgress } from "@/lib/repo/progress";

export const maxDuration = 60;

/** 최신 진행상황, 이력(변경 표시), 진행상황 회신 목록 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/items/[id]/progress">) {
  await connection();
  return respond(async () => getProgressState(parseId((await ctx.params).id)));
}

/** { action: "reparse", mailId? } 다시 해석 · { action: "manual", text } 직접 입력 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/progress">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    let report;
    if (body.action === "reparse") report = await reparseProgress(id, optionalId(body.mailId));
    else if (body.action === "manual") report = await addManualProgress(id, body.text);
    else throw badRequest("action은 reparse 또는 manual이어야 합니다.");
    return { report, state: await getProgressState(id) };
  });
}
