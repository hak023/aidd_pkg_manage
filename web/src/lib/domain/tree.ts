import type { NodeType } from "@/lib/db/schema";

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  service: "단위서비스",
  label: "라벨링",
  item: "개발사항",
};

export function isNodeType(v: unknown): v is NodeType {
  return v === "service" || v === "label" || v === "item";
}

/**
 * 배치 규칙
 * - 단위서비스: 최상위에만
 * - 라벨링: 단위서비스 아래
 * - 개발사항: 라벨링 아래 또는 단위서비스 바로 아래 (Q-01)
 */
export function allowedParentTypes(type: NodeType): (NodeType | null)[] {
  switch (type) {
    case "service":
      return [null];
    case "label":
      return ["service"];
    case "item":
      return ["label", "service"];
  }
}

export function canPlace(type: NodeType, parentType: NodeType | null): boolean {
  return allowedParentTypes(type).includes(parentType);
}

export function placementError(type: NodeType, parentType: NodeType | null): string | null {
  if (canPlace(type, parentType)) return null;
  const where = parentType ? `${NODE_TYPE_LABEL[parentType]} 아래` : "최상위";
  const allowed = allowedParentTypes(type)
    .map((p) => (p ? `${NODE_TYPE_LABEL[p]} 아래` : "최상위"))
    .join(" 또는 ");
  const topic = type === "service" ? "단위서비스는" : type === "label" ? "라벨링은" : "개발사항은";
  return `${topic} ${where}에 둘 수 없습니다. (${allowed}만 가능)`;
}

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > 120) return null;
  return name;
}
