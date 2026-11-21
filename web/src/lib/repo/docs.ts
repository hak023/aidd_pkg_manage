/**
 * P4 Architecture·QA 문서 등록, L3 분류, L4/L5 검토 리포트, 공유 (설계: docs/dev/P4_Architecture-QA.md)
 * PRD 공유도 여기서 함께 처리한다 (kind = prd | arch | qa).
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getHandle } from "@/lib/db/client";
import { devItems, documents, mailAttachments, mails, nodes, reviews } from "@/lib/db/schema";
import { AUTO_ASSIGN_CONFIDENCE, guessDocType, type ClassifyResult, type ItemCandidate } from "@/lib/llm/classify";
import { parseRequirements, renderDocReview, type ReviewKind } from "@/lib/llm/docreview";
import { runClassify, runDocReview } from "@/lib/llm/provider";
import type { ReviewResult } from "@/lib/llm/review";
import { getMailConfig } from "@/lib/mail/config";
import { isDocAttachment } from "@/lib/mail/match";
import { badRequest, DomainError, notFound } from "./errors";
import { sendAndRecord, type MailSummaryDTO } from "./mail";
import {
  getDocument,
  insertDocument,
  KIND_LABEL,
  listDocuments,
  type DocumentDTO,
  type DocumentMetaDTO,
} from "./prd";
import { addEvent, getItemDetail, setStageStatus, type ItemDetailDTO } from "./tree";

type MailRow = typeof mails.$inferSelect;
type AttRow = typeof mailAttachments.$inferSelect;

const REPORT_KIND = { arch: "arch_report", qa: "qa_report" } as const;
const STAGE_OF = { arch: "arch", qa: "qa" } as const;
const TYPE_LABEL = { arch: "Architecture", qa: "QA(시험항목서)" } as const;

export function isReviewKind(v: unknown): v is ReviewKind {
  return v === "arch" || v === "qa";
}

// ------------------------------------------------------------ 조회

export interface DocCandidateDTO {
  attachmentId: number;
  mailId: number;
  filename: string;
  size: number;
  mailSubject: string;
  mailDate: string;
  /** 키워드로 추정한 유형 */
  guess: "arch" | "qa" | "other";
}

export interface DocStateDTO {
  versions: DocumentMetaDTO[];
  reports: DocumentMetaDTO[];
  candidates: DocCandidateDTO[];
  hasPrd: boolean;
}

/** 이 개발사항 메일의 문서 첨부 중 아직 등록하지 않은 것 */
export async function docCandidates(itemId: number): Promise<DocCandidateDTO[]> {
  const { db } = await getHandle();
  const rows = await db
    .select({ a: mailAttachments, m: mails })
    .from(mailAttachments)
    .innerJoin(mails, eq(mails.id, mailAttachments.mailId))
    .where(and(eq(mails.itemId, itemId), eq(mails.direction, "in"), isNotNull(mailAttachments.content)))
    .orderBy(desc(mails.mailDate), desc(mailAttachments.id));
  const used = await db
    .select({ id: documents.attachmentId })
    .from(documents)
    .where(and(eq(documents.itemId, itemId), isNotNull(documents.attachmentId)));
  const usedSet = new Set(used.map((u) => u.id));
  return rows
    .filter((r) => isDocAttachment(r.a) && !usedSet.has(r.a.id))
    .map((r) => ({
      attachmentId: r.a.id,
      mailId: r.m.id,
      filename: r.a.filename,
      size: r.a.size,
      mailSubject: r.m.subject,
      mailDate: r.m.mailDate.toISOString(),
      guess: guessDocType({ filename: r.a.filename, subject: r.m.subject, content: r.a.content ?? "" }).type,
    }));
}

export async function getDocState(itemId: number, kind: ReviewKind): Promise<DocStateDTO> {
  await getItemDetail(itemId);
  return {
    versions: await listDocuments(itemId, kind),
    reports: await listDocuments(itemId, REPORT_KIND[kind]),
    candidates: await docCandidates(itemId),
    hasPrd: (await listDocuments(itemId, "prd")).length > 0,
  };
}

// ------------------------------------------------------------ 등록

export interface RegisterResult {
  document: DocumentDTO;
  report: DocumentDTO | null;
  reportError: string | null;
}

