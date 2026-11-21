import { and, asc, count, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { getHandle } from "@/lib/db/client";
import {
  appState,
  devItems,
  mailAttachments,
  mails,
  simInbox,
  stages,
  type MailKind,
  type MailStatus,
  type MatchMethod,
} from "@/lib/db/schema";
import { getMailConfig, type MailConfig } from "@/lib/mail/config";
import { composeCollectRequest } from "@/lib/mail/compose";
import {
  detectKind,
  isDocAttachment,
  isRelevant,
  MAIL_KIND_LABEL,
  matchMail,
  normalizeMessageId,
  type InboundMail,
} from "@/lib/mail/match";
import { buildSample, type SampleKey } from "@/lib/mail/samples";
import { fetchViaImap, MAX_TEXT, newMessageId, sendViaGmail, type FetchState, type OutgoingMail } from "@/lib/mail/transport";
import { DomainError } from "./errors";
import { addEvent, getItemDetail, setStageStatus } from "./tree";

// ---------------------------------------------------------------- DTO

export interface MailSummaryDTO {
  id: number;
  itemId: number | null;
  direction: "out" | "in";
  kind: MailKind;
  kindLabel: string;
  status: MailStatus;
  matchMethod: MatchMethod | null;
  subject: string;
  from: string;
  to: string;
  date: string;
  simulated: boolean;
  attachments: { id: number; filename: string; size: number; isDoc: boolean }[];
  /** 미분류 메일의 L3 추정 (P4) */
  suggestion: { itemCode: string; docType: string; confidence: number; reason: string; model: string } | null;
}

export interface MailDetailDTO extends MailSummaryDTO {
  body: string;
  attachments: (MailSummaryDTO["attachments"][number] & { content: string | null })[];
}

type MailRow = typeof mails.$inferSelect;
type AttRow = typeof mailAttachments.$inferSelect;

function toSummary(m: MailRow, atts: AttRow[]): MailSummaryDTO {
  return {
    id: m.id,
    itemId: m.itemId,
    direction: m.direction,
    kind: m.kind,
    kindLabel: MAIL_KIND_LABEL[m.kind] ?? m.kind,
    status: m.status,
    matchMethod: m.matchMethod ?? null,
    subject: m.subject,
    from: m.fromAddr,
    to: m.toAddrs,
    date: m.mailDate.toISOString(),
    simulated: m.simulated,
    suggestion: parseSuggestion(m.suggestion),
    attachments: atts.map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      isDoc: isDocAttachment({ filename: a.filename, contentType: a.contentType }),
    })),
  };
}

function parseSuggestion(s: string | null): MailSummaryDTO["suggestion"] {
  if (!s) return null;
  try {
    return JSON.parse(s) as MailSummaryDTO["suggestion"];
  } catch {
    return null;
  }
}

async function withAttachments(rows: MailRow[]): Promise<MailSummaryDTO[]> {
  if (rows.length === 0) return [];
  const { db } = await getHandle();
  const atts = await db
    .select()
    .from(mailAttachments)
    .where(inArray(mailAttachments.mailId, rows.map((r) => r.id)))
    .orderBy(asc(mailAttachments.id));
  return rows.map((r) => toSummary(r, atts.filter((a) => a.mailId === r.id)));
}

// ---------------------------------------------------------------- 상태 저장

async function getState(key: string): Promise<string | null> {
  const { db } = await getHandle();
  const [r] = await db.select().from(appState).where(eq(appState.key, key));
  return r?.value ?? null;
}

async function setState(key: string, value: string) {
  const { db } = await getHandle();
  await db.insert(appState).values({ key, value }).onConflictDoUpdate({ target: appState.key, set: { value } });
}

// ---------------------------------------------------------------- 발송

function requireUsable(cfg: MailConfig) {
  if (cfg.mode === "unconfigured") {
    throw new DomainError(
      503,
      "메일 설정이 없습니다. GMAIL_ADDRESS, GMAIL_APP_PASSWORD, COLLECT_TO_ADDRESS 환경 변수를 설정하세요.",
    );
  }
}

