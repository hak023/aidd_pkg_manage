/**
 * 시연 시나리오 타입 정의.
 * 관련자 3명의 이름·회사 메일 주소는 사용자 지정(2026-11-25)이며, 그 밖의 내용(개발사, 수치, 논의 이력, 문서)은 모두 합성 자료다.
 */
import type { Verdict } from "@/lib/llm/docreview";
import type { TimeKey } from "./timeline";

export interface PersonProfile {
  name: string;
  dept: string;
  role: string;
  email: string;
}

/** 수집 회신·PRD의 히스토리 표 한 행. 출처 표기는 [채널 일자 작성자 "제목"] 형식으로 만든다. */
export interface HistoryEntry {
  key: Extract<TimeKey, `h${number}`>;
  channel: "메일" | "회의" | "Teams";
  /** 출처 표기의 채널 */
  sourceChannel: "Outlook" | "Teams";
  /** 출처 표기의 작성자 (회의록이면 "회의록") */
  author: string;
  title: string;
  participants: string;
  topic: string;
  /** 수집 회신에 적힌 결정 사항 */
  decision: string;
  /** PRD에서 담당자 보완으로 바뀐 결정 사항 (없으면 decision 그대로) */
  resolved?: string;
}

/** 요구사항과, 개발사 문서 대조 결과(Architecture·QA 검토 리포트의 한 행) */
export interface DemoRequirement {
  id: string;
  title: string;
  priority: "상" | "중";
  criteria: string;
  /** 출처가 되는 히스토리. "answer"는 담당자 보완 */
  source: HistoryEntry["key"] | "answer";
  /** 이 요구사항이 처음 들어간 PRD 버전 */
  sinceVersion: 1 | 2;
  arch: { verdict: Verdict; location: string; note: string };
  qa: { verdict: Verdict; location: string; note: string };
}

export interface DemoScenario {
  service: string;
  label: string;
  title: string;
  keywords: string;
  searchPeriod: string;
  memo: string;
  vendorName: string;
  people: {
    requester: PersonProfile;
    reviewer: PersonProfile;
    ops: PersonProfile;
  };
  history: HistoryEntry[];
  funcReqs: DemoRequirement[];
  nonFuncReqs: DemoRequirement[];
}
