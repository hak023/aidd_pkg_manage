"use client";

import { useEffect, useState } from "react";
import { api, formatDateTime } from "@/lib/client-api";
import type { StageKey, StageStatus } from "@/lib/db/schema";
import type { ItemDetailDTO } from "@/lib/repo/tree";
import type { MailSummaryDTO } from "@/lib/repo/mail";
import { STAGES, STATUS_LABEL, stageDef } from "@/lib/domain/stages";
import { docFileName, forwardSubject, mailTag } from "@/lib/domain/naming";
import type { Toast } from "./Workspace";
import { MailList, MailViewer } from "./Mail";
import ReviewPanel from "./ReviewPanel";
import PrdPanel from "./PrdPanel";
import DocReviewPanel from "./DocReviewPanel";
import ProgressPanel from "./ProgressPanel";
import RequestMailDialog from "./RequestMailDialog";
import PromptDisclosure from "./PromptDisclosure";

interface Props {
  id: number;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
  onSelect: (id: number | null) => void;
  /** 메일 확인 등으로 바뀌면 다시 불러온다 */
  refreshToken: number;
}

const STATUS_STYLE: Record<StageStatus, { circle: string; text: string; chip: string }> = {
  pending: { circle: "bg-panel border-line text-muted", text: "text-muted", chip: "bg-bg text-muted" },
  in_progress: { circle: "bg-warn border-warn text-white", text: "text-warn", chip: "bg-warn-soft text-warn" },
  done: { circle: "bg-ok border-ok text-white", text: "text-ok", chip: "bg-ok-soft text-ok" },
};

