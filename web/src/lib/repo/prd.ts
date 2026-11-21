/**
 * P3 수집 검토·PRD (설계: docs/dev/P3_수집-PRD.md)
 */
import { and, desc, eq, max } from "drizzle-orm";
import { getHandle } from "@/lib/db/client";
import { documents, mails, reviews, stages, type DocKind } from "@/lib/db/schema";
import { docFileName } from "@/lib/domain/naming";
import { getLlmProvider, runPrd, runReview } from "@/lib/llm/provider";
import { extractReplyBlock, type ReviewResult } from "@/lib/llm/review";
import { badRequest, DomainError, notFound } from "./errors";
import { addEvent, getItemDetail, setStageStatus, type ItemDetailDTO } from "./tree";

// ------------------------------------------------------------ DTO

export interface ReviewDTO {
  id: number;
  mailId: number | null;
  mailSubject: string | null;
  status: "ok" | "failed";
  provider: string;
  model: string;
  error: string | null;
  result: ReviewResult | null;
  /** 질문 순번(문자열) → 답 */
  answers: Record<string, string>;
  extraNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewStateDTO {
  latest: ReviewDTO | null;
  replies: { id: number; subject: string; date: string }[];
  reviewCount: number;
  llm: string;
}

export interface DocumentMetaDTO {
  id: number;
  itemId: number;
  sourceMailId: number | null;
  attachmentId: number | null;
  baseDocId: number | null;
  prdDocId: number | null;
  kind: DocKind;
  version: number;
  filename: string;
  source: "llm" | "edit" | "mail";
  note: string;
  createdAt: string;
  size: number;
}

export interface DocumentDTO extends DocumentMetaDTO {
  content: string;
}

type ReviewRow = typeof reviews.$inferSelect;
type DocRow = typeof documents.$inferSelect;

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

async function toReviewDTO(r: ReviewRow): Promise<ReviewDTO> {
  let mailSubject: string | null = null;
  if (r.mailId) {
    const { db } = await getHandle();
    const [m] = await db.select({ subject: mails.subject }).from(mails).where(eq(mails.id, r.mailId));
    mailSubject = m?.subject ?? null;
  }
  return {
    id: r.id,
    mailId: r.mailId,
    mailSubject,
    status: r.status,
    provider: r.provider,
    model: r.model,
    error: r.error,
    result: parseJson<ReviewResult | null>(r.result, null),
    answers: parseJson<Record<string, string>>(r.answers, {}),
    extraNote: r.extraNote,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toDocMeta(d: DocRow): DocumentMetaDTO {
  return {
    id: d.id,
    itemId: d.itemId,
    sourceMailId: d.sourceMailId,
    attachmentId: d.attachmentId,
    baseDocId: d.baseDocId,
    prdDocId: d.prdDocId,
    kind: d.kind,
    version: d.version,
    filename: d.filename,
    source: d.source,
    note: d.note,
    createdAt: d.createdAt.toISOString(),
    size: Buffer.byteLength(d.content, "utf8"),
  };
}

function llmLabel(): string {
  try {
    return getLlmProvider() === "mock" ? "모의 LLM" : "Gemini";
  } catch (e) {
    return e instanceof Error ? e.message : "LLM 설정 오류";
  }
}

async function stageStatus(itemId: number, stage: "review" | "prd") {
  const { db } = await getHandle();
  const [r] = await db
    .select({ s: stages.status })
    .from(stages)
    .where(and(eq(stages.itemId, itemId), eq(stages.stage, stage)));
  return r?.s ?? "pending";
}

// ------------------------------------------------------------ L1 점검

async function collectReplies(itemId: number) {
  const { db } = await getHandle();
  return db
    .select()
    .from(mails)
    .where(and(eq(mails.itemId, itemId), eq(mails.direction, "in"), eq(mails.kind, "collect_reply")))
    .orderBy(desc(mails.mailDate), desc(mails.id));
}

async function latestReviewRow(itemId: number): Promise<ReviewRow | null> {
  const { db } = await getHandle();
  const [r] = await db.select().from(reviews).where(eq(reviews.itemId, itemId)).orderBy(desc(reviews.id)).limit(1);
  return r ?? null;
}

export async function getReviewState(itemId: number): Promise<ReviewStateDTO> {
  await getItemDetail(itemId); // 존재 확인
  const { db } = await getHandle();
  const replies = await collectReplies(itemId);
  const latest = await latestReviewRow(itemId);
  const all = await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.itemId, itemId));
  return {
    latest: latest ? await toReviewDTO(latest) : null,
    replies: replies.map((m) => ({ id: m.id, subject: m.subject, date: m.mailDate.toISOString() })),
    reviewCount: all.length,
    llm: llmLabel(),
  };
}

/**
 * L1 실행. 실패해도 기록은 남기고(status=failed) 단계는 진행하지 않는다 (G-05).
 * 이전 점검의 답·메모는 새 점검으로 이어 받지 않는다 (질문이 달라질 수 있으므로).
 */
export async function runCollectReview(itemId: number, mailId?: number | null): Promise<ReviewDTO> {
  const item = await getItemDetail(itemId);
  const replies = await collectReplies(itemId);
  const mail = mailId ? replies.find((m) => m.id === mailId) : replies[0];
  if (!mail) {
    throw badRequest(
      mailId ? "선택한 메일이 이 개발사항의 수집 회신이 아닙니다." : "수집 회신 메일이 아직 없습니다. 1단계에서 회신을 받은 뒤 실행하세요.",
    );
  }
  const { text } = extractReplyBlock(mail.bodyText);
  const path = [item.path.service?.name, item.path.label?.name, item.name].filter(Boolean).join(" / ");

  const { db } = await getHandle();
  let row: ReviewRow;
  try {
    const run = await runReview({ itemName: item.name, path }, text);
    [row] = await db
      .insert(reviews)
      .values({
        itemId,
        mailId: mail.id,
        status: "ok",
        provider: run.provider,
        model: run.model,
        sourceText: text,
        result: JSON.stringify(run.output),
      })
      .returning();
    const r = run.output;
    const counts = (["충분", "부족", "확인 안 됨"] as const).map((s) => `${s} ${r.sections.filter((x) => x.status === s).length}`);
    await addEvent(itemId, "review", `수집 회신 점검 완료 (${run.provider === "mock" ? "모의" : run.model}): ${counts.join(", ")}, 질문 ${r.questions.length}개`);
    if ((await stageStatus(itemId, "review")) === "pending") {
      await setStageStatus(itemId, "review", "in_progress", "수집 회신 점검");
    }
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    let provider = "unknown";
    try {
      provider = getLlmProvider();
    } catch {
      /* 이미 오류 */
    }
    [row] = await db
      .insert(reviews)
      .values({ itemId, mailId: mail.id, status: "failed", provider, sourceText: text, error: msg.slice(0, 2000) })
      .returning();
    await addEvent(itemId, "review", `수집 회신 점검 실패: ${msg.slice(0, 200)}`);
  }
  return toReviewDTO(row);
}

export async function saveReviewInput(reviewId: number, input: { answers?: unknown; extraNote?: unknown }) {
  const { db } = await getHandle();
  const [r] = await db.select().from(reviews).where(eq(reviews.id, reviewId));
  if (!r) throw notFound("점검 결과");
  const set: Partial<typeof reviews.$inferInsert> = { updatedAt: new Date() };
  if (input.answers !== undefined) {
    if (!input.answers || typeof input.answers !== "object" || Array.isArray(input.answers)) {
      throw badRequest("answers 형식이 올바르지 않습니다.");
    }
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.answers as Record<string, unknown>)) {
      if (/^\d{1,3}$/.test(k) && typeof v === "string" && v.trim()) clean[k] = v.slice(0, 5000);
    }
    set.answers = JSON.stringify(clean);
  }
  if (input.extraNote !== undefined) {
    if (typeof input.extraNote !== "string") throw badRequest("extraNote 형식이 올바르지 않습니다.");
    set.extraNote = input.extraNote.slice(0, 20000);
  }
  const [row] = await db.update(reviews).set(set).where(eq(reviews.id, reviewId)).returning();
  return toReviewDTO(row);
}

