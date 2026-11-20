"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { MailSummaryDTO } from "@/lib/repo/mail";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import type { Toast } from "./Workspace";
import { MailList, MailViewer } from "./Mail";

/** 미분류함: 개발사항을 찾지 못한 수신 메일을 수동으로 지정하거나 무시한다 */
export default function MailInbox({
  flat,
  refreshToken,
  onChanged,
  notify,
}: {
  flat: TreeNodeDTO[];
  refreshToken: number;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
}) {
  const [status, setStatus] = useState<"unmatched" | "ignored">("unmatched");
  const [mails, setMails] = useState<MailSummaryDTO[] | null>(null);
  const [viewMail, setViewMail] = useState<number | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api<{ mails: MailSummaryDTO[] }>(`/api/mails?status=${status}`)
      .then((r) => alive && setMails(r.mails))
      .catch((e: Error) => alive && notify({ kind: "error", text: e.message }));
    return () => {
      alive = false;
    };
  }, [status, refreshToken, tick, notify]);

  const items = flat.filter((n) => n.type === "item" && n.item);
  const pathName = (n: TreeNodeDTO) => {
    const names: string[] = [];
    let cur: TreeNodeDTO | undefined = n;
    while (cur) {
      names.unshift(cur.name);
      const pid: number | null = cur.parentId;
      cur = pid === null ? undefined : flat.find((x) => x.id === pid);
    }
    return names.join(" / ");
  };

  async function act(id: number, body: Record<string, unknown>, done: string) {
    try {
      await api(`/api/mails/${id}`, { method: "PATCH", body });
      notify({ kind: "ok", text: done });
      setTick((t) => t + 1);
      await onChanged();
    } catch (e) {
      notify({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-[20px] font-bold mb-1">미분류함</h1>
      <p className="text-[13px] text-muted mb-4">
        제목 태그·회신 헤더·본문 표식으로 개발사항을 찾지 못한 수신 메일입니다. 개발사항을 골라 지정하면 그 개발사항의
        메일로 등록되고 단계가 진행됩니다. (첨부 내용으로 자동 추정하는 기능은 P4에서 추가됩니다.)
      </p>
      <div className="flex gap-1.5 mb-3">
        {(["unmatched", "ignored"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`text-[12px] px-3 py-1 rounded-md border ${
              status === s ? "border-accent bg-accent-soft text-accent font-semibold" : "border-line text-muted"
            }`}
          >
            {s === "unmatched" ? "미분류" : "무시한 메일"}
          </button>
        ))}
      </div>
      <section className="bg-panel border border-line rounded-xl px-5 py-2">
        {mails === null ? (
          <p className="py-3 text-muted text-[13px]">불러오는 중…</p>
        ) : (
          <MailList
            mails={mails}
            empty={status === "unmatched" ? "미분류 메일이 없습니다." : "무시한 메일이 없습니다."}
            onOpen={setViewMail}
            actions={(m) =>
              status === "unmatched" ? (
                <>
                  <select
                    aria-label="지정할 개발사항"
                    className="border border-line rounded-md px-2 py-1 text-[12px] max-w-64 bg-white"
                    value={pick[m.id] ?? ""}
                    onChange={(e) => setPick({ ...pick, [m.id]: e.target.value })}
                  >
                    <option value="">개발사항 선택…</option>
                    {items.map((n) => (
                      <option key={n.id} value={n.id}>
                        [{n.item!.code}] {pathName(n)}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!pick[m.id]}
                    onClick={() => act(m.id, { action: "assign", itemId: Number(pick[m.id]) }, "개발사항에 지정했습니다.")}
                    className="text-[12px] px-2.5 py-1 rounded-md bg-accent text-white font-semibold disabled:opacity-40"
                  >
                    지정
                  </button>
                  <button
                    onClick={() => act(m.id, { action: "ignore" }, "무시한 메일로 옮겼습니다.")}
                    className="text-[12px] px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink"
                  >
                    무시
                  </button>
                </>
              ) : (
                <button
                  onClick={() => act(m.id, { action: "restore" }, "미분류함으로 되돌렸습니다.")}
                  className="text-[12px] px-2.5 py-1 rounded-md border border-line text-muted hover:text-ink"
                >
                  되돌리기
                </button>
              )
            }
          />
        )}
      </section>
      {viewMail !== null && <MailViewer id={viewMail} onClose={() => setViewMail(null)} />}
    </div>
  );
}
