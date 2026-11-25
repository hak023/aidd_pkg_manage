import { connection, type NextRequest } from "next/server";
import { respond } from "@/lib/api";
import { getPromptDisclosure, isDisclosedStage } from "@/lib/llm/disclosure";
import { badRequest } from "@/lib/repo/errors";

/** 2~5단계의 작성·검토 방식과 프롬프트 원문 ?stage=review|prd|arch|qa (로그인 필요: proxy.ts) */
export async function GET(req: NextRequest) {
  await connection();
  return respond(async () => {
    const stage = req.nextUrl.searchParams.get("stage");
    if (!isDisclosedStage(stage)) throw badRequest("stage는 review, prd, arch, qa 중 하나여야 합니다.");
    return getPromptDisclosure(stage);
  });
}