async function checkDailyLimit(cfg: MailConfig) {
  if (cfg.mode !== "gmail") return;
  const { db } = await getHandle();
  const since = new Date(Date.now() - 86_400_000);
  const [r] = await db
    .select({ n: count() })
    .from(mails)
    .where(and(eq(mails.direction, "out"), eq(mails.status, "sent"), gte(mails.createdAt, since)));
  if ((r?.n ?? 0) >= cfg.dailyLimit) {
    throw new DomainError(429, `최근 24시간 발송 한도(${cfg.dailyLimit}건)에 도달했습니다. MAIL_DAILY_LIMIT로 조정할 수 있습니다.`);
  }
}

export async function sendAndRecord(
  cfg: MailConfig,
  itemId: number | null,
  code: string | null,
  kind: MailKind,
  mail: OutgoingMail,
): Promise<MailSummaryDTO> {
  requireUsable(cfg);
  await checkDailyLimit(cfg);
  const messageId = newMessageId(code);
  const simulated = cfg.mode === "simulator";
  if (!simulated) {
    try {
      await sendViaGmail(cfg, mail, messageId);
    } catch (e) {
      console.error("[mail] send failed", e);
      throw new DomainError(502, `메일 발송에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const { db } = await getHandle();
  const [row] = await db
    .insert(mails)
    .values({
      itemId,
      direction: "out",
      kind,
      status: simulated ? "simulated" : "sent",
      messageId,
      inReplyTo: mail.inReplyTo ?? null,
      fromAddr: cfg.gmailAddress,
      toAddrs: mail.to.join(", "),
      subject: mail.subject,
      bodyText: mail.text,
      simulated,
    })
    .returning();
  if (mail.attachments?.length) {
    await db.insert(mailAttachments).values(
      mail.attachments.map((a) => ({
        mailId: row.id,
        filename: a.filename,
        contentType: a.contentType ?? "text/markdown",
        size: Buffer.byteLength(a.content, "utf8"),
        content: a.content,
      })),
    );
  }
  return (await withAttachments([row]))[0];
}

/** 1단계: 수집 요청 메일. 수신자는 config의 회사 주소로 고정한다 (자동 발송 규칙). */
export async function sendCollectRequest(itemId: number): Promise<MailSummaryDTO> {
  const cfg = getMailConfig();
  const d = await getItemDetail(itemId);
  const { subject, text } = composeCollectRequest({
    code: d.code,
    service: d.path.service?.name ?? null,
    label: d.path.label?.name ?? null,
    item: d.name,
    ...d.fields,
  });
  const sent = await sendAndRecord(cfg, itemId, d.code, "collect_request", { to: [cfg.collectTo], subject, text });
  await addEvent(itemId, "mail", `수집 요청 메일 발송${sent.simulated ? " (시뮬레이터)" : ""}: ${subject}`);
  if (d.statuses.collect.status === "pending") {
    await setStageStatus(itemId, "collect", "in_progress", "수집 요청 발송");
  }
  return sent;
}

/** 발송될 수집 요청 메일 미리보기 */
export async function previewCollectRequest(itemId: number) {
  const cfg = getMailConfig();
  const d = await getItemDetail(itemId);
  const m = composeCollectRequest({
    code: d.code,
    service: d.path.service?.name ?? null,
    label: d.path.label?.name ?? null,
    item: d.name,
    ...d.fields,
  });
  return { ...m, to: cfg.collectTo, mode: cfg.mode };
}

// ---------------------------------------------------------------- 수신

export interface PollResult {
  mode: MailConfig["mode"];
  fetched: number;
  stored: number;
  matched: number;
  unmatched: number;
  skipped: number;
  at: string;
}

type GlobalWithPoll = typeof globalThis & { __aiddPolling?: Promise<PollResult> };
const g = globalThis as GlobalWithPoll;

/** 메일 확인. 동시에 여러 번 눌려도 한 번만 실행한다. */
export function pollMail(): Promise<PollResult> {
  if (!g.__aiddPolling) {
    g.__aiddPolling = doPoll().finally(() => {
      g.__aiddPolling = undefined;
    });
  }
  return g.__aiddPolling;
}

async function doPoll(): Promise<PollResult> {
  const cfg = getMailConfig();
  requireUsable(cfg);
  const { db } = await getHandle();
  let inbound: InboundMail[] = [];

  if (cfg.mode === "gmail") {
    const prev: FetchState = {
      uidValidity: await getState("imap_uid_validity"),
      lastUid: Number(await getState("imap_last_uid")) || 0,
    };
    try {
      const r = await fetchViaImap(cfg, prev);
      inbound = r.mails;
      // 처리 전에 위치를 저장하면 실패 시 메일을 놓칠 수 있으므로, 처리 후 저장한다
      const result = await ingestAll(cfg, inbound, false);
      await setState("imap_uid_validity", r.state.uidValidity ?? "");
      await setState("imap_last_uid", String(r.state.lastUid));
      await setState("last_poll_at", result.at);
      return result;
    } catch (e) {
      if (e instanceof DomainError) throw e;
      console.error("[mail] poll failed", e);
      throw new DomainError(502, `메일 확인에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // simulator
  const rows = await db.select().from(simInbox).where(isNull(simInbox.consumedAt)).orderBy(asc(simInbox.id));
  inbound = rows.map((r) => {
    const p = JSON.parse(r.payload) as InboundMail & { date: string };
    return { ...p, date: new Date(p.date) };
  });
  if (rows.length) {
    await db
      .update(simInbox)
      .set({ consumedAt: new Date() })
      .where(inArray(simInbox.id, rows.map((r) => r.id)));
  }
  const result = await ingestAll(cfg, inbound, true);
  await setState("last_poll_at", result.at);
  return result;
}

async function ingestAll(cfg: MailConfig, inbound: InboundMail[], simulated: boolean): Promise<PollResult> {
  const res: PollResult = {
    mode: cfg.mode,
    fetched: inbound.length,
    stored: 0,
    matched: 0,
    unmatched: 0,
    skipped: 0,
    at: new Date().toISOString(),
  };
  for (const m of inbound) {
    const r = await ingestMail(cfg, m, simulated);
    if (r === "skipped") res.skipped++;
    else {
      res.stored++;
      if (r === "matched") res.matched++;
      else res.unmatched++;
    }
  }
  return res;
}

/** 수신 메일 한 통을 기록하고, 개발사항에 매칭되면 단계를 진행한다. */
export async function ingestMail(
  cfg: MailConfig,
  m: InboundMail,
  simulated: boolean,
): Promise<"matched" | "unmatched" | "skipped"> {
  if (!simulated && !isRelevant(m, cfg.collectTo)) return "skipped";
  const { db } = await getHandle();

  const messageId = m.messageId ? normalizeMessageId(m.messageId) : null;
  if (messageId) {
    const [dup] = await db
      .select({ id: mails.id })
      .from(mails)
      .where(and(eq(mails.direction, "in"), eq(mails.messageId, messageId)));
    if (dup) return "skipped";
  }

  // 헤더 매칭용: 우리가 보낸 메일의 Message-ID → 개발사항 코드
  const refIds = [m.inReplyTo, ...m.references].filter((x): x is string => !!x).map(normalizeMessageId);
  const codeByMsgId = new Map<string, string>();
  if (refIds.length) {
    const rows = await db
      .select({ messageId: mails.messageId, code: devItems.code })
      .from(mails)
      .innerJoin(devItems, eq(devItems.nodeId, mails.itemId))
      .where(and(eq(mails.direction, "out"), inArray(mails.messageId, refIds)));
    for (const r of rows) if (r.messageId) codeByMsgId.set(r.messageId, r.code);
  }

  const kind = detectKind(m);
  const match = matchMail(m, (id) => codeByMsgId.get(id) ?? null);
  let itemId: number | null = null;
  if (match.code) {
    const [it] = await db.select({ id: devItems.nodeId }).from(devItems).where(eq(devItems.code, match.code));
    itemId = it?.id ?? null;
  }

  const [row] = await db
    .insert(mails)
    .values({
      itemId,
      direction: "in",
      kind,
      status: itemId ? "matched" : "unmatched",
      matchMethod: itemId ? match.method : null,
      messageId,
      inReplyTo: m.inReplyTo ? normalizeMessageId(m.inReplyTo) : null,
      refs: m.references.join(" "),
      fromAddr: m.from,
      toAddrs: m.to,
      subject: m.subject,
      bodyText: m.text,
      simulated,
      mailDate: m.date,
    })
    .returning();
  if (m.attachments.length) {
    await db.insert(mailAttachments).values(
      m.attachments.map((a) => ({
        mailId: row.id,
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
        content: a.content,
      })),
    );
  }

  if (itemId) {
    await applyInboundEffects(itemId, row);
    return "matched";
  }
  // 태그 없는 문서 전달 메일: L3로 개발사항을 추정해 자동 지정하거나 추천을 남긴다 (P4)
  if (m.attachments.some((a) => a.content && isDocAttachment(a))) {
    const { handleDocMail } = await import("./docs");
    if ((await handleDocMail(row.id)) === "assigned") return "matched";
  }
  return "unmatched";
}

/** 매칭된 수신 메일의 효과: 이력 기록과 단계 진행 */
async function applyInboundEffects(itemId: number, m: MailRow) {
  const { db } = await getHandle();
  const statusOf = async (stage: "review" | "progress") => {
    const [r] = await db
      .select({ s: stages.status })
      .from(stages)
      .where(and(eq(stages.itemId, itemId), eq(stages.stage, stage)));
    return r?.s;
  };
  const sim = m.simulated ? " (시뮬레이터)" : "";

  switch (m.kind) {
    case "collect_reply":
      await addEvent(itemId, "mail", `수집 회신 수신${sim}: ${m.subject}`);
      await setStageStatus(itemId, "collect", "done", "수집 회신 수신");
      if ((await statusOf("review")) === "pending") {
        await setStageStatus(itemId, "review", "in_progress", "수집 회신 수신");
      }
      break;
    case "progress_reply":
      await addEvent(itemId, "mail", `진행상황 회신 수신${sim}: ${m.subject}`);
      // 해석(L6)에 성공해야 6단계 완료 (P5, G-05)
      {
        const { handleProgressMail } = await import("./progress");
        await handleProgressMail(m.id);
      }
      break;
    case "doc_forward": {
      const { db: d } = await getHandle();
      const atts = await d.select().from(mailAttachments).where(eq(mailAttachments.mailId, m.id));
      const names = atts.map((a) => a.filename).join(", ");
      await addEvent(itemId, "mail", `문서 전달 메일 수신${sim} (첨부: ${names || "없음"}): ${m.subject}`);
      // 유형 판별(키워드 → L3)과 Architecture/QA 등록, 검토 리포트 생성 (P4)
      const { handleDocMail } = await import("./docs");
      await handleDocMail(m.id);
      break;
    }
    default:
      await addEvent(itemId, "mail", `메일 수신${sim}: ${m.subject}`);
  }
}

// ---------------------------------------------------------------- 조회·미분류함

export async function listItemMails(itemId: number): Promise<MailSummaryDTO[]> {
  const { db } = await getHandle();
  const rows = await db
    .select()
    .from(mails)
    .where(eq(mails.itemId, itemId))
    .orderBy(desc(mails.mailDate), desc(mails.id));
  return withAttachments(rows);
}

export async function listMailsByStatus(status: MailStatus): Promise<MailSummaryDTO[]> {
  const { db } = await getHandle();
  const rows = await db
    .select()
    .from(mails)
    .where(and(eq(mails.direction, "in"), eq(mails.status, status)))
    .orderBy(desc(mails.mailDate), desc(mails.id))
    .limit(200);
  return withAttachments(rows);
}

export async function getMail(id: number): Promise<MailDetailDTO> {
  const { db } = await getHandle();
  const [m] = await db.select().from(mails).where(eq(mails.id, id));
  if (!m) throw new DomainError(404, "메일을 찾을 수 없습니다.");
  const atts = await db.select().from(mailAttachments).where(eq(mailAttachments.mailId, id)).orderBy(asc(mailAttachments.id));
  const s = toSummary(m, atts);
  return {
    ...s,
    body: m.bodyText,
    attachments: s.attachments.map((a, i) => ({ ...a, content: atts[i].content })),
  };
}

async function getInbound(id: number): Promise<MailRow> {
  const { db } = await getHandle();
  const [m] = await db.select().from(mails).where(eq(mails.id, id));
  if (!m) throw new DomainError(404, "메일을 찾을 수 없습니다.");
  if (m.direction !== "in") throw new DomainError(400, "수신 메일만 지정할 수 있습니다.");
  return m;
}

/** 미분류 메일을 개발사항에 수동 지정 */
export async function assignMail(id: number, itemId: number) {
  const m = await getInbound(id);
  const { db } = await getHandle();
  const [it] = await db.select().from(devItems).where(eq(devItems.nodeId, itemId));
  if (!it) throw new DomainError(404, "개발사항을 찾을 수 없습니다.");
  if (m.itemId === itemId && m.status === "matched") return;
  const [row] = await db
    .update(mails)
    .set({ itemId, status: "matched", matchMethod: "manual" })
    .where(eq(mails.id, id))
    .returning();
  await addEvent(itemId, "mail", `미분류 메일을 이 개발사항으로 지정 (${it.code})`);
  await applyInboundEffects(itemId, row);
}

export async function ignoreMail(id: number) {
  await getInbound(id);
  const { db } = await getHandle();
  await db.update(mails).set({ status: "ignored" }).where(eq(mails.id, id));
}

export async function restoreMail(id: number) {
  const m = await getInbound(id);
  if (m.status !== "ignored") return;
  const { db } = await getHandle();
  await db.update(mails).set({ status: "unmatched", itemId: null, matchMethod: null }).where(eq(mails.id, id));
}

// ---------------------------------------------------------------- 상태 요약

export interface MailStatusDTO {
  mode: MailConfig["mode"];
  unmatched: number;
  lastPollAt: string | null;
  pendingSimulated: number;
}

export async function mailStatus(): Promise<MailStatusDTO> {
  const cfg = getMailConfig();
  const { db } = await getHandle();
  const [u] = await db
    .select({ n: count() })
    .from(mails)
    .where(and(eq(mails.direction, "in"), eq(mails.status, "unmatched")));
  const [p] = await db.select({ n: count() }).from(simInbox).where(isNull(simInbox.consumedAt));
  return {
    mode: cfg.mode,
    unmatched: Number(u?.n ?? 0),
    lastPollAt: await getState("last_poll_at"),
    pendingSimulated: Number(p?.n ?? 0),
  };
}

// ---------------------------------------------------------------- 시뮬레이터

/** 가상 받은편지함에 샘플 메일을 넣는다. 다음 '메일 확인' 때 처리된다. */
export async function injectSample(key: SampleKey, itemId: number | null) {
  const cfg = getMailConfig();
  if (cfg.mode !== "simulator") {
    throw new DomainError(400, "시뮬레이터 모드에서만 샘플 메일을 넣을 수 있습니다.");
  }
  let ctx: Parameters<typeof buildSample>[1] = {
    code: null,
    item: "통화매니저 SSO 로그인 기능 개발",
    service: null,
    label: null,
    companyAddress: cfg.collectTo,
    systemAddress: cfg.gmailAddress,
    request: null,
  };
  if (itemId !== null) {
    const d = await getItemDetail(itemId);
    const { db } = await getHandle();
    const reqKind: MailKind | null =
      key === "collect_reply" ? "collect_request" : key.startsWith("progress_reply") ? "progress_request" : null;
    let request: { subject: string; messageId: string | null } | null = null;
    if (reqKind) {
      const [r] = await db
        .select({ subject: mails.subject, messageId: mails.messageId })
        .from(mails)
        .where(and(eq(mails.itemId, itemId), eq(mails.direction, "out"), eq(mails.kind, reqKind)))
        .orderBy(desc(mails.id))
        .limit(1);
      request = r ?? null;
    }
    ctx = {
      ...ctx,
      code: key === "untagged_doc" ? null : d.code,
      item: d.name,
      service: d.path.service?.name ?? null,
      label: d.path.label?.name ?? null,
      request,
    };
  }
  const mail = buildSample(key, ctx);
  const { db } = await getHandle();
  await db.insert(simInbox).values({ payload: JSON.stringify(mail) });
  return { subject: mail.subject };
}

// ---------------------------------------------------------------- 수집 회신 직접 입력 (P4, P3 보완)

/**
 * Copilot 회신 본문을 붙여 넣어 수집 회신으로 등록한다.
 * Gmail을 쓸 수 없을 때 실제 회신으로 2·3단계를 진행하기 위한 경로.
 */
export async function addManualReply(itemId: number, text: unknown): Promise<MailSummaryDTO> {
  if (typeof text !== "string" || text.trim().length < 20) {
    throw new DomainError(400, "회신 본문을 20자 이상 붙여 넣으세요.");
  }
  const d = await getItemDetail(itemId);
  const { db } = await getHandle();
  const [row] = await db
    .insert(mails)
    .values({
      itemId,
      direction: "in",
      kind: "collect_reply",
      status: "matched",
      matchMethod: "manual",
      fromAddr: "(직접 입력)",
      toAddrs: "",
      subject: `(직접 입력) ${d.code} 수집 회신`,
      bodyText: text.slice(0, MAX_TEXT),
    })
    .returning();
  await applyInboundEffects(itemId, row);
  return (await withAttachments([row]))[0];
}
