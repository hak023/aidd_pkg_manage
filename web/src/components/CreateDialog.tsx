"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/client-api";
import type { NodeType } from "@/lib/db/schema";
import type { TreeNodeDTO } from "@/lib/repo/tree";
import { allowedParentTypes, NODE_TYPE_LABEL } from "@/lib/domain/tree";

export interface CreateDefaults {
  type: NodeType;
  parentId: number | null;
}

interface Props {
  defaults: CreateDefaults;
  flat: TreeNodeDTO[];
  onClose: () => void;
  onCreated: (node: TreeNodeDTO) => void;
}

const TYPES: NodeType[] = ["service", "label", "item"];
const PLACEHOLDER: Record<NodeType, string> = {
  service: "예: 통화매니저",
  label: "예: R181PKG_26.12",
  item: "예: 통화매니저 SSO 로그인 기능 개발",
};

export default function CreateDialog({ defaults, flat, onClose, onCreated }: Props) {
  const [type, setType] = useState<NodeType>(defaults.type);
  const [parentId, setParentId] = useState<number | null>(defaults.parentId);
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");
  const [searchPeriod, setSearchPeriod] = useState("");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const byId = useMemo(() => new Map(flat.map((n) => [n.id, n])), [flat]);
  const parentOptions = useMemo(() => {
    const allowed = allowedParentTypes(type).filter((t): t is NodeType => t !== null);
    return flat
      .filter((n) => allowed.includes(n.type))
      .map((n) => {
        const parent = n.parentId !== null ? byId.get(n.parentId) : undefined;
        const label = parent ? `${parent.name} / ${n.name}` : n.name;
        return { id: n.id, label, type: n.type };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "ko"));
  }, [flat, type, byId]);

  const needsParent = type !== "service";
  const validParent = !needsParent || parentOptions.some((o) => o.id === parentId);
  const effectiveParent = needsParent && validParent ? parentId : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsParent && effectiveParent === null) {
      setError(`상위 항목을 선택하세요. ${parentOptions.length === 0 ? "먼저 단위서비스를 만들어야 합니다." : ""}`);
      return;
    }
    setBusy(true);
    try {
      const { node } = await api<{ node: TreeNodeDTO }>("/api/nodes", {
        method: "POST",
        body: {
          type,
          name,
          parentId: effectiveParent,
          fields: type === "item" ? { keywords, searchPeriod, memo } : undefined,
        },
      });
      onCreated(node);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-start justify-center pt-[10vh] px-4 z-50"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg bg-panel rounded-xl shadow-xl border border-line p-6"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <h2 className="text-[16px] font-bold mb-4">새로 만들기</h2>

        <div className="grid grid-cols-3 gap-2 mb-4" role="radiogroup" aria-label="유형">
          {TYPES.map((t) => (
            <button
              type="button"
              key={t}
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`border rounded-md py-2 text-[13px] ${
                type === t ? "border-accent bg-accent-soft text-accent font-semibold" : "border-line text-muted"
              }`}
            >
              {NODE_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        {needsParent && (
          <Field label="상위 항목">
            <select
              value={effectiveParent ?? ""}
              onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-line rounded-md px-3 py-2 bg-white"
            >
              <option value="">선택하세요</option>
              {parentOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  [{NODE_TYPE_LABEL[o.type]}] {o.label}
                </option>
              ))}
            </select>
            {type === "item" && (
              <p className="text-[11px] text-muted mt-1">라벨링 또는 단위서비스(라벨 없음) 아래에 만들 수 있습니다.</p>
            )}
          </Field>
        )}

        <Field label={`${NODE_TYPE_LABEL[type]} 이름`}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={PLACEHOLDER[type]}
            className="w-full border border-line rounded-md px-3 py-2 bg-white"
            maxLength={120}
            required
          />
        </Field>

        {type === "item" && (
          <details className="mb-4 rounded-md border border-line px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-medium">
              수집 조건 <span className="text-muted font-normal">(선택 · Copilot 검색 정확도 향상)</span>
            </summary>
            <div className="pt-3">
              <Field label="검색 키워드">
                <input
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="예: 통화매니저, SSO, 로그인, 통합인증"
                  className="w-full border border-line rounded-md px-3 py-2 bg-white"
                />
              </Field>
              <Field label="검색 기간">
                <input
                  value={searchPeriod}
                  onChange={(e) => setSearchPeriod(e.target.value)}
                  placeholder="비워 두면 최근 6개월"
                  className="w-full border border-line rounded-md px-3 py-2 bg-white"
                />
              </Field>
              <Field label="메모">
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  rows={2}
                  placeholder="Copilot에게 함께 전달할 참고 사항"
                  className="w-full border border-line rounded-md px-3 py-2 bg-white"
                />
              </Field>
            </div>
          </details>
        )}

        {error && <p className="text-danger text-[13px] mb-3">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-md text-muted hover:bg-bg">
            취소
          </button>
          <button disabled={busy} className="px-4 py-2 rounded-md bg-accent text-white font-semibold disabled:opacity-60">
            {busy ? "만드는 중…" : "만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-[13px] font-medium mb-1">{props.label}</span>
      {props.children}
    </label>
  );
}