/**
 * 문서 등록 → 새 버전, 해당 단계 완료, 검토 리포트 자동 생성.
 * 리포트 생성이 실패해도 등록과 단계는 유지한다 (G-05: 실패한 점검 결과는 만들지 않음).
 */
export async function registerDocument(
  itemId: number,
  kind: ReviewKind,
  input: { attachmentId?: number | null; content?: unknown; filename?: unknown },
  how = "수동 등록",
): Promise<RegisterResult> {
  const item = await getItemDetail(itemId);
  const { db } = await getHandle();
  let content: string;
  let note: string;
  let links: { sourceMailId?: number | null; attachmentId?: number | null } = {};

  if (input.attachmentId) {
    const [a] = await db.select().from(mailAttachments).where(eq(mailAttachments.id, input.attachmentId));
    if (!a) throw notFound("첨부");
    const [m] = await db.select().from(mails).where(eq(mails.id, a.mailId));
    if (!m || m.itemId !== itemId) throw badRequest("이 개발사항의 메일 첨부가 아닙니다.");
    if (!a.content) throw badRequest("텍스트 파일이 아니라 등록할 수 없습니다.");
    content = a.content;
    note = `${a.filename} · ${how}`;
    links = { sourceMailId: m.id, attachmentId: a.id };
  } else {
    if (typeof input.content !== "string" || !input.content.trim()) throw badRequest("문서 내용이 비어 있습니다.");
    if (input.content.length > 1_000_000) throw badRequest("문서가 너무 깁니다.");
    content = input.content;
    const fn = typeof input.filename === "string" && input.filename.trim() ? input.filename.trim().slice(0, 200) : "직접 입력";
    note = `${fn} · 직접 입력`;
  }

  const doc = await insertDocument(item, kind, content, input.attachmentId ? "mail" : "edit", note, links);
  await addEvent(itemId, "document", `${TYPE_LABEL[kind]} 문서 v${doc.version} 등록 (${note})`);
  await setStageStatus(itemId, STAGE_OF[kind], "done", `${TYPE_LABEL[kind]} md 등록`);

  let report: DocumentDTO | null = null;
  let reportError: string | null = null;
  try {
    report = await generateDocReport(itemId, kind, item);
  } catch (e) {
    reportError = e instanceof Error ? e.message : String(e);
  }
  return { document: doc, report, reportError };
}

// ------------------------------------------------------------ L4/L5 리포트

/** 최신 대상 문서와 최신 PRD로 검토 리포트를 만든다 → 새 버전 */
export async function generateDocReport(itemId: number, kind: ReviewKind, itemArg?: ItemDetailDTO): Promise<DocumentDTO> {
  const item = itemArg ?? (await getItemDetail(itemId));
  const [docMeta] = await listDocuments(itemId, kind);
  if (!docMeta) throw badRequest(`등록된 ${TYPE_LABEL[kind]} 문서가 없습니다.`);
  const [prdMeta] = await listDocuments(itemId, "prd");
  if (!prdMeta) {
    await addEvent(itemId, "report", `${TYPE_LABEL[kind]} 검토 리포트 보류: PRD가 없습니다. PRD를 만든 뒤 '리포트 다시 생성'을 누르세요.`);
    throw badRequest("PRD가 없어 검토 리포트를 만들 수 없습니다. PRD를 먼저 만드세요.");
  }
  const doc = await getDocument(docMeta.id);
  const prd = await getDocument(prdMeta.id);
  // QA 점검에는 Architecture를 넣지 않는다: 넣으면 모델이 설계서를 시험 커버리지 근거로 인용한다
  // (실제 Gemini 시험 TC-P4-R2에서 확인, 프롬프트 지시로도 막히지 않음). 서비스 정의 5.1에서 선택 입력.
  const arch: string | null = null;
  const reqs = parseRequirements(prd.content);

  let run;
  try {
    run = await runDocReview(kind, reqs, prd.content, doc.content, arch);
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    await addEvent(itemId, "report", `${TYPE_LABEL[kind]} 검토 실패: ${msg.slice(0, 200)}`);
    throw new DomainError(502, `${TYPE_LABEL[kind]} 검토에 실패했습니다: ${msg}`);
  }
  const md = renderDocReview({
    kind,
    itemName: item.name,
    doc: { filename: doc.filename, version: doc.version, createdAt: doc.createdAt },
    prdVersion: prd.version,
    model: run.provider === "mock" ? "모의 LLM" : run.model,
    reqs,
    result: run.output,
    now: new Date(),
  });
  const report = await insertDocument(item, REPORT_KIND[kind], md, "llm", `${TYPE_LABEL[kind]} v${doc.version} · PRD v${prd.version} 기준`, {
    baseDocId: doc.id,
    prdDocId: prd.id,
  });
  const c = (v: string) => run.output.rows.filter((r) => r.verdict === v).length;
  await addEvent(
    itemId,
    "report",
    `${TYPE_LABEL[kind]} 검토 리포트 v${report.version} 생성 (${run.provider === "mock" ? "모의" : run.model}): 반영 ${c("반영")}, 부분 ${c("부분")}, 미반영 ${c("미반영")}, 확인 불가 ${c("확인 불가")}`,
  );
  return report;
}

