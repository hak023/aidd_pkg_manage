import { connection, type NextRequest } from "next/server";
import { respond } from "@/lib/api";
import { badRequest } from "@/lib/repo/errors";
import { listMailsByStatus } from "@/lib/repo/mail";

/** 수신 메일 목록: ?status=unmatched(기본) | ignored */
export async function GET(req: NextRequest) {
  await connection();
  return respond(async () => {
    const status = req.nextUrl.searchParams.get("status") ?? "unmatched";
    if (status !== "unmatched" && status !== "ignored") throw badRequest("status가 올바르지 않습니다.");
    return { mails: await listMailsByStatus(status) };
  });
}
