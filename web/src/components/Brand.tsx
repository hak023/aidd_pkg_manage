/**
 * 서비스 표기: "kt AX_AIDD" + 부제.
 * kt 표기는 글자로 그린다. 공식 로고 파일을 쓰려면 web/public/에 넣고 KtMark를 <img>로 바꾼다.
 */
export const BRAND_NAME = "kt AX_AIDD";
export const BRAND_SUBTITLE = "IT부문 아웃소싱 AIDD";

export function KtMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-label="kt"
      className={`font-extrabold lowercase tracking-tighter leading-none ${className}`}
      style={{ color: "#E4002B" }}
    >
      kt
    </span>
  );
}

export function BrandName({ size = "md" }: { size?: "md" | "lg" }) {
  const text = size === "lg" ? "text-[22px]" : "text-[15px]";
  const mark = size === "lg" ? "text-[26px]" : "text-[18px]";
  return (
    <span className={`inline-flex items-baseline gap-1.5 font-bold tracking-tight ${text}`}>
      <KtMark className={mark} />
      <span>AX_AIDD</span>
    </span>
  );
}
