"use client";

import type { NodeType } from "@/lib/db/schema";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import { NODE_TYPE_LABEL } from "@/lib/domain/tree";
import { stageDef } from "@/lib/domain/stages";
import type { Toast } from "./Workspace";
import StageDots from "./StageDots";

interface Props {
  node: TreeNodeDTO;
  flat: TreeNodeDTO[];
  onSelect: (id: number | null) => void;
  onCreate: (type: NodeType, parentId: number | null) => void;
  onChanged: () => Promise<void>;
  notify: (t: Toast) => void;
}

/** 단위서비스·라벨링 선택 시: 하위 항목 목록 */
export default function ContainerDetail({ node, flat, onSelect, onCreate }: Props) {
  const children = flat.filter((n) => n.parentId === node.id);
  const labels = children.filter((n) => n.type === "label");
  const items = children.filter((n) => n.type === "item");
  const parent = node.parentId !== null ? flat.find((n) => n.id === node.parentId) : null;

  return (
    <div className="p-6 max-w-4xl">
      <div className="text-[12px] text-muted mb-1">
        {parent ? (
          <button className="hover:underline" onClick={() => onSelect(parent.id)}>
            {parent.name}
          </button>
        ) : (
          NODE_TYPE_LABEL[node.type]
        )}
      </div>
      <h1 className="text-[20px] font-bold mb-1">{node.name}</h1>
      <p className="text-muted text-[13px] mb-5">
        {NODE_TYPE_LABEL[node.type]} · 이름은 트리에서 더블클릭해 바꿀 수 있습니다.
      </p>

      <div className="flex gap-2 mb-6">
        {node.type === "service" && (
          <button
            onClick={() => onCreate("label", node.id)}
            className="border border-line bg-panel rounded-md px-3 py-1.5 text-[13px] hover:border-accent"
          >
            + 라벨링 추가
          </button>
        )}
        <button
          onClick={() => onCreate("item", node.id)}
          className="border border-line bg-panel rounded-md px-3 py-1.5 text-[13px] hover:border-accent"
        >
          + 개발사항 추가{node.type === "service" ? " (라벨 없음)" : ""}
        </button>
      </div>

      {labels.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[13px] font-semibold text-muted mb-2">라벨링 {labels.length}개</h2>
          <div className="grid sm:grid-cols-2 gap-2">
            {labels.map((l) => {
              const n = flat.filter((x) => x.parentId === l.id && x.type === "item").length;
              return (
                <button
                  key={l.id}
                  onClick={() => onSelect(l.id)}
                  className="text-left bg-panel border border-line rounded-lg px-4 py-3 hover:border-accent"
                >
                  <div className="font-semibold">{l.name}</div>
                  <div className="text-[12px] text-muted">개발사항 {n}개</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-[13px] font-semibold text-muted mb-2">
          {node.type === "service" ? "라벨 없는 개발사항" : "개발사항"} {items.length}개
        </h2>
        {items.length === 0 ? (
          <p className="text-[13px] text-muted">없습니다.</p>
        ) : (
          <ul className="bg-panel border border-line rounded-lg divide-y divide-line">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => onSelect(it.id)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-bg"
                >
                  <span className="font-mono text-[12px] text-muted w-20">{it.item?.code}</span>
                  <span className="flex-1 font-medium">{it.name}</span>
                  {it.item && (
                    <>
                      <span className="text-[12px] text-muted">{stageDef(it.item.currentStage).label}</span>
                      <StageDots statuses={it.item.statuses} />
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
