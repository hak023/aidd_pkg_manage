"use client";

import { useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client-api";
import type { DocStateDTO, RegisterResult } from "@/lib/repo/docs";
import type { DocumentDTO } from "@/lib/repo/prd";
import type { Toast } from "./Workspace";
import DocPanel from "./DocPanel";
import Markdown from "./Markdown";

const LABEL = { arch: "Architecture", qa: "QA(시험항목서)" } as const;
const REQUEST_FILE = { arch: "architecture.md", qa: "qa.md" } as const;
const GUESS = { arch: "Architecture로 보임", qa: "QA로 보임", other: "유형 불명" } as const;

/** 4·5단계: 개발사 문서 등록·버전과 검토 리포트 */
export default function DocReviewPanel({
  itemId,
  kind,
  refreshToken,
  onChanged,
  notify,
}: {
  itemId: number;
  kind: "arch" | "qa";
  refreshToken: number;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
}) {
  const [state, setState] = useState<DocStateDTO | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<DocStateDTO>(`/api/items/${itemId}/docs?kind=${kind}`)
      .then((s) => alive && setState(s))
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [itemId, kind, refreshToken, tick, notify]);

  async function after(r: RegisterResult) {
    notify(
      r.reportError
        ? { kind: "error", text: `v${r.document.version} 등록. 리포트는 만들지 못했습니다: ${r.reportError}` }
        : { kind: "ok", text: `${LABEL[kind]} v${r.document.version}을(를) 등록하고 검토 리포트를 만들었습니다.` },
    );
    setTick((t) => t + 1);
    await onChanged();
  }

  async function register(body: Record<string, unknown>, tag: string) {
    setBusy(tag);
    try {
      await after(await api<RegisterResult>(`/api/items/${itemId}/docs`, { method: "POST", body: { kind, ...body } }));
      return true;
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    setBusy("regen");
    try {
      const r = await api<{ document: DocumentDTO }>(`/api/items/${itemId}/doc-review`, { method: "POST", body: { kind } });
      notify({ kind: "ok", text: `검토 리포트 v${r.document.version}을(를) 만들었습니다.` });
      setTick((t) => t + 1);
      await onChanged();
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!state) return <section className="bg-panel border border-line rounded-xl p-5 mb-4">불러오는 중…</section>;

  return (
    <>
      <SourceDocCard
        kind={kind}
        state={state}
        busy={busy}
        onRegisterAttachment={(id) => register({ attachmentId: id }, `att-${id}`)}
        onRegisterPaste={(content, filename) => register({ content, filename }, "paste")}
        notify={notify}
      />
      <DocPanel
        itemId={itemId}
        kind={kind === "arch" ? "arch_report" : "qa_report"}
        shareKind={kind}
        title={`${kind === "arch" ? "Architecture" : "QA"} 검토 리포트`}
        emptyText={
          state.versions.length === 0
            ? "문서를 등록하면 PRD와 대조한 검토 리포트가 자동으로 만들어집니다."
            : state.hasPrd
              ? "아직 리포트가 없습니다. ‘리포트 다시 생성’을 누르세요."
              : "PRD가 없어 리포트를 만들 수 없습니다. 2·3단계에서 PRD를 먼저 만드세요."
        }
        actions={
          state.versions.length > 0 && (
            <button
              onClick={regenerate}
              disabled={!!busy || !state.hasPrd}
              title={state.hasPrd ? "최신 문서와 최신 PRD로 다시 대조" : "PRD가 필요합니다"}
              className="px-3 py-1.5 rounded-md border border-accent text-accent text-[13px] font-semibold disabled:opacity-40"
            >
              {busy === "regen" ? "대조 중…" : "리포트 다시 생성"}
            </button>
          )
        }
        refreshToken={refreshToken + tick}
        onChanged={onChanged}
        notify={notify}
      />
    </>
  );
}

function SourceDocCard({
  kind,
  state,
  busy,
  onRegisterAttachment,
  onRegisterPaste,
  notify,
}: {
  kind: "arch" | "qa";
  state: DocStateDTO;
  busy: string | null;
  onRegisterAttachment: (attachmentId: number) => Promise<boolean>;
  onRegisterPaste: (content: string, filename: string) => Promise<boolean>;
  notify: (t: Toast) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [doc, setDoc] = useState<DocumentDTO | null>(null);
  const [showDoc, setShowDoc] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteName, setPasteName] = useState("");

  const current = selected ?? state.versions[0]?.id ?? null;
  useEffect(() => {
    if (current === null || !showDoc) return;
    let alive = true;
    api<{ document: DocumentDTO }>(`/api/documents/${current}`)
      .then((r) => alive && setDoc(r.document))
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [current, showDoc, notify]);

  // 이 단계에 맞는 후보를 앞에
  const cands = [...state.candidates].sort((a, b) => Number(b.guess === kind) - Number(a.guess === kind));

  return (
    <section className="bg-panel border border-line rounded-xl p-5 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <h3 className="font-semibold">개발사 {LABEL[kind]} 문서</h3>
          <p className="text-[12px] text-muted">
            개발사로부터 {REQUEST_FILE[kind]} 파일을 요청합니다. 받은 파일은 “전달용 제목”을 붙여 Gmail로 보내면 자동으로 등록되고, 개정본은 새 버전으로 쌓입니다.
          </p>
        </div>
        <button
          onClick={() => setPasteOpen((v) => !v)}
          className="px-3 py-1.5 rounded-md border border-line text-[13px]"
        >
          {pasteOpen ? "직접 입력 닫기" : "md 직접 붙여 넣기"}
        </button>
      </div>

      {state.versions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <select
            aria-label={`${LABEL[kind]} 문서 버전`}
            className="border border-line rounded-md px-2 py-1.5 text-[12px] bg-white max-w-full"
            value={current ?? ""}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {state.versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {formatDateTime(v.createdAt)} · {v.note}
              </option>
            ))}
          </select>
          <button onClick={() => setShowDoc((v) => !v)} className="text-[12px] px-2.5 py-1.5 rounded-md border border-line">
            {showDoc ? "문서 접기" : "문서 보기"}
          </button>
          {current && (
            <a href={`/api/documents/${current}?download=1`} className="text-[12px] px-2.5 py-1.5 rounded-md border border-line">
              내려받기
            </a>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-muted mb-2">아직 등록된 문서가 없습니다.</p>
      )}
      {showDoc && doc && (
        <div className="border border-line rounded-lg p-4 max-h-[480px] overflow-y-auto bg-white mb-3">
          <Markdown source={doc.content} />
        </div>
      )}

      {cands.length > 0 && (
        <div className="mt-3">
          <h4 className="text-[13px] font-semibold mb-1">등록하지 않은 전달 문서 ({cands.length})</h4>
          <ul className="divide-y divide-line border border-line rounded-lg">
            {cands.map((c) => (
              <li key={c.attachmentId} className="px-3 py-2 flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-mono break-all">📎 {c.filename}</span>
                <span className={`text-[11px] px-1.5 rounded ${c.guess === kind ? "bg-ok-soft text-ok" : "bg-bg text-muted"}`}>
                  {GUESS[c.guess]}
                </span>
                <span className="text-[12px] text-muted flex-1 min-w-40 break-all">
                  {formatDateTime(c.mailDate)} · {c.mailSubject}
                </span>
                <button
                  onClick={() => onRegisterAttachment(c.attachmentId)}
                  disabled={!!busy}
                  className="text-[12px] px-2.5 py-1 rounded-md bg-accent text-white font-semibold disabled:opacity-40"
                >
                  {busy === `att-${c.attachmentId}` ? "등록 중…" : `${LABEL[kind]}로 등록`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pasteOpen && (
        <div className="mt-3 space-y-2">
          <input
            aria-label="파일명"
            className="w-full border border-line rounded-md px-3 py-1.5 text-[13px] bg-white"
            placeholder="원본 파일명 (선택, 예: SSO_Architecture_v1.2.md)"
            value={pasteName}
            onChange={(e) => setPasteName(e.target.value)}
          />
          <textarea
            aria-label={`${LABEL[kind]} 문서 내용`}
            rows={8}
            className="w-full border border-line rounded-md px-3 py-2 font-mono text-[12.5px] bg-white"
            placeholder="개발사 문서(md) 내용을 붙여 넣으세요"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <button
            onClick={async () => {
              if (await onRegisterPaste(paste, pasteName)) {
                setPaste("");
                setPasteName("");
                setPasteOpen(false);
              }
            }}
            disabled={!!busy || !paste.trim()}
            className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
          >
            {busy === "paste" ? "등록 중…" : `${LABEL[kind]}로 등록`}
          </button>
        </div>
      )}
    </section>
  );
}
