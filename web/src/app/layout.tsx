import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AX_AIDD",
  description: "출처 기반 개발 산출물 작성 지원 — 개발사항 수집·PRD·Architecture·QA·진행상황 관리",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col text-[14px]">{children}</body>
    </html>
  );
}
