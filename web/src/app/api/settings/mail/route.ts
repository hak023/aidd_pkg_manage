import { connection } from "next/server";
import { readJson, respond } from "@/lib/api";
import { DomainError } from "@/lib/repo/errors";
import { getMyMailSettings, saveMyMailSettings } from "@/lib/repo/user-settings";
import { currentUser } from "@/lib/session";

function me() {
  const user = currentUser();
  if (!user) throw new DomainError(401, "로그인이 필요합니다.");
  return user;
}

/** 내 메일 설정 (앱 비밀번호는 설정 여부만) */
export async function GET() {
  await connection();
  return respond(async () => getMyMailSettings(me()));
}

/** 내 메일 설정 저장. 로그인한 본인 설정만 바꿀 수 있다. */
export async function PUT(req: Request) {
  return respond(async () => saveMyMailSettings(me(), await readJson(req)));
}
