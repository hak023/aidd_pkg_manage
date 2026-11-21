"use client";

import { useMemo } from "react";
import { marked } from "marked";

/**
 * markdown 미리보기. 원문에 섞인 HTML은 이스케이프해 글자로 보여 준다
 * (LLM·메일에서 온 텍스트의 스크립트 삽입 방지).
 */
export function renderMarkdown(src: string): string {
  const escaped = src.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = marked.parse(escaped, { async: false, gfm: true, breaks: true }) as string;
  // 링크는 http(s)만 허용
  return html.replace(/href="(?!https?:)[^"]*"/gi, 'href="#"');
}

export default function Markdown({ source, className = "" }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
