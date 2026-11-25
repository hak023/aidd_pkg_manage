import type { StageKey, StageStatus } from "@/lib/db/schema";

export interface StageDef {
  key: StageKey;
  no: number;
  label: string;
  /** 이 단계에서 일어나는 일 (단계 그래프 아래 설명) */
  summary: string;
  /** 사용자가 할 일 */
  userAction: string;
  /** 시스템이 하는 일 */
  systemAction: string;
  /** 완료 조건 */
  doneWhen: string;
  /** 이 단계의 자동화가 구현되는 개발 단계 */
  availableIn: "P1" | "P2" | "P3" | "P4" | "P5";
}

export const STAGES: StageDef[] = [
  {
    key: "collect",
    no: 1,
    label: "개발 내용 수집",
    summary: "회사 메일로 수집 요청을 보내고, Copilot이 정리한 회신을 기다립니다.",
    userAction: "‘수집 요청 메일 보내기’를 누릅니다. 회사 PC의 Outlook에서 Copilot에게 “메일 내용 회신내용 작성해줘”라고 요청한 뒤, 결과를 검토하고 회신합니다.",
    systemAction: "개발사항 태그가 붙은 수집 요청 메일을 지정된 회사 주소로 보내고, 회신이 오면 자동으로 등록합니다.",
    doneWhen: "태그가 맞는 회신 메일이 수신되면 완료됩니다.",
    availableIn: "P2",
  },
  {
    key: "review",
    no: 2,
    label: "수집 내용 검토",
    summary: "LLM이 회신 내용을 12개 항목으로 정리하고, 부족하거나 상충하는 부분을 표시합니다.",
    userAction: "점검 결과와 추가 확인 질문을 보고, 필요한 내용을 텍스트로 보완합니다.",
    systemAction: "회신을 구조화하고 항목별 채움 상태, 출처 없는 진술, [상충] 항목, 추가 확인 질문을 보여 줍니다.",
    doneWhen: "‘PRD 생성’을 실행하면 완료됩니다.",
    availableIn: "P3",
  },
  {
    key: "prd",
    no: 3,
    label: "PRD 작성·공유",
    summary: "수집 내용과 보완 내용으로 PRD.md를 만들고 관련자에게 공유합니다.",
    userAction: "PRD를 확인·편집한 뒤 ‘공유’를 누르고, 수신자를 확인합니다.",
    systemAction: "{단위서비스}_{라벨링}_{개발사항}_PRD.md를 만들고 버전을 기록합니다. 공유하면 md 파일을 첨부해 메일을 보냅니다.",
    doneWhen: "PRD 공유 메일을 보내면 완료됩니다.",
    availableIn: "P3",
  },
  {
    key: "arch",
    no: 4,
    label: "Architecture 검토",
    summary: "개발사의 Architecture md를 받아 PRD 반영 여부를 점검합니다.",
    userAction: "개발사로부터 architecture.md 파일을 요청합니다. 점검 리포트를 확인·편집하고 공유합니다.",
    systemAction: "수신된 md를 분류해 자동 등록하고, 요구사항별 반영 여부와 추가 확인 사항을 담은 검토 리포트를 만듭니다.",
    doneWhen: "이 개발사항의 Architecture md가 등록되면 완료됩니다.",
    availableIn: "P4",
  },
  {
    key: "qa",
    no: 5,
    label: "QA(시험항목서) 검토",
    summary: "개발사의 시험항목서(QA md)를 받아 요구사항별 시험 커버리지를 점검합니다.",
    userAction: "개발사로부터 qa.md 파일을 요청합니다. 점검 리포트를 확인·편집하고 공유합니다.",
    systemAction: "수신된 md를 분류해 자동 등록하고, 요구사항별 시험 항목 대응과 누락(예외·비기능·회귀)을 점검합니다.",
    doneWhen: "이 개발사항의 QA md가 등록되면 완료됩니다.",
    availableIn: "P4",
  },
  {
    key: "progress",
    no: 6,
    label: "진행상황 체크",
    summary: "회사 메일로 진행상황을 요청하고, 마일스톤과 날짜를 받아 표시합니다.",
    userAction: "‘진행상황 요청 메일 보내기’를 누르고, 회사 PC에서 Copilot 회신을 보냅니다. 확인한 내용을 공유할 수 있습니다.",
    systemAction: "개발중·개발검증시험·운용검증시험·상용적용의 상태와 날짜(예정 포함)를 정리합니다. 값이 없으면 ‘미정’으로 표시합니다.",
    doneWhen: "진행상황 회신이 수신되면 완료됩니다. 여러 번 반복할 수 있습니다.",
    availableIn: "P5",
  },
  {
    key: "done",
    no: 7,
    label: "완료",
    summary: "개발사항을 완료 상태로 바꿉니다.",
    userAction: "‘완료’ 버튼을 누릅니다.",
    systemAction: "완료 일시를 기록합니다.",
    doneWhen: "‘완료’ 버튼을 누르면 완료됩니다.",
    availableIn: "P1",
  },
];

export const STAGE_KEYS = STAGES.map((s) => s.key);

export const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "대기",
  in_progress: "진행중",
  done: "완료",
};

export function isStageKey(v: unknown): v is StageKey {
  return typeof v === "string" && (STAGE_KEYS as string[]).includes(v);
}

export function isStageStatus(v: unknown): v is StageStatus {
  return v === "pending" || v === "in_progress" || v === "done";
}

/**
 * 현재 단계: 완료되지 않은 단계 중 가장 앞의 단계 (Q-04: 순서는 강제하지 않음).
 * 모두 완료면 'done'.
 */
export function currentStage(statuses: Partial<Record<StageKey, StageStatus>>): StageKey {
  if (statuses.done === "done") return "done";
  for (const s of STAGES) {
    if (statuses[s.key] !== "done") return s.key;
  }
  return "done";
}

export function stageDef(key: StageKey): StageDef {
  return STAGES.find((s) => s.key === key)!;
}
