import { getHandle } from "../src/lib/db/client";
import { clearDemoData, resetAndSeedDemoData } from "../src/lib/repo/demo-seed";

/** 시연 데이터(is_demo)만 초기화 후 다시 생성한다. --clear면 시연 데이터만 지운다. */
async function main() {
  try {
    if (process.argv[2] === "--clear") {
      await clearDemoData();
      console.log("시연 데이터를 비웠습니다. (실제 업무 데이터는 그대로)");
      return;
    }
    const s = await resetAndSeedDemoData();
    console.log(
      `시연 데이터 재생성 완료: 단위서비스 ${s.services}개, 라벨링 ${s.labels}개, 개발사항 ${s.items}개, 메일 ${s.mails}건, 문서 ${s.documents}건 (${s.elapsedMs}ms)`,
    );
    console.log("단계별 분포:", s.stageCounts);
  } finally {
    const h = await getHandle().catch(() => null);
    await h?.close?.();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