// ------------------------------------------------------------ 수신 메일 처리 (L3)

async function itemCandidates(): Promise<ItemCandidate[]> {
  const { db } = await getHandle();
  const all = await db.select().from(nodes);
  const items = await db.select().from(devItems);
  const byId = new Map(all.map((n) => [n.id, n]));
  return items
    .filter((i) => !i.completedAt)
    .map((i) => {
      const n = byId.get(i.nodeId);
      const path: string[] = [];
      let cur = n;
      while (cur) {
        path.unshift(cur.name);
        cur = cur.parentId !== null ? byId.get(cur.parentId) : undefined;
      }
      return { code: i.code, path: path.join(" / "), name: n?.name ?? "", keywords: i.keywords };
    });
}

function docAttachments(atts: AttRow[]) {
  return atts.filter((a) => a.content && isDocAttachment(a));
}

/**
 * 문서 전달 메일 처리. ingest(수신)·assignMail(수동 지정)에서 호출한다.
 * - 개발사항이 정해진 메일: 첨부마다 유형을 판별해 등록 (키워드로 확실하면 LLM 없이)
 * - 미분류 메일: L3로 개발사항·유형 추정. 확신도가 기준 이상이면 지정·등록, 아니면 추천만 저장
 * 실패해도 메일 수신 자체는 막지 않는다.
 */
export async function handleDocMail(mailId: number): Promise<"registered" | "assigned" | "suggested" | "skipped"> {
  const { db } = await getHandle();
  const [m] = await db.select().from(mails).where(eq(mails.id, mailId));
  if (!m || m.direction !== "in") return "skipped";
  const atts = docAttachments(await db.select().from(mailAttachments).where(eq(mailAttachments.mailId, mailId)));
  if (atts.length === 0) return "skipped";
  const mailInput = {
    subject: m.subject,
    body: m.bodyText,
    attachments: atts.map((a) => ({ filename: a.filename, content: a.content ?? "" })),
  };

  try {
    if (m.itemId) return await registerFromMail(m, atts);

    // 미분류: L3로 개발사항 추정
    const cands = await itemCandidates();
    if (cands.length === 0) return "skipped";
    const run = await runClassify(mailInput, cands, null);
    const r = run.output;
    const suggestion: ClassifyResult & { model: string } = { ...r, model: run.model };
    await db.update(mails).set({ suggestion: JSON.stringify(suggestion) }).where(eq(mails.id, mailId));
    if (r.itemCode && r.docType !== "other" && r.confidence >= AUTO_ASSIGN_CONFIDENCE) {
      const [it] = await db.select().from(devItems).where(eq(devItems.code, r.itemCode));
      if (it) {
        const [row] = await db
          .update(mails)
          .set({ itemId: it.nodeId, status: "matched", matchMethod: "llm" })
          .where(eq(mails.id, mailId))
          .returning();
        await addEvent(
          it.nodeId,
          "mail",
          `태그 없는 전달 메일을 자동 지정 (L3 ${run.provider === "mock" ? "모의" : run.model}, 확신도 ${r.confidence.toFixed(2)}): ${row.subject}`,
        );
        await registerFromMail(row, atts, r.docType);
        return "assigned";
      }
    }
    return "suggested";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[docs] handleDocMail", msg);
    if (m.itemId) await addEvent(m.itemId, "document", `전달 문서 자동 등록 실패: ${msg.slice(0, 200)} — 개발사항 화면에서 직접 등록하세요.`);
    return "skipped";
  }
}

