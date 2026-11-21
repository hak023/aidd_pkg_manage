"use client";

import { useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client-api";
import type { ReviewDTO, ReviewStateDTO } from "@/lib/repo/prd";
import type { SectionStatus } from "@/lib/llm/review";
import type { Toast } from "./Workspace";

const STATUS_CHIP: Record<SectionStatus, string> = {
  충분: "bg-ok-soft text-ok",
  부족: "bg-warn-soft text-warn",
  "확인 안 됨": "bg-danger-soft text-danger",
};

/** 2단계 수집 검토: L1 점검 결과, 추가 입력, PRD 생성 */
export default function ReviewPanel({
  itemId,
  refreshToken,
  onChanged,
  notify,
  onPrdCreated,
}: {
  itemId: number;
  refreshToken: number;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
  onPrdCreated: () => void;
}) {
  const [state, setState] = useState<ReviewStateDTO | null>(null);
  const [mailId, setMailId] = useState<string>("");
  const [busy, setBusy] = useState<"review" | "save" | "prd" | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [loadedFor, setLoadedFor] = useState<number | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");

  useEffect(() => {
    let alive = true;
    api<ReviewStateDTO>(`/api/items/${itemId}/review`)
      .then((s) => {
        if (!alive) return;
        setState(s);
      })
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [itemId, refreshToken, notify]);

  // 점검 결과가 바뀌면 입력란을 그 결과의 저장값으로 맞춘다
  const latest = state?.latest ?? null;
  if (latest && loadedFor !== latest.id) {
    setLoadedFor(latest.id);
    setAnswers(latest.answers);
    setNote(latest.extraNote);
  }

  const dirty =
    !!latest &&
    (note !== latest.extraNote ||
      JSON.stringify(clean(answers)) !== JSON.stringify(clean(latest.answers)));

  async function addManual() {
    setBusy("review");
    try {
      await api(`/api/items/${itemId}/manual-reply`, { method: "POST", body: { text: manualText } });
      notify({ kind: "ok", text: "회신을 등록했습니다. ‘점검 실행’을 누르세요." });
      setManualText("");
      setManualOpen(false);
      setMailId("");
      await onChanged();
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function runReview() {
    setBusy("review");
    try {
      const r = await api<{ review: ReviewDTO; state: ReviewStateDTO }>(`/api/items/${itemId}/review`, {
        method: "POST",
        body: { mailId: mailId ? Number(mailId) : null },
      });
      setState(r.state);
      notify(
        r.review.status === "ok"
          ? { kind: "ok", text: "수집 회신 점검을 마쳤습니다." }
          : { kind: "error", text: `점검 실패: ${r.review.error ?? ""}` },
      );
      await onChanged();
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function save(quiet = false): Promise<boolean> {
    if (!latest) return false;
    setBusy("save");
    try {
      const r = await api<{ review: ReviewDTO }>(`/api/reviews/${latest.id}`, {
        method: "PATCH",
        body: { answers: clean(answers), extraNote: note },
      });
      setState((s) => (s ? { ...s, latest: r.review } : s));
      setLoadedFor(r.review.id);
      if (!quiet) notify({ kind: "ok", text: "추가 입력을 저장했습니다." });
      return true;
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function makePrd() {
    if (dirty && !(await save(true))) return;
    setBusy("prd");
    try {
      const r = await api<{ document: { version: number } }>(`/api/items/${itemId}/prd`, { method: "POST" });
      notify({ kind: "ok", text: `PRD v${r.document.version}을(를) 만들었습니다.` });
      await onChanged();
      onPrdCreated();
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!state) return <Card>불러오는 중…</Card>;

  const res = latest?.status === "ok" ? latest.result : null;
  const counts = res
    ? (["충분", "부족", "확인 안 됨"] as SectionStatus[]).map((s) => [s, res.sections.filter((x) => x.status === s).length] as const)
    : [];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="font-semibold">수집 검토</h3>
          <p className="text-[12px] text-muted">
            회신을 12개 항목으로 정리하고 부족한 점을 표시합니다. 판단은 담당자가 합니다. · LLM: {state.llm}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {state.replies.length > 1 && (
            <select
              aria-label="점검할 회신"
              className="border border-line rounded-md px-2 py-1.5 text-[12px] max-w-72 bg-white"
              value={mailId}
              onChange={(e) => setMailId(e.target.value)}
            >
              <option value="">최신 회신</option>
              {state.replies.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDateTime(r.date)} · {r.subject}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => setManualOpen((v) => !v)}
            className="px-3 py-1.5 rounded-md border border-line text-[13px]"
            title="Gmail을 쓸 수 없을 때 Copilot 회신 본문을 붙여 넣어 등록"
          >
            {manualOpen ? "직접 입력 닫기" : "회신 직접 입력"}
          </button>
          <button
            onClick={runReview}
            disabled={!!busy || state.replies.length === 0}
            className="px-3 py-1.5 rounded-md border border-accent text-accent text-[13px] font-semibold disabled:opacity-40"
          >
            {busy === "review" ? "점검 중…" : latest ? "다시 점검" : "점검 실행"}
          </button>
        </div>
      </div>

      {manualOpen && (
        <div className="mb-4 space-y-2">
          <textarea
            aria-label="회신 본문 직접 입력"
            rows={8}
            className="w-full border border-line rounded-md px-3 py-2 font-mono text-[12.5px] bg-white"
            placeholder="Copilot이 작성한 회신 본문을 붙여 넣으세요 (<<<AX_AIDD_REPLY_START …>>> 표식이 있으면 그 구간만 사용)"
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
          />
          <button
            onClick={addManual}
            disabled={!!busy || manualText.trim().length < 20}
            className="px-4 py-1.5 rounded-md bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
          >
            수집 회신으로 등록
          </button>
          <span className="text-[12px] text-muted ml-2">등록하면 1단계가 완료됩니다.</span>
        </div>
      )}

      {state.replies.length === 0 && !manualOpen && (
        <p className="text-[13px] text-muted">
          아직 수집 회신이 없습니다. 1단계에서 수집 요청 메일을 보내고 회신을 받거나, ‘회신 직접 입력’으로 붙여 넣으세요.
        </p>
      )}

      {latest?.status === "failed" && (
        <div className="p-3 rounded-md bg-danger-soft text-danger text-[13px] mb-3">
          <b>점검 실패</b> ({formatDateTime(latest.createdAt)}) — 단계는 진행하지 않았습니다. 다시 점검하세요.
          <div className="mt-1 break-all text-[12px]">{latest.error}</div>
        </div>
      )}

      {res && latest && (
        <>
          <div className="text-[12px] text-muted mb-2">
            {formatDateTime(latest.createdAt)} 점검 · {latest.provider === "mock" ? "모의 LLM" : latest.model} · 대상:{" "}
            {latest.mailSubject ?? "(삭제된 메일)"} · 점검 {state.reviewCount}회
          </div>
          <div className="flex gap-2 mb-3">
            {counts.map(([s, n]) => (
              <span key={s} className={`text-[12px] px-2 py-0.5 rounded-full ${STATUS_CHIP[s]}`}>
                {s} {n}
              </span>
            ))}
          </div>

          <div className="border border-line rounded-lg overflow-hidden mb-4">
            <table className="w-full text-[12.5px]">
              <thead className="bg-bg text-muted">
                <tr>
                  <th className="text-left px-3 py-1.5 w-44">항목</th>
                  <th className="text-left px-3 py-1.5 w-24">상태</th>
                  <th className="text-left px-3 py-1.5">정리 내용</th>
                </tr>
              </thead>
              <tbody>
                {res.sections.map((s) => (
                  <tr key={s.no} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-semibold">
                      {s.no}. {s.title}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_CHIP[s.status]}`}>
                        {s.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-pre-wrap break-words">
                      {s.summary}
                      {s.sources.length > 0 && <div className="text-[11px] text-muted mt-1">출처 {s.sources.length}건</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid md:grid-cols-3 gap-3 mb-4 text-[12.5px]">
            <ListBox title={`[상충] ${res.conflicts.length}`} items={res.conflicts} tone="warn" />
            <ListBox title={`출처 없는 진술 ${res.unsourced.length}`} items={res.unsourced} tone="muted" />
            <ListBox
              title={`관련자 ${res.stakeholders.length} (공유 수신자 기본값)`}
              items={res.stakeholders.map((p) => [p.name, p.dept, p.role, p.email].filter(Boolean).join(" · "))}
              tone="muted"
            />
          </div>

          <h4 className="font-semibold text-[13px] mb-1">추가 확인 질문 ({res.questions.length})</h4>
          <p className="text-[12px] text-muted mb-2">
            아는 내용을 답으로 적으세요. 비워 둔 질문은 PRD의 “미결 사항”에 들어갑니다.
          </p>
          <ol className="space-y-2 mb-3">
            {res.questions.map((q, i) => (
              <li key={i} className="text-[13px]">
                <div className="mb-1">
                  <span className="text-muted mr-1">Q{i + 1}{q.section ? ` [${q.section}]` : ""}</span>
                  {q.question}
                </div>
                <textarea
                  aria-label={`질문 ${i + 1}의 답`}
                  rows={2}
                  className="w-full border border-line rounded-md px-3 py-1.5 bg-white text-[13px]"
                  value={answers[String(i)] ?? ""}
                  onChange={(e) => setAnswers({ ...answers, [String(i)]: e.target.value })}
                />
              </li>
            ))}
          </ol>
          <label className="block mb-3">
            <span className="text-[13px] font-semibold">보완 메모</span>
            <textarea
              aria-label="보완 메모"
              rows={3}
              className="w-full border border-line rounded-md px-3 py-1.5 bg-white text-[13px] mt-1"
              placeholder="질문 외에 PRD에 반영할 내용 (근거가 있으면 출처도 적어 주세요)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => save()}
              disabled={!dirty || !!busy}
              className="px-3 py-1.5 rounded-md border border-line text-[13px] disabled:opacity-40"
            >
              {busy === "save" ? "저장 중…" : "입력 저장"}
            </button>
            <button
              onClick={makePrd}
              disabled={!!busy}
              className="px-4 py-2 rounded-md bg-accent text-white font-semibold text-[13px] disabled:opacity-40"
            >
              {busy === "prd" ? "PRD 만드는 중…" : "PRD 생성"}
            </button>
            <span className="text-[12px] text-muted">
              저장하지 않은 입력은 PRD 생성 전에 자동으로 저장됩니다. 생성하면 2단계가 완료됩니다.
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function clean(a: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(a)
      .filter(([, v]) => v.trim())
      .sort(([x], [y]) => Number(x) - Number(y)),
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="bg-panel border border-line rounded-xl p-5 mb-4">{children}</section>;
}

function ListBox({ title, items, tone }: { title: string; items: string[]; tone: "warn" | "muted" }) {
  return (
    <div className={`rounded-lg p-3 ${tone === "warn" ? "bg-warn-soft" : "bg-bg"}`}>
      <div className="font-semibold mb-1">{title}</div>
      {items.length === 0 ? (
        <div className="text-muted">없음</div>
      ) : (
        <ul className="list-disc pl-4 space-y-0.5 max-h-40 overflow-y-auto">
          {items.map((x, i) => (
            <li key={i} className="break-words">
              {x}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
