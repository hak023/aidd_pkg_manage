import { connection, type NextRequest } from "next/server";
import { parseId, respond } from "@/lib/api";
import { DomainError } from "@/lib/repo/errors";
import { getDocument } from "@/lib/repo/prd";

/** 문서 원문. ?download=1이면 md 파일로 내려받기 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/documents/[id]">) {
  await connection();
  const id = (await ctx.params).id;
  if (req.nextUrl.searchParams.get("download") === "1") {
    try {
      const d = await getDocument(parseId(id));
      return new Response(d.content, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
        },
      });
    } catch (e) {
      const status = e instanceof DomainError ? e.status : 500;
      return Response.json({ error: e instanceof Error ? e.message : "오류" }, { status });
    }
  }
  return respond(async () => ({ document: await getDocument(parseId(id)) }));
}
