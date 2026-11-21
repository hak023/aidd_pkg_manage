/**
 * P5 진행상황: 요청 메일, L6 해석·이력, 직접 입력, 공유 (설계: docs/dev/P5_진행상황-완료.md)
 */
import { and, desc, eq } from "drizzle-orm";
import { getHandle } from "@/lib/db/client";
import { mails, progressReports } from "@/lib/db/schema";
import { composeProgressRequest } from "@/lib/mail/compose";
import { getMailConfig } from "@/lib/mail/config";
import { diffMilestones, extractProgressBlock, renderMilestoneTable, type Milestone } from "@/lib/llm/progress";
import { getLlmProvider, runProgress } from "@/lib/llm/provider";
import { MAX_TEXT } from "@/lib/mail/transport";
import { parseRecipients, stakeholderEmails } from "./docs";
import { badRequest, DomainError, notFound } from "./errors";
import { sendAndRecord, type MailSummaryDTO } from "./mail";
import { addEvent, getItemDetail, setStageStatus, type ItemDetailDTO } from "./tree";

type ReportRow = typeof progressReports.$inferSelect;

export interface ProgressReportDTO {
  id: number;
  mailId: number | null;
  mailSubject: string | null;
  status: "ok" | "failed";
  provider: string;
  model: string;
  error: string | null;
  milestones: Milestone[] | null;
  /** 직전 성공 기록 대비 바뀐 점 */
  changes: string[];
  createdAt: string;
}

export interface ProgressStateDTO {
  latest: ProgressReportDTO | null;
  history: ProgressReportDTO[];
  replies: { id: number; subject: string; date: string }[];
  llm: string;
}

function parseMs(s: string | null): Milestone[] | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as Milestone[];
  } catch {
    return null;
  }
}

function itemTarget(d: ItemDetailDTO) {
  return {
    code: d.code,
    service: d.path.service?.name ?? null,
    label: d.path.label?.name ?? null,
    item: d.name,
    ...d.fields,
  };
}

// ------------------------------------------------------------ 요청 메일

export async function previewProgressRequest(itemId: number) {
  const cfg = getMailConfig();
  const d = await getItemDetail(itemId);
  return { ...composeProgressRequest(itemTarget(d)), to: cfg.collectTo, mode: cfg.mode };
}

/** 6단계: 진행상황 요청 메일. 받는 사람은 config의 회사 주소로 고정 (자동 발송 규칙) */
export async function sendProgressRequest(itemId: number): Promise<MailSummaryDTO> {
  const cfg = getMailConfig();
  const d = await getItemDetail(itemId);
  const { subject, text } = composeProgressRequest(itemTarget(d));
  const sent = await sendAndRecord(cfg, itemId, d.code, "progress_request", { to: [cfg.collectTo], subject, text });
  await addEvent(itemId, "mail", `진행상황 요청 메일 발송${sent.simulated ? " (시뮬레이터)" : ""}: ${subject}`);
  if (d.statuses.progress.status === "pending") {
    await setStageStatus(itemId, "progress", "in_progress", "진행상황 요청 발송");
  }
  return sent;
}

// ------------------------------------------------------------ 해석 (L6)

/**
 * 진행상황 회신 한 통을 해석해 기록한다. 수신(ingest)·수동 지정·다시 해석·직접 입력에서 호출.
 * 성공하면 6단계 완료, 실패하면 기록만 하고 단계는 그대로 (G-05).
 */
