"use client";

import { useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client-api";
import type { MailDetailDTO, MailSummaryDTO } from "@/lib/repo/mail";

const METHOD_LABEL: Record<string, string> = {
  tag: "제목 태그",
  header: "회신 헤더",
  marker: "본문 표식",
  manual: "수동 지정",
};

export function MailBadges({ m }: { m: MailSummaryDTO }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span
        className={`text-[11px] px-1.5 rounded ${
          m.direction === "out" ? "bg-accent-soft text-accent" : "bg-ok-soft text-ok"
        }`}
      >
        {m.direction === "out" ? "발송" : "수신"} · {m.kindLabel}
      </span>
      {m.simulated && <span className="text-[11px] px-1.5 rounded bg-warn-soft text-warn">시뮬레이터</span>}
      {m.status === "unmatched" && <span className="text-[11px] px-1.5 rounded bg-danger-soft text-danger">미분류</span>}
      {m.status === "ignored" && <span className="text-[11px] px-1.5 rounded bg-bg text-muted">무시됨</span>}
      {m.matchMethod && <span className="text-[11px] text-muted">매칭: {METHOD_LABEL[m.matchMethod]}</span>}
    </span>
  );
}

export function MailList({
  mails,
  empty,
  onOpen,
  actions,
}: {
  mails: MailSummaryDTO[];
  empty: string;
  onOpen: (id: number) => void;
  actions?: (m: MailSummaryDTO) => React.ReactNode;
}) {
  if (mails.length === 0) return <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {mails.map((m) => (
        <li key={m.id} className="py-2.5 flex flex-wrap items-start gap-x-3 gap-y-1">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-0.5">
              <MailBadges m={m} />
              <span className="text-[12px] text-muted">{formatDateTime(m.date)}</span>
            </div>
            <button onClick={() => onOpen(m.id)} className="text-left text-[13px] hover:underline break-all">
              {m.subject || "(제목 없음)"}
            </button>
            <div className="text-[12px] text-muted break-all">
              {m.direction === "out" ? `받는 사람: ${m.to}` : `보낸 사람: ${m.from}`}
              {m.attachments.length > 0 && ` · 첨부 ${m.attachments.map((a) => a.filename).join(", ")}`}
            </div>
          </div>
          {actions && <div className="flex items-center gap-1.5">{actions(m)}</div>}
        </li>
      ))}
    </ul>
  );
}

/** 메일 본문·첨부 보기 */
export function MailViewer({ id, onClose }: { id: number; onClose: () => void }) {
  const [mail, setMail] = useState<MailDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<number | "body">("body");

  useEffect(() => {
    let alive = true;
    api<{ mail: MailDetailDTO }>(`/api/mails/${id}`)
      .then(({ mail }) => alive && setMail(mail))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const att = typeof tab === "number" ? mail?.attachments.find((a) => a.id === tab) : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="메일 보기"
        className="bg-panel rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-line flex items-start justify-between gap-3">
          <div className="min-w-0">
            {mail && <MailBadges m={mail} />}
            <h2 className="font-semibold text-[15px] break-all mt-1">{mail?.subject ?? "불러오는 중…"}</h2>
            {mail && (
              <div className="text-[12px] text-muted break-all">
                {formatDateTime(mail.date)} · 보낸 사람 {mail.from} · 받는 사람 {mail.to}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink text-[18px] leading-none" aria-label="닫기">
            ×
          </button>
        </div>
        {error && <div className="m-4 p-3 rounded-md bg-danger-soft text-danger text-[13px]">{error}</div>}
        {mail && (
          <>
            {mail.attachments.length > 0 && (
              <div className="px-5 pt-3 flex flex-wrap gap-1.5">
                <TabButton active={tab === "body"} onClick={() => setTab("body")}>
                  본문
                </TabButton>
                {mail.attachments.map((a) => (
                  <TabButton key={a.id} active={tab === a.id} onClick={() => setTab(a.id)}>
                    📎 {a.filename} <span className="text-muted">({Math.ceil(a.size / 1024)}KB)</span>
                  </TabButton>
                ))}
              </div>
            )}
            <pre className="m-5 mt-3 p-4 bg-bg rounded-lg text-[12.5px] leading-relaxed whitespace-pre-wrap break-words overflow-y-auto flex-1 font-mono">
              {tab === "body"
                ? mail.body || "(본문 없음)"
                : (att?.content ?? "텍스트 파일이 아니라 내용을 표시할 수 없습니다.")}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className={`text-[12px] px-2.5 py-1 rounded-md border ${
        props.active ? "border-accent bg-accent-soft text-accent font-semibold" : "border-line text-muted hover:text-ink"
      }`}
    >
      {props.children}
    </button>
  );
}
