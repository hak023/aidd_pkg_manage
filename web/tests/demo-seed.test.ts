import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHandle, getHandle, migrate, setHandleForTest } from "@/lib/db/client";
import { mails, nodes } from "@/lib/db/schema";
import { DEMO_CATALOG } from "@/lib/demo/catalog";
import { STAGE_KEYS } from "@/lib/domain/stages";
import { clearDemoData, resetAndSeedDemoData } from "@/lib/repo/demo-seed";
import { getDocState } from "@/lib/repo/docs";
import { listItemMails, sendAndRecord } from "@/lib/repo/mail";
import { getDocument, getReviewState, listDocuments } from "@/lib/repo/prd";
import { getProgressState } from "@/lib/repo/progress";
import { createNode, deleteNode, getItemDetail, listTree, moveNode, renameNode } from "@/lib/repo/tree";

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

  it("TC-P1-22 시연 데이터만 초기화: 실제 업무 데이터·코드는 보존하고 시연 개발사항에 매칭된 실제 메일은 미분류로 되돌린다", async () => {
    await resetAndSeedDemoData({ rng: makeDeterministicRng(1) });
    const realSvc = await createNode({ type: "service", name: "실제 업무 서비스", parentId: null });
    const realItem = await createNode({ type: "item", name: "실제 업무 개발사항", parentId: realSvc.id });

    // 시연 데이터 변조: 이름 변경, 삭제, 시연 라벨 아래 새 항목 추가
    const before = await listTree();
    const demoItem = before.find((n) => n.type === "item" && n.id !== realItem.id)!;
    await renameNode(demoItem.id, "변조된 항목 이름");
    await deleteNode(before.find((n) => n.type === "service" && n.id !== realSvc.id)!.id);
    const demoLabel = (await listTree()).find((n) => n.type === "label")!;
    await createNode({ type: "item", name: "시연 중 추가한 항목", parentId: demoLabel.id });

    // 실제 수신 메일이 시연 개발사항에 매칭된 상태
    const anyDemoItem = (await listTree()).find((n) => n.type === "item" && n.id !== realItem.id)!;
    const h = await getHandle();
    const [realMail] = await h.db
      .insert(mails)
      .values({ itemId: anyDemoItem.id, direction: "in", kind: "other", status: "matched", matchMethod: "tag", subject: "실제 회신" })
      .returning();

    const reseeded = await resetAndSeedDemoData({ rng: makeDeterministicRng(99) });
    const after = await listTree();
    expect(after.filter((n) => n.type === "service").map((s) => s.name)).toEqual([
      ...DEMO_CATALOG.map((s) => s.name),
      "실제 업무 서비스",
    ]);
    expect(after.some((n) => n.name === "변조된 항목 이름" || n.name === "시연 중 추가한 항목")).toBe(false);
    expect(after.find((n) => n.id === realItem.id)?.item?.code).toBe(realItem.item!.code);
    expect(after.filter((n) => n.type === "item")).toHaveLength(reseeded.items + 1);

    // 코드는 재사용하지 않는다
    const codes = after.filter((n) => n.type === "item").map((n) => n.item!.code);
    expect(new Set(codes).size).toBe(codes.length);

    const [m] = await h.db.select().from(mails).where(eq(mails.id, realMail.id));
    expect(m).toMatchObject({ itemId: null, status: "unmatched", matchMethod: null });

    await clearDemoData();
    expect((await listTree()).map((n) => n.name).sort()).toEqual(["실제 업무 개발사항", "실제 업무 서비스"]);
  });

  it("TC-P1-25 시연 데이터와 실제 데이터 사이 이동은 거부하고, 시연 항목 아래에서 만든 항목은 시연 데이터가 된다", async () => {
    await resetAndSeedDemoData({ rng: makeDeterministicRng(3) });
    const realSvc = await createNode({ type: "service", name: "실제 서비스", parentId: null });
    const demoLabel = (await listTree()).find((n) => n.type === "label")!;
    const demoItem = (await listTree()).find((n) => n.type === "item")!;
    await expect(moveNode(demoItem.id, realSvc.id)).rejects.toThrow(/시연 데이터와 실제/);
    const realItem = await createNode({ type: "item", name: "실제 항목", parentId: realSvc.id });
    await expect(moveNode(realItem.id, demoLabel.id)).rejects.toThrow(/시연 데이터와 실제/);

    const child = await createNode({ type: "item", name: "시연 하위 항목", parentId: demoLabel.id });
    const h = await getHandle();
    const [row] = await h.db.select({ isDemo: nodes.isDemo }).from(nodes).where(eq(nodes.id, child.id));
    expect(row.isDemo).toBe(true);
  });

  it("TC-P1-26 동시에 초기화하면 한 번만 실행하고 나머지는 409로 거부한다", async () => {
    const results = await Promise.allSettled([
      resetAndSeedDemoData({ rng: makeDeterministicRng(5) }),
      resetAndSeedDemoData({ rng: makeDeterministicRng(6) }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    // 잠금은 풀려 있어 다시 실행할 수 있다
    await expect(resetAndSeedDemoData({ rng: makeDeterministicRng(7) })).resolves.toBeTruthy();
  });

  it("TC-P1-27 실제 Gmail 모드에서 시연 개발사항 메일은 본인 수집 주소로만 보낼 수 있다", async () => {
    await resetAndSeedDemoData({ rng: makeDeterministicRng(8) });
    const demoItem = (await listTree()).find((n) => n.type === "item")!;
    const cfg = {
      mode: "gmail" as const,
      gmailAddress: "sys@example.com",
      appPassword: "x",
      collectTo: "me@example.com",
      account: "sys@example.com",
      envNames: { gmailAddress: "", appPassword: "", collectTo: "" },
      dailyLimit: 30,
      initialLookbackDays: 3,
    };
    await expect(
      sendAndRecord(cfg, demoItem.id, demoItem.item!.code, "share", {
        to: ["me@example.com", "stakeholder@example.com"],
        subject: "s",
        text: "t",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