// ------------------------------------------------------------ 문서·버전

export function fileNameFor(item: ItemDetailDTO, kind: DocKind): string {
  const suffix = { prd: "PRD", arch: "Architecture", qa: "QA", arch_report: "Architecture_검토리포트", qa_report: "QA_검토리포트" }[kind];
  return docFileName({ service: item.path.service?.name ?? "", label: item.path.label?.name ?? null, item: item.name }, suffix);
}

async function nextVersion(itemId: number, kind: DocKind): Promise<number> {
  const { db } = await getHandle();
  const [r] = await db
    .select({ v: max(documents.version) })
    .from(documents)
    .where(and(eq(documents.itemId, itemId), eq(documents.kind, kind)));
  return (r?.v ?? 0) + 1;
}

export interface DocLinks {
  sourceMailId?: number | null;
  attachmentId?: number | null;
  baseDocId?: number | null;
  prdDocId?: number | null;
}

export async function insertDocument(
  item: ItemDetailDTO,
  kind: DocKind,
  content: string,
  source: "llm" | "edit" | "mail",
  note: string,
  links: DocLinks = {},
): Promise<DocumentDTO> {
  const { db } = await getHandle();
  const version = await nextVersion(item.id, kind);
  const [row] = await db
    .insert(documents)
    .values({ itemId: item.id, kind, version, filename: fileNameFor(item, kind), content, source, note, ...links })
    .returning();
  return { ...toDocMeta(row), content: row.content };
}

