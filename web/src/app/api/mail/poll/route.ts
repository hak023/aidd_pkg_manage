import { connection, type NextRequest } from "next/server";
import { respond } from "@/lib/api";
import { getMailConfig } from "@/lib/mail/config";
import { pollMail } from "@/lib/repo/mail";

export const maxDuration = 60;

/**
 * 외부 크론용: GET /api/mail/poll?secret=POLL_SECRET
 * (proxy.ts는 secret 파라미터가 있는 요청만 로그인 없이 통과시키고, 여기서 값을 검사한다)
 */
export async function GET(req: NextRequest) {
  await connection();
  const secret = req.nextUrl.searchParams.get("secret") ?? "";
  const expected = getMailConfig().pollSecret;
  if (!expected || secret !== expected) {
    return Response.json({ error: "secret이 올바르지 않습니다." }, { status: 401 });
  }
  return respond(async () => pollMail());
}

/** 화면의 '메일 확인' 버튼 (로그인 필요) */
export async function POST() {
  return respond(async () => pollMail());
}