export async function handleProgressMail(mailId: number): Promise<ProgressReportDTO> {
  const { db } = await getHandle();
  const [m] = await db.select().from(mails).where(eq(mails.id, mailId));
  if (!m || !m.itemId) throw notFound("진행상황 회신");
  const d = await getItemDetail(m.itemId);
  const { text } = extractProgressBlock(m.bodyText);

  let row: ReportRow;
  try {
    const run = await runProgress(d.name, text);
    [row] = await db
      .insert(progressReports)
      .values({
        itemId: d.id,
        mailId,
        status: "ok",
        provider: run.provider,
        model: run.model,
        sourceText: text,
        milestones: JSON.stringify(run.output),
      })
      .returning();
    const launch = run.output.find((x) => x.name === "상용적용");
    await addEvent(
      d.id,
      "progress",
      `진행상황 해석 (${run.provider === "rule" ? "규칙" : run.provider === "mock" ? "모의" : run.model}): 상용적용 ${launch?.status ?? "미정"} ${launch?.end || "미정"}`,
    );
    await setStageStatus(d.id, "progress", "done", "진행상황 회신 해석");
  } catch (e) {
    if (e instanceof DomainError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    let provider = "unknown";
    try {
      provider = getLlmProvider();
    } catch {
      /* 설정 오류 */
    }
    [row] = await db
      .insert(progressReports)
      .values({ itemId: d.id, mailId, status: "failed", provider, sourceText: text, error: msg.slice(0, 2000) })
      .returning();
    await addEvent(d.id, "progress", `진행상황 해석 실패: ${msg.slice(0, 200)} — '다시 해석' 또는 '직접 입력'을 쓰세요.`);
  }
  return (await toDTOs([row], d.id))[0];
}

async function toDTOs(rows: ReportRow[], itemId: number): Promise<ProgressReportDTO[]> {
  const { db } = await getHandle();
  // 변경 비교를 위해 이 개발사항의 성공 기록 전체를 시간순으로 본다
  const okRows = await db
    .select()
    .from(progressReports)
    .where(and(eq(progressReports.itemId, itemId), eq(progressReports.status, "ok")))
    .orderBy(progressReports.id);
  const subjects = new Map<number, string>();
  for (const r of rows) {
    if (r.mailId && !subjects.has(r.mailId)) {
      const [m] = await db.select({ subject: mails.subject }).from(mails).where(eq(mails.id, r.mailId));
      if (m) subjects.set(r.mailId, m.subject);
    }
  }
  return rows.map((r) => {
    const ms = parseMs(r.milestones);
    const idx = okRows.findIndex((x) => x.id === r.id);
    const prev = idx > 0 ? parseMs(okRows[idx - 1].milestones) : null;
    return {
      id: r.id,
      mailId: r.mailId,
      mailSubject: r.mailId ? (subjects.get(r.mailId) ?? null) : null,
      status: r.status,
      provider: r.provider,
      model: r.model,
      error: r.error,
      milestones: ms,
      changes: r.status === "ok" && ms ? diffMilestones(prev, ms) : [],
      createdAt: r.createdAt.toISOString(),
    };
  });
}

async function progressReplies(itemId: number) {
  const { db } = await getHandle();
  return db
    .select()
    .from(mails)
    .where(and(eq(mails.itemId, itemId), eq(mails.direction, "in"), eq(mails.kind, "progress_reply")))
    .orderBy(desc(mails.mailDate), desc(mails.id));
}

export async function getProgressState(itemId: number): Promise<ProgressStateDTO> {
  await getItemDetail(itemId);
  const { db } = await getHandle();
  const rows = await db
    .select()
    .from(progressReports)
    .where(eq(progressReports.itemId, itemId))
    .orderBy(desc(progressReports.id))
    .limit(50);
  const history = await toDTOs(rows, itemId);
  let llm: string;
  try {
    llm = getLlmProvider() === "mock" ? "모의 LLM" : "Gemini";
  } catch (e) {
    llm = e instanceof Error ? e.message : "LLM 설정 오류";
  }
  return {
    latest: history.find((h) => h.status === "ok") ?? null,
    history,
    replies: (await progressReplies(itemId)).map((m) => ({ id: m.id, subject: m.subject, date: m.mailDate.toISOString() })),
    llm,
  };
}

/** 다시 해석: 지정한 회신(없으면 최신 회신) */
export async function reparseProgress(itemId: number, mailId?: number | null): Promise<ProgressReportDTO> {
  const replies = await progressReplies(itemId);
  const m = mailId ? replies.find((r) => r.id === mailId) : replies[0];
  if (!m) throw badRequest("진행상황 회신이 없습니다. 요청 메일을 보내 회신을 받거나 '직접 입력'을 쓰세요.");
  return handleProgressMail(m.id);
}

/** 진행상황 회신 직접 입력 (Gmail을 쓸 수 없을 때) */
export async function addManualProgress(itemId: number, text: unknown): Promise<ProgressReportDTO> {
  if (typeof text !== "string" || text.trim().length < 10) throw badRequest("회신 본문을 붙여 넣으세요.");
  const d = await getItemDetail(itemId);
  const { db } = await getHandle();
  const [row] = await db
    .insert(mails)
    .values({
      itemId,
      direction: "in",
      kind: "progress_reply",
      status: "matched",
      matchMethod: "manual",
      fromAddr: "(직접 입력)",
      subject: `(직접 입력) ${d.code} 진행상황 회신`,
      bodyText: text.slice(0, MAX_TEXT),
    })
    .returning();
  await addEvent(itemId, "mail", "진행상황 회신 직접 입력");
  return handleProgressMail(row.id);
}

// ------------------------------------------------------------ 공유

export function progressShareSubject(itemName: string) {
  return `[AX_AIDD시스템] ${itemName} 진행상황을 공유합니다.`;
}

async function latestOk(itemId: number): Promise<ReportRow | null> {
  const { db } = await getHandle();
  const [r] = await db
    .select()
    .from(progressReports)
    .where(and(eq(progressReports.itemId, itemId), eq(progressReports.status, "ok")))
    .orderBy(desc(progressReports.id))
    .limit(1);
  return r ?? null;
}

export function progressShareText(itemName: string, code: string, ms: Milestone[], at: string): string {
  return [
    "안녕하세요. AX_AIDD 시스템입니다.",
    "",
    `"${itemName}"(${code})의 진행상황을 공유드립니다. (${at.slice(0, 10)} 기준, 확인되지 않은 값은 "미정")`,
    "",
    renderMilestoneTable(ms),
    "",
    "일정 변경이나 정정 사항이 있으면 회신 부탁드립니다.",
  ].join("\n");
}

export async function progressShareDefaults(itemId: number) {
  const d = await getItemDetail(itemId);
  const r = await latestOk(itemId);
  const ms = parseMs(r?.milestones ?? null);
  return {
    to: await stakeholderEmails(itemId),
    subject: progressShareSubject(d.name),
    text: ms ? progressShareText(d.name, d.code, ms, r!.createdAt.toISOString()) : "",
    reportId: r?.id ?? null,
    mode: getMailConfig().mode,
  };
}

/** 사용자가 수신자를 확인하고 버튼을 눌렀을 때만 호출된다 (AGENTS.md 5-4). 단계는 바꾸지 않는다. */
export async function shareProgress(
  itemId: number,
  input: { to: unknown; subject: unknown; text: unknown },
): Promise<{ mail: MailSummaryDTO }> {
  const d = await getItemDetail(itemId);
  const r = await latestOk(itemId);
  if (!r) throw badRequest("공유할 진행상황이 없습니다. 먼저 회신을 해석하세요.");
  const to = parseRecipients(input.to);
  const subject = typeof input.subject === "string" && input.subject.trim() ? input.subject.trim().slice(0, 300) : progressShareSubject(d.name);
  const ms = parseMs(r.milestones)!;
  const text =
    typeof input.text === "string" && input.text.trim() ? input.text.slice(0, 20000) : progressShareText(d.name, d.code, ms, r.createdAt.toISOString());
  const mail = await sendAndRecord(getMailConfig(), itemId, d.code, "share", { to, subject, text });
  await addEvent(itemId, "share", `진행상황 공유${mail.simulated ? " (시뮬레이터)" : ""}: ${to.length}명 (${to.join(", ")})`);
  return { mail };
}

// ------------------------------------------------------------ 대시보드

export interface LaunchInfo {
  status: string;
  end: string;
  endKind: string;
}

/** 개발사항별 최신 '상용적용' 마일스톤 */
export async function latestLaunchByItem(): Promise<Map<number, LaunchInfo>> {
  const { db } = await getHandle();
  const rows = await db
    .select({ itemId: progressReports.itemId, milestones: progressReports.milestones, id: progressReports.id })
    .from(progressReports)
    .where(eq(progressReports.status, "ok"))
    .orderBy(desc(progressReports.id));
  const out = new Map<number, LaunchInfo>();
  for (const r of rows) {
    if (out.has(r.itemId)) continue;
    const l = parseMs(r.milestones)?.find((x) => x.name === "상용적용");
    if (l) out.set(r.itemId, { status: l.status, end: l.end, endKind: l.endKind });
  }
  return out;
}

