import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHandle, getHandle, migrate, setHandleForTest } from "@/lib/db/client";
import { mails, nodes } from "@/lib/db/schema";
import { DEMO_SCENARIO } from "@/lib/demo/catalog";
import { buildTimeline } from "@/lib/demo/timeline";
import { STAGE_KEYS } from "@/lib/domain/stages";
import { clearDemoData, resetAndSeedDemoData } from "@/lib/repo/demo-seed";
import { getDocState, stakeholderEmails } from "@/lib/repo/docs";
import { listItemMails, sendAndRecord } from "@/lib/repo/mail";
import { getDocument, getReviewState, listDocuments } from "@/lib/repo/prd";
import { getProgressState } from "@/lib/repo/progress";
import { createNode, deleteNode, getItemDetail, listTree, moveNode, renameNode } from "@/lib/repo/tree";

const FORBIDDEN_PATTERN =
  /시뮬레이터|simulator|샘플|sample|예시|example\.com|가상|gasang|모의\s*LLM|\(모의\)|테스트용|더미|dummy/i;

/** 기준 일정의 완료(2026-12-11)보다 이른 초기화 시점 */
const BEFORE_DONE = new Date("2026-11-25T11:00:00Z");

describe("시연 데이터 초기화 및 생성", () => {
  beforeEach(async () => {
    const h = await createHandle({ url: "", pgliteDir: "memory://" });
    await migrate(h);
    setHandleForTest(h);
  });

  afterEach(() => {
    setHandleForTest(undefined);
  });

  it("TC-P1-29 같은 개발사항을 1~7단계 상태로 7개 만들고, 각 스냅샷은 자기 단계까지의 산출물만 가진다", async () => {
    const summary = await resetAndSeedDemoData({ now: BEFORE_DONE });
    expect(summary).toMatchObject({ services: 1, labels: 1, items: 7 });
    expect(summary.stageCounts).toEqual(Object.fromEntries(STAGE_KEYS.map((k) => [k, 1])));

    const flat = await listTree();
    const [service] = flat.filter((n) => n.type === "service");
    const [label] = flat.filter((n) => n.type === "label");
    const items = flat.filter((n) => n.type === "item");
    expect(service.name).toBe("음성링고");
    expect(label).toMatchObject({ name: "R164PKG_26.12", parentId: service.id });
    expect(items.map((n) => n.name)).toEqual(Array(7).fill("계절·명절 인사말 자동 추천 템플릿 및 예약 일괄 전환 서비스"));
    expect(items.map((n) => n.item!.currentStage)).toEqual(STAGE_KEYS);

    const people = ["yujin.huh@kt.com", "seunghak.lee2@kt.com", "subin.ok@kt.com"];
    const prdDates = new Set<string>();

    for (const [idx, node] of items.entries()) {
      const stageNo = idx + 1;
      const detail = await getItemDetail(node.id);
      expect(JSON.stringify(detail)).not.toMatch(FORBIDDEN_PATTERN);
      expect(detail.completedAt === null).toBe(stageNo < 7);
      // 일정을 앞당겼으므로 미래 시각의 이력이 없어야 한다
      expect(detail.events.every((e) => new Date(e.createdAt) <= BEFORE_DONE)).toBe(true);

      const itemMails = await listItemMails(node.id);
      for (const m of itemMails) {
        expect(m.simulated).toBe(false);
        expect(`${m.subject} ${m.from} ${m.to}`).not.toMatch(FORBIDDEN_PATTERN);
      }

      const rev = await getReviewState(node.id);
      if (stageNo === 1) {
        expect(itemMails.map((m) => m.kind)).toEqual(["collect_request"]);
        expect(rev.latest).toBeNull();
        continue;
      }
      expect(rev.latest).toMatchObject({ status: "ok", provider: "gemini" });
      expect(Object.keys(rev.latest!.answers)).toHaveLength(stageNo === 2 ? 1 : rev.latest!.result!.questions.length);
      expect(await stakeholderEmails(node.id)).toEqual(people);

      const prds = await listDocuments(node.id, "prd");
      expect(prds.map((d) => d.version)).toEqual(stageNo >= 3 ? [2, 1] : []);
      if (stageNo >= 3) {
        const [v2, v1] = await Promise.all(prds.map((d) => getDocument(d.id)));
        expect(v2.content).toContain("## 7. 요구사항");
        expect(v2.content).toContain("| NFR-03 |");
        expect(v1.content).not.toContain("| NFR-03 |");
        expect(v2.content).not.toMatch(FORBIDDEN_PATTERN);
        prdDates.add(v2.createdAt);
      }

      for (const [kind, from] of [["arch", 4], ["qa", 5]] as const) {
        const st = await getDocState(node.id, kind);
        expect(st.versions).toHaveLength(stageNo >= from ? 1 : 0);
        expect(st.reports).toHaveLength(stageNo >= from ? 1 : 0);
        if (stageNo >= from) {
          expect(st.reports[0]).toMatchObject({ baseDocId: st.versions[0].id, prdDocId: prds[0].id });
          expect(st.versions[0].attachmentId).not.toBeNull();
        }
      }

      const prog = await getProgressState(node.id);
      expect(prog.history).toHaveLength(stageNo === 6 ? 2 : stageNo === 7 ? 3 : 0);
      if (stageNo >= 6) {
        expect(prog.latest!.milestones).toHaveLength(4);
        expect(node.item!.launch).toMatchObject(
          stageNo === 6 ? { status: "예정", endKind: "예정" } : { status: "완료", endKind: "실적" },
        );
      }
    }
    // 모든 스냅샷이 같은 일정을 쓴다
    expect(prdDates.size).toBe(1);
  });

  it("TC-P1-30 시연 일정: 완료 전에 초기화하면 주 단위로 앞당기고, 완료 뒤에는 기준 일정을 그대로 쓴다", () => {
    const early = buildTimeline(BEFORE_DONE);
    expect(early.shiftWeeks).toBe(3);
    expect(early.ymd("launch")).toBe("2026-11-19");
    expect(early.at("done").getTime()).toBeLessThan(BEFORE_DONE.getTime());

    const late = buildTimeline(new Date("2027-01-10T00:00:00Z"));
    expect(late.shiftWeeks).toBe(0);
    expect(late.ymd("kickoff")).toBe("2026-10-06");
    expect(late.ymd("launch")).toBe("2026-12-10");
  });

  it("TC-P1-22 시연 데이터만 초기화: 실제 업무 데이터·코드는 보존하고 시연 개발사항에 매칭된 실제 메일은 미분류로 되돌린다", async () => {
    await resetAndSeedDemoData();
    const realSvc = await createNode({ type: "service", name: "실제 업무 서비스", parentId: null });
    const realItem = await createNode({ type: "item", name: "실제 업무 개발사항", parentId: realSvc.id });

    // 시연 데이터 변조: 이름 변경, 삭제, 시연 라벨 아래 새 항목 추가
    const before = await listTree();
    const demoItems = before.filter((n) => n.type === "item" && n.id !== realItem.id);
    await renameNode(demoItems[0].id, "변조된 항목 이름");
    await deleteNode(demoItems[1].id);
    const demoLabel = before.find((n) => n.type === "label")!;
    await createNode({ type: "item", name: "시연 중 추가한 항목", parentId: demoLabel.id });

    // 실제 수신 메일이 시연 개발사항에 매칭된 상태
    const h = await getHandle();
    const [realMail] = await h.db
      .insert(mails)
      .values({ itemId: demoItems[2].id, direction: "in", kind: "other", status: "matched", matchMethod: "tag", subject: "실제 회신" })
      .returning();

    const reseeded = await resetAndSeedDemoData();
    const after = await listTree();
    expect(after.filter((n) => n.type === "service").map((s) => s.name)).toEqual([DEMO_SCENARIO.service, "실제 업무 서비스"]);
    expect(after.some((n) => n.name === "변조된 항목 이름" || n.name === "시연 중 추가한 항목")).toBe(false);
    expect(after.find((n) => n.id === realItem.id)?.item?.code).toBe(realItem.item!.code);
    expect(after.filter((n) => n.type === "item")).toHaveLength(reseeded.items + 1);

    // 코드는 재사용하지 않는다
    const codes = after.filter((n) => n.type === "item").map((n) => n.item!.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain(demoItems[0].item!.code);

    const [m] = await h.db.select().from(mails).where(eq(mails.id, realMail.id));
    expect(m).toMatchObject({ itemId: null, status: "unmatched", matchMethod: null });

    await clearDemoData();
    expect((await listTree()).map((n) => n.name).sort()).toEqual(["실제 업무 개발사항", "실제 업무 서비스"]);
  });

  it("TC-P1-25 시연 데이터와 실제 데이터 사이 이동은 거부하고, 시연 항목 아래에서 만든 항목은 시연 데이터가 된다", async () => {
    await resetAndSeedDemoData();
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
    const results = await Promise.allSettled([resetAndSeedDemoData(), resetAndSeedDemoData()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    // 잠금은 풀려 있어 다시 실행할 수 있다
    await expect(resetAndSeedDemoData()).resolves.toBeTruthy();
  });

  it("TC-P1-27 실제 Gmail 모드에서 시연 개발사항 메일은 본인 수집 주소로만 보낼 수 있다", async () => {
    await resetAndSeedDemoData();
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
    // 시연 자료의 관련자 주소(공유 수신자 기본값)로는 실제 메일이 나가지 않는다
    await expect(
      sendAndRecord(cfg, demoItem.id, demoItem.item!.code, "share", {
        to: ["me@example.com", DEMO_SCENARIO.people.requester.email],
        subject: "s",
        text: "t",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
