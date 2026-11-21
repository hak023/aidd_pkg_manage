import { respond } from "@/lib/api";
import { pollMail } from "@/lib/repo/mail";

export const maxDuration = 60;

/** 화면의 '메일 확인' 버튼과 자동 확인 (로그인한 사용자의 메일함만 확인한다. 외부 크론은 사용하지 않는다) */
export async function POST() {
  return respond(async () => pollMail());
}
