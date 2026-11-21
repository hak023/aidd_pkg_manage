import type { NextRequest } from "next/server";
import { readJson, respond } from "@/lib/api";
import { testGemini, testGmail } from "@/lib/diag";
import { badRequest } from "@/lib/repo/errors";

export const maxDuration = 60;

/** 연결 테스트 { target: "gmail" | "gemini", send?: boolean } */
export async function POST(req: NextRequest) {
  return respond(async () => {
    const body = await readJson(req);
    if (body.target === "gmail") return { steps: await testGmail({ send: body.send === true }) };
    if (body.target === "gemini") return { steps: await testGemini() };
    throw badRequest("target은 gmail 또는 gemini여야 합니다.");
  });
}
