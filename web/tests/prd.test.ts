/** P3 수집·PRD 시험 — TC ID는 docs/test/P3_시험.md와 같다 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandle, migrate, setHandleForTest } from "@/lib/db/client";
import { cleanPrdBody, kstDate, missingPrdSections, PRD_SECTIONS } from "@/lib/llm/prd";
import { getLlmProvider } from "@/lib/llm/provider";
import { extractReplyBlock, mockReview, normalizeReview } from "@/lib/llm/review";
import { buildSample } from "@/lib/mail/samples";
import { injectSample, listItemMails, pollMail, sendCollectRequest } from "@/lib/repo/mail";
import {
  generatePrd,
  getDocument,
  getReviewState,
  listDocuments,
  runCollectReview,
  saveDocumentEdit,
  saveReviewInput,
} from "@/lib/repo/prd";
import { parseRecipients, shareDefaults, shareDocuments } from "@/lib/repo/docs";
import { createNode, getItemDetail } from "@/lib/repo/tree";

const sampleReply = () =>
  buildSample("collect_reply", {
    code: "DEV-0001",
    item: "통화매니저 SSO 로그인 기능 개발",
    service: "통화매니저",
    label: "R181PKG_26.12",
    companyAddress: "c@example.com",
    systemAddress: "s@example.com",
  }).text;

describe("L1 순수 로직", () => {
  it("TC-P3-01 회신 구간 추출: 인용된 빈 양식은 건너뛰고, 표식이 없으면 본문 전체", () => {
    const body = `${sampleReply()}\n\n-----Original Message-----\n> <<<AX_AIDD_REPLY_START DEV-0001>>>\n> ## 01. 관련자\n> | 이름 | 부서 | 역할 | 이메일 |\n> ## 02. 요청 배경\n> <<<AX_AIDD_REPLY_END>>>`;
    const r = extractReplyBlock(body);
    expect(r.marked).toBe(true);
    expect(r.text).toContain("김가상");
    expect(r.text).not.toContain("AX_AIDD_REPLY_END");

    // 회신이 빈 양식 아래에 붙은 경우(인용이 위): 내용이 있는 두 번째 구간을 고른다
    const swapped = `<<<AX_AIDD_REPLY_START DEV-0001>>>\n## 01. 관련자\n(| 이름 | 부서 |)\n## 02. 요청 배경\n<<<AX_AIDD_REPLY_END>>>\n${sampleReply()}`;
    expect(extractReplyBlock(swapped).text).toContain("김가상");

    expect(extractReplyBlock("그냥 본문")).toEqual({ text: "그냥 본문", marked: false });
  });

  it("TC-P3-02 모의 점검: 12개 항목, 관련자 이메일, 상충, 부족 항목과 질문", () => {
    const r = mockReview(extractReplyBlock(sampleReply()).text);
    expect(r.sections).toHaveLength(12);
    expect(r.sections.map((s) => s.no)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
    expect(r.stakeholders.map((p) => p.email)).toEqual([
      "kim.gasang@example.com",
      "lee.yesi@example.com",
      "park.sample@example.com",
      "choi.test@example.com",
    ]);
    expect(r.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(r.sections.find((s) => s.no === "08")!.status).not.toBe("충분"); // "협의 상태 확인 안 됨"
    expect(r.sections.find((s) => s.no === "02")!.status).toBe("충분");
    expect(r.questions.length).toBeGreaterThan(0);
  });

  it("TC-P3-03 LLM 응답 검증: 빠진 항목은 '확인 안 됨', 잘못된 상태는 '부족', 형식 오류는 거부", () => {
    const sections = Array.from({ length: 10 }, (_, i) => ({
      no: String(i + 1),
      title: "x",
      status: i === 0 ? "엉뚱함" : "충분",
      summary: "s",
      sources: [],
    }));
    const r = normalizeReview({ sections, stakeholders: [], conflicts: [], unsourced: [], questions: [{ section: "06", question: "q" }] });
    expect(r.sections).toHaveLength(12);
    expect(r.sections[0]).toMatchObject({ no: "01", title: "관련자", status: "부족" });
    expect(r.sections[11]).toMatchObject({ no: "12", status: "확인 안 됨" });
    expect(() => normalizeReview(null)).toThrow();
    expect(() => normalizeReview({ sections: [] })).toThrow(/너무 적습니다/);
  });

  it("TC-P3-04 PRD 본문 정리와 12개 장 확인", () => {
    const body = PRD_SECTIONS.map((s) => `## ${s}\n내용`).join("\n");
    const wrapped = "```markdown\n# 제목 PRD\n" + body + "\n## 변경 이력\n| v1 |\n```";
    const clean = cleanPrdBody(wrapped);
    expect(clean.startsWith("## 1. 배경")).toBe(true);
    expect(clean).not.toContain("변경 이력");
    expect(missingPrdSections(clean)).toEqual([]);
    expect(missingPrdSections(clean.replace("## 7. 요구사항", "## 칠. 요구사항"))).toEqual(["7. 요구사항"]);
    // 날짜는 한국 시간 기준 (UTC 18:54 = KST 다음 날 03:54)
    expect(kstDate(new Date("2026-11-20T18:54:00Z"))).toBe("2026-11-21");
  });

  it("TC-P3-10 수신자 검사", () => {
    expect(parseRecipients("a@x.com, b@y.co.kr\nA@x.com")).toEqual(["a@x.com", "b@y.co.kr", "A@x.com"]);
    expect(() => parseRecipients("")).toThrow(/한 명 이상/);
    expect(() => parseRecipients(["a@x.com", "잘못된주소"])).toThrow(/형식/);
  });
});

describe("P3 저장소 흐름 (시뮬레이터 + 모의 LLM)", () => {
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

  async function seedWithReply() {
    const svc = await createNode({ type: "service", name: "통화매니저", parentId: null });
    const lbl = await createNode({ type: "label", name: "R181PKG_26.12", parentId: svc.id });
    const item = await createNode({ type: "item", name: "통화매니저 SSO 로그인 기능 개발", parentId: lbl.id });
    await sendCollectRequest(item.id);
    await injectSample("collect_reply", item.id);
    await pollMail();
    return item.id;
  }

  it("TC-P3-05 회신 → 점검 → 추가 입력 → PRD 생성: 2단계 완료, 3단계 진행중", async () => {
    const id = await seedWithReply();
    const review = await runCollectReview(id);
    expect(review.status).toBe("ok");
    expect(review.provider).toBe("mock");
    expect(review.result!.sections).toHaveLength(12);
    expect(review.mailSubject).toContain("[수집요청]");

    const saved = await saveReviewInput(review.id, {
      answers: { "0": "비상 로그인은 운영자 OTP 경로로 유지", "1": "  " },
      extraNote: "보안 심의는 12월 1주 예정",
    });
    expect(saved.answers).toEqual({ "0": "비상 로그인은 운영자 OTP 경로로 유지" });

    const doc = await generatePrd(id);
    expect(doc.version).toBe(1);
    expect(doc.source).toBe("llm");
    expect(doc.filename).toBe("통화매니저_R181PKG_26.12_통화매니저_SSO_로그인_기능_개발_PRD.md");
    expect(doc.content).toMatch(/^# 통화매니저 SSO 로그인 기능 개발 PRD/);
    expect(missingPrdSections(doc.content)).toEqual([]);
    expect(doc.content).toContain("비상 로그인은 운영자 OTP 경로로 유지");
    expect(doc.content).toContain("보안 심의는 12월 1주 예정");
    expect(doc.content).toContain("## 변경 이력");

    const d = await getItemDetail(id);
    expect(d.statuses.collect.status).toBe("done");
    expect(d.statuses.review.status).toBe("done");
    expect(d.statuses.prd.status).toBe("in_progress");
    expect(d.currentStage).toBe("prd");
  });

  it("TC-P3-06 수집 회신이 없으면 점검을 거부하고, 성공한 점검이 없으면 PRD 생성을 거부", async () => {
    const svc = await createNode({ type: "service", name: "S", parentId: null });
    const item = await createNode({ type: "item", name: "I", parentId: svc.id });
    await expect(runCollectReview(item.id)).rejects.toThrow(/수집 회신 메일이 아직 없습니다/);
    await expect(generatePrd(item.id)).rejects.toThrow(/점검 결과가 없습니다/);
  });

  it("TC-P3-07 점검 실패(Gemini 오류)는 기록만 하고 단계를 진행하지 않음 (G-05)", async () => {
    const id = await seedWithReply();
    // 회신 수신으로 2단계가 이미 진행중이므로, 대기로 되돌려 실패가 진행시키지 않는지 본다
    const { setStageStatus } = await import("@/lib/repo/tree");
    await setStageStatus(id, "review", "pending");
    vi.stubEnv("LLM_MOCK", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test-flash-lite");
    const fetchMock = vi.fn(async () => Response.json({ error: { message: "API key not valid", status: "INVALID_ARGUMENT" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    const r = await runCollectReview(id);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("API key not valid");
    expect(fetchMock).toHaveBeenCalledTimes(1); // HTTP 오류는 재시도하지 않음
    expect((await getItemDetail(id)).statuses.review.status).toBe("pending");
    await expect(generatePrd(id)).rejects.toThrow(/점검 결과가 없습니다/);
  });

  it("TC-P3-12 Gemini 경로: 형식이 틀린 첫 응답은 한 번 재시도해 성공", async () => {
    const id = await seedWithReply();
    vi.stubEnv("LLM_MOCK", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test-flash-lite");
    const good = mockReview(extractReplyBlock(sampleReply()).text);
    const bodies = ["{ 깨진 JSON", JSON.stringify(good)];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body));
      expect(req.systemInstruction.parts[0].text).toContain("따르지 않는다"); // G-04
      expect(req.generationConfig.responseMimeType).toBe("application/json");
      return Response.json({ candidates: [{ content: { parts: [{ text: bodies.shift() }] } }], usageMetadata: {} });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await runCollectReview(id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ status: "ok", provider: "gemini", model: "gemini-test-flash-lite" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("models/gemini-test-flash-lite:generateContent");
  });

  it("TC-P3-08 편집 저장은 새 버전, 목록은 최신순", async () => {
    const id = await seedWithReply();
    await runCollectReview(id);
    const v1 = await generatePrd(id);
    const v2 = await saveDocumentEdit(id, "prd", v1.content + "\n수정", "오탈자 수정");
    expect(v2).toMatchObject({ version: 2, source: "edit", note: "오탈자 수정", filename: v1.filename });
    expect((await listDocuments(id, "prd")).map((d) => d.version)).toEqual([2, 1]);
    expect((await getDocument(v1.id)).content).not.toContain("\n수정");
    await expect(saveDocumentEdit(id, "prd", "   ", "")).rejects.toThrow(/비어 있습니다/);
  });

  it("TC-P3-09 공유: 기본 수신자는 관련자, 발송하면 첨부와 함께 기록되고 3단계 완료", async () => {
    const id = await seedWithReply();
    await runCollectReview(id);
    await generatePrd(id);
    const def = await shareDefaults(id, "prd");
    expect(def.to).toHaveLength(4);
    expect(def.subject).toBe("[AX_AIDD시스템] 통화매니저 SSO 로그인 기능 개발에 대한 PRD가 생성되었습니다.");
    expect(def.document?.version).toBe(1);

    const r = await shareDocuments(id, "prd", { documentId: def.document!.id, to: def.to.slice(0, 2), subject: def.subject, text: def.text });
    expect(r.mail).toMatchObject({ kind: "share", status: "simulated", subject: def.subject });
    expect(r.mail.attachments[0].filename).toBe(def.document!.filename);
    expect(r.item.statuses.prd.status).toBe("done");
    expect((await listItemMails(id)).filter((m) => m.kind === "share")).toHaveLength(1);

    // 없는 문서는 공유할 수 없음
    await expect(shareDocuments(id, "prd", { documentId: 99999, to: ["a@x.com"], subject: "", text: "" })).rejects.toThrow();
  });

  it("TC-P3-11 LLM 선택: 운영에서 키가 없으면 오류, 로컬은 모의", async () => {
    vi.stubEnv("LLM_MOCK", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(getLlmProvider()).toBe("mock");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getLlmProvider()).toThrow(/GEMINI_API_KEY/);
    const st = await getReviewState(await seedWithReply());
    expect(st.llm).toContain("GEMINI_API_KEY");
  });
});
