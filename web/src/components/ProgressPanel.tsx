"use client";

import { useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client-api";
import type { ProgressReportDTO, ProgressStateDTO } from "@/lib/repo/progress";
import type { Milestone, MilestoneStatus } from "@/lib/llm/progress";
import type { Toast } from "./Workspace";
import RequestMailDialog from "./RequestMailDialog";

const CHIP: Record<MilestoneStatus, string> = {
  완료: "bg-ok-soft text-ok",
  진행중: "bg-warn-soft text-warn",
  예정: "bg-accent-soft text-accent",
  미정: "bg-bg text-muted",
};
const PROVIDER = (p: ProgressReportDTO) => (p.provider === "rule" ? "규칙 해석" : p.provider === "mock" ? "모의 LLM" : p.model);

/** 6단계 진행상황: 요청 메일, 마일스톤 표(미정 표시), 이력·변경, 다시 해석, 직접 입력, 공유 */
export default function ProgressPanel({
  itemId,
  refreshToken,
  onChanged,
  notify,
}: {
  itemId: number;
  refreshToken: number;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
}) {
  const [state, setState] = useState<ProgressStateDTO | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    let alive = true;
    api<ProgressStateDTO>(`/api/items/${itemId}/progress`)
      .then((s) => alive && setState(s))
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [itemId, refreshToken, tick, notify]);

  async function post(body: Record<string, unknown>, tag: string) {
    setBusy(tag);
    try {
      const r = await api<{ report: ProgressReportDTO; state: ProgressStateDTO }>(`/api/items/${itemId}/progress`, {
        method: "POST",
        body,
      });
      setState(r.state);
      notify(
        r.report.status === "ok"
          ? { kind: "ok", text: "진행상황을 해석했습니다." }
          : { kind: "error", text: `해석 실패: ${r.report.error ?? ""}` },
      );
      await onChanged();
      return r.report.status === "ok";
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!state) return <Card>불러오는 중…</Card>;
  const latest = state.latest;
  const lastFailed = state.history[0]?.status === "failed" ? state.history[0] : null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold">진행상황</h3>
          <p className="text-[12px] text-muted">
            회신의 양식 표는 규칙으로 읽고, 표가 없을 때만 LLM({state.llm})으로 해석합니다. 확인되지 않은 값은 “미정”입니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setRequestOpen(true)} className="px-3 py-1.5 rounded-md bg-accent text-white font-semibold text-[13px]">
            진행상황 요청 메일 보내기
          </button>
          <button onClick={() => setManualOpen((v) => !v)} className="px-3 py-1.5 rounded-md border border-line text-[13px]">
            {manualOpen ? "직접 입력 닫기" : "회신 직접 입력"}
          </button>
          {state.replies.length > 0 && (
            <button
              onClick={() => post({ action: "reparse" }, "reparse")}
              disabled={!!busy}
              className="px-3 py-1.5 rounded-md border border-line text-[13px] disabled:opacity-40"
            >
              {busy === "reparse" ? "해석 중…" : "최신 회신 다시 해석"}
            </button>
          )}
          <button
            onClick={() => setSharing(true)}
            disabled={!latest}
            className="px-3 py-1.5 rounded-md border border-accent text-accent font-semibold text-[13px] disabled:opacity-40"
          >
            공유
          </button>
        </div>
      </div>

      {manualOpen && (
        <div className="mb-4 space-y-2">
          <textarea
            aria-label="진행상황 회신 직접 입력"
            rows={7}
            className="w-full border border-line rounded-md px-3 py-2 font-mono text-[12.5px] bg-white"
            placeholder="회신 본문을 붙여 넣으세요 (양식 표가 있으면 규칙으로, 없으면 LLM으로 해석)"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            onClick={async () => {
              if (await post({ action: "manual", text: manual }, "manual")) {
                setManual("");
                setManualOpen(false);
              }
            }}
            disabled={!!busy || manual.trim().length < 10}
            className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
          >
            {busy === "manual" ? "해석 중…" : "등록하고 해석"}
          </button>
        </div>
      )}

      {lastFailed && (
        <div className="p-3 rounded-md bg-danger-soft text-danger text-[13px] mb-3">
          <b>최근 해석 실패</b> ({formatDateTime(lastFailed.createdAt)}) — 6단계는 진행하지 않았습니다. 다시 해석하거나 직접
          입력하세요.
          <div className="mt-1 break-all text-[12px]">{lastFailed.error}</div>
        </div>
      )}

      {latest ? (
        <>
          <div className="text-[12px] text-muted mb-2">
            {formatDateTime(latest.createdAt)} · {PROVIDER(latest)} · {latest.mailSubject ?? "(삭제된 메일)"}
          </div>
          <MilestoneTable ms={latest.milestones!} />
          {latest.changes.length > 0 && (
            <div className="mt-2 p-3 rounded-lg bg-warn-soft text-[12.5px]">
              <b>직전 대비 변경</b>
              <ul className="list-disc pl-5">
                {latest.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        !lastFailed && (
          <p className="text-[13px] text-muted">
            아직 진행상황이 없습니다. 요청 메일을 보내고 Copilot 회신을 받거나, ‘회신 직접 입력’을 쓰세요.
          </p>
        )
      )}

      {state.history.length > 1 && (
        <details className="mt-4">
          <summary className="text-[13px] font-semibold cursor-pointer">이력 ({state.history.length})</summary>
          <ul className="mt-2 divide-y divide-line border border-line rounded-lg text-[12.5px]">
            {state.history.map((h) => (
              <li key={h.id} className="px-3 py-2">
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-muted">{formatDateTime(h.createdAt)}</span>
                  <span className={`text-[11px] px-1.5 rounded ${h.status === "ok" ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
                    {h.status === "ok" ? "해석" : "실패"}
                  </span>
                  <span className="text-muted">{PROVIDER(h)}</span>
                  {h.milestones && (
                    <span>
                      상용적용 {h.milestones.find((m) => m.name === "상용적용")?.end || "미정"}
                    </span>
                  )}
                </div>
                {h.changes.length > 0 && <div className="text-warn mt-0.5">{h.changes.join(" · ")}</div>}
                {h.error && <div className="text-danger mt-0.5 break-all">{h.error}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {requestOpen && (
        <RequestMailDialog
          itemId={itemId}
          kind="progress"
          onClose={() => setRequestOpen(false)}
          onSent={async (_item, mail) => {
            setRequestOpen(false);
            notify({
              kind: "ok",
              text: mail.simulated ? "진행상황 요청 메일을 가상 메일함에 기록했습니다 (시뮬레이터)." : "진행상황 요청 메일을 보냈습니다.",
            });
            setTick((t) => t + 1);
            await onChanged();
          }}
          notify={notify}
        />
      )}
      {sharing && (
        <ProgressShareDialog
          itemId={itemId}
          onClose={() => setSharing(false)}
          onSent={async (n) => {
            setSharing(false);
            notify({ kind: "ok", text: `진행상황을 ${n}명에게 공유했습니다.` });
            await onChanged();
          }}
          notify={notify}
        />
      )}
    </Card>
  );
}

export function MilestoneTable({ ms }: { ms: Milestone[] }) {
  return (
    <div className="border border-line rounded-lg overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead className="bg-bg text-muted">
          <tr>
            <th className="text-left px-3 py-1.5">마일스톤</th>
            <th className="text-left px-3 py-1.5">상태</th>
            <th className="text-left px-3 py-1.5">시작일</th>
            <th className="text-left px-3 py-1.5">완료일</th>
            <th className="text-left px-3 py-1.5">근거</th>
            <th className="text-left px-3 py-1.5">비고</th>
          </tr>
        </thead>
        <tbody>
          {ms.map((m) => (
            <tr key={m.name} className="border-t border-line align-top">
              <td className="px-3 py-2 font-semibold whitespace-nowrap">{m.name}</td>
              <td className="px-3 py-2">
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${CHIP[m.status]}`}>{m.status}</span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{m.start || <Undecided />}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {m.end ? (
                  <>
                    {m.end} {m.endKind && <span className="text-muted">({m.endKind})</span>}
                  </>
                ) : (
                  <Undecided />
                )}
              </td>
              <td className="px-3 py-2 text-muted break-words">{m.source || "-"}</td>
              <td className="px-3 py-2 break-words">{m.note || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Undecided() {
  return <span className="text-muted">미정</span>;
}

/** 진행상황 공유 창: 본문에 마일스톤 표, 첨부 없음. 수신자 확인 후 두 번 눌러 발송 */
function ProgressShareDialog({
  itemId,
  onClose,
  onSent,
  notify,
}: {
  itemId: number;
  onClose: () => void;
  onSent: (n: number) => Promise<void>;
  notify: (t: Toast) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [mode, setMode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ to: string[]; subject: string; text: string; mode: string }>(`/api/items/${itemId}/share?kind=progress`)
      .then((d) => {
        if (!alive) return;
        setTo(d.to.join("\n"));
        setSubject(d.subject);
        setText(d.text);
        setMode(d.mode);
        setLoaded(true);
      })
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [itemId, notify]);

  const list = [...new Set(to.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean))];
  const bad = list.filter((s) => !/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s));

  async function send() {
    setBusy(true);
    try {
      await api(`/api/items/${itemId}/share?kind=progress`, { method: "POST", body: { to: list, subject, text } });
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
        aria-label="진행상황 공유"
        className="bg-panel rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-line">
          <h2 className="font-semibold text-[15px]">진행상황 공유</h2>
          <p className="text-[12px] text-muted">
            받는 사람 기본값은 관련자입니다. 본문에 마일스톤 표가 들어갑니다.
            {mode === "simulator" && " 지금은 시뮬레이터 모드라 실제로 발송하지 않고 기록만 합니다."}
          </p>
        </div>
        {!loaded ? (
          <div className="p-5 text-muted text-[13px]">불러오는 중…</div>
        ) : (
          <div className="px-5 py-3 overflow-y-auto flex-1 space-y-3 text-[13px]">
            <label className="block">
              <span className="text-[12px] text-muted">받는 사람 (한 줄에 한 명, 또는 쉼표로 구분) · {list.length}명</span>
              <textarea
                aria-label="받는 사람"
                rows={3}
                className={`w-full border rounded-md px-3 py-1.5 bg-white font-mono text-[12.5px] ${bad.length ? "border-danger" : "border-line"}`}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setConfirming(false);
                }}
              />
              {bad.length > 0 && <span className="text-[12px] text-danger">형식이 올바르지 않음: {bad.join(", ")}</span>}
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
                rows={12}
                className="w-full border border-line rounded-md px-3 py-1.5 bg-white font-mono text-[12px]"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="px-5 py-3 border-t border-line flex flex-wrap items-center justify-end gap-2">
          {confirming && <span className="text-[12px] text-warn mr-auto">{list.length}명에게 보냅니다. 한 번 더 누르면 발송합니다.</span>}
          <button onClick={onClose} className="px-4 py-2 rounded-md border border-line text-[13px]">
            취소
          </button>
          <button
            onClick={() => (confirming ? send() : setConfirming(true))}
            disabled={!loaded || busy || list.length === 0 || bad.length > 0 || !subject.trim()}
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
