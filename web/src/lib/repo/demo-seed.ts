/**
 * 시연용 데이터 전체 초기화 및 일괄 생성 엔진.
 * - 6개 단위서비스 × 각 3개 라벨링 × 라벨링당 2~4개 개발사항(랜덤)
 * - 개발사항별 진행 단계 1~7(랜덤) 및 단계에 부합하는 메일·점검·문서·마일스톤·이력 일괄 적재
 * - Neon HTTP 환경에서도 수 초 내 완료되도록 테이블별 청크 배치 INSERT로 처리한다.
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
  buildArchArtifacts,
  buildCollectMails,
  buildPrdMarkdown,
  buildProgressArtifacts,
  buildQaArtifacts,
  DEMO_COMPANY_EMAIL,
  DEMO_MODEL,
  DEMO_SYSTEM_EMAIL,
  fmtYmd,
  makeMsgId,
  shiftDays,
} from "@/lib/demo/builders";
import { DEMO_CATALOG } from "@/lib/demo/catalog";
import type { ItemBlueprint, LabelSpec, ServiceCatalog } from "@/lib/demo/types";
import { docFileName, formatDevCode } from "@/lib/domain/naming";
import { STAGE_KEYS } from "@/lib/domain/stages";
import { progressShareSubject, progressShareText } from "./progress";
import { shareSubject } from "./docs";

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
  rng?: () => number;
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

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function shuffle<T>(rng: () => number, list: readonly T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 모든 업무 테이블과 개발사항 코드 시퀀스를 초기화한다 (IMAP 연동 오프셋인 app_state는 유지). */
export async function clearAllDemoData(): Promise<void> {
  const h = await getHandle();
  await h.query(
    "TRUNCATE TABLE progress_reports, documents, reviews, mail_attachments, mails, sim_inbox, events, stages, dev_items, nodes RESTART IDENTITY CASCADE",
  );
  await h.query("ALTER SEQUENCE dev_code_seq RESTART WITH 1");
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
  refs: string;
  fromAddr: string;
  toAddrs: string;
  subject: string;
  bodyText: string;
  mailDate: Date;
  attachments: {
    localAttIdx: number;
    filename: string;
    contentType: string;
    content: string;
  }[];
}

interface PendingBaseDoc {
  localDocIdx: number;
  itemIdx: number;
  kind: "prd" | "arch" | "qa";
  version: number;
  filename: string;
  content: string;
  source: "llm" | "edit" | "mail";
  note: string;
  mailLocalIdx: number | null;
  attLocalIdx: number | null;
  createdAt: Date;
}

interface PendingReportDoc {
  itemIdx: number;
  kind: "arch_report" | "qa_report";
  version: number;
  filename: string;
  content: string;
  note: string;
  baseDocLocalIdx: number;
  prdDocLocalIdx: number;
  createdAt: Date;
}

