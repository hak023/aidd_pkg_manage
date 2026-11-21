import { respond } from "@/lib/api";
import { runScenario } from "@/lib/repo/scenario";

// 실제 Gemini로 돌리면 LLM 호출이 여러 번이라 시간이 걸린다
export const maxDuration = 300;

/** 전체 시나리오 실행 (시뮬레이터 모드만) */
export async function POST() {
  return respond(async () => runScenario());
}
