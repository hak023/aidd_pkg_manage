"use client";

import { useMemo, useState } from "react";
import type { NodeType } from "@/lib/db/schema";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import { pathOf } from "@/lib/domain/tree-build";
import { STAGES, stageDef } from "@/lib/domain/stages";
import { formatDateTime } from "@/lib/client-api";
import StageDots from "./StageDots";

interface Props {
  flat: TreeNodeDTO[];
  loading: boolean;
  onSelect: (id: number) => void;
  onCreate: (type: NodeType, parentId: number | null) => void;
}

export default function Dashboard({ flat, loading, onSelect, onCreate }: Props) {
  const [showDone, setShowDone] = useState(false);
  const items = useMemo(
    () =>
      flat
        .filter((n) => n.type === "item" && n.item)
        .map((n) => ({ node: n, path: pathOf(flat, n.id) }))
        .filter((r) => showDone || !r.node.item!.completedAt)
        .sort((a, b) => (b.node.item!.lastEventAt ?? "").localeCompare(a.node.item!.lastEventAt ?? "")),
    [flat, showDone],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s.key, 0])) as Record<string, number>;
    for (const n of flat) if (n.item) c[n.item.currentStage]++;
    return c;
  }, [flat]);

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <h1 className="text-[20px] font-bold">대시보드</h1>
          <p className="text-muted text-[13px]">개발사항별 현재 단계와 최근 활동을 확인합니다.</p>
        </div>
        <label className="text-[13px] text-muted flex items-center gap-1.5">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          완료 포함
        </label>
      </div>

      <div className="grid grid-cols-4 lg:grid-cols-7 gap-2 mb-5">
        {STAGES.map((s) => (
          <div key={s.key} className="bg-panel border border-line rounded-lg px-3 py-2">
            <div className="text-[11px] text-muted truncate">
              {s.no}. {s.label}
            </div>
            <div className="text-[20px] font-bold">{counts[s.key]}</div>
          </div>
        ))}
      </div>

      <div className="bg-panel border border-line rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-bg text-muted text-left">
            <tr>
              <th className="px-3 py-2 font-medium w-24">코드</th>
              <th className="px-3 py-2 font-medium">개발사항</th>
              <th className="px-3 py-2 font-medium">단위서비스 / 라벨링</th>
              <th className="px-3 py-2 font-medium">현재 단계</th>
              <th className="px-3 py-2 font-medium">진행</th>
              <th className="px-3 py-2 font-medium w-32">상용적용</th>
              <th className="px-3 py-2 font-medium w-36">최근 활동</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  불러오는 중…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted">
                  표시할 개발사항이 없습니다.{" "}
                  <button className="text-accent hover:underline" onClick={() => onCreate("item", null)}>
                    개발사항 만들기
                  </button>
                </td>
              </tr>
            )}
            {items.map(({ node, path }) => {
              const cur = stageDef(node.item!.currentStage);
              return (
                <tr
                  key={node.id}
                  onClick={() => onSelect(node.id)}
                  className="border-t border-line hover:bg-bg cursor-pointer"
                >
                  <td className="px-3 py-2 font-mono text-[12px] text-muted">{node.item!.code}</td>
                  <td className="px-3 py-2 font-medium">{node.name}</td>
                  <td className="px-3 py-2 text-muted">
                    {path.service?.name ?? "-"} {path.label ? `/ ${path.label.name}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[12px] ${
                        cur.key === "done" ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent"
                      }`}
                    >
                      {cur.no}. {cur.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <StageDots statuses={node.item!.statuses} />
                  </td>
                  <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                    {node.item!.launch?.end ? (
                      <span title={`상태: ${node.item!.launch.status}`}>
                        {node.item!.launch.end}
                        {node.item!.launch.endKind && <span className="text-muted"> ({node.item!.launch.endKind})</span>}
                      </span>
                    ) : (
                      <span className="text-muted">미정</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted text-[12px]">{formatDateTime(node.item!.lastEventAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
