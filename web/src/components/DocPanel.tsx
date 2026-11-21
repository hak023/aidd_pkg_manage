"use client";

import { useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client-api";
import type { DocKind } from "@/lib/db/schema";
import type { DocumentDTO, DocumentMetaDTO } from "@/lib/repo/prd";
import type { ShareDefaultsDTO, ShareKind } from "@/lib/repo/docs";
import type { Toast } from "./Workspace";
import Markdown from "./Markdown";

const SOURCE_LABEL = { llm: "생성", edit: "편집", mail: "수신" } as const;

/**
 * 버전 관리되는 md 문서 편집 카드 (PRD, Architecture/QA 검토 리포트).
 * 버전 선택, 편집·미리보기, 저장(새 버전), 내려받기, 공유.
 */
export default function DocPanel({
  itemId,
  kind,
  shareKind,
  title,
  emptyText,
  actions,
  refreshToken,
  onChanged,
  notify,
}: {
  itemId: number;
  kind: DocKind;
  shareKind: ShareKind;
  title: string;
  emptyText: string;
  /** 머리글 오른쪽에 붙일 추가 버튼 (예: 리포트 다시 생성) */
  actions?: React.ReactNode;
  refreshToken: number;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
}) {
  const [versions, setVersions] = useState<DocumentMetaDTO[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [doc, setDoc] = useState<DocumentDTO | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"split" | "edit" | "preview">("split");
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ documents: DocumentMetaDTO[] }>(`/api/items/${itemId}/documents?kind=${kind}`)
      .then((r) => {
        if (!alive) return;
        setVersions(r.documents);
        setSelected((cur) => (cur && r.documents.some((d) => d.id === cur) ? cur : (r.documents[0]?.id ?? null)));
      })
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [itemId, kind, refreshToken, tick, notify]);

  useEffect(() => {
    if (selected === null) return;
    let alive = true;
    api<{ document: DocumentDTO }>(`/api/documents/${selected}`)
      .then((r) => {
        if (!alive) return;
        setDoc(r.document);
        setDraft(r.document.content);
        setNote("");
      })
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [selected, notify]);

  const dirty = !!doc && draft !== doc.content;
  const latestId = versions?.[0]?.id ?? null;

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ document: DocumentDTO }>(`/api/items/${itemId}/documents`, {
        method: "POST",
        body: { kind, content: draft, note },
      });
      notify({ kind: "ok", text: `${title} v${r.document.version}로 저장했습니다.` });
      // 저장된 버전을 바로 현재 문서로 (다시 불러오기를 기다리는 동안 '저장 안 됨'으로 보이지 않게)
      setDoc(r.document);
      setDraft(r.document.content);
      setNote("");
      setSelected(r.document.id);
      setTick((t) => t + 1);
      await onChanged();
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (versions === null) return <Card>불러오는 중…</Card>;
  if (versions.length === 0) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 className="font-semibold">{title}</h3>
          {actions}
        </div>
        <p className="text-[13px] text-muted">{emptyText}</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {doc && <p className="text-[12px] text-muted font-mono break-all">{doc.filename}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`${title} 버전`}
            className="border border-line rounded-md px-2 py-1.5 text-[12px] bg-white"
            value={selected ?? ""}
            onChange={(e) => {
              if (dirty && !window.confirm("저장하지 않은 편집 내용이 사라집니다. 다른 버전을 열까요?")) return;
              setSelected(Number(e.target.value));
            }}
          >
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {SOURCE_LABEL[v.source]} · {formatDateTime(v.createdAt)}
                {v.note ? ` · ${v.note}` : ""}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-line overflow-hidden text-[12px]" role="group" aria-label="보기 방식">
            {(["edit", "split", "preview"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-2.5 py-1.5 ${mode === m ? "bg-accent-soft text-accent font-semibold" : "text-muted"}`}
              >
                {m === "edit" ? "편집" : m === "split" ? "나란히" : "미리보기"}
              </button>
            ))}
          </div>
          {actions}
          {doc && (
            <a href={`/api/documents/${doc.id}?download=1`} className="px-3 py-1.5 rounded-md border border-line text-[13px]">
              내려받기
            </a>
          )}
          <button
            onClick={() => {
              if (dirty) {
                notify({ kind: "error", text: "편집 내용을 먼저 저장하세요. 공유는 저장된 버전만 보냅니다." });
                return;
              }
              setSharing(true);
            }}
            className="px-4 py-1.5 rounded-md bg-accent text-white font-semibold text-[13px]"
          >
            공유
          </button>
        </div>
      </div>

      {doc && selected !== latestId && (
        <p className="text-[12px] text-warn mb-2">이전 버전(v{doc.version})을 보고 있습니다. 저장하면 최신 버전 다음 번호로 저장됩니다.</p>
      )}

      <div className={`grid gap-3 ${mode === "split" ? "lg:grid-cols-2" : ""}`}>
        {mode !== "preview" && (
          <textarea
            aria-label={`${title} 편집`}
            className="w-full min-h-[560px] border border-line rounded-lg p-3 font-mono text-[12.5px] leading-relaxed bg-white"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
        )}
        {mode !== "edit" && (
          <div className="border border-line rounded-lg p-4 min-h-[560px] max-h-[760px] overflow-y-auto bg-white">
            <Markdown source={draft} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <input
          aria-label="변경 메모"
          className="border border-line rounded-md px-3 py-1.5 text-[13px] flex-1 min-w-48 bg-white"
          placeholder="변경 메모 (선택, 버전 목록에 표시)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button
          onClick={save}
          disabled={!dirty || busy}
          className="px-4 py-1.5 rounded-md bg-ink text-white text-[13px] font-semibold disabled:opacity-40"
        >
          {busy ? "저장 중…" : "새 버전으로 저장"}
        </button>
        {dirty && <span className="text-[12px] text-warn">저장하지 않은 변경이 있습니다.</span>}
      </div>

      {sharing && doc && (
        <ShareDialog
          itemId={itemId}
          shareKind={shareKind}
          title={title}
          doc={doc}
          onClose={() => setSharing(false)}
          onSent={async (n) => {
            setSharing(false);
            notify({ kind: "ok", text: `${title}를 ${n}명에게 공유했습니다.` });
            await onChanged();
          }}
          notify={notify}
        />
      )}
    </Card>
  );
}

/** 공유 창: 수신자 편집, 제목·본문·첨부 확인 후 발송 (AGENTS.md 5-4) */
function ShareDialog({
  itemId,
  shareKind,
  title,
  doc,
  onClose,
  onSent,
  notify,
}: {
  itemId: number;
  shareKind: ShareKind;
  title: string;
  doc: DocumentDTO;
  onClose: () => void;
  onSent: (count: number) => Promise<void>;
  notify: (t: Toast) => void;
}) {
  const [def, setDef] = useState<ShareDefaultsDTO | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<ShareDefaultsDTO>(`/api/items/${itemId}/share?kind=${shareKind}`)
      .then((d) => {
        if (!alive) return;
        setDef(d);
        setTo(d.to.join("\n"));
        setSubject(d.subject);
        // 기본 본문의 첨부 줄을 지금 고른 버전으로 맞춘다
        setText(
          d.text.replace(/^첨부: .*$/m, `첨부: ${[d.companion && shareKind !== "prd" ? `${d.companion.filename} (v${d.companion.version})` : null, `${doc.filename} (v${doc.version})`].filter(Boolean).join(", ")}`),
        );
      })
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [itemId, shareKind, doc, notify]);

  const list = [...new Set(to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean))];
  const bad = list.filter((s) => !/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s));

  async function send() {
    setBusy(true);
    try {
      await api(`/api/items/${itemId}/share?kind=${shareKind}`, {
        method: "POST",
        body: { documentId: doc.id, to: list, subject, text },
      });
      await onSent(list.length);
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} 공유`}
        className="bg-panel rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-line">
          <h2 className="font-semibold text-[15px]">{title} 공유</h2>
          <p className="text-[12px] text-muted">
            받는 사람 기본값은 수집 회신의 관련자입니다. 추가·삭제한 뒤 보내세요.
            {def?.mode === "simulator" && " 지금은 시뮬레이터 모드라 실제로 발송하지 않고 기록만 합니다."}
          </p>
        </div>
        {!def ? (
          <div className="p-5 text-muted text-[13px]">불러오는 중…</div>
        ) : (
          <div className="px-5 py-3 overflow-y-auto flex-1 space-y-3 text-[13px]">
            <label className="block">
              <span className="text-[12px] text-muted">받는 사람 (한 줄에 한 명, 또는 쉼표로 구분) · {list.length}명</span>
              <textarea
                aria-label="받는 사람"
                rows={4}
                className={`w-full border rounded-md px-3 py-1.5 bg-white font-mono text-[12.5px] ${bad.length ? "border-danger" : "border-line"}`}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setConfirming(false);
                }}
              />
              {bad.length > 0 && <span className="text-[12px] text-danger">형식이 올바르지 않음: {bad.join(", ")}</span>}
              {def.to.length === 0 && (
                <span className="text-[12px] text-muted">관련자 이메일을 찾지 못했습니다. 직접 입력하세요.</span>
              )}
            </label>
            <label className="block">
              <span className="text-[12px] text-muted">제목</span>
              <input
                aria-label="제목"
                className="w-full border border-line rounded-md px-3 py-1.5 bg-white"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-[12px] text-muted">본문</span>
              <textarea
                aria-label="본문"
                rows={6}
                className="w-full border border-line rounded-md px-3 py-1.5 bg-white"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="text-[12px] space-y-0.5">
              <span className="text-muted">첨부</span>
              {shareKind !== "prd" && (
                <div className="font-mono">
                  📎 {def.companion ? `${def.companion.filename} (대조한 버전)` : "대상 문서 없음"}
                </div>
              )}
              <div className="font-mono">
                📎 {doc.filename} (v{doc.version}, {Math.ceil(doc.size / 1024)}KB)
              </div>
            </div>
          </div>
        )}
        <div className="px-5 py-3 border-t border-line flex flex-wrap items-center justify-end gap-2">
          {confirming && (
            <span className="text-[12px] text-warn mr-auto">
              {list.length}명에게 v{doc.version}을(를) 보냅니다. 한 번 더 누르면 발송합니다.
            </span>
          )}
          <button onClick={onClose} className="px-4 py-2 rounded-md border border-line text-[13px]">
            취소
          </button>
          <button
            onClick={() => (confirming ? send() : setConfirming(true))}
            disabled={!def || busy || list.length === 0 || bad.length > 0 || !subject.trim()}
            className="px-4 py-2 rounded-md bg-accent text-white font-semibold text-[13px] disabled:opacity-40"
          >
            {busy ? "보내는 중…" : confirming ? "발송 확인" : "보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="bg-panel border border-line rounded-xl p-5 mb-4">{children}</section>;
}
