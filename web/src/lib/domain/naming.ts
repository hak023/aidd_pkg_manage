/** 서비스 정의 4.2 / 4.6의 메일 태그·파일명 규칙 */

export const SYSTEM_TAG = "AX_AIDD";

export function formatDevCode(seq: number): string {
  return `DEV-${String(seq).padStart(4, "0")}`;
}

/** 메일 제목 추적 태그. 예: [AX_AIDD][DEV-0001] */
export function mailTag(code: string): string {
  return `[${SYSTEM_TAG}][${code}]`;
}

/** 개발사 문서를 회사 메일에서 전달할 때 쓰는 제목 예시 (Q-03) */
export function forwardSubject(code: string, itemName: string): string {
  return `${mailTag(code)} FW: ${itemName}`;
}

/** 제목에서 개발사항 코드 추출 */
export function parseDevCode(subject: string): string | null {
  const m = subject.match(/\[AX_AIDD\]\s*\[(DEV-\d{4,})\]/i);
  return m ? m[1].toUpperCase() : null;
}

/** 공백·파일명 금지 문자를 '_'로 바꾼다. */
export function sanitizeFilePart(s: string): string {
  return s
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** {단위서비스}_{라벨링}_{개발사항}_{suffix}.md — 라벨링이 없으면 생략 */
export function docFileName(
  parts: { service: string; label?: string | null; item: string },
  suffix: string,
): string {
  const segs = [parts.service, parts.label ?? "", parts.item, suffix]
    .filter((s) => s && s.trim())
    .map(sanitizeFilePart);
  return `${segs.join("_")}.md`;
}
