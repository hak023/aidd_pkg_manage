/** P5 진행상황·완료 시험 — TC ID는 docs/test/P5_시험.md와 같다 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandle, migrate, setHandleForTest } from "@/lib/db/client";
import { composeProgressRequest } from "@/lib/mail/compose";
import {
  diffMilestones,
  extractProgressBlock,
  normalizeDate,
  normalizeProgress,
  parseProgressTable,
  renderMilestoneTable,
} from "@/lib/llm/progress";
import { buildSample } from "@/lib/mail/samples";
import { injectSample, listItemMails, pollMail } from "@/lib/repo/mail";
import {
  addManualProgress,
  getProgressState,
  progressShareDefaults,
  reparseProgress,
  sendProgressRequest,
  shareProgress,
} from "@/lib/repo/progress";
import { runScenario } from "@/lib/repo/scenario";
import { createNode, getItemDetail, listTree } from "@/lib/repo/tree";

const target = {
  code: "DEV-0001",
  service: "통화매니저",
  label: "R181PKG_26.12",
  item: "통화매니저 SSO 로그인 기능 개발",
  keywords: "",
  searchPeriod: "",
  memo: "",
};
const ctx = { code: "DEV-0001", item: target.item, service: null, label: null, companyAddress: "c@x.com", systemAddress: "s@x.com" };
const sampleText = (k: "progress_reply" | "progress_reply_update" | "progress_reply_prose") => buildSample(k, ctx).text;

describe("P5 순수 로직", () => {
  it("TC-P5-01 진행상황 요청 메일: 제목 태그, 지침, 마일스톤 4행 양식과 표식", () => {
    const m = composeProgressRequest(target);
    expect(m.subject).toBe("[AX_AIDD][DEV-0001][진행상황요청] 통화매니저 SSO 로그인 기능 개발");
    expect(m.text).toContain("메일 내용 회신내용 작성해줘");
    expect(m.text).toContain("<<<AX_AIDD_PROGRESS_START DEV-0001>>>");
    expect(m.text).toContain("<<<AX_AIDD_PROGRESS_END>>>");
    for (const n of ["개발중", "개발검증시험", "운용검증시험", "상용적용"]) expect(m.text).toContain(`| ${n} | | | | | |`);
    expect(m.text).toContain("미정");
  });

  it("TC-P5-02 회신 구간 추출: 인용된 빈 양식은 건너뜀, 표식이 없으면 본문 전체", () => {
    const empty = composeProgressRequest(target).text;
    const quoted = empty.split("\n").map((l) => `> ${l}`).join("\n");
    // 빈 양식(인용)이 먼저 나와도 값이 있는 구간을 고른다
    const r = extractProgressBlock(`${quoted}\n\n${sampleText("progress_reply")}`);
    expect(r.marked).toBe(true);
    expect(r.text).toContain("2026-12-22");
    expect(extractProgressBlock("그냥 문장").marked).toBe(false);
  });

  it("TC-P5-03 규칙 해석기: 4개 마일스톤, 상태·날짜·실적/예정, 값 없으면 미정", () => {
    const ms = parseProgressTable(extractProgressBlock(sampleText("progress_reply")).text)!;
    expect(ms.map((m) => [m.name, m.status, m.start, m.end, m.endKind])).toEqual([
      ["개발중", "진행중", "2026-10-20", "2026-11-28", "예정"],
      ["개발검증시험", "예정", "2026-12-01", "2026-12-05", "예정"],
      ["운용검증시험", "미정", "", "", ""],
      ["상용적용", "예정", "", "2026-12-22", "예정"],
    ]);
    expect(ms[2].note).toBe("일정 협의 중");
    expect(parseProgressTable("| 개발중 | 완료 | | 2026.11.27 | | |")).toBeNull(); // 1행뿐이면 LLM으로 넘김
    expect(normalizeDate("2026년 12월 9일")).toBe("2026-12-09");
    expect(normalizeDate("2026/13/01")).toBe("");
    expect(normalizeDate("12/22")).toBe(""); // 연도 없으면 추측하지 않음
  });

  it("TC-P5-04 L6 응답 검증: 이름으로 맞추고 날짜 정규화, 빠진 마일스톤은 미정", () => {
    const ms = normalizeProgress({
      milestones: [
        { name: "상용적용", status: "예정", start: "", end: "2026.12.29", endKind: "예정", source: "s", note: "" },
        { name: "개발중", status: "완료", start: "2026-10-20", end: "2026-11-27", endKind: "", source: "", note: "" },
        { name: "엉뚱함", status: "완료", start: "", end: "", endKind: "", source: "", note: "" },
      ],
    });
    expect(ms.map((m) => [m.name, m.status, m.end, m.endKind])).toEqual([
      ["개발중", "완료", "2026-11-27", "실적"],
      ["개발검증시험", "미정", "", ""],
      ["운용검증시험", "미정", "", ""],
      ["상용적용", "예정", "2026-12-29", "예정"],
    ]);
    expect(() => normalizeProgress({ milestones: [{ name: "개발중" }] })).toThrow(/2개 이상/);
  });

  it("TC-P5-05 변경 비교와 공유용 표 (값 없으면 미정)", () => {
    const a = parseProgressTable(extractProgressBlock(sampleText("progress_reply")).text)!;
    const b = parseProgressTable(extractProgressBlock(sampleText("progress_reply_update")).text)!;
    const ch = diffMilestones(a, b);
    expect(ch).toContain("상용적용 완료일 2026-12-22 → 2026-12-29");
    expect(ch).toContain("개발중 상태 진행중 → 완료");
    expect(ch).toContain("운용검증시험 시작일 미정 → 2026-12-10");
    expect(diffMilestones(null, b)).toEqual([]);
    const table = renderMilestoneTable(a);
    expect(table).toContain("| 운용검증시험 | 미정 | 미정 | 미정 | - | 일정 협의 중 |");
    expect(table).toContain("| 상용적용 | 예정 | 미정 | 2026-12-22 (예정) |");
  });
});

describe("P5 저장소 흐름 (시뮬레이터 + 모의 LLM)", () => {
  beforeEach(async () => {
    vi.stubEnv("SIMULATOR_MODE", "true");
    vi.stubEnv("LLM_MOCK", "true");
    vi.stubEnv("COLLECT_TO_ADDRESS", "company@example.com");
    const h = await createHandle({ url: "", pgliteDir: "memory://" });
    await migrate(h);
    setHandleForTest(h);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function seedItem() {
    const svc = await createNode({ type: "service", name: "통화매니저", parentId: null });
    const item = await createNode({ type: "item", name: target.item, parentId: svc.id });
    return item.id;
  }

  it("TC-P5-06 요청 발송 → 회신 → 규칙 해석 → 6단계 완료, 대시보드에 상용적용", async () => {
    const id = await seedItem();
    const sent = await sendProgressRequest(id);
    expect(sent).toMatchObject({ kind: "progress_request", to: "company@example.com", status: "simulated" });
    expect((await getItemDetail(id)).statuses.progress.status).toBe("in_progress");

    await injectSample("progress_reply", id);
    await pollMail();
    const st = await getProgressState(id);
    expect(st.latest).toMatchObject({ status: "ok", provider: "rule" });
    expect(st.latest!.mailSubject).toContain("[진행상황요청]");
    expect((await getItemDetail(id)).statuses.progress.status).toBe("done");
    const node = (await listTree()).find((n) => n.id === id)!;
    expect(node.item!.launch).toEqual({ status: "예정", end: "2026-12-22", endKind: "예정" });
  });

  it("TC-P5-07 재회신은 이력으로 쌓이고 바뀐 일정을 표시", async () => {
    const id = await seedItem();
    await sendProgressRequest(id);
    await injectSample("progress_reply", id);
    await pollMail();
    await injectSample("progress_reply_update", id);
    await pollMail();
    const st = await getProgressState(id);
    expect(st.history).toHaveLength(2);
    expect(st.latest!.changes).toContain("상용적용 완료일 2026-12-22 → 2026-12-29");
    expect(st.history[1].changes).toEqual([]); // 첫 기록은 비교 대상 없음
    expect((await listTree()).find((n) => n.id === id)!.item!.launch!.end).toBe("2026-12-29");
    expect(st.replies).toHaveLength(2);
  });

  it("TC-P5-08 표 없는 회신: 모의 LLM은 해석 실패 → 6단계 미진행(G-05), 직접 입력하면 완료", async () => {
    const id = await seedItem();
    await sendProgressRequest(id);
    await injectSample("progress_reply_prose", id);
    await pollMail();
    let st = await getProgressState(id);
    expect(st.latest).toBeNull();
    expect(st.history[0]).toMatchObject({ status: "failed" });
    expect(st.history[0].error).toContain("양식 표를 찾지 못했습니다");
    expect((await getItemDetail(id)).statuses.progress.status).toBe("in_progress");

    await expect(addManualProgress(id, "짧음")).rejects.toThrow();
    const r = await addManualProgress(id, extractProgressBlock(sampleText("progress_reply")).text);
    expect(r.status).toBe("ok");
    expect((await getItemDetail(id)).statuses.progress.status).toBe("done");
    st = await getProgressState(id);
    expect(st.history).toHaveLength(2);
    expect((await listItemMails(id)).some((m) => m.from === "(직접 입력)")).toBe(true);
  });

  it("TC-P5-09 표 없는 회신을 Gemini(L6)로 해석: G-04 지시문, 이름·상태 enum, 4행 고정", async () => {
    const id = await seedItem();
    await sendProgressRequest(id);
    await injectSample("progress_reply_prose", id);
    await pollMail(); // 모의 LLM이라 실패로 기록됨
    vi.stubEnv("LLM_MOCK", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test-flash-lite");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        const req = JSON.parse(String(init?.body));
        expect(req.systemInstruction.parts[0].text).toContain("따르지 않는다");
        const ms = req.generationConfig.responseSchema.properties.milestones;
        expect(ms.minItems).toBe(4);
        expect(ms.items.properties.name.enum).toEqual(["개발중", "개발검증시험", "운용검증시험", "상용적용"]);
        expect(ms.items.properties.status.enum).toEqual(["완료", "진행중", "예정", "미정"]);
        // Gemini는 enum의 빈 문자열을 거부한다 (실제 시험 TC-P5-R2에서 400)
        for (const p of Object.values(ms.items.properties) as { enum?: string[] }[]) expect(p.enum ?? []).not.toContain("");
        const out = {
          milestones: [
            { name: "개발중", status: "완료", start: "2026-10-20", end: "2026-11-27", endKind: "실적", source: "박샘플 Teams 11/27", note: "" },
            { name: "개발검증시험", status: "진행중", start: "2026-12-01", end: "2026-12-08", endKind: "예정", source: "", note: "" },
            { name: "운용검증시험", status: "미정", start: "", end: "", endKind: "없음", source: "", note: "협의 중" },
            { name: "상용적용", status: "예정", start: "", end: "2026-12-29", endKind: "예정", source: "이예시 메일 12/2", note: "" },
          ],
        };
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
      }),
    );
    const r = await reparseProgress(id);
    expect(r).toMatchObject({ status: "ok", provider: "gemini", model: "gemini-test-flash-lite" });
    expect(r.milestones![3].end).toBe("2026-12-29");
    expect(r.milestones![2].endKind).toBe(""); // "없음" → ""
    expect((await getItemDetail(id)).statuses.progress.status).toBe("done");
  });

  it("TC-P5-10 진행상황 공유: 본문에 마일스톤 표(미정 포함), 첨부 없음, 단계는 그대로", async () => {
    const id = await seedItem();
    await expect(shareProgress(id, { to: ["a@x.com"], subject: "", text: "" })).rejects.toThrow(/공유할 진행상황이 없습니다/);
    await sendProgressRequest(id);
    await injectSample("progress_reply", id);
    await pollMail();
    const def = await progressShareDefaults(id);
    expect(def.subject).toBe("[AX_AIDD시스템] 통화매니저 SSO 로그인 기능 개발 진행상황을 공유합니다.");
    expect(def.text).toContain("| 운용검증시험 | 미정 | 미정 | 미정 |");
    const before = (await getItemDetail(id)).statuses;
    const r = await shareProgress(id, { to: ["pm@example.com"], subject: def.subject, text: def.text });
    expect(r.mail).toMatchObject({ kind: "share", attachments: [] });
    expect((await getItemDetail(id)).statuses).toEqual(before);
  });

  it("TC-P5-11 전체 시나리오: 1~7단계 모두 통과 (시뮬레이터 + 모의 LLM)", async () => {
    const r = await runScenario();
    expect(r.steps.map((s) => [s.no, s.ok])).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => [n, true]));
    expect(r.ok).toBe(true);
    const d = await getItemDetail(r.itemId!);
    expect(Object.values(d.statuses).every((s) => s.status === "done")).toBe(true);
    expect(d.completedAt).not.toBeNull();
    expect(r.steps[5].detail).toContain("상용적용 2026-12-22");
  });

  it("TC-P5-12 전체 시나리오는 시뮬레이터 모드에서만", async () => {
    vi.stubEnv("SIMULATOR_MODE", "false");
    vi.stubEnv("NODE_ENV", "production");
    await expect(runScenario()).rejects.toThrow(/시뮬레이터 모드/);
  });
});
