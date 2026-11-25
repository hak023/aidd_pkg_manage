/**
 * 시연용 데이터 초기화 및 생성 엔진. 시연 데이터(is_demo)만 지우고 다시 만든다.
 * - 개발사항 하나(DEMO_SCENARIO)를 1~7단계 상태로 각각 만든다 (단계별 스냅샷 7개).
 * - 7개 스냅샷은 같은 일정(lib/demo/timeline.ts)을 쓰고, 자기 단계까지의 메일·점검·문서·마일스톤·이력만 가진다.
 * - Neon HTTP 환경에서도 빨리 끝나도록 테이블별로 묶어서 INSERT한다.
 */
import { getHandle } from "@/lib/db/client";
import {
  devItems,
  documents,
  events,
  mailAttachments,
  mails,
  nodes,
  progressReports,
  reviews,
  stages,
  type DocKind,
  type MailDirection,
  type MailKind,
  type MailStatus,
  type MatchMethod,
  type StageKey,
  type StageStatus,
} from "@/lib/db/schema";
import {
  buildArch,
  buildCollect,
  buildPrd,
  buildProgress,
  buildQa,
  DEMO_MODEL,
  DEMO_SYSTEM_EMAIL,
  mailbox,
  makeMsgId,
  PRD_V2_NOTE,
  stakeholders,
  type BuildContext,
} from "@/lib/demo/builders";
import { DEMO_SCENARIO } from "@/lib/demo/catalog";
import { buildTimeline, type TimeKey } from "@/lib/demo/timeline";
import { docFileName, formatDevCode } from "@/lib/domain/naming";
import { STAGE_KEYS, STATUS_LABEL, stageDef } from "@/lib/domain/stages";
import { progressShareSubject, progressShareText } from "./progress";
import { shareSubject } from "./docs";
import { DomainError } from "./errors";

export interface DemoSeedSummary {
  services: number;
  labels: number;
  items: number;
  stageCounts: Record<StageKey, number>;
  mails: number;
  documents: number;
  elapsedMs: number;
}

export interface SeedOptions {
  now?: Date;
}

const CHUNK_SIZE = 75;

async function insertChunked<TVal extends Record<string, unknown>>(
  runChunk: (chunk: TVal[]) => Promise<{ id: number }[]>,
  rows: TVal[],
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const res = await runChunk(rows.slice(i, i + CHUNK_SIZE));
    for (const r of res) ids.push(r.id);
  }
  return ids;
}

async function execChunked<TVal extends Record<string, unknown>>(
  runChunk: (chunk: TVal[]) => Promise<unknown>,
  rows: TVal[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await runChunk(rows.slice(i, i + CHUNK_SIZE));
  }
}

/**
 * 시연 데이터만 지운다. 실제 업무 데이터(is_demo = false)는 건드리지 않는다.
 * - 시연 개발사항에 매칭된 실제 수신 메일은 미분류함으로 되돌린다.
 * - 개발사항 코드 시퀀스는 되돌리지 않는다(실제 자료와 코드가 겹치지 않게).
 */
export async function clearDemoData(): Promise<void> {
  const h = await getHandle();
  await h.query(
    `UPDATE mails SET item_id = NULL, status = 'unmatched', match_method = NULL
       WHERE is_demo = false AND direction = 'in' AND status = 'matched'
         AND item_id IN (SELECT id FROM nodes WHERE is_demo = true)`,
  );
  await h.query("DELETE FROM mails WHERE is_demo = true");
  await h.query("DELETE FROM nodes WHERE is_demo = true");
}

const LOCK_KEY = "demo_reset_lock";
const LOCK_TTL_MS = 5 * 60_000;

/** 여러 사용자가 동시에 눌러도 한 번만 실행되도록 DB에 잠금을 둔다 (5분 뒤 자동 만료). */
async function acquireDemoLock(): Promise<boolean> {
  const h = await getHandle();
  const now = Date.now();
  const rows = await h.query(
    `INSERT INTO app_state (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE app_state.value < $3
       RETURNING key`,
    [LOCK_KEY, String(now), String(now - LOCK_TTL_MS)],
  );
  return rows.length > 0;
}

async function releaseDemoLock() {
  const h = await getHandle();
  await h.query("DELETE FROM app_state WHERE key = $1", [LOCK_KEY]);
}

/**
 * 시연 데이터만 초기화하고 다시 생성한다.
 * 생성 중 실패하면 일부만 생긴 시연 자료를 지우고 오류를 알린다(다시 누르면 복구).
 */
