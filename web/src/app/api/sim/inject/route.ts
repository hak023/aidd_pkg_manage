import type { NextRequest } from "next/server";
import { optionalId, readJson, respond } from "@/lib/api";
import { SAMPLE_LABEL, isSampleKey } from "@/lib/mail/samples";
import { badRequest } from "@/lib/repo/errors";
import { injectSample } from "@/lib/repo/mail";

/** 시뮬레이터: 가상 받은편지함에 샘플 메일 넣기 { sample, itemId? } */
export async function POST(req: NextRequest) {
  return respond(async () => {
    const body = await readJson(req);
    if (!isSampleKey(body.sample)) {
      throw badRequest(`sample은 ${Object.keys(SAMPLE_LABEL).join(", ")} 중 하나여야 합니다.`);
    }
    return injectSample(body.sample, optionalId(body.itemId));
  });
}
