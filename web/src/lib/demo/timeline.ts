/**
 * 시연 시나리오의 일정. 7개 단계 스냅샷이 모두 같은 일정을 쓴다 (같은 메일·문서는 같은 날짜).
 * 기준 일정은 R164PKG_26.12의 실제 달력 날짜이고, 초기화 시점이 완료 일시보다 이르면
 * 완료가 과거가 되도록 전체 일정을 주 단위로 앞당긴다 (요일 유지).
 */
import { kstDate } from "@/lib/llm/prd";

/** 한국 시간 기준 "YYYY-MM-DD HH:mm" */
const BASE = {
  // 사내 논의 (수집 회신·PRD 히스토리의 출처 일자)
  h1: "2026-09-07 10:12",
  h2: "2026-09-10 14:00",
  h3: "2026-09-15 16:40",
  h4: "2026-09-17 11:05",
  h5: "2026-09-22 15:00",
  h6: "2026-09-29 09:48",
  // 1단계 수집
  created: "2026-09-30 09:12",
  collectReq: "2026-09-30 09:15",
  collectReply: "2026-09-30 14:38",
  // 2단계 점검·보완
  review: "2026-09-30 14:41",
  firstAnswer: "2026-09-30 15:02",
  answers: "2026-10-01 10:05",
  // 3단계 PRD
  prd1: "2026-10-01 10:22",
  prd2: "2026-10-02 11:10",
  prdShare: "2026-10-02 13:30",
  kickoff: "2026-10-06 09:00",
  // 4단계 Architecture
  archMail: "2026-10-20 16:05",
  archShare: "2026-10-21 10:40",
  // 5단계 QA
  qaMail: "2026-11-03 15:20",
  qaShare: "2026-11-04 09:50",
  // 6단계 진행상황
  devEnd: "2026-11-13 18:00",
  devTestStart: "2026-11-16 09:00",
  progReq1: "2026-11-17 09:05",
  progReply1: "2026-11-17 13:47",
  devTestPlanEnd: "2026-11-24 18:00",
  devTestEnd: "2026-11-25 18:00",
  opsTestPlanStart: "2026-11-26 09:00",
  opsTestStart: "2026-11-27 09:00",
  progReq2: "2026-12-01 09:10",
  progReply2: "2026-12-01 11:30",
  opsTestEnd: "2026-12-04 18:00",
  launch: "2026-12-10 02:00",
  // 7단계 완료
  progReq3: "2026-12-11 09:05",
  progReply3: "2026-12-11 10:20",
  progShare: "2026-12-11 10:45",
  done: "2026-12-11 11:00",
} as const;

export type TimeKey = keyof typeof BASE;

const WEEK_MS = 7 * 86_400_000;
const MARGIN_MS = 30 * 60_000;

function baseDate(key: TimeKey): Date {
  return new Date(`${BASE[key].replace(" ", "T")}:00+09:00`);
}

export interface DemoTimeline {
  /** 기준 일정에서 앞당긴 주 수 */
  shiftWeeks: number;
  at(key: TimeKey): Date;
  /** 한국 시간 날짜 (YYYY-MM-DD) */
  ymd(key: TimeKey): string;
}

export function buildTimeline(now: Date): DemoTimeline {
  const lateMs = baseDate("done").getTime() + MARGIN_MS - now.getTime();
  const shiftWeeks = lateMs > 0 ? Math.ceil(lateMs / WEEK_MS) : 0;
  const at = (key: TimeKey) => new Date(baseDate(key).getTime() - shiftWeeks * WEEK_MS);
  return { shiftWeeks, at, ymd: (key) => kstDate(at(key)) };
}
