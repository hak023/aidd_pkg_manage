import { connection, type NextRequest } from "next/server";
import { parseId, readJson, respond } from "@/lib/api";
import { badRequest } from "@/lib/repo/errors";
import { listDocuments, saveDocumentEdit } from "@/lib/repo/prd";
import type { DocKind } from "@/lib/db/schema";

const KINDS: DocKind[] = ["prd", "arch", "qa", "arch_report", "qa_report"];
function kindOf(v: unknown): DocKind {
  if (typeof v === "string" && (KINDS as string[]).includes(v)) return v as DocKind;
  throw badRequest("kind가 올바르지 않습니다.");
}

/** 버전 목록 ?kind=prd */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/items/[id]/documents">) {
  await connection();
  return respond(async () => ({
    documents: await listDocuments(parseId((await ctx.params).id), kindOf(req.nextUrl.searchParams.get("kind") ?? "prd")),
  }));
}

/** 편집본 저장 { kind, content, note } → 새 버전 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/items/[id]/documents">) {
  return respond(async () => {
    const id = parseId((await ctx.params).id);
    const body = await readJson(req);
    return { document: await saveDocumentEdit(id, kindOf(body.kind), body.content, body.note) };
  });
}
