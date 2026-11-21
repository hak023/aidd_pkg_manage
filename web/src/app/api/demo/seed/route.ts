import { readJson, respond } from "@/lib/api";
import { clearAllDemoData, resetAndSeedDemoData } from "@/lib/repo/demo-seed";

// Neon 원격 배치 적재 여유 시간 확보 (Vercel Hobby 상한 60초)
export const maxDuration = 60;

/** 전체 데이터 초기화 및 시연 데이터 일괄 재생성 */
export async function POST(req: Request) {
  return respond(async () => {
    const body = await readJson(req);
    if (body.action === "clear") {
      await clearAllDemoData();
      return { cleared: true };
    }
    const summary = await resetAndSeedDemoData();
    return { cleared: false, summary };
  });
}
