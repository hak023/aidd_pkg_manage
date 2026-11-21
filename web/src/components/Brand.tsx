import Image from "next/image";

/**
 * 서비스 표기: kt 로고 + "AX_AIDD" + 부제.
 * 로고 파일: web/public/kt-logo.svg (사용자 제공)
 */
export const BRAND_NAME = "kt AX_AIDD";
export const BRAND_SUBTITLE = "IT부문 아웃소싱 AIDD";

export function KtMark({ size }: { size: number }) {
  return <Image src="/kt-logo.svg" alt="kt" width={size} height={size} unoptimized priority className="shrink-0" />;
}

export function BrandName({ size = "md" }: { size?: "md" | "lg" }) {
  const lg = size === "lg";
  return (
    <span className={`inline-flex items-center gap-1 font-bold tracking-tight ${lg ? "text-[22px]" : "text-[15px]"}`}>
      <KtMark size={lg ? 34 : 24} />
      <span>AX_AIDD</span>
    </span>
  );
}
