/** 시뮬레이터 샘플 메일 종류 (화면에서도 쓰므로 본문 데이터와 분리) */
export type SampleKey =
  | "collect_reply"
  | "architecture"
  | "qa"
  | "progress_reply"
  | "progress_reply_update"
  | "progress_reply_prose"
  | "untagged_doc";

export const SAMPLE_LABEL: Record<SampleKey, string> = {
  collect_reply: "① Copilot 수집 회신",
  architecture: "② 개발사 Architecture md 전달",
  qa: "③ 개발사 QA(시험항목서) md 전달",
  progress_reply: "④ 진행상황 회신",
  progress_reply_update: "④-2 진행상황 재회신 (일정 변경)",
  progress_reply_prose: "④-3 진행상황 회신 (표 없이 문장, L6 확인용)",
  untagged_doc: "⑤ 태그 없는 전달 메일 (미분류 확인용)",
};

export function isSampleKey(v: unknown): v is SampleKey {
  return typeof v === "string" && v in SAMPLE_LABEL;
}