export async function listDocuments(itemId: number, kind: DocKind): Promise<DocumentMetaDTO[]> {
  const { db } = await getHandle();
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.itemId, itemId), eq(documents.kind, kind)))
    .orderBy(desc(documents.version));
  return rows.map(toDocMeta);
}

export async function getDocument(id: number): Promise<DocumentDTO> {
  const { db } = await getHandle();
  const [d] = await db.select().from(documents).where(eq(documents.id, id));
  if (!d) throw notFound("문서");
  return { ...toDocMeta(d), content: d.content };
}

export const KIND_LABEL: Record<DocKind, string> = {
  prd: "PRD",
  arch: "Architecture",
  qa: "QA",
  arch_report: "Architecture 검토 리포트",
  qa_report: "QA 검토 리포트",
};

/** 편집본 저장 → 새 버전 */
export async function saveDocumentEdit(itemId: number, kind: DocKind, content: unknown, note: unknown): Promise<DocumentDTO> {
  if (typeof content !== "string" || !content.trim()) throw badRequest("내용이 비어 있습니다.");
  if (content.length > 500_000) throw badRequest("문서가 너무 깁니다 (50만 자 이하).");
  const item = await getItemDetail(itemId);
  // 리포트를 편집하면 대상 문서·기준 PRD 연결을 이전 버전에서 이어 받는다
  const [prev] = await listDocuments(itemId, kind);
  const links: DocLinks = prev ? { baseDocId: prev.baseDocId, prdDocId: prev.prdDocId, sourceMailId: prev.sourceMailId } : {};
  const doc = await insertDocument(item, kind, content, "edit", typeof note === "string" ? note.trim().slice(0, 500) : "", links);
  await addEvent(itemId, "document", `${KIND_LABEL[kind]} v${doc.version} 저장 (편집)${doc.note ? `: ${doc.note}` : ""}`);
  return doc;
}

// ------------------------------------------------------------ L2 PRD 생성

export async function generatePrd(itemId: number): Promise<DocumentDTO> {
  const item = await getItemDetail(itemId);
  const latest = await latestReviewRow(itemId);
  if (!latest || latest.status !== "ok" || !latest.result) {
    throw badRequest("성공한 수집 회신 점검 결과가 없습니다. 먼저 '점검 실행'을 하세요.");
  }
  const review = await toReviewDTO(latest);
  const { db } = await getHandle();
  const [mail] = latest.mailId ? await db.select().from(mails).where(eq(mails.id, latest.mailId)) : [];
  const result = review.result!;
  const version = await nextVersion(itemId, "prd");

  let run;
  try {
    run = await runPrd({
      itemName: item.name,
      code: item.code,
      service: item.path.service?.name ?? null,
      label: item.path.label?.name ?? null,
      version,
      reply: {
        subject: mail?.subject ?? review.mailSubject ?? "(삭제된 메일)",
        receivedAt: (mail?.mailDate ?? latest.createdAt).toISOString(),
        text: latest.sourceText,
      },
      review: result,
      answers: result.questions.map((q, i) => ({ ...q, answer: review.answers[String(i)] ?? "" })),
      extraNote: review.extraNote,
      now: new Date(),
    });
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    await addEvent(itemId, "prd", `PRD 생성 실패: ${msg.slice(0, 200)}`);
    throw new DomainError(502, `PRD 생성에 실패했습니다: ${msg}`);
  }

  const doc = await insertDocument(item, "prd", run.output, "llm", run.provider === "mock" ? "모의 LLM 초안" : `${run.model} 초안`);
  await addEvent(itemId, "prd", `PRD v${doc.version} 생성 (${run.provider === "mock" ? "모의" : run.model})`);
  await setStageStatus(itemId, "review", "done", "PRD 생성");
  if ((await stageStatus(itemId, "prd")) === "pending") {
    await setStageStatus(itemId, "prd", "in_progress", "PRD 생성");
  }
  return doc;
}
