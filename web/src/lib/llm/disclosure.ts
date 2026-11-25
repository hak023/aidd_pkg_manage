/**
 * 2~5단계의 작성·검토 방식 공개 (설계: docs/dev/P6_프롬프트-공개.md).
 * 지시문은 실제 호출에 쓰는 상수와 조립 함수에서 얻는다. 자료가 들어가는 자리만 자리 표시로 바꾼다.
 * 로그인한 사용자에게만 보여야 하므로 클라이언트 컴포넌트에서 값을 import하지 않는다 (타입만).
 */
import { DISCLOSURE_LABEL, type DisclosedStage } from "@/lib/domain/disclosure";
import { buildDocReviewPrompt, DOCREVIEW_SCHEMA, DOCREVIEW_SYSTEM, type ReviewKind } from "./docreview";
import { PRD_SYSTEM, renderPrdPrompt } from "./prd";
import { describeLlmRuntime, temperatureFor, type LlmTask } from "./provider";
import { buildReviewPrompt, REVIEW_SCHEMA, REVIEW_SYSTEM } from "./review";

export { isDisclosedStage, type DisclosedStage } from "@/lib/domain/disclosure";

/** 지시문에서 실행할 때 실제 자료로 바뀌는 자리 */
export const SLOT = {
  itemName: "{개발사항명}",
  itemPath: "{단위서비스 / 라벨링 / 개발사항명}",
  today: "{오늘 날짜}",
  replySubject: "{수집 회신 제목}",
  replyDate: "{수집 회신 수신일}",
  replyText: "{수집 회신 본문}",
  reviewJson: "{2단계 점검 결과 JSON}",
  qa: "{추가 확인 질문과 담당자 답 목록}",
  extraNote: "{담당자 보완 메모}",
  reqId: "{요구사항 ID}",
  reqText: "{요구사항 내용}",
  prd: "{PRD 본문}",
  archDoc: "{Architecture 문서 본문}",
  qaDoc: "{QA(시험항목서) 문서 본문}",
} as const;

export interface PromptDisclosureDTO {
  stage: DisclosedStage;
  /** 화면 제목 (점검 방식 / 작성 방식 / 검토 방식) */
  title: string;
  task: string;
  inputs: string[];
  system: string;
  prompt: string;
  responseFormat: { label: string; schema: string | null; note: string | null };
  temperature: number;
  codeSteps: string[];
  notes: string[];
  runtime: { provider: "gemini" | "mock" | "unset"; label: string; modelEnv: string };
}

const RETRY = "응답이 비었거나 형식이 틀리면 한 번 다시 요청합니다. Gemini가 오류 코드(키·권한·한도 등)를 돌려주면 다시 요청하지 않습니다.";

function runtimeOf(task: LlmTask): PromptDisclosureDTO["runtime"] {
  const r = describeLlmRuntime(task);
  const label =
    r.provider === "gemini"
      ? `Gemini · 모델 ${r.model ?? "자동 선택 (Flash-Lite 최신 안정 버전)"}`
      : r.provider === "mock"
        ? "모의 LLM (규칙 기반) · 지금 설정에서는 아래 지시문을 보내지 않고 규칙으로 결과를 만듭니다"
        : `LLM 미설정 · ${r.error ?? ""}`.trim();
  return { provider: r.provider, label, modelEnv: r.modelEnv };
}

function docReview(kind: ReviewKind): PromptDisclosureDTO {
  const arch = kind === "arch";
  const docName = arch ? "Architecture" : "QA(시험항목서)";
  return {
    stage: kind,
    ...DISCLOSURE_LABEL[kind],
    inputs: [
      "PRD 최신 버전 (앞 6만 자)",
      `등록된 ${docName} 문서 최신 버전 (앞 6만 자)`,
      "PRD 요구사항 표에서 뽑은 요구사항 목록 (FR-xx, NFR-xx마다 한 줄)",
    ],
    system: DOCREVIEW_SYSTEM,
    prompt: buildDocReviewPrompt(kind, [{ id: SLOT.reqId, text: SLOT.reqText }], SLOT.prd, arch ? SLOT.archDoc : SLOT.qaDoc, null),
    responseFormat: {
      label: "JSON (응답 스키마 지정)",
      schema: JSON.stringify(DOCREVIEW_SCHEMA, null, 2),
      note: "실행할 때 rows의 id는 요구사항 목록의 ID만 허용하고, 행 수는 요구사항 수와 같게 제한합니다. PRD에 FR/NFR 번호가 없으면 이 제한 없이 아래 스키마를 그대로 씁니다.",
    },
    temperature: temperatureFor("docreview"),
    codeSteps: [
      "PRD 표에서 FR-xx, NFR-xx 행을 뽑아 요구사항 목록을 만듭니다. 번호가 없으면 목록 자리에 “PRD 7장 요구사항을 직접 읽고 R-01부터 번호를 붙여 판정”하라는 문장을 넣습니다.",
      "응답을 검증합니다. 빠진 요구사항과 알 수 없는 판정은 “확인 불가”로 두고, “미반영”의 근거 위치는 “-”로 둡니다. 판정된 요구사항이 절반보다 적으면 형식 오류로 봅니다.",
      `${RETRY} 그래도 실패하면 리포트를 만들지 않습니다 (문서 등록과 단계는 유지).`,
      `검토 리포트 md는 LLM이 아니라 시스템이 판정 JSON으로 만듭니다: 요약 건수, 대조 표, ${arch ? "" : "시험 누락 점검, "}PRD에 없는 추가 내용, 개발사에 보낼 질문, 검토자 메모 칸, “문서상 대조 결과” 안내문.`,
      "문서를 등록하면 자동으로 실행하고, ‘리포트 다시 생성’을 누르면 최신 문서와 최신 PRD로 다시 실행합니다. PRD가 없으면 실행하지 않습니다.",
      "리포트를 편집해 저장하면 새 버전이 됩니다. 그 버전은 사람이 고친 내용을 포함합니다.",
    ],
    notes: [
      "4단계와 5단계는 같은 지시문을 씁니다. 문서 이름, 첫 줄의 판정 초점 문장, gaps 줄만 다릅니다.",
      ...(arch ? [] : ["QA 검토에는 Architecture 문서를 보내지 않습니다. 넣으면 설계서를 시험 근거로 인용하기 때문입니다."]),
    ],
    runtime: runtimeOf("docreview"),
  };
}

