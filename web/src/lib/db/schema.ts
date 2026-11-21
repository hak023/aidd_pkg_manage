import {
  boolean,
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
  /** 시연 데이터 여부. 상단 '시연 데이터 초기화'는 이 값이 true인 자료만 지우고 다시 만든다. */
  isDemo: boolean("is_demo").notNull().default(false),
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

/**
 * 메일 (P2). 발송(out)과 수신(in)을 함께 기록한다.
 * - out: status = sent | simulated
 * - in:  status = matched | unmatched | ignored
 */
export const mails = pgTable("mails", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id"),
  direction: text("direction").$type<MailDirection>().notNull(),
  kind: text("kind").$type<MailKind>().notNull(),
  status: text("status").$type<MailStatus>().notNull(),
  matchMethod: text("match_method").$type<MatchMethod>(),
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
  refs: text("refs").notNull().default(""),
  fromAddr: text("from_addr").notNull().default(""),
  toAddrs: text("to_addrs").notNull().default(""),
  subject: text("subject").notNull().default(""),
  bodyText: text("body_text").notNull().default(""),
  simulated: boolean("simulated").notNull().default(false),
  /** 미분류 메일의 L3 추정 결과 (JSON, P4) */
  suggestion: text("suggestion"),
  /** 시연 데이터 생성기가 만든 메일 */
  isDemo: boolean("is_demo").notNull().default(false),
  /** 발송·수신한 메일 계정 (Gmail 주소, 소문자). 발송 한도를 계정별로 센다 */
  account: text("account").notNull().default(""),
  mailDate: timestamp("mail_date", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 메일 첨부. 텍스트 파일(md 등)은 내용까지 저장한다. */
export const mailAttachments = pgTable("mail_attachments", {
  id: serial("id").primaryKey(),
  mailId: integer("mail_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull().default(""),
  size: integer("size").notNull().default(0),
  content: text("content"),
});

/** 시뮬레이터 가상 받은편지함: 주입된 메일이 다음 '메일 확인' 때 처리된다. */
export const simInbox = pgTable("sim_inbox", {
  id: serial("id").primaryKey(),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

/** 키-값 상태 (IMAP 마지막 UID 등) */
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** L1 수집 회신 점검 결과와 사용자 추가 입력 (P3) */
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  mailId: integer("mail_id"),
  status: text("status").$type<"ok" | "failed">().notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull().default(""),
  sourceText: text("source_text").notNull().default(""),
  result: text("result"),
  error: text("error"),
  answers: text("answers").notNull().default("{}"),
  extraNote: text("extra_note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** 버전별 md 문서 (PRD, 이후 Architecture/QA와 검토 리포트) */
export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    itemId: integer("item_id").notNull(),
    kind: text("kind").$type<DocKind>().notNull(),
    version: integer("version").notNull(),
    filename: text("filename").notNull(),
    content: text("content").notNull(),
    source: text("source").$type<"llm" | "edit" | "mail">().notNull(),
    note: text("note").notNull().default(""),
    /** 전달 메일에서 등록한 경우 그 메일과 첨부 (P4) */
    sourceMailId: integer("source_mail_id"),
    attachmentId: integer("attachment_id"),
    /** 검토 리포트의 대상 문서와 기준 PRD (P4) */
    baseDocId: integer("base_doc_id"),
    prdDocId: integer("prd_doc_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("documents_item_kind_ver_uq").on(t.itemId, t.kind, t.version)],
);

/** L6 진행상황 회신 해석 결과 (P5). 회신마다 한 행 */
export const progressReports = pgTable("progress_reports", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull(),
  mailId: integer("mail_id"),
  status: text("status").$type<"ok" | "failed">().notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull().default(""),
  sourceText: text("source_text").notNull().default(""),
  milestones: text("milestones"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocKind = "prd" | "arch" | "qa" | "arch_report" | "qa_report";

/**
 * 사용자가 설정 화면에서 입력한 메일 설정 (2026-11-22). 비어 있는 값은 관리자 환경 변수를 쓴다.
 * 앱 비밀번호는 암호화해 저장한다 (lib/secret-box.ts).
 */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  gmailAddress: text("gmail_address").notNull().default(""),
  appPasswordEnc: text("app_password_enc").notNull().default(""),
  collectTo: text("collect_to").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MailDirection = "out" | "in";
export type MailKind =
  | "collect_request"
  | "progress_request"
  | "share"
  | "collect_reply"
  | "progress_reply"
  | "doc_forward"
  | "other";
export type MailStatus = "sent" | "simulated" | "matched" | "unmatched" | "ignored";
export type MatchMethod = "tag" | "header" | "marker" | "manual" | "llm";

export type NodeType = "service" | "label" | "item";
export type StageKey = "collect" | "review" | "prd" | "arch" | "qa" | "progress" | "done";
export type StageStatus = "pending" | "in_progress" | "done";
