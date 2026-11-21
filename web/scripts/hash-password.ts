/**
 * 다중 사용자 비밀번호 해시 생성: npm run hash-password
 * 출력값을 Vercel 환경 변수 USER_<ID>_PASSWORD_HASH에 넣는다. 비밀번호 원문은 어디에도 저장하지 않는다.
 */
import { createInterface } from "node:readline/promises";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const pw = await rl.question("비밀번호 (8자 이상): ");
  rl.close();
  if (pw.length < 8) throw new Error("비밀번호는 8자 이상이어야 합니다.");
  console.log("\nUSER_<ID>_PASSWORD_HASH 값:");
  console.log(await hashPassword(pw));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
