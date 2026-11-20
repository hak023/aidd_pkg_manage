/**
 * 수신 메일 분류·매칭 (서비스 정의 4.2). 순수 함수만 둔다.
 *
 * 매칭 우선순위
 * 1. 제목 태그 [AX_AIDD][DEV-xxxx]
 * 2. In-Reply-To / References가 우리가 보낸 메일의 Message-ID와 일치
 * 3. 본문 시작 표식 <<<AX_AIDD_REPLY_START DEV-xxxx>>>
 * 태그 없는 전달 메일의 내용 기반 추정(L3)은 P4에서 Gemini로 추가한다.
 */
import type { MailKind } from "@/lib/db/schema";
import { parseDevCode } from "@/lib/domain/naming";
import { KIND_SUBJECT_TAG } from "./compose";

export interface InboundAttachment {
  filename: string;
  contentType: string;
  size: number;
  /** 텍스트 파일이면 내용, 아니면 null */
  content: string | null;
}

export interface InboundMail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string;
  to: string;
  subject: string;
  text: string;
  date: Date;
  attachments: InboundAttachment[];
}

const MARKER_RE = /<<<AX_AIDD_(REPLY|PROGRESS)_START\s+(DEV-\d{4,})>>>/i;

export function markerCode(text: string): { code: string; kind: "REPLY" | "PROGRESS" } | null {
  const m = text.match(MARKER_RE);
  return m ? { kind: m[1].toUpperCase() as "REPLY" | "PROGRESS", code: m[2].toUpperCase() } : null;
}

export function isDocAttachment(a: { filename: string; contentType: string }): boolean {
  return /\.(md|markdown|txt)$/i.test(a.filename) || /^text\/(markdown|plain)/i.test(a.contentType);
}

export function detectKind(mail: Pick<InboundMail, "subject" | "text" | "attachments">): MailKind {
  if (mail.subject.includes(KIND_SUBJECT_TAG.progress)) return "progress_reply";
  if (mail.subject.includes(KIND_SUBJECT_TAG.collect)) return "collect_reply";
  const mk = markerCode(mail.text);
  if (mk?.kind === "PROGRESS") return "progress_reply";
  if (mk?.kind === "REPLY") return "collect_reply";
  if (mail.attachments.some(isDocAttachment)) return "doc_forward";
  return "other";
}

/** 시스템이 받아서 기록할 메일인가 (Gmail 받은편지함의 관계없는 메일은 건너뛴다) */
export function isRelevant(mail: Pick<InboundMail, "subject" | "text" | "from">, collectTo: string): boolean {
  if (/\[AX_AIDD\]/i.test(mail.subject)) return true;
  if (markerCode(mail.text)) return true;
  return !!collectTo && extractAddress(mail.from) === collectTo.trim().toLowerCase();
}

export function extractAddress(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

export interface MatchResult {
  code: string | null;
  method: "tag" | "header" | "marker" | null;
}

/**
 * @param codeByMessageId 우리가 보낸 메일의 Message-ID → 개발사항 코드
 */
export function matchMail(
  mail: Pick<InboundMail, "subject" | "text" | "inReplyTo" | "references">,
  codeByMessageId: (id: string) => string | null,
): MatchResult {
  const byTag = parseDevCode(mail.subject);
  if (byTag) return { code: byTag, method: "tag" };
  for (const id of [mail.inReplyTo, ...mail.references]) {
    if (!id) continue;
    const c = codeByMessageId(normalizeMessageId(id));
    if (c) return { code: c, method: "header" };
  }
  const mk = markerCode(mail.text);
  if (mk) return { code: mk.code, method: "marker" };
  return { code: null, method: null };
}

export function normalizeMessageId(id: string): string {
  const t = id.trim();
  return t.startsWith("<") ? t : `<${t}>`;
}

export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  collect_request: "수집 요청",
  progress_request: "진행상황 요청",
  share: "공유",
  collect_reply: "수집 회신",
  progress_reply: "진행상황 회신",
  doc_forward: "문서 전달",
  other: "기타",
};
