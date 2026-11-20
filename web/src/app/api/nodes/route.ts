import { optionalId, readJson, respond } from "@/lib/api";
import { isNodeType } from "@/lib/domain/tree";
import { badRequest } from "@/lib/repo/errors";
import { createNode } from "@/lib/repo/tree";

/** 생성: { type, name, parentId, fields? } */
export async function POST(req: Request) {
  return respond(async () => {
    const body = await readJson(req);
    if (!isNodeType(body.type)) throw badRequest("유형을 선택하세요.");
    const fields = (body.fields ?? {}) as Record<string, string>;
    return { node: await createNode({ type: body.type, name: body.name, parentId: optionalId(body.parentId), fields }) };
  });
}