export async function resetAndSeedDemoData(opts?: SeedOptions): Promise<DemoSeedSummary> {
  if (!(await acquireDemoLock())) {
    throw new DomainError(409, "다른 사용자가 시연 데이터를 초기화하는 중입니다. 잠시 뒤 다시 시도하세요.");
  }
  try {
    await clearDemoData();
    try {
      return await seedDemoData(opts);
    } catch (e) {
      await clearDemoData().catch((ce) => console.error("[demo] cleanup failed", ce));
      throw e;
    }
  } finally {
    await releaseDemoLock().catch((e) => console.error("[demo] unlock failed", e));
  }
}

interface PendingAttachment {
  localAttIdx: number;
  filename: string;
  content: string;
}

interface PendingMail {
  localIdx: number;
  itemIdx: number;
  direction: MailDirection;
  kind: MailKind;
  status: MailStatus;
  matchMethod: MatchMethod | null;
  messageId: string;
  inReplyTo: string | null;
  fromAddr: string;
  toAddrs: string;
  subject: string;
  bodyText: string;
  mailDate: Date;
  attachments: PendingAttachment[];
}

interface PendingDoc {
  localDocIdx: number;
  itemIdx: number;
  kind: DocKind;
  version: number;
  filename: string;
  content: string;
  source: "llm" | "edit" | "mail";
  note: string;
  mailLocalIdx: number | null;
  attLocalIdx: number | null;
  /** 검토 리포트의 대상 문서와 기준 PRD */
  baseDocLocalIdx: number | null;
  prdDocLocalIdx: number | null;
  createdAt: Date;
}

const SNAPSHOT_STAGES = [1, 2, 3, 4, 5, 6, 7] as const;

