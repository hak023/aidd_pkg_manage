/**
 * 전체 시나리오 자동 실행 (서비스 정의 7.3, D-02 자체 검증). 설계: docs/dev/P5_진행상황-완료.md
 * 시뮬레이터 메일 + 현재 LLM 설정(모의 또는 Gemini)으로 개발사항 하나를 1~7단계까지 진행하고 단계마다 확인한다.
 * 화면(설정 → 전체 시나리오 실행)과 자동 시험이 같은 함수를 쓴다.
 */
import type { StageKey } from "@/lib/db/schema";
import { getMailConfig } from "@/lib/mail/config";
import { generateDocReport } from "./docs";
import { listDocuments, generatePrd, runCollectReview } from "./prd";
import { getProgressState, sendProgressRequest } from "./progress";
import { DomainError } from "./errors";
import { injectSample, pollMail, sendCollectRequest } from "./mail";
import { createNode, getItemDetail, setStageStatus } from "./tree";
import { shareDefaults, shareDocuments } from "./docs";
import { getLlmProvider } from "@/lib/llm/provider";

export interface ScenarioStep {
  no: number;
  stage: StageKey;
  title: string;
  ok: boolean;
  detail: string;
  ms: number;
}

export interface ScenarioResult {
  itemId: number | null;
  itemName: string;
  llm: string;
  ok: boolean;
  steps: ScenarioStep[];
  totalMs: number;
}

export async function runScenario(): Promise<ScenarioResult> {
  if (getMailConfig().mode !== "simulator") {
    throw new DomainError(400, "전체 시나리오는 시뮬레이터 모드(SIMULATOR_MODE=true)에서만 실행할 수 있습니다.");
  }
  const llm = (() => {
    try {
      return getLlmProvider() === "mock" ? "모의 LLM" : "Gemini";
    } catch (e) {
      return e instanceof Error ? e.message : "LLM 설정 오류";
    }
  })();
  const t0 = Date.now();
  const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(5, 16).replace("T", " ");
  const itemName = `[시나리오 ${stamp}] 통화매니저 SSO 로그인 기능 개발`;
  const steps: ScenarioStep[] = [];
  let itemId: number | null = null;

  const step = async (no: number, stage: StageKey, title: string, fn: () => Promise<string>) => {
    const s = Date.now();
    try {
      const detail = await fn();
      const d = await getItemDetail(itemId!);
      const st = d.statuses[stage].status;
      const ok = st === "done";
      steps.push({ no, stage, title, ok, detail: ok ? detail : `${detail} · 단계 상태가 '${st}'임`, ms: Date.now() - s });
      return ok;
    } catch (e) {
      steps.push({ no, stage, title, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - s });
      return false;
    }
  };

  // 준비: 시나리오 전용 단위서비스/라벨링/개발사항
  const svc = await createNode({ type: "service", name: "시나리오 시험", parentId: null });
  const lbl = await createNode({ type: "label", name: "R181PKG_26.12", parentId: svc.id });
  const item = await createNode({
    type: "item",
    name: itemName,
    parentId: lbl.id,
    fields: { keywords: "통화매니저, SSO, 로그인, 통합인증" },
  });
  itemId = item.id;

  const plan: [number, StageKey, string, () => Promise<string>][] = [
    [
      1,
      "collect",
      "개발 내용 수집",
      async () => {
        await sendCollectRequest(itemId!);
        await injectSample("collect_reply", itemId!);
        const r = await pollMail();
        return `수집 요청 발송 → 회신 수신 (매칭 ${r.matched})`;
      },
    ],
    [
      2,
      "review",
      "수집 내용 검토",
      async () => {
        const rv = await runCollectReview(itemId!);
        if (rv.status !== "ok") throw new Error(`점검 실패: ${rv.error}`);
        const doc = await generatePrd(itemId!);
        const r = rv.result!;
        return `점검 ${rv.provider === "mock" ? "모의" : rv.model}: 질문 ${r.questions.length}개, 관련자 ${r.stakeholders.length}명 → PRD v${doc.version} 생성`;
      },
    ],
    [
      3,
      "prd",
      "PRD 작성·공유",
      async () => {
        const def = await shareDefaults(itemId!, "prd");
        if (!def.document) throw new Error("PRD가 없습니다.");
        const to = def.to.length ? def.to : ["scenario@example.com"];
        await shareDocuments(itemId!, "prd", { documentId: def.document.id, to, subject: def.subject, text: def.text });
        return `PRD v${def.document.version} 공유 (가상 발송 ${to.length}명)`;
      },
    ],
    [
      4,
      "arch",
      "Architecture 검토",
      async () => {
        await injectSample("architecture", itemId!);
        await pollMail();
        const [rep] = await listDocuments(itemId!, "arch_report");
        if (!rep) {
          // 자동 생성이 실패했으면 다시 시도해 원인을 드러낸다
          await generateDocReport(itemId!, "arch");
        }
        const [r] = await listDocuments(itemId!, "arch_report");
        return `설계서 자동 등록 → 검토 리포트 v${r.version} (${r.note})`;
      },
    ],
    [
      5,
      "qa",
      "QA(시험항목서) 검토",
      async () => {
        await injectSample("qa", itemId!);
        await pollMail();
        const [rep] = await listDocuments(itemId!, "qa_report");
        if (!rep) await generateDocReport(itemId!, "qa");
        const [r] = await listDocuments(itemId!, "qa_report");
        return `시험항목서 자동 등록 → 검토 리포트 v${r.version}`;
      },
    ],
    [
      6,
      "progress",
      "진행상황 체크",
      async () => {
        await sendProgressRequest(itemId!);
        await injectSample("progress_reply", itemId!);
        await pollMail();
        const st = await getProgressState(itemId!);
        if (!st.latest) throw new Error(`해석 실패: ${st.history[0]?.error ?? "회신 없음"}`);
        const launch = st.latest.milestones!.find((m) => m.name === "상용적용")!;
        const undecided = st.latest.milestones!.filter((m) => m.status === "미정").length;
        return `요청 발송 → 회신 해석 (${st.latest.provider === "rule" ? "규칙" : st.latest.model}): 상용적용 ${launch.end || "미정"}, 미정 ${undecided}건`;
      },
    ],
    [
      7,
      "done",
      "완료",
      async () => {
        await setStageStatus(itemId!, "done", "done", "전체 시나리오");
        return "완료 처리";
      },
    ],
  ];

  for (const [no, stage, title, fn] of plan) {
    const ok = await step(no, stage, title, fn);
    if (!ok) break; // 앞 단계가 실패하면 멈춘다
  }

  return {
    itemId,
    itemName,
    llm,
    ok: steps.length === plan.length && steps.every((s) => s.ok),
    steps,
    totalMs: Date.now() - t0,
  };
}
