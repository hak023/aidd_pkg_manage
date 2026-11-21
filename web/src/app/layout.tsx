import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "kt AX_AIDD",
  description: "IT부문 아웃소싱 AIDD — 개발사항 수집·PRD·Architecture·QA·진행상황 관리",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col text-[14px]">{children}</body>
    </html>
  );
}
