import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * 트리 노드: 단위서비스(service) > 라벨링(label) > 개발사항(item)
 * - service: parentId = null
 * - label:   parent = service
 * - item:    parent = label 또는 service (라벨 없음, Q-01)
 */
export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  type: text("type").$type<NodeType>().notNull(),
  name: text("name").notNull(),
  parentId: integer("parent_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 개발사항 상세 (nodes.type = 'item'과 1:1) */
export const devItems = pgTable("dev_items", {
  nodeId: integer("node_id").primaryKey(),
  code: text("code").notNull().unique(),
  keywords: text("keywords").notNull().default(""),
  searchPeriod: text("search_period").notNull().default(""),
  memo: text("memo").notNull().default(""),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/** 개발사항별 단계 상태. 순서를 강제하지 않는다 (Q-04). */
export const stages = pgTable(
  "stages",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id").notNull(),
    stage: text("stage").$type<StageKey>().notNull(),
    status: text("status").$type<StageStatus>().notNull().default("pending"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stages_item_stage_uq").on(t.itemId, t.stage)],
);

/** 개발사항 이력 */
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NodeType = "service" | "label" | "item";
export type StageKey = "collect" | "review" | "prd" | "arch" | "qa" | "progress" | "done";
export type StageStatus = "pending" | "in_progress" | "done";
