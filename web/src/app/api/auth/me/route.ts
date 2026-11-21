import { connection } from "next/server";
import { getSessionUser } from "@/lib/session";

/** 현재 로그인 사용자 (머리글 표시용) */
export async function GET() {
  await connection();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  return Response.json({ id: user.id, name: user.name });
}
