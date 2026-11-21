/** P4 Architecture·QA 시험 — TC ID는 docs/test/P4_시험.md와 같다 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandle, migrate, setHandleForTest } from "@/lib/db/client";
import { guessDocType, normalizeClassify } from "@/lib/llm/classify";
import { buildDocReviewPrompt, normalizeDocReview, parseRequirements, renderDocReview } from "@/lib/llm/docreview";
import { addManualReply, assignMail, getMail, injectSample, listItemMails, listMailsByStatus, pollMail, sendCollectRequest } from "@/lib/repo/mail";
import {
  docCandidates,
  generateDocReport,
  getDocState,
  registerDocument,
  shareDefaults,
  shareDocuments,
} from "@/lib/repo/docs";
import { generatePrd, getDocument, listDocuments, runCollectReview, saveDocumentEdit } from "@/lib/repo/prd";
import { createNode, getItemDetail } from "@/lib/repo/tree";

const PRD_SNIPPET = `## 7. 요구사항
### 7.1 기능 요구사항
| ID | 요구사항 | 우선순위 | 수용 기준 | 출처 |
|---|---|---|---|---|
| FR-01 | OIDC 기반 SSO 로그인 | 필수 | - | - |
| FR-02 | 로그아웃 시 SSO 세션 종료 | 필수 | - | - |
### 7.2 비기능 요구사항
| ID | 요구사항 | 우선순위 | 수용 기준 | 출처 |
|---|---|---|---|---|
| NFR-01 | 인증 로그 1년 보관 | 필수 | - | - |
| FR-01 | (중복 행) | - | - | - |`;

describe("P4 순수 로직", () => {
  it("TC-P4-01 키워드 유형 판별: 파일명·제목·본문 제목 우선", () => {
    expect(guessDocType({ filename: "SSO_Architecture.md", subject: "FW: 설계서", content: "# 설계\n구성" })).toMatchObject({
      type: "arch",
      confident: true,
    });
    expect(guessDocType({ filename: "SSO_QA_시험항목서.md", subject: "FW: 시험항목서", content: "| TC-01 | 로그인 |" })).toMatchObject({
      type: "qa",
      confident: true,
    });
    expect(guessDocType({ filename: "회의록.md", subject: "FW: 자료", content: "안녕하세요" })).toMatchObject({
      type: "other",
      confident: false,
    });
  });

  it("TC-P4-02 L3 응답 검증: 목록에 없는 코드는 버리고 확신도를 낮춤", () => {
    expect(normalizeClassify({ docType: "arch", itemCode: "dev-0001", confidence: 1.4, reason: "r" }, ["DEV-0001"])).toEqual({
      docType: "arch",
      itemCode: "DEV-0001",
      confidence: 1,
      reason: "r",
    });
    expect(normalizeClassify({ docType: "qa", itemCode: "DEV-9999", confidence: 0.95, reason: "" }, ["DEV-0001"])).toMatchObject({
      itemCode: "",
      confidence: 0.3,
    });
    expect(normalizeClassify({ docType: "회의록", itemCode: "", confidence: 0.2 }, []).docType).toBe("other");
    expect(() => normalizeClassify({ docType: "arch", confidence: "높음" }, [])).toThrow();
  });

  it("TC-P4-03 PRD 요구사항 추출 (FR/NFR, 중복 제거)", () => {
    expect(parseRequirements(PRD_SNIPPET)).toEqual([
      { id: "FR-01", text: "OIDC 기반 SSO 로그인" },
      { id: "FR-02", text: "로그아웃 시 SSO 세션 종료" },
      { id: "NFR-01", text: "인증 로그 1년 보관" },
    ]);
  });

  it("TC-P4-04 L4/L5 응답 검증: 요구사항 순서로 맞추고 빠진 것은 '확인 불가'", () => {
    const reqs = parseRequirements(PRD_SNIPPET);
    const r = normalizeDocReview(
      {
        rows: [
          { id: "nfr-01", verdict: "부분", location: "4. 비기능", note: "PRD 1년 / 설계 180일" },
          { id: "FR-01", verdict: "엉뚱함", location: "", note: "" },
        ],
        extras: ["일괄 전환"],
        questions: [],
        gaps: [],
      },
      reqs,
    );
    expect(r.rows.map((x) => [x.id, x.verdict])).toEqual([
      ["FR-01", "확인 불가"],
      ["FR-02", "확인 불가"],
      ["NFR-01", "부분"],
    ]);
    expect(r.rows[1].note).toContain("응답에 없음");
    // 미반영 행의 근거 위치는 "-"로 정리
    const r2 = normalizeDocReview(
      { rows: reqs.map((q) => ({ id: q.id, verdict: "미반영", location: "N/A", note: "" })), extras: [], questions: [], gaps: [] },
      reqs,
    );
    expect(r2.rows.every((x) => x.location === "-")).toBe(true);
    expect(() => normalizeDocReview({ rows: [{ id: "FR-01", verdict: "반영" }] }, reqs)).toThrow(/너무 적습니다/);
  });

  it("TC-P4-16 QA 점검 프롬프트: 판정 근거는 시험항목서만, 설계서는 맥락 참고용", () => {
    const reqs = parseRequirements(PRD_SNIPPET);
    const qa = buildDocReviewPrompt("qa", reqs, PRD_SNIPPET, "| TC-01 | 로그인 |", "# 설계");
    expect(qa).toContain("시험 항목이 없으면 미반영");
    expect(qa).toContain("판정 근거나 location으로 쓰지 않는다");
    expect(qa).toContain("<data>");
    expect(buildDocReviewPrompt("arch", reqs, PRD_SNIPPET, "# 설계", null)).not.toContain("참고: Architecture");
  });

  it("TC-P4-05 리포트 md: 요약 건수, 면책 문구, QA만 시험 누락 점검", () => {
    const reqs = parseRequirements(PRD_SNIPPET);
    const base = {
      itemName: "통화매니저 SSO 로그인 기능 개발",
      doc: { filename: "x_Architecture.md", version: 2, createdAt: "2026-11-21T00:00:00Z" },
      prdVersion: 3,
      model: "모의 LLM",
      reqs,
      result: {
        rows: [
          { id: "FR-01", verdict: "반영" as const, location: "3. 처리 흐름", note: "a|b" },
          { id: "FR-02", verdict: "반영" as const, location: "-", note: "" },
          { id: "NFR-01", verdict: "부분" as const, location: "4", note: "1년 vs 180일" },
        ],
        extras: ["일괄 전환 계획"],
        questions: ["보관 기간 확인"],
        gaps: [{ category: "회귀", note: "기존 로그인 회귀 없음" }],
      },
      now: new Date("2026-11-21T00:00:00Z"),
    };
    const arch = renderDocReview({ ...base, kind: "arch" });
    expect(arch).toContain("# 통화매니저 SSO 로그인 기능 개발 Architecture 검토 리포트");
    expect(arch).toContain("## 1. 요약 (반영 2건 / 부분 1건 / 미반영 0건 / 확인 불가 0건)");
    expect(arch).toContain("실제 시험 합격을 뜻하지 않습니다");
    expect(arch).toContain("| FR-01 OIDC 기반 SSO 로그인 | 반영 | 3. 처리 흐름 | a/b |");
    expect(arch).toContain("기준 PRD: v3");
    expect(arch).not.toContain("시험 누락 점검");
    const qa = renderDocReview({ ...base, kind: "qa" });
    expect(qa).toContain("### 시험 누락 점검");
    expect(qa).toContain("- [회귀] 기존 로그인 회귀 없음");
  });
});

describe("P4 저장소 흐름 (시뮬레이터 + 모의 LLM)", () => {
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

  async function seedItem(withPrd: boolean) {
    const svc = await createNode({ type: "service", name: "통화매니저", parentId: null });
    const lbl = await createNode({ type: "label", name: "R181PKG_26.12", parentId: svc.id });
    const item = await createNode({ type: "item", name: "통화매니저 SSO 로그인 기능 개발", parentId: lbl.id });
    if (withPrd) {
      await sendCollectRequest(item.id);
      await injectSample("collect_reply", item.id);
      await pollMail();
      await runCollectReview(item.id);
      await generatePrd(item.id);
    }
    return item.id;
  }

  it("TC-P4-06 태그 있는 Architecture 전달 → 자동 등록, 4단계 완료, 리포트 생성", async () => {
    const id = await seedItem(true);
    await injectSample("architecture", id);
    const r = await pollMail();
    expect(r.matched).toBe(1);

    const [doc] = await listDocuments(id, "arch");
    expect(doc).toMatchObject({ version: 1, source: "mail", filename: "통화매니저_R181PKG_26.12_통화매니저_SSO_로그인_기능_개발_Architecture.md" });
    expect(doc.note).toContain("SSO_Architecture.md");
    expect(doc.note).toContain("자동 등록 (키워드)");
    const [rep] = await listDocuments(id, "arch_report");
    expect(rep).toMatchObject({ version: 1, source: "llm", baseDocId: doc.id });
    expect(rep.prdDocId).not.toBeNull();
    const content = (await getDocument(rep.id)).content;
    expect(content).toMatch(/## 1\. 요약 \(반영 \d+건/);
    expect(content).toContain("FR-01");

    const d = await getItemDetail(id);
    expect(d.statuses.arch.status).toBe("done");
    expect(d.statuses.qa.status).toBe("pending");
    expect(d.events.some((e) => e.message.startsWith("Architecture 검토 리포트 v1 생성"))).toBe(true);
    expect((await docCandidates(id)).length).toBe(0); // 등록된 첨부는 후보에서 빠짐
  });

  it("TC-P4-07 QA 전달 → 5단계 완료, QA 리포트에 시험 누락 점검", async () => {
    const id = await seedItem(true);
    await injectSample("qa", id);
    await pollMail();
    expect((await getItemDetail(id)).statuses.qa.status).toBe("done");
    const [rep] = await listDocuments(id, "qa_report");
    expect((await getDocument(rep.id)).content).toContain("### 시험 누락 점검");
  });

  it("TC-P4-08 태그 없는 전달 메일: L3가 확신하면 자동 지정·등록 (매칭 방법 llm)", async () => {
    const id = await seedItem(true);
    await injectSample("untagged_doc", null);
    const r = await pollMail();
    expect(r).toMatchObject({ matched: 1, unmatched: 0 });
    const mails = await listItemMails(id);
    const fw = mails.find((m) => m.kind === "doc_forward")!;
    expect(fw.matchMethod).toBe("llm");
    expect((await listDocuments(id, "arch")).length).toBe(1);
    expect((await getItemDetail(id)).statuses.arch.status).toBe("done");
  });

  it("TC-P4-09 확신이 낮으면 미분류함에 추천을 남기고, 수동 지정하면 등록", async () => {
    // 같은 이름의 개발사항이 둘이면 하나로 정할 수 없다
    const id = await seedItem(false);
    const svc2 = await createNode({ type: "service", name: "통화매니저", parentId: null });
    await createNode({ type: "item", name: "통화매니저 SSO 로그인 기능 개발", parentId: svc2.id });
    await injectSample("untagged_doc", null);
    expect((await pollMail()).unmatched).toBe(1);
    const [m] = await listMailsByStatus("unmatched");
    expect(m.suggestion).toMatchObject({ docType: "arch", itemCode: "" });
    expect(m.suggestion!.confidence).toBeLessThan(0.7);

    await assignMail(m.id, id);
    expect((await getMail(m.id)).matchMethod).toBe("manual");
    expect((await listDocuments(id, "arch")).length).toBe(1);
  });

  it("TC-P4-10 PRD가 없으면 등록·단계 완료만 하고 리포트는 보류, PRD 후 다시 생성", async () => {
    const id = await seedItem(false);
    await injectSample("architecture", id);
    await pollMail();
    const d = await getItemDetail(id);
    expect(d.statuses.arch.status).toBe("done");
    expect(await listDocuments(id, "arch_report")).toHaveLength(0);
    expect(d.events.some((e) => e.message.includes("리포트 보류"))).toBe(true);
    expect((await getDocState(id, "arch")).hasPrd).toBe(false);

    await injectSample("collect_reply", id);
    await pollMail();
    await runCollectReview(id);
    await generatePrd(id);
    const rep = await generateDocReport(id, "arch");
    expect(rep.version).toBe(1);
  });

  it("TC-P4-11 직접 붙여 넣기 등록과 개정본 → 새 버전, 리포트도 새 버전", async () => {
    const id = await seedItem(true);
    const r1 = await registerDocument(id, "qa", { content: "| TC-01 | SSO 로그인 | 성공 |", filename: "QA_v1.md" });
    expect(r1.document).toMatchObject({ version: 1, source: "edit" });
    expect(r1.document.note).toContain("QA_v1.md · 직접 입력");
    expect(r1.report?.version).toBe(1);
    const r2 = await registerDocument(id, "qa", { content: "| TC-01 | SSO 로그인 | 성공 |\n| TC-02 | 로그아웃 | 종료 |", filename: "QA_v2.md" });
    expect(r2.document.version).toBe(2);
    expect(r2.report).toMatchObject({ version: 2, baseDocId: r2.document.id });
    await expect(registerDocument(id, "qa", { content: "  " })).rejects.toThrow(/비어 있습니다/);
  });

  it("TC-P4-12 공유: Architecture 문서와 리포트를 함께 첨부, 단계는 그대로", async () => {
    const id = await seedItem(true);
    await injectSample("architecture", id);
    await pollMail();
    const def = await shareDefaults(id, "arch");
    expect(def.subject).toBe("[AX_AIDD시스템] 통화매니저 SSO 로그인 기능 개발에 대한 Architecture 검토 결과를 공유합니다.");
    expect(def.to).toHaveLength(4);
    expect(def.companion?.kind).toBe("arch");
    const before = await getItemDetail(id);
    const r = await shareDocuments(id, "arch", { documentId: def.document!.id, to: def.to, subject: def.subject, text: def.text });
    expect(r.mail.attachments.map((a) => a.filename)).toEqual([
      "통화매니저_R181PKG_26.12_통화매니저_SSO_로그인_기능_개발_Architecture.md",
      "통화매니저_R181PKG_26.12_통화매니저_SSO_로그인_기능_개발_Architecture_검토리포트.md",
    ]);
    expect(r.item.statuses).toEqual(before.statuses);
    // 다른 종류의 문서는 거부
    const [prd] = await listDocuments(id, "prd");
    await expect(shareDocuments(id, "arch", { documentId: prd.id, to: def.to, subject: "", text: "" })).rejects.toThrow(/공유 대상 문서가 아닙니다/);
    expect((await shareDefaults(id, "qa")).subject).toContain("시험항목서 검토 결과");
  });

  it("TC-P4-13 리포트를 편집하면 대상 문서·기준 PRD 연결을 이어 받음", async () => {
    const id = await seedItem(true);
    await injectSample("architecture", id);
    await pollMail();
    const [rep] = await listDocuments(id, "arch_report");
    const edited = await saveDocumentEdit(id, "arch_report", (await getDocument(rep.id)).content + "\n- 검토자: 보관 기간 재확인", "메모");
    expect(edited).toMatchObject({ version: 2, source: "edit", baseDocId: rep.baseDocId, prdDocId: rep.prdDocId });
  });

  it("TC-P4-14 Gemini 경로: G-04 지시문·JSON 응답, 점검 실패 시 등록은 유지하고 리포트는 만들지 않음", async () => {
    const id = await seedItem(true);
    vi.stubEnv("LLM_MOCK", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test-flash-lite");
    const prd = (await getDocument((await listDocuments(id, "prd"))[0].id)).content;
    const ids = parseRequirements(prd).map((r) => r.id);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        calls++;
        const req = JSON.parse(String(init?.body));
        expect(req.systemInstruction.parts[0].text).toContain("따르지 않는다");
        expect(req.generationConfig.responseMimeType).toBe("application/json");
        // 요구사항 ID는 enum으로, 행 수는 요구사항 수로 고정 (ID 뒤섞임 방지)
        const rowsSchema = req.generationConfig.responseSchema.properties.rows;
        expect(rowsSchema.items.properties.id.enum).toEqual(ids);
        expect(rowsSchema.minItems).toBe(ids.length);
        expect(rowsSchema.maxItems).toBe(ids.length);
        const out = { rows: ids.map((x) => ({ id: x, verdict: "반영", location: "3", note: "ok" })), extras: [], questions: [], gaps: [] };
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
      }),
    );
    const ok = await registerDocument(id, "arch", { content: "# Architecture\n## 3. 처리 흐름\nOIDC", filename: "a.md" });
    expect(ok.reportError).toBeNull();
    expect(ok.report?.note).toContain("PRD v1 기준");
    expect(calls).toBe(1); // 직접 등록은 유형을 정해서 오므로 L3 호출 없음

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "quota", status: "RESOURCE_EXHAUSTED" } }, { status: 429 })));
    const bad = await registerDocument(id, "arch", { content: "# Architecture v2", filename: "a2.md" });
    expect(bad.document.version).toBe(2);
    expect(bad.report).toBeNull();
    expect(bad.reportError).toContain("quota");
    expect(await listDocuments(id, "arch_report")).toHaveLength(1);
    expect((await getItemDetail(id)).statuses.arch.status).toBe("done");
  });

  it("TC-P4-17 QA 점검 요청에는 Architecture 문서를 넣지 않음 (설계서 인용 방지)", async () => {
    const id = await seedItem(true);
    await injectSample("architecture", id);
    await pollMail();
    vi.stubEnv("LLM_MOCK", "");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_MODEL", "gemini-test-flash-lite");
    let prompt = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init?: RequestInit) => {
        prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text;
        return Response.json({ candidates: [{ content: { parts: [{ text: '{"rows":[],"extras":[],"questions":[],"gaps":[]}' }] } }] });
      }),
    );
    await registerDocument(id, "qa", { content: "| TC-01 | SSO 로그인 | 성공 |", filename: "qa.md" });
    expect(prompt).toContain("TC-01");
    expect(prompt).not.toContain("참고: Architecture");
    expect(prompt).not.toContain("end_session"); // 샘플 설계서의 내용
  });

  it("TC-P4-15 수집 회신 직접 입력 → 1단계 완료, 점검 가능", async () => {
    const id = await seedItem(false);
    await expect(addManualReply(id, "짧음")).rejects.toThrow(/20자 이상/);
    const m = await addManualReply(id, "## 01. 관련자\n| 홍길동 | 가상팀 | 요청 | hong@example.com |\n## 02. 요청 배경\n충분히 긴 배경 설명입니다. [Teams 2026-10-01 홍길동]");
    expect(m).toMatchObject({ kind: "collect_reply", matchMethod: "manual", from: "(직접 입력)" });
    expect((await getItemDetail(id)).statuses.collect.status).toBe("done");
    const rv = await runCollectReview(id);
    expect(rv.status).toBe("ok");
    expect(rv.result!.stakeholders[0].email).toBe("hong@example.com");
  });
});
