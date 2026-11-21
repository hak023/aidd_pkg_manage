import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHandle, migrate, setHandleForTest } from "@/lib/db/client";
import { DEMO_CATALOG } from "@/lib/demo/catalog";
import { STAGE_KEYS } from "@/lib/domain/stages";
import { clearAllDemoData, resetAndSeedDemoData } from "@/lib/repo/demo-seed";
import { getDocState } from "@/lib/repo/docs";
import { listItemMails } from "@/lib/repo/mail";
import { getDocument, getReviewState, listDocuments } from "@/lib/repo/prd";
import { getProgressState } from "@/lib/repo/progress";
import { createNode, deleteNode, getItemDetail, listTree, renameNode } from "@/lib/repo/tree";

function makeDeterministicRng(seed = 20261121): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const FORBIDDEN_PATTERN =
  /시뮬레이터|simulator|샘플|sample|예시|example\.com|가상|gasang|모의\s*LLM|\(모의\)|테스트용|더미|dummy/i;

describe("시연 데이터 초기화 및 일괄 생성", () => {
  beforeEach(async () => {
    const h = await createHandle({ url: "", pgliteDir: "memory://" });
    await migrate(h);
    setHandleForTest(h);
  });

  afterEach(() => {
    setHandleForTest(undefined);
  });

  it("카탈로그 원본 검증: 6개 단위서비스 × 라벨링 3개 × 고유 개발사항 12개, 금지어 없음", () => {
    expect(DEMO_CATALOG.map((s) => s.name)).toEqual([
      "전국대표번호",
      "음성링고",
      "영상링고",
      "AI통화비서",
      "080착신형AS",
      "모두의AI",
    ]);
    const titles = new Set<string>();
    for (const svc of DEMO_CATALOG) {
      expect(svc.labels).toHaveLength(3);
      expect(svc.items.length).toBeGreaterThanOrEqual(12);
      expect(JSON.stringify(svc)).not.toMatch(FORBIDDEN_PATTERN);
      for (const item of svc.items) {
        expect(titles.has(item.title)).toBe(false);
        titles.add(item.title);
      }
    }
  });

  it("일괄 생성 시 라벨링당 2~4개·단계 1~7이 정합하게 적재되고 시뮬레이터 흔적이 없다", async () => {
    const rng = makeDeterministicRng(42);
    const now = new Date("2026-11-21T09:30:00Z");
    const summary = await resetAndSeedDemoData({ rng, now });

    expect(summary.services).toBe(6);
    expect(summary.labels).toBe(18);
    expect(summary.items).toBeGreaterThanOrEqual(36);
    expect(summary.items).toBeLessThanOrEqual(72);

    const flat = await listTree();
    const services = flat.filter((n) => n.type === "service");
    const labels = flat.filter((n) => n.type === "label");
    const items = flat.filter((n) => n.type === "item");

    expect(services.map((s) => s.name)).toEqual([
      "전국대표번호",
      "음성링고",
      "영상링고",
      "AI통화비서",
      "080착신형AS",
      "모두의AI",
    ]);
    expect(labels).toHaveLength(18);
    expect(items).toHaveLength(summary.items);

    for (const svc of services) {
      const childLabels = labels.filter((l) => l.parentId === svc.id);
      expect(childLabels).toHaveLength(3);
      for (const lbl of childLabels) {
        const childItems = items.filter((it) => it.parentId === lbl.id);
        expect(childItems.length).toBeGreaterThanOrEqual(2);
        expect(childItems.length).toBeLessThanOrEqual(4);
      }
    }

    // 트리 currentStage 집계와 summary.stageCounts가 정확히 일치해야 함
    const counted = Object.fromEntries(STAGE_KEYS.map((k) => [k, 0]));
    for (const it of items) {
      counted[it.item!.currentStage] += 1;
    }
    expect(counted).toEqual(summary.stageCounts);

    // 단계별 대표 항목 1개씩 뽑아 산출물 및 시뮬레이터 비노출 검증
    for (const stageKey of STAGE_KEYS) {
      const sampleNode = items.find((n) => n.item!.currentStage === stageKey);
      if (!sampleNode) continue;
      const detail = await getItemDetail(sampleNode.id);
      expect(JSON.stringify(detail)).not.toMatch(FORBIDDEN_PATTERN);

      const mails = await listItemMails(sampleNode.id);
      for (const m of mails) {
        expect(m.simulated).toBe(false);
        expect(m.subject).not.toMatch(FORBIDDEN_PATTERN);
        expect(m.from).not.toMatch(FORBIDDEN_PATTERN);
        expect(m.to).not.toMatch(FORBIDDEN_PATTERN);
      }

      const stageNo = STAGE_KEYS.indexOf(stageKey) + 1;
      if (stageNo >= 2) {
        const rev = await getReviewState(sampleNode.id);
        expect(rev.latest?.status).toBe("ok");
        expect(rev.latest?.provider).toBe("gemini");
      }
      if (stageNo >= 3) {
        const prds = await listDocuments(sampleNode.id, "prd");
        expect(prds.length).toBeGreaterThanOrEqual(1);
        const prdDoc = await getDocument(prds[0].id);
        expect(prdDoc.content).toContain("## 7. 요구사항");
        expect(prdDoc.content).not.toMatch(FORBIDDEN_PATTERN);
      }
      if (stageNo >= 4) {
        const archState = await getDocState(sampleNode.id, "arch");
        expect(archState.versions).toHaveLength(1);
        expect(archState.reports).toHaveLength(1);
      }
      if (stageNo >= 5) {
        const qaState = await getDocState(sampleNode.id, "qa");
        expect(qaState.versions).toHaveLength(1);
        expect(qaState.reports).toHaveLength(1);
      }
      if (stageNo >= 6) {
        const prog = await getProgressState(sampleNode.id);
        expect(prog.latest?.status).toBe("ok");
        expect(prog.latest?.milestones).toHaveLength(4);
        expect(sampleNode.item!.launch).not.toBeNull();
      }
      if (stageNo === 7) {
        expect(detail.completedAt).not.toBeNull();
      }
    }
  });

  it("데이터 변조·삭제 후 다시 초기화하면 DEV-0001부터 깨끗이 재구성되고 후속 생성도 정상 동작한다", async () => {
    await resetAndSeedDemoData({ rng: makeDeterministicRng(1) });
    const before = await listTree();
    const firstSvc = before.find((n) => n.type === "service")!;
    const firstItem = before.find((n) => n.type === "item")!;

    // 시연 중 임의 변조 시뮬레이션 (이름 변경, 삭제, 임의 서비스 추가)
    await renameNode(firstItem.id, "변조된 항목 이름");
    await deleteNode(firstSvc.id);
    await createNode({ type: "service", name: "임시 추가 서비스", parentId: null });

    // 재초기화 실행
    const reseeded = await resetAndSeedDemoData({ rng: makeDeterministicRng(99) });
    const after = await listTree();
    expect(after.filter((n) => n.type === "service").map((s) => s.name)).toEqual([
      "전국대표번호",
      "음성링고",
      "영상링고",
      "AI통화비서",
      "080착신형AS",
      "모두의AI",
    ]);
    expect(after.some((n) => n.name === "변조된 항목 이름" || n.name === "임시 추가 서비스")).toBe(false);

    const afterItems = after.filter((n) => n.type === "item");
    expect(afterItems[0].item!.code).toBe("DEV-0001");

    // 재초기화 이후 사용자가 새 개발사항을 추가할 때 코드 시퀀스 충돌이 없어야 함
    const anyLabel = after.find((n) => n.type === "label")!;
    const added = await createNode({ type: "item", name: "추가 신규 개발사항", parentId: anyLabel.id });
    expect(added.item!.code).toBe(`DEV-${String(reseeded.items + 1).padStart(4, "0")}`);

    await clearAllDemoData();
    expect(await listTree()).toHaveLength(0);
  });
});
