// 시험 문서: docs/test/P6_시험.md
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPromptDisclosure, SLOT } from "@/lib/llm/disclosure";
import { buildDocReviewPrompt } from "@/lib/llm/docreview";
import { buildPrdPrompt, kstDate, mockPrdBody, type PrdInput } from "@/lib/llm/prd";
import { runDocReview, runPrd, runReview } from "@/lib/llm/provider";
import { buildReviewPrompt, mockReview } from "@/lib/llm/review";

const REPLY = "## 01. 관련자\n홍길동 (서비스기획팀)\n## 06. 요구사항 (기능 / 비기능)\nOIDC 기반 SSO 로그인";

const prdInput = (): PrdInput => ({
  itemName: "통화매니저 SSO 로그인",
  code: "DEV-0001",
  service: "통화매니저",
  label: "R181PKG_26.12",
  version: 1,
  reply: { subject: "RE: 수집 요청", receivedAt: "2026-11-20T03:00:00.000Z", text: REPLY },
  review: mockReview(REPLY),
  answers: [
    { section: "06", question: "응답 시간 기준은?", answer: "2초" },
    { section: "", question: "일정은?", answer: " " },
  ],
  extraNote: "보안 검토 필요",
  now: new Date("2026-11-25T01:00:00.000Z"),
});

/** 공개 지시문의 자리 표시에 실제 자료를 넣는다 */
const fill = (text: string, values: Record<string, string>) =>
  Object.entries(values).reduce((acc, [slot, v]) => acc.split(slot).join(v), text);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("P6 프롬프트 공개", () => {
  it("TC-P6-01 공개 지시문에 자료를 넣으면 실제로 조립한 프롬프트와 글자까지 같음 (2~5단계)", () => {
    expect(
      fill(getPromptDisclosure("review").prompt, {
        [SLOT.itemName]: "통화매니저 SSO 로그인",
        [SLOT.itemPath]: "통화매니저 / R181PKG_26.12 / 통화매니저 SSO 로그인",
        [SLOT.replyText]: REPLY,
      }),
    ).toBe(buildReviewPrompt({ itemName: "통화매니저 SSO 로그인", path: "통화매니저 / R181PKG_26.12 / 통화매니저 SSO 로그인" }, REPLY));

    const i = prdInput();
    expect(
      fill(getPromptDisclosure("prd").prompt, {
        [SLOT.itemName]: i.itemName,
        [SLOT.today]: kstDate(i.now),
        [SLOT.replySubject]: i.reply.subject,
        [SLOT.replyDate]: kstDate(i.reply.receivedAt),
        [SLOT.replyText]: i.reply.text,
        [SLOT.reviewJson]: JSON.stringify(i.review),
        [SLOT.qa]: "Q1. [06] 응답 시간 기준은?\nA1. 2초\nQ2. [-] 일정은?\nA2. (답 없음)",
        [SLOT.extraNote]: "보안 검토 필요",
      }),
    ).toBe(buildPrdPrompt(i));

    const reqs = [{ id: "FR-01", text: "OIDC 기반 SSO 로그인" }];
    for (const [kind, docSlot] of [
      ["arch", SLOT.archDoc],
      ["qa", SLOT.qaDoc],
    ] as const) {
      expect(
        fill(getPromptDisclosure(kind).prompt, {
          [SLOT.reqId]: "FR-01",
          [SLOT.reqText]: "OIDC 기반 SSO 로그인",
          [SLOT.prd]: "# PRD 본문",
          [docSlot]: "# 개발사 문서",
        }),
      ).toBe(buildDocReviewPrompt(kind, reqs, "# PRD 본문", "# 개발사 문서", null));
    }
  });

  it("TC-P6-02 Gemini로 보내는 요청의 시스템 지시문·temperature·응답 형식이 공개 내용과 같음", async () => {
    vi.stubEnv("LLM_MOCK", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test-flash-lite");
    const i = prdInput();
    const sent: { systemInstruction: { parts: { text: string }[] }; generationConfig: Record<string, unknown> }[] = [];
    const replies = [
      JSON.stringify(i.review),
      mockPrdBody(i),
      JSON.stringify({ rows: [{ id: "R-01", verdict: "반영", location: "3장", note: "ok" }], extras: [], questions: [], gaps: [] }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json({ candidates: [{ content: { parts: [{ text: replies[sent.length - 1] }] } }] });
      }),
    );
    await runReview({ itemName: i.itemName, path: "통화매니저" }, REPLY);
    await runPrd(i);
    await runDocReview("arch", [], "# PRD", "# 설계", null);

    expect(sent).toHaveLength(3);
    (["review", "prd", "arch"] as const).forEach((stage, n) => {
      const d = getPromptDisclosure(stage);
      expect(sent[n].systemInstruction.parts[0].text).toBe(d.system);
      expect(sent[n].generationConfig.temperature).toBe(d.temperature);
      expect(sent[n].generationConfig.responseSchema).toEqual(d.responseFormat.schema ? JSON.parse(d.responseFormat.schema) : undefined);
    });
    expect(getPromptDisclosure("qa").system).toBe(getPromptDisclosure("arch").system);
  });

  it("TC-P6-03 실행 방식 표시: 모의 LLM은 지시문을 보내지 않는다고 알리고, Gemini는 작업별 모델 설정을 따름", () => {
    vi.stubEnv("LLM_MOCK", "true");
    expect(getPromptDisclosure("prd").runtime).toMatchObject({ provider: "mock", modelEnv: "GEMINI_MODEL_PRD" });
    expect(getPromptDisclosure("prd").runtime.label).toContain("보내지 않고");

    vi.stubEnv("LLM_MOCK", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "");
    vi.stubEnv("GEMINI_MODEL_PRD", "");
    expect(getPromptDisclosure("prd").runtime.label).toContain("자동 선택");
    vi.stubEnv("GEMINI_MODEL", "gemini-common");
    vi.stubEnv("GEMINI_MODEL_DOCREVIEW", "gemini-docreview");
    expect(getPromptDisclosure("review").runtime.label).toContain("gemini-common");
    expect(getPromptDisclosure("qa").runtime.label).toContain("gemini-docreview");

    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(getPromptDisclosure("arch").runtime.provider).toBe("unset");
  });
});