async function registerFromMail(m: MailRow, atts: AttRow[], hint?: "arch" | "qa" | "other"): Promise<"registered" | "skipped"> {
  const { db } = await getHandle();
  const [item] = await db.select().from(devItems).where(eq(devItems.nodeId, m.itemId!));
  let registered = false;
  for (const a of atts) {
    const [dup] = await db.select({ id: documents.id }).from(documents).where(eq(documents.attachmentId, a.id));
    if (dup) continue;
    let type = guessDocType({ filename: a.filename, subject: m.subject, content: a.content ?? "" });
    let how = "자동 등록 (키워드)";
    if (!type.confident) {
      if (hint && hint !== "other" && atts.length === 1) {
        type = { ...type, type: hint, confident: true };
        how = "자동 등록 (L3)";
      } else {
        const run = await runClassify(
          { subject: m.subject, body: m.bodyText, attachments: [{ filename: a.filename, content: a.content ?? "" }] },
          [],
          item.code,
        );
        if (run.output.docType !== "other" && run.output.confidence >= 0.5) {
          type = { ...type, type: run.output.docType, confident: true };
          how = `자동 등록 (L3 ${run.provider === "mock" ? "모의" : run.model})`;
        }
      }
    }
    if (!type.confident || type.type === "other") {
      await addEvent(m.itemId!, "document", `전달 문서 유형을 판별하지 못함: ${a.filename} — 4·5단계 화면에서 직접 등록하세요.`);
      continue;
    }
    const r = await registerDocument(m.itemId!, type.type, { attachmentId: a.id }, how);
    if (r.reportError) {
      await addEvent(m.itemId!, "report", `검토 리포트를 만들지 못함: ${r.reportError.slice(0, 200)}`);
    }
    registered = true;
  }
  return registered ? "registered" : "skipped";
}

// ------------------------------------------------------------ 공유 (PRD / Architecture / QA)

export type ShareKind = "prd" | ReviewKind;

export function isShareKind(v: unknown): v is ShareKind {
  return v === "prd" || v === "arch" || v === "qa";
}

export function shareSubject(kind: ShareKind, itemName: string): string {
  if (kind === "prd") return `[AX_AIDD시스템] ${itemName}에 대한 PRD가 생성되었습니다.`;
  if (kind === "arch") return `[AX_AIDD시스템] ${itemName}에 대한 Architecture 검토 결과를 공유합니다.`;
  return `[AX_AIDD시스템] ${itemName}에 대한 시험항목서 검토 결과를 공유합니다.`;
}

export interface ShareDefaultsDTO {
  to: string[];
  subject: string;
  text: string;
  /** 공유 창에서 고르는 문서 (PRD 또는 검토 리포트) 최신본 */
  document: DocumentMetaDTO | null;
  /** 함께 첨부되는 대상 문서 (Architecture/QA 최신본) */
  companion: DocumentMetaDTO | null;
  mode: string;
}

const MAIN_KIND = { prd: "prd", arch: "arch_report", qa: "qa_report" } as const;

export async function stakeholderEmails(itemId: number): Promise<string[]> {
  const { db } = await getHandle();
  const [r] = await db
    .select({ result: reviews.result })
    .from(reviews)
    .where(and(eq(reviews.itemId, itemId), eq(reviews.status, "ok")))
    .orderBy(desc(reviews.id))
    .limit(1);
  let result: ReviewResult | null = null;
  try {
    result = r?.result ? (JSON.parse(r.result) as ReviewResult) : null;
  } catch {
    result = null;
  }
  return [...new Set((result?.stakeholders ?? []).map((p) => p.email.trim()).filter(isEmail))];
}

