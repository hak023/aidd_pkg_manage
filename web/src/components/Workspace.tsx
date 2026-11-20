"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import type { NodeType } from "@/lib/db/schema";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import { buildTree } from "@/lib/domain/tree-build";
import TreePanel from "./TreePanel";
import CreateDialog, { type CreateDefaults } from "./CreateDialog";
import Dashboard from "./Dashboard";
import ItemDetail from "./ItemDetail";
import ContainerDetail from "./ContainerDetail";

export interface Toast {
  kind: "ok" | "error";
  text: string;
}

function readHash(): number | null {
  const m = typeof window !== "undefined" ? window.location.hash.match(/^#node-(\d+)$/) : null;
  return m ? Number(m[1]) : null;
}

export default function Workspace() {
  const router = useRouter();
  const [flat, setFlat] = useState<TreeNodeDTO[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [create, setCreate] = useState<CreateDefaults | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { nodes } = await api<{ nodes: TreeNodeDTO[] }>("/api/tree");
      setFlat(nodes);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // 최초 로드와 주소의 #node-N 복원
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(readHash());
    void reload();
    const onHash = () => setSelectedId(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const select = useCallback((id: number | null) => {
    setSelectedId(id);
    window.history.replaceState(null, "", id ? `#node-${id}` : window.location.pathname);
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
          {!selected && <Dashboard flat={flat ?? []} loading={flat === null} onSelect={select} onCreate={openCreate} />}
          {selected?.type === "item" && (
            <ItemDetail key={selected.id} id={selected.id} onChanged={reload} notify={notify} onSelect={select} />
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
