import { getHandle } from "../src/lib/db/client";
import { clearAllDemoData, resetAndSeedDemoData } from "../src/lib/repo/demo-seed";

async function main() {
  try {
    const mode = process.argv[2];
    if (mode === "--clear") {
      await clearAllDemoData();
      console.log("전체 데이터를 비웠습니다.");
      return;
    }
    const s = await resetAndSeedDemoData();
    console.log(
      `초기화 및 시연 데이터 생성 완료: 단위서비스 ${s.services}개, 라벨링 ${s.labels}개, 개발사항 ${s.items}개, 메일 ${s.mails}건, 문서 ${s.documents}건 (${s.elapsedMs}ms)`,
    );
    console.log("단계별 분포:", s.stageCounts);
  } finally {
    const h = await getHandle().catch(() => null);
    await h?.close?.();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