export default function ItemDetail({ id, onChanged, notify, onSelect, refreshToken }: Props) {
  const [item, setItem] = useState<ItemDetailDTO | null>(null);
  const [mails, setMails] = useState<MailSummaryDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<StageKey | null>(null);
  const [collectOpen, setCollectOpen] = useState(false);
  const [viewMail, setViewMail] = useState<number | null>(null);
  const [localTick, setLocalTick] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api<{ item: ItemDetailDTO }>(`/api/items/${id}`),
      api<{ mails: MailSummaryDTO[] }>(`/api/items/${id}/mails`),
    ])
      .then(([a, b]) => {
        if (!alive) return;
        setItem(a.item);
        setMails(b.mails);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [id, refreshToken, localTick]);

  if (error) return <div className="m-6 p-3 rounded-md bg-danger-soft text-danger text-[13px]">{error}</div>;
  if (!item) return <div className="p-6 text-muted">불러오는 중…</div>;

  const focused = stageDef(focus ?? item.currentStage);

  /** 작업 영역에서 단계가 바뀌었을 때: 상세·메일 이력과 트리를 다시 불러온다 */
  async function refresh() {
    setLocalTick((t) => t + 1);
    await onChanged();
  }

  async function setStatus(stage: StageKey, status: StageStatus) {
    try {
      const { item: next } = await api<{ item: ItemDetailDTO }>(`/api/items/${id}/stages`, {
        method: "PATCH",
        body: { stage, status },
      });
      setItem(next);
      await onChanged();
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    }
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify({ kind: "ok", text: `${what}을(를) 복사했습니다.` });
    } catch {
      window.prompt(`${what} (복사해서 사용하세요)`, text);
    }
  }

  const fileBase = {
    service: item.path.service?.name ?? "",
    label: item.path.label?.name ?? null,
    item: item.name,
  };

  return (
    <div className="p-6 max-w-6xl">
      {/* 머리글 */}
      <div className="text-[12px] text-muted mb-1 flex items-center gap-1">
        {item.path.service && (
          <button className="hover:underline" onClick={() => onSelect(item.path.service!.id)}>
            {item.path.service.name}
          </button>
        )}
        <span>/</span>
        {item.path.label ? (
          <button className="hover:underline" onClick={() => onSelect(item.path.label!.id)}>
            {item.path.label.name}
          </button>
        ) : (
          <span className="italic">라벨 없음</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 mb-1">
        <h1 className="text-[20px] font-bold">{item.name}</h1>
        <span className="font-mono text-[12px] px-2 py-0.5 rounded bg-bg border border-line">{item.code}</span>
        {item.completedAt && (
          <span className="text-[12px] px-2 py-0.5 rounded-full bg-ok-soft text-ok">
            완료 {formatDateTime(item.completedAt)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mb-6 text-[12px]">
        <button
          onClick={() => copy(forwardSubject(item.code, item.name), "전달용 제목")}
          className="border border-line bg-panel rounded-md px-2.5 py-1 hover:border-accent"
          title="개발사로부터 받은 architecture.md·qa.md 파일을 Gmail로 보낼 때 제목에 붙이면 자동으로 이 개발사항에 등록됩니다."
        >
          전달용 제목 복사 <span className="font-mono text-muted">{mailTag(item.code)}</span>
        </button>
      </div>

      {/* 진행 단계 그래프 */}
      <section className="bg-panel border border-line rounded-xl px-5 pt-5 pb-4 mb-4">
        <ol className="flex items-start">
          {STAGES.map((s, i) => {
            const st = item.statuses[s.key].status;
            const isCur = item.currentStage === s.key;
            const isFocus = focused.key === s.key;
            const style = STATUS_STYLE[st];
            return (
              <li key={s.key} className="flex-1 flex flex-col items-center relative min-w-0">
                {i > 0 && (
                  <span
                    className={`absolute top-4 right-1/2 w-full h-0.5 -z-0 ${
                      st === "done" && item.statuses[STAGES[i - 1].key].status === "done" ? "bg-ok" : "bg-line"
                    }`}
                    aria-hidden
                  />
                )}
                <button
                  onClick={() => setFocus(s.key)}
                  className={`relative z-10 w-8 h-8 rounded-full border-2 text-[12px] font-bold flex items-center justify-center ${
                    style.circle
                  } ${isCur ? "ring-4 ring-accent-soft" : ""} ${isFocus ? "outline-2 outline-accent outline-offset-2" : ""}`}
                  aria-label={`${s.no}. ${s.label} (${STATUS_LABEL[st]})`}
                >
                  {st === "done" ? "✓" : s.no}
                </button>
                <button
                  onClick={() => setFocus(s.key)}
                  className={`mt-2 text-[12px] text-center leading-tight px-1 ${
                    isFocus ? "font-semibold text-ink" : style.text
                  }`}
                >
                  {s.label}
                </button>
                <span className={`mt-1 text-[10px] px-1.5 rounded-full ${style.chip}`}>
                  {isCur && st !== "done" ? "현재 · " : ""}
                  {STATUS_LABEL[st]}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* 선택한 단계 설명 */}
      <section className="bg-panel border border-line rounded-xl p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[12px] text-muted">
              {focused.no}단계 {focus === null && "· 현재 단계"}
            </div>
            <h2 className="text-[16px] font-bold">{focused.label}</h2>
            <p className="text-[13px] mt-1">{focused.summary}</p>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="상태 변경">
            {(["pending", "in_progress", "done"] as StageStatus[]).map((st) => (
              <button
                key={st}
                onClick={() => setStatus(focused.key, st)}
                className={`px-2.5 py-1 rounded-md text-[12px] border ${
                  item.statuses[focused.key].status === st
                    ? `${STATUS_STYLE[st].chip} border-transparent font-semibold`
                    : "border-line text-muted hover:text-ink"
                }`}
              >
                {STATUS_LABEL[st]}
              </button>
            ))}
          </div>
        </div>

        <dl className="grid md:grid-cols-3 gap-3 text-[13px]">
          <Info title="사용자가 할 일">{focused.userAction}</Info>
          <Info title="시스템이 하는 일">{focused.systemAction}</Info>
          <Info title="완료 조건">{focused.doneWhen}</Info>
        </dl>

        {(focused.key === "review" || focused.key === "prd" || focused.key === "arch" || focused.key === "qa") && (
          <PromptDisclosure stage={focused.key} onCopy={copy} />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {focused.key === "done" && (
            <div className="w-full flex flex-wrap gap-1.5 mb-1 text-[12px]" aria-label="단계 요약">
              {STAGES.filter((x) => x.key !== "done").map((x) => (
                <span key={x.key} className={`px-2 py-0.5 rounded-full ${STATUS_STYLE[item.statuses[x.key].status].chip}`}>
                  {x.no}. {x.label} · {STATUS_LABEL[item.statuses[x.key].status]}
                </span>
              ))}
            </div>
          )}
          {focused.key === "done" ? (
            item.completedAt ? (
              <button
                onClick={() => setStatus("done", "pending")}
                className="px-4 py-2 rounded-md border border-line text-[13px]"
              >
                완료 취소
              </button>
            ) : (
              <button
                onClick={() => {
                  if (window.confirm("이 개발사항을 완료 처리할까요?")) void setStatus("done", "done");
                }}
                className="px-4 py-2 rounded-md bg-ok text-white font-semibold text-[13px]"
              >
                완료
              </button>
            )
          ) : focused.key === "collect" ? (
            <>
              <button
                onClick={() => setCollectOpen(true)}
                className="px-4 py-2 rounded-md bg-accent text-white font-semibold text-[13px]"
              >
                {ACTION_LABEL.collect}
              </button>
              <span className="text-[12px] text-muted">
                여러 번 보낼 수 있습니다. 회신이 오면 ‘메일 확인’ 때 자동으로 이 단계가 완료됩니다.
              </span>
            </>
          ) : (
            <span className="text-[12px] text-muted">
              아래 “
              {
                { review: "수집 검토", prd: "PRD", arch: "개발사 Architecture 문서", qa: "개발사 QA 문서", progress: "진행상황" }[
                  focused.key
                ]
              }
              ” 영역에서 진행합니다.
            </span>
          )}
        </div>

        {FILE_SUFFIX[focused.key] && fileBase.service && (
          <p className="mt-3 text-[12px] text-muted">
            생성될 파일명:{" "}
            <span className="font-mono">{docFileName(fileBase, FILE_SUFFIX[focused.key]!)}</span>
          </p>
        )}
      </section>

      {focused.key === "review" && (
        <ReviewPanel
          itemId={id}
          refreshToken={refreshToken + localTick}
          onChanged={refresh}
          notify={notify}
          onPrdCreated={() => setFocus("prd")}
        />
      )}
      {focused.key === "prd" && (
        <PrdPanel itemId={id} refreshToken={refreshToken + localTick} onChanged={refresh} notify={notify} />
      )}
      {focused.key === "progress" && (
        <ProgressPanel itemId={id} refreshToken={refreshToken + localTick} onChanged={refresh} notify={notify} />
      )}
      {(focused.key === "arch" || focused.key === "qa") && (
        <DocReviewPanel
          key={focused.key}
          itemId={id}
          kind={focused.key}
          refreshToken={refreshToken + localTick}
          onChanged={refresh}
          notify={notify}
        />
      )}

      <section className="bg-panel border border-line rounded-xl p-5 mb-4">
        <h3 className="font-semibold mb-2">메일 이력</h3>
        <MailList mails={mails} empty="아직 주고받은 메일이 없습니다." onOpen={setViewMail} />
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <FieldsCard item={item} onSaved={setItem} notify={notify} />
        <section className="bg-panel border border-line rounded-xl p-5">
          <h3 className="font-semibold mb-3">이력</h3>
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {item.events.map((e) => (
              <li key={e.id} className="text-[13px] flex gap-3">
                <span className="text-muted text-[12px] w-32 shrink-0">{formatDateTime(e.createdAt)}</span>
                <span>{e.message}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {collectOpen && (
        <RequestMailDialog
          itemId={id}
          kind="collect"
          onClose={() => setCollectOpen(false)}
          onSent={async (next, mail) => {
            setCollectOpen(false);
            setItem(next);
            setMails((prev) => [mail, ...prev]);
            await onChanged();
            notify({
              kind: "ok",
              text: mail.simulated ? "수집 요청 메일을 가상 메일함에 기록했습니다 (시뮬레이터)." : "수집 요청 메일을 보냈습니다.",
            });
          }}
          notify={notify}
        />
      )}
      {viewMail !== null && <MailViewer id={viewMail} onClose={() => setViewMail(null)} />}
    </div>
  );
}

const ACTION_LABEL: Record<Exclude<StageKey, "done">, string> = {
  collect: "수집 요청 메일 보내기",
  review: "PRD 생성",
  prd: "공유",
  arch: "검토 리포트 보기",
  qa: "검토 리포트 보기",
  progress: "진행상황 요청 메일 보내기",
};

const FILE_SUFFIX: Partial<Record<StageKey, string>> = { prd: "PRD", arch: "Architecture", qa: "QA" };

function Info(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg rounded-lg p-3">
      <dt className="text-[12px] font-semibold text-muted mb-1">{props.title}</dt>
      <dd className="leading-relaxed">{props.children}</dd>
    </div>
  );
}

function FieldsCard({
  item,
  onSaved,
  notify,
}: {
  item: ItemDetailDTO;
  onSaved: (i: ItemDetailDTO) => void;
  notify: (t: Toast) => void;
}) {
  const [f, setF] = useState(item.fields);
  const [busy, setBusy] = useState(false);
  const dirty =
    f.keywords !== item.fields.keywords || f.searchPeriod !== item.fields.searchPeriod || f.memo !== item.fields.memo;

  async function save() {
    setBusy(true);
    try {
      const { item: next } = await api<{ item: ItemDetailDTO }>(`/api/items/${item.id}`, { method: "PATCH", body: f });
      onSaved(next);
      notify({ kind: "ok", text: "수집 조건을 저장했습니다." });
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full border border-line rounded-md px-3 py-2 bg-white text-[13px]";
  return (
    <section className="bg-panel border border-line rounded-xl p-5">
      <h3 className="font-semibold mb-1">수집 조건</h3>
      <p className="text-[12px] text-muted mb-3">수집 요청 메일의 Copilot 지침에 들어갑니다.</p>
      <label className="block mb-2">
        <span className="text-[12px] text-muted">검색 키워드</span>
        <input className={input} value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
      </label>
      <label className="block mb-2">
        <span className="text-[12px] text-muted">검색 기간</span>
        <input
          className={input}
          value={f.searchPeriod}
          placeholder="비워 두면 최근 6개월"
          onChange={(e) => setF({ ...f, searchPeriod: e.target.value })}
        />
      </label>
      <label className="block mb-3">
        <span className="text-[12px] text-muted">메모</span>
        <textarea className={input} rows={3} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} />
      </label>
      <button
        onClick={save}
        disabled={!dirty || busy}
        className="px-3 py-1.5 rounded-md bg-accent text-white text-[13px] font-semibold disabled:opacity-40"
      >
        저장
      </button>
    </section>
  );
}
