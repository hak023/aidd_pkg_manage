"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { ItemDetailDTO } from "@/lib/repo/tree";
import type { MailSummaryDTO } from "@/lib/repo/mail";
import type { Toast } from "./Workspace";

const TITLE = { collect: "수집 요청 메일 보내기", progress: "진행상황 요청 메일 보내기" } as const;

/** 수집·진행상황 요청 메일 미리보기와 발송 확인. 받는 사람은 config 주소로 고정 */
export default function RequestMailDialog({
  itemId,
  kind,
  onClose,
  onSent,
  notify,
}: {
  itemId: number;
  kind: "collect" | "progress";
  onClose: () => void;
  onSent: (item: ItemDetailDTO, mail: MailSummaryDTO) => Promise<void>;
  notify: (t: Toast) => void;
}) {
  const [preview, setPreview] = useState<{ subject: string; text: string; to: string; mode: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ subject: string; text: string; to: string; mode: string }>(`/api/items/${itemId}/${kind}-request`)
      .then((p) => alive && setPreview(p))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [itemId, kind]);

  async function send() {
    setBusy(true);
    try {
      const r = await api<{ item: ItemDetailDTO; mail: MailSummaryDTO }>(`/api/items/${itemId}/${kind}-request`, {
        method: "POST",
      });
      await onSent(r.item, r.mail);
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={TITLE[kind]}
        className="bg-panel rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-line">
          <h2 className="font-semibold text-[15px]">{TITLE[kind]}</h2>
          <p className="text-[12px] text-muted">
            받는 사람은 config에 지정된 회사 주소로 고정됩니다.
            {preview?.mode === "simulator" && " 지금은 시뮬레이터 모드라 실제로 발송하지 않고 가상 메일함에 기록합니다."}
          </p>
        </div>
        {error && <div className="m-4 p-3 rounded-md bg-danger-soft text-danger text-[13px]">{error}</div>}
        {!preview && !error && <div className="p-5 text-muted text-[13px]">불러오는 중…</div>}
        {preview && (
          <div className="px-5 py-3 overflow-y-auto flex-1 text-[13px]">
            <div className="grid grid-cols-[80px_1fr] gap-y-1 mb-3">
              <span className="text-muted">받는 사람</span>
              <span className="font-mono break-all">{preview.to}</span>
              <span className="text-muted">제목</span>
              <span className="break-all">{preview.subject}</span>
            </div>
            <pre className="p-4 bg-bg rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap break-words font-mono">
              {preview.text}
            </pre>
          </div>
        )}
        <div className="px-5 py-3 border-t border-line flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md border border-line text-[13px]">
            취소
          </button>
          <button
            onClick={send}
            disabled={!preview || busy}
            className="px-4 py-2 rounded-md bg-accent text-white font-semibold text-[13px] disabled:opacity-40"
          >
            {busy ? "보내는 중…" : "보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}
