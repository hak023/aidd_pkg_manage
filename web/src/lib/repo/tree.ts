import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { getHandle } from "@/lib/db/client";
import { devItems, events, nodes, stages, type NodeType, type StageKey, type StageStatus } from "@/lib/db/schema";
import { currentStage, STAGE_KEYS, STAGES, STATUS_LABEL } from "@/lib/domain/stages";
import { formatDevCode } from "@/lib/domain/naming";
import { NODE_TYPE_LABEL, normalizeName, placementError } from "@/lib/domain/tree";
import { badRequest, notFound } from "./errors";

export interface TreeNodeDTO {
  id: number;
  type: NodeType;
  name: string;
  parentId: number | null;
  sortOrder: number;
  item?: {
    code: string;
    currentStage: StageKey;
    completedAt: string | null;
    statuses: Partial<Record<StageKey, StageStatus>>;
    lastEventAt: string | null;
    /** 최신 진행상황의 상용적용 (P5). 없으면 null → 화면에 "미정" */
    launch: { status: string; end: string; endKind: string } | null;
  };
}

export interface ItemFields {
  keywords?: string;
  searchPeriod?: string;
  memo?: string;
}

function cleanFields(f: ItemFields | undefined): ItemFields {
  const out: ItemFields = {};
  if (!f) return out;
  for (const k of ["keywords", "searchPeriod", "memo"] as const) {
    const v = f[k];
    if (typeof v === "string") out[k] = v.trim().slice(0, 2000);
  }
  return out;
}

export async function listTree(): Promise<TreeNodeDTO[]> {
  const { db } = await getHandle();
  const rows = await db.select().from(nodes).orderBy(asc(nodes.sortOrder), asc(nodes.id));
  const items = await db.select().from(devItems);
  const stageRows = await db.select().from(stages);
  const lastEvents = await db
    .select({ itemId: events.itemId, at: max(events.createdAt) })
    .from(events)
    .groupBy(events.itemId);

  const itemById = new Map(items.map((i) => [i.nodeId, i]));
  const statusesById = new Map<number, Partial<Record<StageKey, StageStatus>>>();
  for (const s of stageRows) {
    const m = statusesById.get(s.itemId) ?? {};
    m[s.stage] = s.status;
    statusesById.set(s.itemId, m);
  }
  const lastById = new Map(lastEvents.map((e) => [e.itemId, e.at]));
  // progress.ts가 tree.ts를 쓰므로 순환 참조를 피해 동적으로 불러온다
  const { latestLaunchByItem } = await import("./progress");
  const launchById = await latestLaunchByItem();

  return rows.map((n) => {
    const dto: TreeNodeDTO = {
      id: n.id,
      type: n.type,
      name: n.name,
      parentId: n.parentId,
      sortOrder: n.sortOrder,
    };
    const it = itemById.get(n.id);
    if (n.type === "item" && it) {
      const statuses = statusesById.get(n.id) ?? {};
      const last = lastById.get(n.id);
      dto.item = {
        code: it.code,
        statuses,
        currentStage: currentStage(statuses),
        completedAt: it.completedAt ? it.completedAt.toISOString() : null,
        lastEventAt: last ? new Date(last).toISOString() : null,
        launch: launchById.get(n.id) ?? null,
      };
    }
    return dto;
  });
}

async function getNode(id: number) {
  const { db } = await getHandle();
  const [n] = await db.select().from(nodes).where(eq(nodes.id, id));
  return n ?? null;
}

async function nextSortOrder(parentId: number | null): Promise<number> {
  const { db } = await getHandle();
  const [r] = await db
    .select({ m: max(nodes.sortOrder) })
    .from(nodes)
    .where(parentId === null ? isNull(nodes.parentId) : eq(nodes.parentId, parentId));
  return (r?.m ?? -1) + 1;
}

export async function addEvent(itemId: number, kind: string, message: string) {
  const { db } = await getHandle();
  await db.insert(events).values({ itemId, kind, message });
}

export async function createNode(input: {
  type: NodeType;
  name: unknown;
  parentId: number | null;
  fields?: ItemFields;
}): Promise<TreeNodeDTO> {
  const name = normalizeName(input.name);
  if (!name) throw badRequest("이름을 1~120자로 입력하세요.");

  const parent = input.parentId === null ? null : await getNode(input.parentId);
  if (input.parentId !== null && !parent) throw notFound("상위 항목");
  const err = placementError(input.type, parent?.type ?? null);
  if (err) throw badRequest(err);

  const h = await getHandle();
  const [created] = await h.db
    .insert(nodes)
    .values({
      type: input.type,
      name,
      parentId: parent?.id ?? null,
      sortOrder: await nextSortOrder(parent?.id ?? null),
    })
    .returning();

  if (input.type === "item") {
    const [{ v }] = await h.query<{ v: number }>("SELECT nextval('dev_code_seq')::int AS v");
    const code = formatDevCode(Number(v));
    await h.db.insert(devItems).values({ nodeId: created.id, code, ...cleanFields(input.fields) });
    await h.db
      .insert(stages)
      .values(STAGE_KEYS.map((stage) => ({ itemId: created.id, stage, status: "pending" as const })));
    await addEvent(created.id, "created", `개발사항 생성 (${code})`);
  }

  const all = await listTree();
  return all.find((n) => n.id === created.id)!;
}

