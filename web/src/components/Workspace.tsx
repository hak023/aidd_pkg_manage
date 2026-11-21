"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, formatDateTime } from "@/lib/client-api";
import type { NodeType } from "@/lib/db/schema";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import type { MailStatusDTO, PollResult } from "@/lib/repo/mail";
import { buildTree } from "@/lib/domain/tree-build";
import TreePanel from "./TreePanel";
import CreateDialog, { type CreateDefaults } from "./CreateDialog";
import Dashboard from "./Dashboard";
import ItemDetail from "./ItemDetail";
import ContainerDetail from "./ContainerDetail";
import MailInbox from "./MailInbox";
import Settings from "./Settings";

type Page = "inbox" | "settings";
/** 사이트를 열어 둔 동안 자동 메일 확인 주기 */
const AUTO_POLL_MS = 2 * 60 * 1000;

export interface Toast {
  kind: "ok" | "error";
  text: string;
}

function readHash(): { id: number | null; page: Page | null } {
  const h = typeof window !== "undefined" ? window.location.hash : "";
  const m = h.match(/^#node-(\d+)$/);
  if (m) return { id: Number(m[1]), page: null };
  if (h === "#inbox" || h === "#settings") return { id: null, page: h.slice(1) as Page };
  return { id: null, page: null };
}

export default function Workspace() {
  const router = useRouter();
  const [flat, setFlat] = useState<TreeNodeDTO[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [create, setCreate] = useState<CreateDefaults | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [mailState, setMailState] = useState<MailStatusDTO | null>(null);
  const [polling, setPolling] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const pollingRef = useRef(false);

  const reload = useCallback(async () => {
    try {
      const { nodes } = await api<{ nodes: TreeNodeDTO[] }>("/api/tree");
      setFlat(nodes);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  const loadMailState = useCallback(async () => {
    try {
      setMailState(await api<MailStatusDTO>("/api/mail/status"));
    } catch {
      /* 머리글 표시용이므로 실패해도 무시 */
    }
  }, []);

  /** 메일 확인. manual이면 결과를 항상 알려 주고, 자동이면 새 메일이 있을 때만 알린다. */
  const poll = useCallback(
    async (manual: boolean) => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      setPolling(true);
      try {
        const r = await api<PollResult>("/api/mail/poll", { method: "POST" });
        if (r.stored > 0) {
          await reload();
          setRefreshToken((t) => t + 1);
        }
        if (manual || r.stored > 0) {
          setToast({
            kind: "ok",
            text:
              r.stored > 0
                ? `새 메일 ${r.stored}건 (개발사항 매칭 ${r.matched}, 미분류 ${r.unmatched})`
                : "새 메일이 없습니다.",
          });
        }
      } catch (e) {
        if (manual) setToast({ kind: "error", text: (e as Error).message });
      } finally {
        pollingRef.current = false;
        setPolling(false);
        await loadMailState();
      }
    },
    [reload, loadMailState],
  );

  useEffect(() => {
    // 최초 로드와 주소의 #node-N / #inbox / #settings 복원
    const apply = () => {
      const h = readHash();
      setSelectedId(h.id);
      setPage(h.page);
    };
    queueMicrotask(() => {
      apply();
      void reload();
      void loadMailState();
    });
    const onHash = apply;
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [reload, loadMailState]);

  useEffect(() => {
    // 화면이 보이는 동안만 자동 확인
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void poll(false);
    }, AUTO_POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const select = useCallback((id: number | null) => {
    setSelectedId(id);
    setPage(null);
    window.history.replaceState(null, "", id ? `#node-${id}` : window.location.pathname);
  }, []);

  const openPage = useCallback((p: Page) => {
    setSelectedId(null);
    setPage(p);
    window.history.replaceState(null, "", `#${p}`);
  }, []);

  const tree = useMemo(() => (flat ? buildTree(flat) : []), [flat]);
  const selected = flat?.find((n) => n.id === selectedId) ?? null;

  const notify = useCallback((t: Toast) => setToast(t), []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  function openCreate(type: NodeType, parentId: number | null) {
    setCreate({ type, parentId });
  }

  return (
    <div className="flex-1 flex flex-col h-screen">
      <header className="h-12 shrink-0 flex items-center justify-between px-4 bg-panel border-b border-line">
        <button className="flex items-baseline gap-2" onClick={() => select(null)} title="대시보드로">
          <span className="font-bold tracking-tight text-[15px]">AX_AIDD</span>
          <span className="text-muted text-[12px] hidden sm:inline">개발 산출물 작성 지원</span>
        </button>
        <div className="flex items-center gap-2">
          {mailState && mailState.mode !== "gmail" && (
            <button
              onClick={() => openPage("settings")}
              className={`text-[11px] px-2 py-0.5 rounded-full ${
                mailState.mode === "simulator" ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger"
              }`}
              title="메일 연동 설정 보기"
            >
              {mailState.mode === "simulator" ? "시뮬레이터 모드" : "메일 설정 필요"}
            </button>
          )}
          <button
            onClick={() => poll(true)}
            disabled={polling}
            className="border border-line rounded-md px-3 py-1.5 text-[13px] hover:border-accent disabled:opacity-50"
            title={mailState?.lastPollAt ? `마지막 확인: ${formatDateTime(mailState.lastPollAt)}` : "메일 확인"}
          >
            {polling ? "확인 중…" : "메일 확인"}
          </button>
          <button
            onClick={() => openPage("inbox")}
            className={`rounded-md px-3 py-1.5 text-[13px] border ${
              page === "inbox" ? "border-accent text-accent" : "border-line"
            }`}
          >
            미분류함
            {mailState && mailState.unmatched > 0 && (
              <span className="ml-1.5 inline-block min-w-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-semibold">
                {mailState.unmatched}
              </span>
            )}
          </button>
          <button
            onClick={() => openPage("settings")}
            className={`rounded-md px-2 py-1.5 text-[13px] ${page === "settings" ? "text-accent" : "text-muted hover:text-ink"}`}
          >
            설정
          </button>
          <button
            onClick={() => openCreate("item", null)}
            className="bg-accent text-white rounded-md px-3 py-1.5 text-[13px] font-semibold"
          >
            + 새로 만들기
          </button>
          <button onClick={logout} className="text-muted text-[13px] px-2 py-1.5 hover:text-ink">
            로그아웃
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-80 shrink-0 border-r border-line bg-panel overflow-y-auto">
          <TreePanel
            tree={tree}
            flat={flat ?? []}
            loading={flat === null}
            selectedId={selectedId}
            onSelect={select}
            onCreate={openCreate}
            onChanged={reload}
            notify={notify}
          />
        </aside>

        <main className="flex-1 overflow-y-auto">
          {loadError && (
            <div className="m-4 p-3 rounded-md bg-danger-soft text-danger text-[13px]">
              불러오기 실패: {loadError}
            </div>
          )}
          {!selected && page === "inbox" && (
            <MailInbox
              flat={flat ?? []}
              refreshToken={refreshToken}
              notify={notify}
              onChanged={async () => {
                await reload();
                await loadMailState();
              }}
            />
          )}
          {!selected && page === "settings" && (
            <Settings
              flat={flat ?? []}
              notify={notify}
              onPoll={() => poll(true)}
              onChanged={async () => {
                await reload();
                await loadMailState();
              }}
              onOpenDashboard={() => select(null)}
            />
          )}
          {!selected && !page && <Dashboard flat={flat ?? []} loading={flat === null} onSelect={select} onCreate={openCreate} />}
          {selected?.type === "item" && (
            <ItemDetail
              key={selected.id}
              id={selected.id}
              onChanged={reload}
              notify={notify}
              onSelect={select}
              refreshToken={refreshToken}
            />
          )}
          {selected && selected.type !== "item" && flat && (
            <ContainerDetail
              node={selected}
              flat={flat}
              onSelect={select}
              onCreate={openCreate}
              onChanged={reload}
              notify={notify}
            />
          )}
        </main>
      </div>

      {create && flat && (
        <CreateDialog
          defaults={create}
          flat={flat}
          onClose={() => setCreate(null)}
          onCreated={async (node) => {
            setCreate(null);
            await reload();
            select(node.id);
            notify({ kind: "ok", text: `생성했습니다: ${node.name}` });
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 -translate-x-1/2 px-4 py-2 rounded-md shadow-lg text-[13px] ${
            toast.kind === "ok" ? "bg-ink text-white" : "bg-danger text-white"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