export async function resetAndSeedDemoData(opts?: SeedOptions): Promise<DemoSeedSummary> {
  const t0 = Date.now();
  const rng = opts?.rng ?? Math.random;
  const now = opts?.now ?? new Date();
  const h = await getHandle();
  const { db } = h;

  await clearAllDemoData();

  const baseSvcCreatedAt = new Date(now.getTime() - 60 * 86_400_000);

  // 1. 단위서비스 6개 일괄 생성
  const svcRows = await db
    .insert(nodes)
    .values(
      DEMO_CATALOG.map((svc, idx) => ({
        type: "service" as const,
        name: svc.name,
        parentId: null,
        sortOrder: idx,
        createdAt: new Date(baseSvcCreatedAt.getTime() + idx * 60_000),
      })),
    )
    .returning({ id: nodes.id });

  // 2. 라벨링 18개(서비스당 3개) 일괄 생성
  const labelSpecs: { svcIdx: number; svc: ServiceCatalog; label: LabelSpec; sortOrder: number }[] = [];
  DEMO_CATALOG.forEach((svc, svcIdx) => {
    svc.labels.forEach((label, lIdx) => {
      labelSpecs.push({ svcIdx, svc, label, sortOrder: lIdx });
    });
  });

  const labelRows = await db
    .insert(nodes)
    .values(
      labelSpecs.map((ls, idx) => ({
        type: "label" as const,
        name: ls.label.name,
        parentId: svcRows[ls.svcIdx].id,
        sortOrder: ls.sortOrder,
        createdAt: new Date(baseSvcCreatedAt.getTime() + (idx + 10) * 60_000),
      })),
    )
    .returning({ id: nodes.id });

  // 3. 라벨링마다 2~4개 랜덤 선택, 단계 1~7 랜덤 배정
  interface PlannedItem {
    itemIdx: number;
    code: string;
    svc: ServiceCatalog;
    label: LabelSpec;
    labelNodeId: number;
    sortOrder: number;
    blueprint: ItemBlueprint;
    targetStage: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    createdAt: Date;
  }

  const plannedItems: PlannedItem[] = [];
  let seq = 0;

  DEMO_CATALOG.forEach((svc, svcIdx) => {
    const pool = shuffle(rng, svc.items);
    let cursor = 0;
    svc.labels.forEach((label, lIdx) => {
      const labelIdx = svcIdx * 3 + lIdx;
      const labelNodeId = labelRows[labelIdx].id;
      const count = randInt(rng, 2, 4);
      const chosen = pool.slice(cursor, cursor + count);
      cursor += count;

      chosen.forEach((blueprint, sortOrder) => {
        seq += 1;
        const targetStage = randInt(rng, 1, 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
        // 최근 활동 시각이 자연스럽게 분산되도록 항목별 기준 생성일을 과거 16~52일 사이로 설정
        const daysAgo = 16 + targetStage * 4 + randInt(rng, 0, 10);
        const createdAt = new Date(
          now.getTime() - daysAgo * 86_400_000 - randInt(rng, 0, 6) * 3_600_000 - randInt(rng, 0, 50) * 60_000,
        );
        plannedItems.push({
          itemIdx: plannedItems.length,
          code: formatDevCode(seq),
          svc,
          label,
          labelNodeId,
          sortOrder,
          blueprint,
          targetStage,
          createdAt,
        });
      });
    });
  });

  const itemNodeIds = await insertChunked(
    (chunk) => db.insert(nodes).values(chunk).returning({ id: nodes.id }),
    plannedItems.map((p) => ({
      type: "item" as const,
      name: p.blueprint.title,
      parentId: p.labelNodeId,
      sortOrder: p.sortOrder,
      createdAt: p.createdAt,
    })),
  );

  await h.query("SELECT setval('dev_code_seq', $1, true)", [plannedItems.length]);

  // 4. 단계별 산출물 및 이벤트 조립
  const pendingMails: PendingMail[] = [];
  const pendingBaseDocs: PendingBaseDoc[] = [];
  const pendingReportDocs: PendingReportDoc[] = [];
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
  const pendingProgress: {
    itemIdx: number;
    mailLocalIdx: number;
    sourceText: string;
    milestones: string;
    createdAt: Date;
  }[] = [];
  const pendingEvents: { itemIdx: number; kind: string; message: string; createdAt: Date }[] = [];
  const pendingStages: { itemId: number; stage: StageKey; status: StageStatus; updatedAt: Date }[] = [];
  const completedAtByIdx = new Map<number, Date>();

  let nextMailLocalIdx = 0;
  let nextAttLocalIdx = 0;
  let nextDocLocalIdx = 0;
  let msgSeq = 100;

  const stageCounts: Record<StageKey, number> = {
    collect: 0,
    review: 0,
    prd: 0,
    arch: 0,
    qa: 0,
    progress: 0,
    done: 0,
  };

  for (const p of plannedItems) {
    const itemNodeId = itemNodeIds[p.itemIdx];
    const target = p.targetStage;
    const variant = p.itemIdx;
    const people = p.svc.people;
    const stakeholderTo = [people.requester.email, people.pm.email, people.ops.email, people.qa.email].join(", ");
    const vendorAndStakeholders = [
      people.requester.email,
      people.pm.email,
      people.vendorDev.email,
      people.ops.email,
      people.qa.email,
    ].join(", ");

    // createdAt 이후부터 now 이전까지 순차적으로 이어지는 단계 타임라인(Step 간격) 산출
    const spanMs = Math.max(3_600_000 * 12, now.getTime() - 1_800_000 - p.createdAt.getTime());
    const stepAt = (stepNo: number, totalSteps = 15) =>
      new Date(p.createdAt.getTime() + Math.floor((spanMs * stepNo) / totalSteps));

    pendingEvents.push({
      itemIdx: p.itemIdx,
      kind: "created",
      message: `개발사항 생성 (${p.code})`,
      createdAt: p.createdAt,
    });

    const stageMap: Record<StageKey, { status: StageStatus; at: Date }> = {
      collect: { status: "pending", at: p.createdAt },
      review: { status: "pending", at: p.createdAt },
      prd: { status: "pending", at: p.createdAt },
      arch: { status: "pending", at: p.createdAt },
      qa: { status: "pending", at: p.createdAt },
      progress: { status: "pending", at: p.createdAt },
      done: { status: "pending", at: p.createdAt },
    };

    // 완료 항목(7단계)은 상용적용 실적일이 미래가 되지 않도록 과거 최근 날짜로 기준 보정
    const effectiveLabel: LabelSpec =
      target === 7 && p.label.releaseDate > fmtYmd(stepAt(13))
        ? {
            name: p.label.name,
            releaseDate: fmtYmd(stepAt(13)),
            kickoffDate: fmtYmd(shiftDays(fmtYmd(stepAt(13)), -42)),
          }
        : target === 6 && p.label.releaseDate <= fmtYmd(now)
          ? {
              name: p.label.name,
              releaseDate: fmtYmd(new Date(now.getTime() + (12 + (variant % 18)) * 86_400_000)),
              kickoffDate: p.label.kickoffDate,
            }
          : p.label;

    const ctx = { code: p.code, service: p.svc, label: effectiveLabel, item: p.blueprint };

    // Stage 1: 수집 요청 발송 및 회신
    const collectStarted = target > 1 || variant % 2 === 0;
    let collectData: ReturnType<typeof buildCollectMails> | null = null;
    let replyMailLocalIdx: number | null = null;

    if (collectStarted) {
      const tReq = stepAt(1);
      const tReply = stepAt(2);
      collectData = buildCollectMails(ctx, tReq, tReply, (msgSeq += 3));

      const reqLocalIdx = nextMailLocalIdx++;
      pendingMails.push({
        localIdx: reqLocalIdx,
        itemIdx: p.itemIdx,
        direction: "out",
        kind: "collect_request",
        status: "sent",
        matchMethod: null,
        messageId: collectData.reqMail.messageId,
        inReplyTo: null,
        refs: "",
        fromAddr: DEMO_SYSTEM_EMAIL,
        toAddrs: DEMO_COMPANY_EMAIL,
        subject: collectData.reqMail.subject,
        bodyText: collectData.reqMail.bodyText,
        mailDate: tReq,
        attachments: [],
      });
      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "mail",
        message: `수집 요청 메일 발송: ${collectData.reqMail.subject}`,
        createdAt: tReq,
      });
      stageMap.collect = { status: "in_progress", at: tReq };

      if (target >= 2) {
        replyMailLocalIdx = nextMailLocalIdx++;
        pendingMails.push({
          localIdx: replyMailLocalIdx,
          itemIdx: p.itemIdx,
          direction: "in",
          kind: "collect_reply",
          status: "matched",
          matchMethod: "tag",
          messageId: collectData.replyMail.messageId,
          inReplyTo: collectData.replyMail.inReplyTo,
          refs: collectData.replyMail.inReplyTo,
          fromAddr: `${people.pm.name} <${DEMO_COMPANY_EMAIL}>`,
          toAddrs: DEMO_SYSTEM_EMAIL,
          subject: collectData.replyMail.subject,
          bodyText: collectData.replyMail.bodyText,
          mailDate: tReply,
          attachments: [],
        });
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "mail",
          message: `수집 회신 메일 수신 (제목 태그 매칭): ${collectData.replyMail.subject}`,
          createdAt: tReply,
        });
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "stage",
          message: "[개발 내용 수집] 진행중 → 완료 (수집 회신 수신)",
          createdAt: tReply,
        });
        stageMap.collect = { status: "done", at: tReply };
      }
    }

    // Stage 2: 수집 회신 L1 점검 및 담당자 보완 입력
    if (target >= 2 && collectData && replyMailLocalIdx !== null) {
      const tRev = stepAt(3);
      const tAns = stepAt(4);
      const answersObj: Record<string, string> =
        target === 2
          ? { "0": p.blueprint.conflictResolution }
          : {
              "0": p.blueprint.conflictResolution,
              "1": p.blueprint.extraFollowUpAnswer,
              "2": `${effectiveLabel.name} 검증베드 일정에 맞춰 개발검증 및 운용검증을 순차 진행합니다.`,
            };
      const extraNote =
        target === 2
          ? `${people.ops.dept} 실무 협의 내용 확인 중`
          : `${people.ops.dept}(${people.ops.name}) 및 ${people.qa.dept}(${people.qa.name}) 사전 검토 의견 반영 완료`;

      pendingReviews.push({
        itemIdx: p.itemIdx,
        mailLocalIdx: replyMailLocalIdx,
        sourceText: collectData.replyMail.innerText,
        result: JSON.stringify(collectData.reviewResult),
        answers: JSON.stringify(answersObj),
        extraNote,
        createdAt: tRev,
        updatedAt: tAns,
      });
      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "review",
        message: `수집 회신 점검 완료 (${DEMO_MODEL}): 충분 8, 부족 4, 확인 안 됨 0, 질문 3개`,
        createdAt: tRev,
      });
      stageMap.review = { status: "in_progress", at: tRev };
    }

    // Stage 3: PRD 생성 (일부 항목은 편집 v2 포함) 및 공유
    let latestPrdLocalIdx: number | null = null;
    let latestPrdContent = "";
    let latestPrdVer = 1;

    if (target >= 3 && collectData) {
      const tPrd1 = stepAt(5);
      const prdFilename = docFileName(
        { service: p.svc.name, label: effectiveLabel.name, item: p.blueprint.title },
        "PRD",
      );
      const prdV1 = buildPrdMarkdown(
        ctx,
        collectData.replyMail.subject,
        stepAt(2),
        tPrd1,
        1,
        collectData.citations,
      );
      const prd1Idx = nextDocLocalIdx++;
      pendingBaseDocs.push({
        localDocIdx: prd1Idx,
        itemIdx: p.itemIdx,
        kind: "prd",
        version: 1,
        filename: prdFilename,
        content: prdV1,
        source: "llm",
        note: `${DEMO_MODEL} 초안`,
        mailLocalIdx: null,
        attLocalIdx: null,
        createdAt: tPrd1,
      });
      latestPrdLocalIdx = prd1Idx;
      latestPrdContent = prdV1;
      latestPrdVer = 1;

      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "prd",
        message: `PRD v1 생성 (${DEMO_MODEL})`,
        createdAt: tPrd1,
      });
      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "stage",
        message: "[수집 내용 검토] 진행중 → 완료 (PRD 생성)",
        createdAt: tPrd1,
      });
      stageMap.review = { status: "done", at: tPrd1 };
      stageMap.prd = { status: "in_progress", at: tPrd1 };

      if (variant % 2 === 1) {
        const tPrd2 = stepAt(6);
        const prdV2 = buildPrdMarkdown(
          ctx,
          collectData.replyMail.subject,
          stepAt(2),
          tPrd2,
          2,
          collectData.citations,
        );
        const prd2Idx = nextDocLocalIdx++;
        pendingBaseDocs.push({
          localDocIdx: prd2Idx,
          itemIdx: p.itemIdx,
          kind: "prd",
          version: 2,
          filename: prdFilename,
          content: prdV2,
          source: "edit",
          note: "수용 기준 수치 및 예외 처리 문구 보완",
          mailLocalIdx: null,
          attLocalIdx: null,
          createdAt: tPrd2,
        });
        latestPrdLocalIdx = prd2Idx;
        latestPrdContent = prdV2;
        latestPrdVer = 2;
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "document",
          message: "PRD v2 저장 (편집): 수용 기준 수치 및 예외 처리 문구 보완",
          createdAt: tPrd2,
        });
      }

      if (target >= 4) {
        const tSharePrd = stepAt(7);
        const shareSubjectStr = shareSubject("prd", p.blueprint.title);
        const prdShareMailIdx = nextMailLocalIdx++;
        const prdShareAttIdx = nextAttLocalIdx++;
        pendingMails.push({
          localIdx: prdShareMailIdx,
          itemIdx: p.itemIdx,
          direction: "out",
          kind: "share",
          status: "sent",
          matchMethod: null,
          messageId: makeMsgId(tSharePrd, (msgSeq += 1), "mail.gmail.com"),
          inReplyTo: null,
          refs: "",
          fromAddr: DEMO_SYSTEM_EMAIL,
          toAddrs: vendorAndStakeholders,
          subject: shareSubjectStr,
          bodyText: [
            "안녕하세요. AX_AIDD 시스템입니다.",
            "",
            `"${p.blueprint.title}"(${p.code}) PRD v${latestPrdVer} 문서를 공유드립니다.`,
            `첨부 문서를 기준으로 ${p.svc.vendorName} 상세 설계 및 검증 준비를 진행 부탁드립니다.`,
          ].join("\n"),
          mailDate: tSharePrd,
          attachments: [
            {
              localAttIdx: prdShareAttIdx,
              filename: prdFilename,
              contentType: "text/markdown; charset=utf-8",
              content: latestPrdContent,
            },
          ],
        });
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "share",
          message: `PRD v${latestPrdVer} 공유: 5명 (${vendorAndStakeholders})`,
          createdAt: tSharePrd,
        });
        stageMap.prd = { status: "done", at: tSharePrd };
      }
    }

    // Stage 4: 개발사 Architecture 설계서 수신·등록 및 대조 리포트 생성
    if (target >= 4 && latestPrdLocalIdx !== null) {
      const tArch = stepAt(8);
      const archBuilt = buildArchArtifacts(ctx, latestPrdContent, latestPrdVer, tArch);
      const archMailIdx = nextMailLocalIdx++;
      const archAttIdx = nextAttLocalIdx++;

      pendingMails.push({
        localIdx: archMailIdx,
        itemIdx: p.itemIdx,
        direction: "in",
        kind: "doc_forward",
        status: "matched",
        matchMethod: "tag",
        messageId: makeMsgId(tArch, (msgSeq += 1), "kt-innet.co.kr"),
        inReplyTo: null,
        refs: "",
        fromAddr: `${people.vendorDev.name} <${people.vendorDev.email}>`,
        toAddrs: DEMO_SYSTEM_EMAIL,
        subject: archBuilt.mailSubject,
        bodyText: archBuilt.mailBody,
        mailDate: tArch,
        attachments: [
          {
            localAttIdx: archAttIdx,
            filename: archBuilt.rawAttachName,
            contentType: "text/markdown",
            content: archBuilt.archMd,
          },
        ],
      });

      const archDocIdx = nextDocLocalIdx++;
      pendingBaseDocs.push({
        localDocIdx: archDocIdx,
        itemIdx: p.itemIdx,
        kind: "arch",
        version: 1,
        filename: archBuilt.registeredName,
        content: archBuilt.archMd,
        source: "mail",
        note: `${archBuilt.rawAttachName} · 자동 등록 (키워드)`,
        mailLocalIdx: archMailIdx,
        attLocalIdx: archAttIdx,
        createdAt: tArch,
      });

      const archReportFilename = docFileName(
        { service: p.svc.name, label: effectiveLabel.name, item: p.blueprint.title },
        "Architecture_검토리포트",
      );
      pendingReportDocs.push({
        itemIdx: p.itemIdx,
        kind: "arch_report",
        version: 1,
        filename: archReportFilename,
        content: archBuilt.reportMd,
        note: `Architecture v1 · PRD v${latestPrdVer} 기준`,
        baseDocLocalIdx: archDocIdx,
        prdDocLocalIdx: latestPrdLocalIdx,
        createdAt: tArch,
      });

      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "document",
        message: `Architecture 문서 v1 등록 (${archBuilt.rawAttachName} · 자동 등록)`,
        createdAt: tArch,
      });
      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "report",
        message: `Architecture 검토 리포트 v1 생성 (${DEMO_MODEL}): 반영 4, 부분 1, 미반영 0, 확인 불가 0`,
        createdAt: tArch,
      });

      if (target === 4) {
        // 4단계가 현재 진행 단계인 항목은 설계 검토 리포트 확인·보완 진행중 상태로 표시
        stageMap.arch = { status: "in_progress", at: tArch };
      } else {
        const tShareArch = stepAt(9);
        pendingMails.push({
          localIdx: nextMailLocalIdx++,
          itemIdx: p.itemIdx,
          direction: "out",
          kind: "share",
          status: "sent",
          matchMethod: null,
          messageId: makeMsgId(tShareArch, (msgSeq += 1), "mail.gmail.com"),
          inReplyTo: null,
          refs: "",
          fromAddr: DEMO_SYSTEM_EMAIL,
          toAddrs: vendorAndStakeholders,
          subject: shareSubject("arch", p.blueprint.title),
          bodyText: `"${p.blueprint.title}"(${p.code}) Architecture 검토 리포트를 공유드립니다. 부분 반영 항목(NFR-02) 확인 부탁드립니다.`,
          mailDate: tShareArch,
          attachments: [
            {
              localAttIdx: nextAttLocalIdx++,
              filename: archReportFilename,
              contentType: "text/markdown; charset=utf-8",
              content: archBuilt.reportMd,
            },
          ],
        });
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "share",
          message: `Architecture 검토 리포트 v1 + Architecture v1 공유: 5명`,
          createdAt: tShareArch,
        });
        stageMap.arch = { status: "done", at: tShareArch };
      }
    }

    // Stage 5: 개발사 QA 시험항목서 수신·등록 및 커버리지 리포트 생성
    if (target >= 5 && latestPrdLocalIdx !== null) {
      const tQa = stepAt(10);
      const qaBuilt = buildQaArtifacts(ctx, latestPrdContent, latestPrdVer, tQa);
      const qaMailIdx = nextMailLocalIdx++;
      const qaAttIdx = nextAttLocalIdx++;

      pendingMails.push({
        localIdx: qaMailIdx,
        itemIdx: p.itemIdx,
        direction: "in",
        kind: "doc_forward",
        status: "matched",
        matchMethod: "tag",
        messageId: makeMsgId(tQa, (msgSeq += 1), "kt-innet.co.kr"),
        inReplyTo: null,
        refs: "",
        fromAddr: `${people.vendorDev.name} <${people.vendorDev.email}>`,
        toAddrs: DEMO_SYSTEM_EMAIL,
        subject: qaBuilt.mailSubject,
        bodyText: qaBuilt.mailBody,
        mailDate: tQa,
        attachments: [
          {
            localAttIdx: qaAttIdx,
            filename: qaBuilt.rawAttachName,
            contentType: "text/markdown",
            content: qaBuilt.qaMd,
          },
        ],
      });

      const qaDocIdx = nextDocLocalIdx++;
      pendingBaseDocs.push({
        localDocIdx: qaDocIdx,
        itemIdx: p.itemIdx,
        kind: "qa",
        version: 1,
        filename: qaBuilt.registeredName,
        content: qaBuilt.qaMd,
        source: "mail",
        note: `${qaBuilt.rawAttachName} · 자동 등록 (키워드)`,
        mailLocalIdx: qaMailIdx,
        attLocalIdx: qaAttIdx,
        createdAt: tQa,
      });

      const qaReportFilename = docFileName(
        { service: p.svc.name, label: effectiveLabel.name, item: p.blueprint.title },
        "QA_검토리포트",
      );
      pendingReportDocs.push({
        itemIdx: p.itemIdx,
        kind: "qa_report",
        version: 1,
        filename: qaReportFilename,
        content: qaBuilt.reportMd,
        note: `QA(시험항목서) v1 · PRD v${latestPrdVer} 기준`,
        baseDocLocalIdx: qaDocIdx,
        prdDocLocalIdx: latestPrdLocalIdx,
        createdAt: tQa,
      });

      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "document",
        message: `QA(시험항목서) 문서 v1 등록 (${qaBuilt.rawAttachName} · 자동 등록)`,
        createdAt: tQa,
      });
      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "report",
        message: `QA(시험항목서) 검토 리포트 v1 생성 (${DEMO_MODEL}): 반영 4, 부분 0, 미반영 1, 확인 불가 0`,
        createdAt: tQa,
      });

      if (target === 5) {
        stageMap.qa = { status: "in_progress", at: tQa };
      } else {
        const tShareQa = stepAt(11);
        pendingMails.push({
          localIdx: nextMailLocalIdx++,
          itemIdx: p.itemIdx,
          direction: "out",
          kind: "share",
          status: "sent",
          matchMethod: null,
          messageId: makeMsgId(tShareQa, (msgSeq += 1), "mail.gmail.com"),
          inReplyTo: null,
          refs: "",
          fromAddr: DEMO_SYSTEM_EMAIL,
          toAddrs: vendorAndStakeholders,
          subject: shareSubject("qa", p.blueprint.title),
          bodyText: `"${p.blueprint.title}"(${p.code}) 시험항목서 검토 결과를 공유드립니다. 비기능 누락 케이스 보완 후 검증베드 시험 진행 바랍니다.`,
          mailDate: tShareQa,
          attachments: [
            {
              localAttIdx: nextAttLocalIdx++,
              filename: qaReportFilename,
              contentType: "text/markdown; charset=utf-8",
              content: qaBuilt.reportMd,
            },
          ],
        });
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "share",
          message: `QA 검토 리포트 v1 + QA(시험항목서) v1 공유: 5명`,
          createdAt: tShareQa,
        });
        stageMap.qa = { status: "done", at: tShareQa };
      }
    }

    // Stage 6 & 7: 진행상황 요청·회신·마일스톤 추적 및 완료 처리
    if (target >= 6) {
      const tProgReq = stepAt(12);
      const tProgRep1 = stepAt(13);
      const tProgRep2 = stepAt(14);
      const progBundle = buildProgressArtifacts(ctx, target === 7 ? 7 : 6, variant, tProgReq, tProgRep1, tProgRep2);

      const progReqMsgId = makeMsgId(tProgReq, (msgSeq += 1), "mail.gmail.com");
      pendingMails.push({
        localIdx: nextMailLocalIdx++,
        itemIdx: p.itemIdx,
        direction: "out",
        kind: "progress_request",
        status: "sent",
        matchMethod: null,
        messageId: progReqMsgId,
        inReplyTo: null,
        refs: "",
        fromAddr: DEMO_SYSTEM_EMAIL,
        toAddrs: DEMO_COMPANY_EMAIL,
        subject: progBundle.reqSubject,
        bodyText: progBundle.reqBody,
        mailDate: tProgReq,
        attachments: [],
      });
      pendingEvents.push({
        itemIdx: p.itemIdx,
        kind: "mail",
        message: `진행상황 요청 메일 발송: ${progBundle.reqSubject}`,
        createdAt: tProgReq,
      });

      let latestMilestones = progBundle.replies[0].milestones;
      let lastProgAt = tProgRep1;

      for (const rep of progBundle.replies) {
        const repMailIdx = nextMailLocalIdx++;
        pendingMails.push({
          localIdx: repMailIdx,
          itemIdx: p.itemIdx,
          direction: "in",
          kind: "progress_reply",
          status: "matched",
          matchMethod: "tag",
          messageId: makeMsgId(rep.at, (msgSeq += 1), "kt-innet.co.kr"),
          inReplyTo: progReqMsgId,
          refs: progReqMsgId,
          fromAddr: `${people.pm.name} <${DEMO_COMPANY_EMAIL}>`,
          toAddrs: DEMO_SYSTEM_EMAIL,
          subject: rep.subject,
          bodyText: rep.bodyText,
          mailDate: rep.at,
          attachments: [],
        });
        pendingProgress.push({
          itemIdx: p.itemIdx,
          mailLocalIdx: repMailIdx,
          sourceText: rep.extractedText,
          milestones: JSON.stringify(rep.milestones),
          createdAt: rep.at,
        });
        const launch = rep.milestones.find((m) => m.name === "상용적용");
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "progress",
          message: `진행상황 해석 (규칙): 상용적용 ${launch?.status ?? "미정"} ${launch?.end || "미정"}`,
          createdAt: rep.at,
        });
        latestMilestones = rep.milestones;
        lastProgAt = rep.at;
      }

      if (target === 6) {
        // 6단계가 현재 단계인 항목은 상용 반영 완료 전까지 지속 추적 진행중 상태 유지
        stageMap.progress = { status: "in_progress", at: lastProgAt };
      } else {
        stageMap.progress = { status: "done", at: lastProgAt };
        const tDone = stepAt(15);
        pendingMails.push({
          localIdx: nextMailLocalIdx++,
          itemIdx: p.itemIdx,
          direction: "out",
          kind: "share",
          status: "sent",
          matchMethod: null,
          messageId: makeMsgId(tDone, (msgSeq += 1), "mail.gmail.com"),
          inReplyTo: null,
          refs: "",
          fromAddr: DEMO_SYSTEM_EMAIL,
          toAddrs: stakeholderTo,
          subject: progressShareSubject(p.blueprint.title),
          bodyText: progressShareText(p.blueprint.title, p.code, latestMilestones, lastProgAt.toISOString()),
          mailDate: tDone,
          attachments: [],
        });
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "share",
          message: `진행상황 공유: 4명 (${stakeholderTo})`,
          createdAt: tDone,
        });
        pendingEvents.push({
          itemIdx: p.itemIdx,
          kind: "stage",
          message: `[완료] 대기 → 완료 (${effectiveLabel.name} 상용 반영 확인)`,
          createdAt: tDone,
        });
        stageMap.done = { status: "done", at: tDone };
        completedAtByIdx.set(p.itemIdx, tDone);
      }
    }

    const stageKeyByTarget: StageKey = STAGE_KEYS[target - 1];
    stageCounts[stageKeyByTarget] += 1;

    for (const sk of STAGE_KEYS) {
      pendingStages.push({
        itemId: itemNodeId,
        stage: sk,
        status: stageMap[sk].status,
        updatedAt: stageMap[sk].at,
      });
    }
  }

  // 5. dev_items 및 stages 일괄 INSERT
  await execChunked(
    (chunk) => db.insert(devItems).values(chunk),
    plannedItems.map((p) => ({
      nodeId: itemNodeIds[p.itemIdx],
      code: p.code,
      keywords: p.blueprint.keywords,
      searchPeriod: p.blueprint.searchPeriod,
      memo: p.blueprint.memo,
      completedAt: completedAtByIdx.get(p.itemIdx) ?? null,
    })),
  );

  await execChunked((chunk) => db.insert(stages).values(chunk), pendingStages);

  // 6. mails 시간순 정렬 후 일괄 INSERT → localIdx 매핑
  const orderedMails = [...pendingMails].sort((a, b) => a.mailDate.getTime() - b.mailDate.getTime());
  const insertedMailIds = await insertChunked(
    (chunk) => db.insert(mails).values(chunk).returning({ id: mails.id }),
    orderedMails.map((m) => ({
      itemId: itemNodeIds[m.itemIdx],
      direction: m.direction,
      kind: m.kind,
      status: m.status,
      matchMethod: m.matchMethod,
      messageId: m.messageId,
      inReplyTo: m.inReplyTo,
      refs: m.refs,
      fromAddr: m.fromAddr,
      toAddrs: m.toAddrs,
      subject: m.subject,
      bodyText: m.bodyText,
      simulated: false,
      suggestion: null,
      mailDate: m.mailDate,
      createdAt: m.mailDate,
    })),
  );

  const mailDbIdByLocal = new Map<number, number>();
  orderedMails.forEach((m, idx) => mailDbIdByLocal.set(m.localIdx, insertedMailIds[idx]));

  // 7. mail_attachments 일괄 INSERT → localAttIdx 매핑
  const flatAtts = orderedMails.flatMap((m) =>
    m.attachments.map((a) => ({
      ...a,
      mailDbId: mailDbIdByLocal.get(m.localIdx)!,
    })),
  );
  const insertedAttIds = await insertChunked(
    (chunk) => db.insert(mailAttachments).values(chunk).returning({ id: mailAttachments.id }),
    flatAtts.map((a) => ({
      mailId: a.mailDbId,
      filename: a.filename,
      contentType: a.contentType,
      size: Buffer.byteLength(a.content, "utf8"),
      content: a.content,
    })),
  );
  const attDbIdByLocal = new Map<number, number>();
  flatAtts.forEach((a, idx) => attDbIdByLocal.set(a.localAttIdx, insertedAttIds[idx]));

  // 8. reviews 일괄 INSERT
  if (pendingReviews.length > 0) {
    await execChunked(
      (chunk) => db.insert(reviews).values(chunk),
      pendingReviews.map((r) => ({
        itemId: itemNodeIds[r.itemIdx],
        mailId: mailDbIdByLocal.get(r.mailLocalIdx)!,
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
  }

  // 9. 기본 문서(prd, arch, qa) 일괄 INSERT → localDocIdx 매핑 후 검토 리포트(arch_report, qa_report) INSERT
  const insertedBaseDocIds = await insertChunked(
    (chunk) => db.insert(documents).values(chunk).returning({ id: documents.id }),
    pendingBaseDocs.map((d) => ({
      itemId: itemNodeIds[d.itemIdx],
      kind: d.kind as DocKind,
      version: d.version,
      filename: d.filename,
      content: d.content,
      source: d.source,
      note: d.note,
      sourceMailId: d.mailLocalIdx !== null ? (mailDbIdByLocal.get(d.mailLocalIdx) ?? null) : null,
      attachmentId: d.attLocalIdx !== null ? (attDbIdByLocal.get(d.attLocalIdx) ?? null) : null,
      baseDocId: null,
      prdDocId: null,
      createdAt: d.createdAt,
    })),
  );

  const docDbIdByLocal = new Map<number, number>();
  pendingBaseDocs.forEach((d, idx) => docDbIdByLocal.set(d.localDocIdx, insertedBaseDocIds[idx]));

  if (pendingReportDocs.length > 0) {
    await execChunked(
      (chunk) => db.insert(documents).values(chunk),
      pendingReportDocs.map((d) => ({
        itemId: itemNodeIds[d.itemIdx],
        kind: d.kind as DocKind,
        version: d.version,
        filename: d.filename,
        content: d.content,
        source: "llm" as const,
        note: d.note,
        sourceMailId: null,
        attachmentId: null,
        baseDocId: docDbIdByLocal.get(d.baseDocLocalIdx) ?? null,
        prdDocId: docDbIdByLocal.get(d.prdDocLocalIdx) ?? null,
        createdAt: d.createdAt,
      })),
    );
  }

  // 10. progress_reports 시간순 정렬 후 일괄 INSERT
  if (pendingProgress.length > 0) {
    const orderedProg = [...pendingProgress].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    await execChunked(
      (chunk) => db.insert(progressReports).values(chunk),
      orderedProg.map((pr) => ({
        itemId: itemNodeIds[pr.itemIdx],
        mailId: mailDbIdByLocal.get(pr.mailLocalIdx)!,
        status: "ok" as const,
        provider: "rule",
        model: "",
        sourceText: pr.sourceText,
        milestones: pr.milestones,
        error: null,
        createdAt: pr.createdAt,
      })),
    );
  }

  // 11. events 시간순 정렬 후 일괄 INSERT
  const orderedEvents = [...pendingEvents].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  await execChunked(
    (chunk) => db.insert(events).values(chunk),
    orderedEvents.map((ev) => ({
      itemId: itemNodeIds[ev.itemIdx],
      kind: ev.kind,
      message: ev.message,
      createdAt: ev.createdAt,
    })),
  );

  return {
    services: svcRows.length,
    labels: labelRows.length,
    items: plannedItems.length,
    stageCounts,
    mails: orderedMails.length,
    documents: pendingBaseDocs.length + pendingReportDocs.length,
    elapsedMs: Date.now() - t0,
  };
}