export async function renameNode(id: number, rawName: unknown) {
  const name = normalizeName(rawName);
  if (!name) throw badRequest("이름을 1~120자로 입력하세요.");
  const n = await getNode(id);
  if (!n) throw notFound();
  const { db } = await getHandle();
  await db.update(nodes).set({ name }).where(eq(nodes.id, id));
  if (n.type === "item" && n.name !== name) {
    await addEvent(id, "renamed", `이름 변경: ${n.name} → ${name}`);
  }
}

/** 드래그 이동: 새 상위 항목의 마지막 자리로 옮긴다. 하위 항목은 함께 이동한다. */
export async function moveNode(id: number, newParentId: number | null) {
  const n = await getNode(id);
  if (!n) throw notFound();
  if (n.parentId === newParentId) return;
  if (newParentId === id) throw badRequest("자기 자신 아래로 옮길 수 없습니다.");

  const parent = newParentId === null ? null : await getNode(newParentId);
  if (newParentId !== null && !parent) throw notFound("이동할 위치");
  const err = placementError(n.type, parent?.type ?? null);
  if (err) throw badRequest(err);

  const { db } = await getHandle();
  await db
    .update(nodes)
    .set({ parentId: parent?.id ?? null, sortOrder: await nextSortOrder(parent?.id ?? null) })
    .where(eq(nodes.id, id));

  if (n.type === "item") {
    await addEvent(id, "moved", `위치 이동: ${parent ? parent.name : "최상위"} 아래로`);
  }
}

/** 하위 항목까지 모두 삭제 (FK cascade). 삭제된 개수를 돌려준다. */
export async function deleteNode(id: number): Promise<number> {
  const n = await getNode(id);
  if (!n) throw notFound();
  const { db } = await getHandle();
  const all = await db.select({ id: nodes.id, parentId: nodes.parentId }).from(nodes);
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of all) {
      if (r.parentId !== null && ids.has(r.parentId) && !ids.has(r.id)) {
        ids.add(r.id);
        grew = true;
      }
    }
  }
  await db.delete(nodes).where(inArray(nodes.id, [...ids]));
  return ids.size;
}

export interface ItemDetailDTO {
  id: number;
  name: string;
  code: string;
  path: { service: { id: number; name: string } | null; label: { id: number; name: string } | null };
  fields: Required<ItemFields>;
  completedAt: string | null;
  statuses: Record<StageKey, { status: StageStatus; updatedAt: string }>;
  currentStage: StageKey;
  events: { id: number; kind: string; message: string; createdAt: string }[];
}

export async function getItemDetail(id: number): Promise<ItemDetailDTO> {
  const { db } = await getHandle();
  const n = await getNode(id);
  if (!n || n.type !== "item") throw notFound("개발사항");
  const [it] = await db.select().from(devItems).where(eq(devItems.nodeId, id));
  if (!it) throw notFound("개발사항");

  let service: { id: number; name: string } | null = null;
  let label: { id: number; name: string } | null = null;
  const p = n.parentId !== null ? await getNode(n.parentId) : null;
  if (p?.type === "label") {
    label = { id: p.id, name: p.name };
    const s = p.parentId !== null ? await getNode(p.parentId) : null;
    if (s) service = { id: s.id, name: s.name };
  } else if (p?.type === "service") {
    service = { id: p.id, name: p.name };
  }

  const st = await db.select().from(stages).where(eq(stages.itemId, id));
  const statuses = Object.fromEntries(
    STAGES.map((d) => {
      const r = st.find((x) => x.stage === d.key);
      return [d.key, { status: r?.status ?? "pending", updatedAt: (r?.updatedAt ?? new Date(0)).toISOString() }];
    }),
  ) as ItemDetailDTO["statuses"];

  const ev = await db
    .select()
    .from(events)
    .where(eq(events.itemId, id))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(100);

  return {
    id,
    name: n.name,
    code: it.code,
    path: { service, label },
    fields: { keywords: it.keywords, searchPeriod: it.searchPeriod, memo: it.memo },
    completedAt: it.completedAt ? it.completedAt.toISOString() : null,
    statuses,
    currentStage: currentStage(Object.fromEntries(st.map((x) => [x.stage, x.status]))),
    events: ev.map((e) => ({ id: e.id, kind: e.kind, message: e.message, createdAt: e.createdAt.toISOString() })),
  };
}

export async function updateItemFields(id: number, fields: ItemFields) {
  const clean = cleanFields(fields);
  if (Object.keys(clean).length === 0) return;
  const { db } = await getHandle();
  const res = await db.update(devItems).set(clean).where(eq(devItems.nodeId, id)).returning();
  if (res.length === 0) throw notFound("개발사항");
  await addEvent(id, "fields", "수집 조건(키워드·기간·메모) 수정");
}

export async function setStageStatus(id: number, stage: StageKey, status: StageStatus, reason = "수동 변경") {
  const { db } = await getHandle();
  const [it] = await db.select().from(devItems).where(eq(devItems.nodeId, id));
  if (!it) throw notFound("개발사항");
  const [prev] = await db
    .select()
    .from(stages)
    .where(and(eq(stages.itemId, id), eq(stages.stage, stage)));
  if (prev?.status === status) return;

  await db
    .update(stages)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(stages.itemId, id), eq(stages.stage, stage)));

  if (stage === "done") {
    await db
      .update(devItems)
      .set({ completedAt: status === "done" ? new Date() : null })
      .where(eq(devItems.nodeId, id));
  }
  const label = STAGES.find((s) => s.key === stage)!.label;
  await addEvent(id, "stage", `[${label}] ${STATUS_LABEL[prev?.status ?? "pending"]} → ${STATUS_LABEL[status]} (${reason})`);
}

export const typeLabel = (t: NodeType) => NODE_TYPE_LABEL[t];