async function seedDemoData(opts?: SeedOptions): Promise<DemoSeedSummary> {
  const t0 = Date.now();
  const sc = DEMO_SCENARIO;
  const tl = buildTimeline(opts?.now ?? new Date());
  const h = await getHandle();
  const { db } = h;

  const createdAt = tl.at("created");
  const [svc] = await db
    .insert(nodes)
    .values({ type: "service", name: sc.service, parentId: null, sortOrder: 0, isDemo: true, createdAt: new Date(createdAt.getTime() - 10 * 60_000) })
    .returning({ id: nodes.id });
  const [label] = await db
    .insert(nodes)
    .values({ type: "label", name: sc.label, parentId: svc.id, sortOrder: 0, isDemo: true, createdAt: new Date(createdAt.getTime() - 5 * 60_000) })
    .returning({ id: nodes.id });

  // 개발사항 코드는 실제 자료와 같은 시퀀스에서 받아 겹치지 않게 한다
  const codeRows = await h.query<{ v: number }>(
    "SELECT nextval('dev_code_seq')::int AS v FROM generate_series(1, $1::int)",
    [SNAPSHOT_STAGES.length],
  );
  const codes = codeRows
    .map((r) => Number(r.v))
    .sort((a, b) => a - b)
    .map(formatDevCode);

  const itemNodeIds = (
    await db
      .insert(nodes)
      .values(
        SNAPSHOT_STAGES.map((_, idx) => ({
          type: "item" as const,
          name: sc.title,
          parentId: label.id,
          sortOrder: idx,
          isDemo: true,
          createdAt,
        })),
      )
      .returning({ id: nodes.id })
  ).map((r) => r.id);

  const pendingMails: PendingMail[] = [];
  const pendingDocs: PendingDoc[] = [];
  const pendingReviews: {
    itemIdx: number;
    mailLocalIdx: number;
    sourceText: string;
    result: string;
    answers: string;
    extraNote: string;
    createdAt: Date;
    updatedAt: Date;
  }[] = [];
  const pendingProgress: { itemIdx: number; mailLocalIdx: number; sourceText: string; milestones: string; createdAt: Date }[] = [];
  const pendingEvents: { itemIdx: number; kind: string; message: string; createdAt: Date }[] = [];
  const pendingStages: { itemId: number; stage: StageKey; status: StageStatus; updatedAt: Date }[] = [];
  const completedAtByIdx = new Map<number, Date>();
  const stageCounts = Object.fromEntries(STAGE_KEYS.map((k) => [k, 0])) as Record<StageKey, number>;

  let msgSeq = 100;
  let nextAttLocalIdx = 0;

  const people = stakeholders(sc);
  const shareTo = people.map((p) => p.email).join(", ");
  const reviewerBox = mailbox(sc.people.reviewer);
  const fileParts = { service: sc.service, label: sc.label, item: sc.title };
  const md = "text/markdown; charset=utf-8";

  SNAPSHOT_STAGES.forEach((target, itemIdx) => {
    const ctx: BuildContext = { code: codes[itemIdx], sc, tl };
    const status = Object.fromEntries(STAGE_KEYS.map((k) => [k, { status: "pending", at: createdAt }])) as Record<
      StageKey,
      { status: StageStatus; at: Date }
    >;

    const event = (at: TimeKey, kind: string, message: string) =>
      pendingEvents.push({ itemIdx, kind, message, createdAt: tl.at(at) });
    const setStage = (key: StageKey, next: StageStatus, at: TimeKey, reason: string) => {
      event(at, "stage", `[${stageDef(key).label}] ${STATUS_LABEL[status[key].status]} → ${STATUS_LABEL[next]} (${reason})`);
      status[key] = { status: next, at: tl.at(at) };
    };
    const attach = (filename: string, content: string): PendingAttachment => ({ localAttIdx: nextAttLocalIdx++, filename, content });
    const mail = (
      at: TimeKey,
      m: Pick<PendingMail, "kind" | "subject" | "bodyText"> & {
        direction: MailDirection;
        to?: string;
        inReplyTo?: string;
        attachments?: PendingAttachment[];
      },
    ): PendingMail => {
      const out = m.direction === "out";
      const row: PendingMail = {
        localIdx: pendingMails.length,
        itemIdx,
        direction: m.direction,
        kind: m.kind,
        status: out ? "sent" : "matched",
        matchMethod: out ? null : "tag",
        messageId: makeMsgId(tl.at(at), (msgSeq += 1), out ? "mail.gmail.com" : "kt.com"),
        inReplyTo: m.inReplyTo ?? null,
        fromAddr: out ? DEMO_SYSTEM_EMAIL : reviewerBox,
        toAddrs: out ? (m.to ?? sc.people.reviewer.email) : DEMO_SYSTEM_EMAIL,
        subject: m.subject,
        bodyText: m.bodyText,
        mailDate: tl.at(at),
        attachments: m.attachments ?? [],
      };
      pendingMails.push(row);
      return row;
    };
    const doc = (
      at: TimeKey,
      d: Pick<PendingDoc, "kind" | "version" | "filename" | "content" | "source" | "note"> & {
        mail?: PendingMail;
        base?: PendingDoc;
        prd?: PendingDoc;
      },
    ): PendingDoc => {
      const row: PendingDoc = {
        localDocIdx: pendingDocs.length,
        itemIdx,
        kind: d.kind,
        version: d.version,
        filename: d.filename,
        content: d.content,
        source: d.source,
        note: d.note,
        mailLocalIdx: d.mail?.localIdx ?? null,
        attLocalIdx: d.mail?.attachments[0]?.localAttIdx ?? null,
        baseDocLocalIdx: d.base?.localDocIdx ?? null,
        prdDocLocalIdx: d.prd?.localDocIdx ?? null,
        createdAt: tl.at(at),
      };
      pendingDocs.push(row);
      return row;
    };

    const plan = () => {
      event("created", "created", `개발사항 생성 (${ctx.code})`);

      // 1단계: 수집 요청 발송 (회신 대기)
      const collect = buildCollect(ctx);
      const reqMail = mail("collectReq", {
        direction: "out",
        kind: "collect_request",
        subject: collect.request.subject,
        bodyText: collect.request.text,
      });
      event("collectReq", "mail", `수집 요청 메일 발송: ${collect.request.subject}`);
      setStage("collect", "in_progress", "collectReq", "수집 요청 발송");
      if (target < 2) return;

      // 2단계: 수집 회신 수신, 점검 (담당자 보완은 3단계 스냅샷부터 모두 입력)
      const replyMail = mail("collectReply", {
        direction: "in",
        kind: "collect_reply",
        subject: collect.reply.subject,
        bodyText: collect.reply.text,
        inReplyTo: reqMail.messageId,
      });
      event("collectReply", "mail", `수집 회신 수신: ${collect.reply.subject}`);
      setStage("collect", "done", "collectReply", "수집 회신 수신");
      setStage("review", "in_progress", "collectReply", "수집 회신 수신");

      const answered = target === 2 ? collect.answers.slice(0, 1) : collect.answers;
      pendingReviews.push({
        itemIdx,
        mailLocalIdx: replyMail.localIdx,
        sourceText: collect.reply.innerText,
        result: JSON.stringify(collect.review),
        answers: JSON.stringify(Object.fromEntries(answered.map((a, i) => [String(i), a]))),
        extraNote: target === 2 ? "" : collect.extraNote,
        createdAt: tl.at("review"),
        updatedAt: tl.at(target === 2 ? "firstAnswer" : "answers"),
      });
      const counts = (["충분", "부족", "확인 안 됨"] as const).map(
        (s) => `${s} ${collect.review.sections.filter((x) => x.status === s).length}`,
      );
      event("review", "review", `수집 회신 점검 완료 (${DEMO_MODEL}): ${counts.join(", ")}, 질문 ${collect.review.questions.length}개`);
      if (target < 3) return;

      // 3단계: PRD v1(시스템 초안), v2(담당자 편집)
      const prdName = docFileName(fileParts, "PRD");
      doc("prd1", { kind: "prd", version: 1, filename: prdName, content: buildPrd(ctx, 1), source: "llm", note: `${DEMO_MODEL} 초안` });
      event("prd1", "prd", `PRD v1 생성 (${DEMO_MODEL})`);
      setStage("review", "done", "prd1", "PRD 생성");
      setStage("prd", "in_progress", "prd1", "PRD 생성");

      const prdVersion = 2;
      const prdContent = buildPrd(ctx, prdVersion);
      const prdDoc = doc("prd2", { kind: "prd", version: prdVersion, filename: prdName, content: prdContent, source: "edit", note: PRD_V2_NOTE });
      event("prd2", "document", `PRD v${prdVersion} 저장 (편집): ${PRD_V2_NOTE}`);
      if (target < 4) return;

      mail("prdShare", {
        direction: "out",
        kind: "share",
        to: shareTo,
        subject: shareSubject("prd", sc.title),
        bodyText: [
          "안녕하세요. AX_AIDD 시스템입니다.",
          "",
          `"${sc.title}"(${ctx.code})에 대한 PRD를 공유드립니다.`,
          `첨부: ${prdName} (v${prdVersion})`,
          "",
          "사내 메일·Teams·Confluence 논의 내용을 수집해 정리한 초안이며, 담당자가 검토했습니다.",
          "수정·보완 의견이 있으면 회신 부탁드립니다.",
        ].join("\n"),
        attachments: [attach(prdName, prdContent)],
      });
      event("prdShare", "share", `PRD v${prdVersion} 공유: ${people.length}명 (${shareTo})`);
      setStage("prd", "done", "prdShare", "PRD 공유");

      // 4·5단계: 개발사 문서 수신·등록, 검토 리포트 (자기 단계 스냅샷에서는 리포트 확인 중, 다음 단계부터 공유 완료)
      const reviewDoc = (kind: "arch" | "qa", mailAt: TimeKey, shareAt: TimeKey) => {
        const built = (kind === "arch" ? buildArch : buildQa)(ctx, prdContent, prdVersion);
        const body = built.docMd;
        const typeLabel = kind === "arch" ? "Architecture" : "QA(시험항목서)";
        const reportLabel = kind === "arch" ? "Architecture 검토 리포트" : "QA 검토 리포트";

        const fwd = mail(mailAt, {
          direction: "in",
          kind: "doc_forward",
          subject: built.mailSubject,
          bodyText: built.mailBody,
          attachments: [attach(built.rawAttachName, body)],
        });
        event(mailAt, "mail", `문서 전달 메일 수신 (첨부: ${built.rawAttachName}): ${built.mailSubject}`);
        const note = `${built.rawAttachName} · 자동 등록 (키워드)`;
        const base = doc(mailAt, { kind, version: 1, filename: built.registeredName, content: body, source: "mail", note, mail: fwd });
        event(mailAt, "document", `${typeLabel} 문서 v1 등록 (${note})`);
        setStage(kind, "in_progress", mailAt, `${typeLabel} md 등록, 검토 리포트 확인 중`);
        doc(mailAt, {
          kind: kind === "arch" ? "arch_report" : "qa_report",
          version: 1,
          filename: built.reportName,
          content: built.reportMd,
          source: "llm",
          note: `${typeLabel} v1 · PRD v${prdVersion} 기준`,
          base,
          prd: prdDoc,
        });
        const c = built.counts;
        event(mailAt, "report", `${typeLabel} 검토 리포트 v1 생성 (${DEMO_MODEL}): 반영 ${c.반영}, 부분 ${c.부분}, 미반영 ${c.미반영}, 확인 불가 ${c["확인 불가"]}`);
        if (target <= (kind === "arch" ? 4 : 5)) return;

        const what = kind === "arch" ? "Architecture 설계서 검토 결과" : "시험항목서 검토 결과";
        mail(shareAt, {
          direction: "out",
          kind: "share",
          to: shareTo,
          subject: shareSubject(kind, sc.title),
          bodyText: [
            "안녕하세요. AX_AIDD 시스템입니다.",
            "",
            `"${sc.title}"(${ctx.code})에 대한 ${what}를 공유드립니다.`,
            `첨부: ${built.registeredName} (v1), ${built.reportName} (v1)`,
            "",
            "검토 리포트는 PRD 대비 문서상 대조 결과이며, 실제 시험 합격을 뜻하지 않습니다.",
            "수정·보완 의견이 있으면 회신 부탁드립니다.",
          ].join("\n"),
          attachments: [attach(built.registeredName, body), attach(built.reportName, built.reportMd)],
        });
        event(shareAt, "share", `${reportLabel} v1 + ${typeLabel} v1 공유: ${people.length}명 (${shareTo})`);
        setStage(kind, "done", shareAt, "검토 리포트 공유");
      };

      reviewDoc("arch", "archMail", "archShare");
      if (target < 5) return;
      reviewDoc("qa", "qaMail", "qaShare");
      if (target < 6) return;

      // 6단계: 진행상황 요청·회신 2회 (일정 변경 이력), 7단계: 상용적용 완료 회신과 공유
      const rounds = buildProgress(ctx).slice(0, target === 6 ? 2 : 3);
      rounds.forEach((r, n) => {
        const req = mail(r.requestAt, { direction: "out", kind: "progress_request", subject: r.request.subject, bodyText: r.request.text });
        event(r.requestAt, "mail", `진행상황 요청 메일 발송: ${r.request.subject}`);
        if (n === 0) setStage("progress", "in_progress", r.requestAt, "진행상황 요청 발송");

        const rep = mail(r.replyAt, {
          direction: "in",
          kind: "progress_reply",
          subject: r.reply.subject,
          bodyText: r.reply.text,
          inReplyTo: req.messageId,
        });
        event(r.replyAt, "mail", `진행상황 회신 수신: ${r.reply.subject}`);
        pendingProgress.push({
          itemIdx,
          mailLocalIdx: rep.localIdx,
          sourceText: r.reply.extractedText,
          milestones: JSON.stringify(r.reply.milestones),
          createdAt: tl.at(r.replyAt),
        });
        const launch = r.reply.milestones.find((m) => m.name === "상용적용");
        event(r.replyAt, "progress", `진행상황 해석 (규칙): 상용적용 ${launch?.status ?? "미정"} ${launch?.end || "미정"}`);
      });
      if (target < 7) return;

      const last = rounds[rounds.length - 1];
      setStage("progress", "done", last.replyAt, "상용적용 완료 회신 해석");
      mail("progShare", {
        direction: "out",
        kind: "share",
        to: shareTo,
        subject: progressShareSubject(sc.title),
        bodyText: progressShareText(sc.title, ctx.code, last.reply.milestones, tl.at(last.replyAt).toISOString()),
      });
      event("progShare", "share", `진행상황 공유: ${people.length}명 (${shareTo})`);
      setStage("done", "done", "done", `${sc.label} 상용적용 확인`);
      completedAtByIdx.set(itemIdx, tl.at("done"));
    };

    plan();
    stageCounts[STAGE_KEYS[target - 1]] += 1;
    for (const sk of STAGE_KEYS) {
      pendingStages.push({ itemId: itemNodeIds[itemIdx], stage: sk, status: status[sk].status, updatedAt: status[sk].at });
    }
  });

  await db.insert(devItems).values(
    SNAPSHOT_STAGES.map((_, idx) => ({
      nodeId: itemNodeIds[idx],
      code: codes[idx],
      keywords: sc.keywords,
      searchPeriod: sc.searchPeriod,
      memo: sc.memo,
      completedAt: completedAtByIdx.get(idx) ?? null,
    })),
  );
  await execChunked((chunk) => db.insert(stages).values(chunk), pendingStages);

  // 메일 → 첨부 → 점검·문서·진행상황 순으로 넣고, 넣은 순서대로 받은 id로 서로 연결한다
  const mailDbIds = await insertChunked(
    (chunk) => db.insert(mails).values(chunk).returning({ id: mails.id }),
    pendingMails.map((m) => ({
      itemId: itemNodeIds[m.itemIdx],
      direction: m.direction,
      kind: m.kind,
      status: m.status,
      matchMethod: m.matchMethod,
      messageId: m.messageId,
      inReplyTo: m.inReplyTo,
      refs: m.inReplyTo ?? "",
      fromAddr: m.fromAddr,
      toAddrs: m.toAddrs,
      subject: m.subject,
      bodyText: m.bodyText,
      simulated: false,
      isDemo: true,
      suggestion: null,
      mailDate: m.mailDate,
      createdAt: m.mailDate,
    })),
  );

  const flatAtts = pendingMails.flatMap((m) => m.attachments.map((a) => ({ ...a, mailDbId: mailDbIds[m.localIdx] })));
  const attDbIds = await insertChunked(
    (chunk) => db.insert(mailAttachments).values(chunk).returning({ id: mailAttachments.id }),
    flatAtts.map((a) => ({
      mailId: a.mailDbId,
      filename: a.filename,
      contentType: md,
      size: Buffer.byteLength(a.content, "utf8"),
      content: a.content,
    })),
  );
  const attDbIdByLocal = new Map(flatAtts.map((a, idx) => [a.localAttIdx, attDbIds[idx]]));

  await execChunked(
    (chunk) => db.insert(reviews).values(chunk),
    pendingReviews.map((r) => ({
      itemId: itemNodeIds[r.itemIdx],
      mailId: mailDbIds[r.mailLocalIdx],
      status: "ok" as const,
      provider: "gemini",
      model: DEMO_MODEL,
      sourceText: r.sourceText,
      result: r.result,
      error: null,
      answers: r.answers,
      extraNote: r.extraNote,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  );

  // 검토 리포트는 대상 문서·기준 PRD의 id가 필요하므로 원문(PRD·Architecture·QA)을 먼저 넣는다
  const baseDocs = pendingDocs.filter((d) => d.baseDocLocalIdx === null);
  const reportDocs = pendingDocs.filter((d) => d.baseDocLocalIdx !== null);
  const docRow = (d: PendingDoc, docDbIdByLocal?: Map<number, number>) => ({
    itemId: itemNodeIds[d.itemIdx],
    kind: d.kind,
    version: d.version,
    filename: d.filename,
    content: d.content,
    source: d.source,
    note: d.note,
    sourceMailId: d.mailLocalIdx !== null ? mailDbIds[d.mailLocalIdx] : null,
    attachmentId: d.attLocalIdx !== null ? (attDbIdByLocal.get(d.attLocalIdx) ?? null) : null,
    baseDocId: d.baseDocLocalIdx !== null ? (docDbIdByLocal?.get(d.baseDocLocalIdx) ?? null) : null,
    prdDocId: d.prdDocLocalIdx !== null ? (docDbIdByLocal?.get(d.prdDocLocalIdx) ?? null) : null,
    createdAt: d.createdAt,
  });
  const baseDocDbIds = await insertChunked(
    (chunk) => db.insert(documents).values(chunk).returning({ id: documents.id }),
    baseDocs.map((d) => docRow(d)),
  );
  const docDbIdByLocal = new Map(baseDocs.map((d, idx) => [d.localDocIdx, baseDocDbIds[idx]]));
  await execChunked(
    (chunk) => db.insert(documents).values(chunk),
    reportDocs.map((d) => docRow(d, docDbIdByLocal)),
  );

  await execChunked(
    (chunk) => db.insert(progressReports).values(chunk),
    pendingProgress.map((pr) => ({
      itemId: itemNodeIds[pr.itemIdx],
      mailId: mailDbIds[pr.mailLocalIdx],
      status: "ok" as const,
      provider: "rule",
      model: "",
      sourceText: pr.sourceText,
      milestones: pr.milestones,
      error: null,
      createdAt: pr.createdAt,
    })),
  );

  // 같은 시각의 이력은 기록한 순서를 유지한다 (정렬은 안정 정렬)
  const orderedEvents = [...pendingEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  await execChunked(
    (chunk) => db.insert(events).values(chunk),
    orderedEvents.map((ev) => ({ itemId: itemNodeIds[ev.itemIdx], kind: ev.kind, message: ev.message, createdAt: ev.createdAt })),
  );

  return {
    services: 1,
    labels: 1,
    items: SNAPSHOT_STAGES.length,
    stageCounts,
    mails: pendingMails.length,
    documents: pendingDocs.length,
    elapsedMs: Date.now() - t0,
  };
}