export async function shareDefaults(itemId: number, kind: ShareKind): Promise<ShareDefaultsDTO> {
  const item = await getItemDetail(itemId);
  const [doc] = await listDocuments(itemId, MAIN_KIND[kind]);
  const [companion] = kind === "prd" ? [] : await listDocuments(itemId, kind);
  const what = kind === "prd" ? "PRD" : kind === "arch" ? "Architecture 설계서 검토 결과" : "시험항목서 검토 결과";
  const files = [companion, doc].filter(Boolean).map((d) => `${d!.filename} (v${d!.version})`);
  return {
    to: await stakeholderEmails(itemId),
    subject: shareSubject(kind, item.name),
    text: [
      "안녕하세요. AX_AIDD 시스템입니다.",
      "",
      `"${item.name}"(${item.code})에 대한 ${what}를 공유드립니다.`,
      ...(files.length ? [`첨부: ${files.join(", ")}`] : []),
      "",
      kind === "prd"
        ? "사내 메일·Teams·Confluence 논의 내용을 수집해 정리한 초안이며, 담당자가 검토했습니다."
        : "검토 리포트는 PRD 대비 문서상 대조 결과이며, 실제 시험 합격을 뜻하지 않습니다.",
      "수정·보완 의견이 있으면 회신 부탁드립니다.",
    ].join("\n"),
    document: doc ?? null,
    companion: companion ?? null,
    mode: getMailConfig().mode,
  };
}

export function isEmail(s: string): boolean {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(s);
}

export function parseRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,;\s]+/) : [];
  const out = [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  const bad = out.filter((s) => !isEmail(s));
  if (bad.length) throw badRequest(`메일 주소 형식이 올바르지 않습니다: ${bad.join(", ")}`);
  if (out.length === 0) throw badRequest("받는 사람을 한 명 이상 입력하세요.");
  if (out.length > 50) throw badRequest("받는 사람은 50명 이하로 입력하세요.");
  return out;
}

/** 사용자가 수신자를 확인하고 버튼을 눌렀을 때만 호출된다 (AGENTS.md 5-4). */
export async function shareDocuments(
  itemId: number,
  kind: ShareKind,
  input: { documentId: unknown; to: unknown; subject: unknown; text: unknown },
): Promise<{ mail: MailSummaryDTO; item: ItemDetailDTO }> {
  const item = await getItemDetail(itemId);
  const docId = Number(input.documentId);
  if (!Number.isInteger(docId)) throw badRequest("공유할 문서 버전을 선택하세요.");
  const doc = await getDocument(docId);
  if (doc.itemId !== itemId || doc.kind !== MAIN_KIND[kind]) throw badRequest("이 개발사항의 공유 대상 문서가 아닙니다.");
  const to = parseRecipients(input.to);
  const subject =
    typeof input.subject === "string" && input.subject.trim() ? input.subject.trim().slice(0, 300) : shareSubject(kind, item.name);
  const text = typeof input.text === "string" ? input.text.slice(0, 20000) : "";

  const attachments: { filename: string; content: string; contentType: string }[] = [];
  let companionVer = "";
  if (kind !== "prd") {
    // 리포트가 대조한 대상 문서 버전을 함께 보낸다 (없으면 최신본)
    const companion = doc.baseDocId ? await getDocument(doc.baseDocId).catch(() => null) : null;
    const comp = companion ?? (await listDocuments(itemId, kind).then(([d]) => (d ? getDocument(d.id) : null)));
    if (comp) {
      attachments.push({ filename: comp.filename, content: comp.content, contentType: "text/markdown; charset=utf-8" });
      companionVer = ` + ${TYPE_LABEL[kind]} v${comp.version}`;
    }
  }
  attachments.push({ filename: doc.filename, content: doc.content, contentType: "text/markdown; charset=utf-8" });

  const mail = await sendAndRecord(getMailConfig(), itemId, item.code, "share", { to, subject, text, attachments });
  await addEvent(
    itemId,
    "share",
    `${KIND_LABEL[doc.kind]} v${doc.version}${companionVer} 공유${mail.simulated ? " (시뮬레이터)" : ""}: ${to.length}명 (${to.join(", ")})`,
  );
  if (kind === "prd") await setStageStatus(itemId, "prd", "done", "PRD 공유");
  return { mail, item: await getItemDetail(itemId) };
}

/** 미분류 메일의 L3 추천을 읽는다 (화면 표시용) */
export async function suggestionsFor(mailIds: number[]): Promise<Map<number, (ClassifyResult & { model: string }) | null>> {
  const out = new Map<number, (ClassifyResult & { model: string }) | null>();
  if (mailIds.length === 0) return out;
  const { db } = await getHandle();
  const rows = await db.select({ id: mails.id, s: mails.suggestion }).from(mails).where(inArray(mails.id, mailIds));
  for (const r of rows) {
    try {
      out.set(r.id, r.s ? JSON.parse(r.s) : null);
    } catch {
      out.set(r.id, null);
    }
  }
  return out;
}
