"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import type { NodeType } from "@/lib/db/schema";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import { canPlace, NODE_TYPE_LABEL, placementError } from "@/lib/domain/tree";
import { countDescendants, type TreeNode } from "@/lib/domain/tree-build";
import { stageDef } from "@/lib/domain/stages";
import type { Toast } from "./Workspace";

interface Props {
  tree: TreeNode[];
  flat: TreeNodeDTO[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onCreate: (type: NodeType, parentId: number | null) => void;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
}

const TYPE_ICON: Record<NodeType, string> = { service: "▣", label: "◆", item: "•" };
const TYPE_COLOR: Record<NodeType, string> = {
  service: "text-accent",
  label: "text-warn",
  item: "text-muted",
};

export default function TreePanel(props: Props) {
  const { tree, flat, loading } = props;
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [drag, setDrag] = useState<{ id: number; type: NodeType } | null>(null);
  const [dropTarget, setDropTarget] = useState<number | "root" | null>(null);
  const [renaming, setRenaming] = useState<number | null>(null);

  const toggle = (id: number) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  async function move(id: number, parentId: number | null) {
    const node = flat.find((n) => n.id === id);
    const parent = parentId === null ? null : flat.find((n) => n.id === parentId);
    if (!node || node.parentId === parentId) return;
    const err = placementError(node.type, parent?.type ?? null);
    if (err) {
      props.notify({ kind: "error", text: err });
      return;
    }
    try {
      await api(`/api/nodes/${id}`, { method: "PATCH", body: { parentId } });
      await props.onChanged();
      if (parentId) setCollapsed((s) => (s.has(parentId) ? new Set([...s].filter((x) => x !== parentId)) : s));
      props.notify({ kind: "ok", text: `${node.name} → ${parent ? parent.name : "최상위"}로 이동했습니다.` });
    } catch (e) {
      props.notify({ kind: "error", text: (e as Error).message });
    }
  }

  async function rename(id: number, name: string) {
    setRenaming(null);
    const node = flat.find((n) => n.id === id);
    if (!node || !name.trim() || name.trim() === node.name) return;
    try {
      await api(`/api/nodes/${id}`, { method: "PATCH", body: { name } });
      await props.onChanged();
    } catch (e) {
      props.notify({ kind: "error", text: (e as Error).message });
    }
  }

  async function remove(n: TreeNode) {
    const sub = countDescendants(n);
    const msg =
      sub > 0
        ? `“${n.name}”과(와) 하위 항목 ${sub}개를 모두 삭제합니다. 개발사항의 이력도 함께 삭제됩니다. 계속할까요?`
        : `“${n.name}”을(를) 삭제할까요?`;
    if (!window.confirm(msg)) return;
    try {
      await api(`/api/nodes/${n.id}`, { method: "DELETE" });
      if (props.selectedId === n.id) props.onSelect(null);
      await props.onChanged();
      props.notify({ kind: "ok", text: "삭제했습니다." });
    } catch (e) {
      props.notify({ kind: "error", text: (e as Error).message });
    }
  }

  function canDropOn(targetType: NodeType | null, targetId: number | null) {
    if (!drag) return false;
    if (targetId === drag.id) return false;
    return canPlace(drag.type, targetType);
  }

  function renderNode(n: TreeNode, depth: number) {
    const isCollapsed = collapsed.has(n.id);
    const selected = props.selectedId === n.id;
    const isDrop = dropTarget === n.id;
    const childType: NodeType | null = n.type === "service" ? "label" : n.type === "label" ? "item" : null;

    return (
      <li key={n.id}>
        <div
          draggable={renaming !== n.id}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(n.id));
            setDrag({ id: n.id, type: n.type });
          }}
          onDragEnd={() => {
            setDrag(null);
            setDropTarget(null);
          }}
          onDragOver={(e) => {
            if (canDropOn(n.type, n.id)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dropTarget !== n.id) setDropTarget(n.id);
            }
          }}
          onDragLeave={() => dropTarget === n.id && setDropTarget(null)}
          onDrop={(e) => {
            e.preventDefault();
            const id = drag?.id;
            setDrag(null);
            setDropTarget(null);
            if (id) void move(id, n.id);
          }}
          onClick={() => props.onSelect(n.id)}
          className={`group flex items-center gap-1 pr-1 py-1 cursor-pointer rounded-md mx-1 ${
            selected ? "bg-accent-soft" : "hover:bg-bg"
          } ${isDrop ? "ring-2 ring-accent ring-inset" : ""} ${drag?.id === n.id ? "opacity-40" : ""}`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <button
            className={`w-4 text-[10px] text-muted ${n.children.length ? "" : "invisible"}`}
            onClick={(e) => {
              e.stopPropagation();
              toggle(n.id);
            }}
            aria-label={isCollapsed ? "펼치기" : "접기"}
          >
            {isCollapsed ? "▶" : "▼"}
          </button>
          <span className={`text-[11px] ${TYPE_COLOR[n.type]}`} title={NODE_TYPE_LABEL[n.type]}>
            {TYPE_ICON[n.type]}
          </span>
          {renaming === n.id ? (
            <input
              autoFocus
              defaultValue={n.name}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => rename(n.id, e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
              className="flex-1 min-w-0 border border-accent rounded px-1 text-[13px] bg-white"
            />
          ) : (
            <span
              className={`flex-1 min-w-0 truncate text-[13px] ${n.type === "service" ? "font-semibold" : ""} ${
                n.item?.completedAt ? "line-through text-muted" : ""
              }`}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setRenaming(n.id);
              }}
              title={n.name}
            >
              {n.name}
            </span>
          )}
          {n.item && renaming !== n.id && (
            <span
              className={`shrink-0 text-[10px] px-1.5 rounded-full group-hover:hidden ${
                n.item.currentStage === "done" ? "bg-ok-soft text-ok" : "bg-bg text-muted"
              }`}
            >
              {stageDef(n.item.currentStage).no}. {stageDef(n.item.currentStage).label.split(/[·(]/)[0]}
            </span>
          )}
          {renaming !== n.id && (
            <span className="shrink-0 hidden group-hover:flex items-center gap-0.5">
              {childType && (
                <IconBtn
                  title={`${NODE_TYPE_LABEL[childType]} 추가`}
                  onClick={() => props.onCreate(childType, n.id)}
                >
                  +
                </IconBtn>
              )}
              {n.type === "service" && (
                <IconBtn title="개발사항 바로 추가 (라벨 없음)" onClick={() => props.onCreate("item", n.id)}>
                  ⊕
                </IconBtn>
              )}
              <IconBtn title="이름 변경" onClick={() => setRenaming(n.id)}>
                ✎
              </IconBtn>
              <IconBtn title="삭제" onClick={() => remove(n)}>
                ✕
              </IconBtn>
            </span>
          )}
        </div>
        {!isCollapsed && n.children.length > 0 && <ul>{n.children.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  }

  return (
    <div className="py-2 min-h-full flex flex-col">
      <div className="px-3 pb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted">개발사항 트리</span>
        <button
          className="text-[12px] text-accent hover:underline"
          onClick={() => props.onCreate("service", null)}
        >
          + 단위서비스
        </button>
      </div>
      {loading && <p className="px-4 text-muted text-[13px]">불러오는 중…</p>}
      {!loading && tree.length === 0 && (
        <div className="mx-3 p-3 rounded-md bg-bg text-[12px] text-muted leading-relaxed">
          아직 항목이 없습니다. <b>+ 단위서비스</b>로 시작하거나, 위의 <b>+ 새로 만들기</b>에서 한 번에 만들 수 있습니다.
        </div>
      )}
      <ul>{tree.map((n) => renderNode(n, 0))}</ul>
      {/* 최상위 드롭 영역 (단위서비스만 의미 있음) */}
      <div
        onDragOver={(e) => {
          if (canDropOn(null, null)) {
            e.preventDefault();
            setDropTarget("root");
          }
        }}
        onDragLeave={() => dropTarget === "root" && setDropTarget(null)}
        onDrop={(e) => {
          e.preventDefault();
          const id = drag?.id;
          setDrag(null);
          setDropTarget(null);
          if (id) void move(id, null);
        }}
        className={`flex-1 min-h-10 mx-2 mt-2 rounded-md ${dropTarget === "root" ? "bg-accent-soft" : ""}`}
      />
      <p className="px-3 pt-2 text-[11px] text-muted leading-relaxed">
        드래그해서 다른 항목 아래로 옮길 수 있습니다. 이름을 더블클릭하면 바꿀 수 있습니다.
      </p>
    </div>
  );
}

function IconBtn(props: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={props.title}
      aria-label={props.title}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
      className="w-5 h-5 text-[12px] leading-none rounded text-muted hover:bg-panel hover:text-ink"
    >
      {props.children}
    </button>
  );
}
