import type { TreeNodeDTO } from "@/lib/repo/tree";

export interface TreeNode extends TreeNodeDTO {
  children: TreeNode[];
}

export function buildTree(flat: TreeNodeDTO[]): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  for (const n of flat) byId.set(n.id, { ...n, children: [] });
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.parentId !== null ? byId.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  const sort = (arr: TreeNode[]) => {
    // 같은 부모 아래에서는 라벨링을 개발사항보다 먼저 보여 준다
    const rank = (t: TreeNode["type"]) => (t === "item" ? 1 : 0);
    arr.sort((a, b) => rank(a.type) - rank(b.type) || a.sortOrder - b.sortOrder || a.id - b.id);
    arr.forEach((c) => sort(c.children));
  };
  sort(roots);
  return roots;
}

export function countDescendants(n: TreeNode): number {
  return n.children.reduce((acc, c) => acc + 1 + countDescendants(c), 0);
}

/** 개발사항의 경로 이름 (단위서비스 / 라벨링) */
export function pathOf(flat: TreeNodeDTO[], id: number): { service?: TreeNodeDTO; label?: TreeNodeDTO } {
  const byId = new Map(flat.map((n) => [n.id, n]));
  const out: { service?: TreeNodeDTO; label?: TreeNodeDTO } = {};
  let cur = byId.get(id);
  while (cur && cur.parentId !== null) {
    cur = byId.get(cur.parentId);
    if (cur?.type === "label") out.label = cur;
    if (cur?.type === "service") out.service = cur;
  }
  return out;
}
