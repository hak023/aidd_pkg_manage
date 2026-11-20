/**
 * 발송 메일 본문 작성 (서비스 정의 4.3, 부록 A).
 * 본문은 ① 사람용 안내 ② Copilot 작성 지침 ③ 회신 양식(시작·끝 표식) 세 부분이다.
 */
import { mailTag } from "@/lib/domain/naming";

export const KIND_SUBJECT_TAG = {
  collect: "[수집요청]",
  progress: "[진행상황요청]",
} as const;

export const COLLECT_SECTIONS: { no: string; title: string; hint?: string }[] = [
  { no: "01", title: "관련자", hint: "| 이름 | 부서 | 역할(요청·결정·개발·운영·검증) | 이메일 |" },
  { no: "02", title: "요청 배경", hint: "누가, 언제, 왜 요청했는지. 고객·VoC·정책 등 계기" },
  {
    no: "03",
    title: "히스토리 (의사결정 과정)",
    hint: "| 일자 | 채널 | 참여자 | 논의 내용 | 결정 사항 | 출처 |  (날짜순)",
  },
  { no: "04", title: "기존 문제점·현행 방식", hint: "지금 어떻게 동작하고 무엇이 불편한지" },
  { no: "05", title: "목표·기대효과", hint: "달성하려는 상태, 언급된 지표" },
  { no: "06", title: "요구사항 (기능 / 비기능)", hint: "기능: 방식·대상·처리 흐름·실패 처리 / 비기능: 성능·보안·가용성" },
  { no: "07", title: "범위·비범위", hint: "이번에 할 것과 하지 않을 것" },
  { no: "08", title: "연동 시스템·부서", hint: "연동 대상, 인터페이스, 담당 부서, 협의 상태" },
  { no: "09", title: "제약·보안·운영 고려", hint: "보안 심의, 운영 절차, 장애 대응, 호환성" },
  { no: "10", title: "일정", hint: "언급된 마일스톤, 목표 PKG(라벨링)와의 관계" },
  { no: "11", title: "미결·쟁점", hint: "결정되지 않은 사항, [상충] 항목" },
  { no: "12", title: "참고 자료·출처 (검색하지 못한 범위 포함)", hint: "문서명, 링크, 일자. 검색하지 못한 범위도 적는다" },
];

export function replyStartMarker(code: string) {
  return `<<<AX_AIDD_REPLY_START ${code}>>>`;
}
export const REPLY_END_MARKER = "<<<AX_AIDD_REPLY_END>>>";

export interface CollectTarget {
  code: string;
  service: string | null;
  label: string | null;
  item: string;
  keywords: string;
  searchPeriod: string;
  memo: string;
}

export function collectSubject(t: CollectTarget): string {
  const path = [t.service, t.label, t.item].filter(Boolean).join(" / ");
  return `${mailTag(t.code)}${KIND_SUBJECT_TAG.collect} ${path}`;
}

export function composeCollectRequest(t: CollectTarget): { subject: string; text: string } {
  const tag = mailTag(t.code);
  const keywords = t.keywords.trim() || t.item;
  const period = t.searchPeriod.trim() || "최근 6개월";
  const lines = [
    "안녕하세요. AX_AIDD 시스템입니다.",
    "아래 개발사항에 대한 논의 내용 수집을 요청합니다.",
    "이 메일을 연 상태에서 Copilot에게 \"메일 내용 회신내용 작성해줘\"라고 요청하고,",
    "작성된 내용을 검토한 뒤 회신해 주세요.",
    `제목의 ${tag} 태그와 회신 양식의 시작·끝 표식은 지우지 마세요.`,
    "(Copilot의 검색 범위가 부족하면, 아래 지침 블록을 Microsoft 365 Copilot Chat에 붙여 넣고 결과를 회신 본문에 붙여 넣어도 됩니다.)",
    "",
    "==== Copilot 작성 지침 ====",
    "[역할] 너는 KT 지능망 서비스 개발 BA 담당자의 업무 비서다.",
    "[대상 개발사항]",
    `- 단위서비스: ${t.service ?? "(없음)"}`,
    `- 라벨링: ${t.label ?? "(없음)"}`,
    `- 개발사항: ${t.item}`,
    "[검색 범위] 나의 Outlook 메일, Teams 채팅·채널·회의록, Confluence 페이지(접근 가능한 경우)",
    `[검색 키워드] ${keywords}`,
    `[검색 기간] ${period}`,
  ];
  if (t.memo.trim()) lines.push(`[참고 메모] ${t.memo.trim()}`);
  lines.push(
    "[작성 규칙]",
    "1. 아래 회신 양식의 섹션 제목과 순서를 그대로 유지한다.",
    "2. 각 내용 끝에 출처를 [채널 일자 작성자 \"제목/채널명\"] 형식으로 단다. 예: [Teams 2026-10-02 홍길동 \"채널명\"]",
    "3. 찾지 못한 항목은 \"확인 안 됨\"으로 쓴다. 추측하거나 지어내지 않는다.",
    "4. 서로 다른 의견이 있으면 모두 적고 [상충]으로 표시한다.",
    "5. 비밀번호, 개인 휴대폰 번호, 고객 개인정보는 쓰지 않는다.",
    "6. Confluence를 검색할 수 없으면 12번 항목에 \"Confluence 검색 불가\"라고 적는다.",
    "7. 회신 본문에는 아래 양식 구간(시작·끝 표식 포함)만 작성한다.",
    "",
    "==== 회신 양식 ====",
    replyStartMarker(t.code),
  );
  for (const s of COLLECT_SECTIONS) {
    lines.push(`## ${s.no}. ${s.title}`);
    if (s.hint) lines.push(`(${s.hint})`);
  }
  lines.push(REPLY_END_MARKER);
  return { subject: collectSubject(t), text: lines.join("\n") };
}
