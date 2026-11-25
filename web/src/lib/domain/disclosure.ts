/** 2~5단계 작성·검토 방식의 제목. 프롬프트 원문은 담지 않으므로 클라이언트에서 가져와도 된다. */
export const DISCLOSED_STAGES = ["review", "prd", "arch", "qa"] as const;
export type DisclosedStage = (typeof DISCLOSED_STAGES)[number];

export function isDisclosedStage(v: unknown): v is DisclosedStage {
  return typeof v === "string" && (DISCLOSED_STAGES as readonly string[]).includes(v);
}

export const DISCLOSURE_LABEL: Record<DisclosedStage, { title: string; task: string }> = {
  review: { title: "점검 방식", task: "L1 수집 회신 구조화·점검" },
  prd: { title: "작성 방식", task: "L2 PRD 생성" },
  arch: { title: "검토 방식", task: "L4 Architecture 점검" },
  qa: { title: "검토 방식", task: "L5 QA 점검" },
};
