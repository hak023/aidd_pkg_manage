import { readJson, respond } from "@/lib/api";
import { clearDemoData, resetAndSeedDemoData } from "@/lib/repo/demo-seed";

// Neon 원격 배치 적재 여유 시간 확보 (Vercel Hobby 상한 60초)
export const maxDuration = 60;

/** 시연 데이터만 초기화 후 다시 생성 (로그인한 모든 사용자). 실제 업무 데이터는 그대로 둔다. */
export async function POST(req: Request) {
  return respond(async () => {
    const body = await readJson(req);
    if (body.action === "clear") {
      await clearDemoData();
      return { cleared: true };
    }
    const summary = await resetAndSeedDemoData();
    return { cleared: false, summary };
  });
}