export function getPromptDisclosure(stage: DisclosedStage): PromptDisclosureDTO {
  if (stage === "arch" || stage === "qa") return docReview(stage);

  if (stage === "review") {
    return {
      stage,
      ...DISCLOSURE_LABEL.review,
      inputs: [
        "수집 회신 메일 본문 (선택한 회신, 기본은 최신). 회신 양식 구간만 꺼내 쓰고, 구간 표식이 없으면 본문 전체를 씁니다",
        "개발사항 이름과 경로",
      ],
      system: REVIEW_SYSTEM,
      prompt: buildReviewPrompt({ itemName: SLOT.itemName, path: SLOT.itemPath }, SLOT.replyText),
      responseFormat: { label: "JSON (응답 스키마 지정)", schema: JSON.stringify(REVIEW_SCHEMA, null, 2), note: null },
      temperature: temperatureFor("review"),
      codeSteps: [
        "응답을 검증합니다. 12개 항목을 양식 순서로 맞추고, 빠진 항목은 “확인 안 됨”, 알 수 없는 상태는 “부족”으로 둡니다. 항목이 6개보다 적으면 형식 오류로 봅니다.",
        `${RETRY} 그래도 실패하면 “점검 실패”로 기록하고 단계를 진행하지 않습니다.`,
        "점검 결과(항목별 상태, 관련자, 상충, 출처 없는 진술, 추가 확인 질문)를 저장해 아래 화면에 표시합니다. 2단계가 대기 상태면 진행중으로 바꿉니다.",
        "이 점검 결과와 담당자가 입력한 답·보완 메모가 3단계 PRD 작성의 입력이 됩니다.",
      ],
      notes: [],
      runtime: runtimeOf("review"),
    };
  }

  return {
    stage,
    ...DISCLOSURE_LABEL.prd,
    inputs: [
      "개발사항 이름",
      "수집 회신 본문과 제목·수신일 (2단계에서 점검한 회신)",
      "2단계 점검 결과 (JSON)",
      "추가 확인 질문과 담당자 답 (“Q1. [항목] 질문 / A1. 답” 형식, 답이 없으면 “(답 없음)”)",
      "담당자 보완 메모 (없으면 “(없음)”)",
    ],
    system: PRD_SYSTEM,
    prompt: renderPrdPrompt({
      itemName: SLOT.itemName,
      today: SLOT.today,
      replySubject: SLOT.replySubject,
      replyDate: SLOT.replyDate,
      replyText: SLOT.replyText,
      reviewJson: SLOT.reviewJson,
      qa: SLOT.qa,
      extraNote: SLOT.extraNote,
    }),
    responseFormat: { label: "markdown (1~12장 본문)", schema: null, note: null },
    temperature: temperatureFor("prd"),
    codeSteps: [
      "응답을 정리합니다. 코드 블록 감싸기, 최상위 제목, 1장 앞의 글, 변경 이력이 섞여 오면 지웁니다.",
      `12개 장이 모두 있는지 검사합니다. 빠진 장이 있으면 형식 오류로 봅니다. ${RETRY} 그래도 실패하면 PRD를 만들지 않습니다.`,
      "머리글(제목, 단위서비스·라벨링·개발사항 ID, 버전, 작성일, 근거 회신)과 변경 이력 표는 LLM이 아니라 시스템이 붙입니다.",
      "새 버전으로 저장합니다. 2단계를 완료로 바꾸고, 3단계가 대기 상태면 진행중으로 바꿉니다.",
      "PRD를 편집해 저장하면 새 버전이 됩니다. 그 버전은 사람이 고친 내용을 포함합니다.",
    ],
    notes: [],
    runtime: runtimeOf("prd"),
  };
}
