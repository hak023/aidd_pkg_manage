/**
 * 개발사항 설계 원본(ItemBlueprint)으로부터 단계별 메일·점검·문서·마일스톤 산출물을 생성한다.
 * 시뮬레이터·모의·샘플 표기 없이 실무 산출물 형식을 그대로 따른다.
 */
import { docFileName, mailTag, sanitizeFilePart } from "@/lib/domain/naming";
import { parseRequirements, renderDocReview, type DocReviewResult } from "@/lib/llm/docreview";
import { kstDate } from "@/lib/llm/prd";
import { extractProgressBlock, parseProgressTable, type Milestone } from "@/lib/llm/progress";
import type { ReviewResult } from "@/lib/llm/review";
import {
  COLLECT_SECTIONS,
  composeCollectRequest,
  composeProgressRequest,
  PROGRESS_END_MARKER,
  progressStartMarker,
  REPLY_END_MARKER,
  replyStartMarker,
} from "@/lib/mail/compose";
import type { ItemBlueprint, LabelSpec, ServiceCatalog } from "./types";

export const DEMO_MODEL = "gemini-2.5-flash";
export const DEMO_SYSTEM_EMAIL = "inservice.aidd@gmail.com";
export const DEMO_COMPANY_EMAIL = "ba.inplatform@kt-innet.co.kr";

export function shiftDays(isoDate: string, deltaDays: number, hourKst = 10, minKst = 20): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hourKst - 9, minKst, 0);
  return new Date(utcMs + deltaDays * 86_400_000);
}

export function fmtYmd(d: Date): string {
  return kstDate(d);
}

export function makeMsgId(d: Date, seq: number, domain: string): string {
  const stamp = new Date(d.getTime() + 9 * 3600_000)
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `<${stamp}.${String(seq).padStart(5, "0")}@${domain}>`;
}

export interface BuildContext {
  code: string;
  service: ServiceCatalog;
  label: LabelSpec;
  item: ItemBlueprint;
}

export function buildCollectMails(ctx: BuildContext, reqAt: Date, replyAt: Date, seqBase: number) {
  const { code, service, label, item } = ctx;
  const p = service.people;
  const d1 = fmtYmd(shiftDays(label.kickoffDate, -18));
  const d2 = fmtYmd(shiftDays(label.kickoffDate, -11));
  const d3 = fmtYmd(shiftDays(label.kickoffDate, -5));
  const d4 = fmtYmd(shiftDays(label.kickoffDate, -1));

  const req = composeCollectRequest({
    code,
    service: service.name,
    label: label.name,
    item: item.title,
    keywords: item.keywords,
    searchPeriod: item.searchPeriod,
    memo: item.memo,
  });
  const reqMsgId = makeMsgId(reqAt, seqBase, "mail.gmail.com");

  const src1 = `[Outlook ${d1} ${p.requester.name} "${service.name} ${item.title} 검토 요청"]`;
  const src2 = `[Teams ${d2} 회의록 "${service.name} 기술검토 회의"]`;
  const src3 = `[Teams ${d3} ${p.ops.name} "${service.name} 운용협의 채널"]`;
  const src4 = `[Outlook ${d4} ${p.pm.name} "${label.name} 반영 범위 확정"]`;

  const innerBlock = [
    "## 01. 관련자",
    "| 이름 | 부서 | 역할 | 이메일 |",
    "|---|---|---|---|",
    `| ${p.requester.name} | ${p.requester.dept} | 요청 | ${p.requester.email} |`,
    `| ${p.pm.name} | ${p.pm.dept} | 결정 | ${p.pm.email} |`,
    `| ${p.vendorDev.name} | ${p.vendorDev.dept} | 개발 | ${p.vendorDev.email} |`,
    `| ${p.ops.name} | ${p.ops.dept} | 운영 | ${p.ops.email} |`,
    `| ${p.qa.name} | ${p.qa.dept} | 검증 | ${p.qa.email} |`,
    "",
    "## 02. 요청 배경",
    `${item.background} ${src1}`,
    "",
    "## 03. 히스토리 (의사결정 과정)",
    "| 일자 | 채널 | 참여자 | 논의 내용 | 결정 사항 | 출처 |",
    "|---|---|---|---|---|---|",
    `| ${d1} | 메일 | ${p.requester.name}, ${p.pm.name} | 현업 VoC 및 개선 필요성 공유 | 기술 타당성 검토 착수 | ${src1} |`,
    `| ${d2} | 회의 | ${p.pm.name}, ${p.vendorDev.name}, ${p.ops.name} | 연동 구조 및 처리 흐름 검토 | ${item.inScope.split(",")[0]} 방향 채택 | ${src2} |`,
    `| ${d3} | Teams | ${p.pm.name}, ${p.ops.name}, ${p.vendorDev.name} | 세부 운영 정책 논의 | [상충] ${item.conflictIssue} | ${src3} |`,
    `| ${d4} | 메일 | ${p.pm.name} | 목표 릴리스 패키지 확정 | ${label.name} 상용 반영 대상 포함 | ${src4} |`,
    "",
    "## 04. 기존 문제점·현행 방식",
    `${item.currentIssue} ${src1}`,
    "",
    "## 05. 목표·기대효과",
    `${item.goal} ${src2}`,
    "",
    "## 06. 요구사항 (기능 / 비기능)",
    `- 기능 1: ${item.funcReqs[0].title} (${item.funcReqs[0].criteria}) ${src2}`,
    `- 기능 2: ${item.funcReqs[1].title} (${item.funcReqs[1].criteria}) ${src2}`,
    `- 기능 3: ${item.funcReqs[2].title} — 세부 예외 기준 추가 확인 필요 ${src3}`,
    `- 비기능: ${item.nonFuncReqs[0].title} (${item.nonFuncReqs[0].criteria}), ${item.nonFuncReqs[1].title} (${item.nonFuncReqs[1].criteria}) ${src3}`,
    "",
    "## 07. 범위·비범위",
    `- 포함 범위: ${item.inScope} ${src4}`,
    `- 제외 범위: ${item.outOfScope} ${src2}`,
    "",
    "## 08. 연동 시스템·부서",
    `${item.linkedSystem} (연동 규격서 현행화 확인 중) ${src2}`,
    "",
    "## 09. 제약·보안·운영 고려",
    `${item.securityOps} ${src3}`,
    "",
    "## 10. 일정",
    `${label.name} 패키지 반영 목표 (상용 예정일 ${label.releaseDate}). 검증베드 세부 일정 협의 중. ${src4}`,
    "",
    "## 11. 미결·쟁점",
    `- [상충] ${item.conflictIssue}`,
    `- ${item.extraFollowUpQuestion}`,
    "",
    "## 12. 참고 자료·출처 (검색하지 못한 범위 포함)",
    `- Outlook 메일 2건 (${d1}, ${d4}), Teams 회의록·채널 2건 (${d2}, ${d3})`,
    `- Confluence "${service.name} 연동 규격서" 최신본 열람 완료`,
  ].join("\n");

  const replyText = [
    "안녕하세요. 사내 메일 및 Teams 논의 이력을 정리하여 회신합니다.",
    "",
    replyStartMarker(code),
    innerBlock,
    REPLY_END_MARKER,
  ].join("\n");

  const replySubject = `RE: ${req.subject}`;
  const replyMsgId = makeMsgId(replyAt, seqBase + 1, "kt-innet.co.kr");

  const reviewResult: ReviewResult = {
    sections: [
      { no: "01", title: COLLECT_SECTIONS[0].title, status: "충분", summary: `요청(${p.requester.name})·결정(${p.pm.name})·개발(${p.vendorDev.name})·운영(${p.ops.name})·검증(${p.qa.name}) 5명 역할 및 연락처 확인됨.`, sources: [] },
      { no: "02", title: COLLECT_SECTIONS[1].title, status: "충분", summary: `${item.background} ${src1}`, sources: [src1] },
      { no: "03", title: COLLECT_SECTIONS[2].title, status: "충분", summary: `${d1} 검토 착수 후 ${d4} ${label.name} 반영 확정. 운영 기준 관련 [상충] 1건 존재.`, sources: [src1, src2, src3, src4] },
      { no: "04", title: COLLECT_SECTIONS[3].title, status: "충분", summary: `${item.currentIssue} ${src1}`, sources: [src1] },
      { no: "05", title: COLLECT_SECTIONS[4].title, status: "충분", summary: `${item.goal} ${src2}`, sources: [src2] },
      { no: "06", title: COLLECT_SECTIONS[5].title, status: "부족", summary: `핵심 기능 3건 및 비기능 2건 도출되었으나 '${item.funcReqs[2].title}'의 세부 임계 조건 확정 필요. ${src2} ${src3}`, sources: [src2, src3] },
      { no: "07", title: COLLECT_SECTIONS[6].title, status: "충분", summary: `포함(${item.inScope}) 및 제외(${item.outOfScope}) 경계 명확함. ${src4}`, sources: [src2, src4] },
      { no: "08", title: COLLECT_SECTIONS[7].title, status: "부족", summary: `${item.linkedSystem} 대상 식별됨. 인터페이스 변경 유무 최종 확인 필요. ${src2}`, sources: [src2] },
      { no: "09", title: COLLECT_SECTIONS[8].title, status: "충분", summary: `${item.securityOps} ${src3}`, sources: [src3] },
      { no: "10", title: COLLECT_SECTIONS[9].title, status: "부족", summary: `${label.name}(${label.releaseDate}) 목표 확인됨. 개발검증·운용검증 세부 일자 보완 필요. ${src4}`, sources: [src4] },
      { no: "11", title: COLLECT_SECTIONS[10].title, status: "부족", summary: `[상충] ${item.conflictIssue} / 추가 확인: ${item.extraFollowUpQuestion}`, sources: [src3] },
      { no: "12", title: COLLECT_SECTIONS[11].title, status: "충분", summary: `Outlook 2건, Teams 2건, Confluence 규격서 확인 완료.`, sources: [src1, src2, src3, src4] },
    ],
    stakeholders: [p.requester, p.pm, p.vendorDev, p.ops, p.qa],
    conflicts: [`[상충] ${item.conflictIssue}`],
    unsourced: [],
    questions: [
      { section: "11", question: `[상충] ${item.conflictIssue}에 대한 최종 합의 기준은 무엇입니까?` },
      { section: "06", question: item.extraFollowUpQuestion },
      { section: "10", question: `${label.name} 상용 반영(${label.releaseDate}) 전 개발검증시험 및 운용검증시험 목표 일정은 어떻게 계획합니까?` },
    ],
  };

  return {
    reqMail: {
      subject: req.subject,
      bodyText: req.text,
      messageId: reqMsgId,
    },
    replyMail: {
      subject: replySubject,
      bodyText: replyText,
      innerText: innerBlock,
      messageId: replyMsgId,
      inReplyTo: reqMsgId,
    },
    reviewResult,
    citations: { d1, d2, d3, d4, src1, src2, src3, src4 },
  };
}

export function buildPrdMarkdown(
  ctx: BuildContext,
  replySubject: string,
  replyAt: Date,
  prdAt: Date,
  version: number,
   citations: { d1: string; d2: string; d3: string; d4: string; src1: string; src2: string; src3: string; src4: string },
): string {
  const { code, service, label, item } = ctx;
  const p = service.people;
  const wroteDate = fmtYmd(prdAt);
  const devTestStart = fmtYmd(shiftDays(label.releaseDate, -24));
  const opsTestStart = fmtYmd(shiftDays(label.releaseDate, -12));

  return [
    `# ${item.title} PRD`,
    "",
    `- 단위서비스: ${service.name} / 라벨링: ${label.name} / 개발사항 ID: ${code}`,
    `- 버전: v${version} / 작성일: ${wroteDate} / 작성: AX_AIDD 시스템 초안 (${p.pm.name} 검토 반영)`,
    `- 상태: ${version > 1 ? "검토 확정" : "초안"} · 근거: 수집 회신 "${replySubject}" (${fmtYmd(replyAt)}), 담당자 추가 입력 ${wroteDate}`,
    "",
    "## 1. 배경",
    `${item.background} ${citations.src1}`,
    "",
    "## 2. 히스토리 (의사결정 과정)",
    "| 일자 | 채널 | 참여자 | 논의 내용 | 결정 사항 | 출처 |",
    "|---|---|---|---|---|---|",
    `| ${citations.d1} | 메일 | ${p.requester.name}, ${p.pm.name} | VoC 및 요구배경 접수 | 기능 개선 검토 착수 | ${citations.src1} |`,
    `| ${citations.d2} | 회의 | ${p.pm.name}, ${p.vendorDev.name}, ${p.ops.name} | 아키텍처 및 연동 범위 논의 | ${item.inScope.split(",")[0]} 구조 채택 | ${citations.src2} |`,
    `| ${citations.d3} | Teams | ${p.pm.name}, ${p.ops.name}, ${p.vendorDev.name} | ${item.conflictIssue} 검토 | ${item.conflictResolution} | [담당자 보완 ${wroteDate}] |`,
    `| ${citations.d4} | 메일 | ${p.pm.name} | 패키지 일정 확정 | ${label.name}(${label.releaseDate}) 반영 확정 | ${citations.src4} |`,
    "",
    "## 3. 기존 문제점 (현행 방식)",
    `${item.currentIssue} ${citations.src1}`,
    "",
    "## 4. 목표 및 기대효과",
    `${item.goal} ${citations.src2}`,
    "",
    "## 5. 범위",
    "### 5.1 포함",
    `- ${item.inScope} ${citations.src4}`,
    "### 5.2 제외",
    `- ${item.outOfScope} ${citations.src2}`,
    "",
    "## 6. 이해관계자 (관련자·역할)",
    "| 이름 | 부서 | 역할 | 이메일 |",
    "|---|---|---|---|",
    `| ${p.requester.name} | ${p.requester.dept} | 요청 | ${p.requester.email} |`,
    `| ${p.pm.name} | ${p.pm.dept} | 결정 | ${p.pm.email} |`,
    `| ${p.vendorDev.name} | ${p.vendorDev.dept} | 개발 | ${p.vendorDev.email} |`,
    `| ${p.ops.name} | ${p.ops.dept} | 운영 | ${p.ops.email} |`,
    `| ${p.qa.name} | ${p.qa.dept} | 검증 | ${p.qa.email} |`,
    "",
    "## 7. 요구사항",
    "### 7.1 기능 요구사항",
    "| ID | 요구사항 | 우선순위 | 수용 기준 | 출처 |",
    "|---|---|---|---|---|",
    ...item.funcReqs.map((r) => `| ${r.id} | ${r.title} | ${r.priority} | ${r.criteria} | ${citations.src2} |`),
    "",
    "### 7.2 비기능 요구사항",
    "| ID | 요구사항 | 우선순위 | 수용 기준 | 출처 |",
    "|---|---|---|---|---|",
    `| ${item.nonFuncReqs[0].id} | ${item.nonFuncReqs[0].title} | 상 | ${item.nonFuncReqs[0].criteria} | ${citations.src3} |`,
    `| ${item.nonFuncReqs[1].id} | ${item.nonFuncReqs[1].title} | 중 | ${item.nonFuncReqs[1].criteria} | ${citations.src3} |`,
    "",
    "## 8. 연동 시스템·인터페이스",
    `- 연동 대상: ${item.linkedSystem} ${citations.src2}`,
    `- 운영 연계 기준: ${item.extraFollowUpAnswer} [담당자 보완 ${wroteDate}]`,
    "",
    "## 9. 제약·보안·운영 고려사항",
    `- ${item.securityOps} ${citations.src3}`,
    `- 합의 기준: ${item.conflictResolution} [담당자 보완 ${wroteDate}]`,
    "",
    "## 10. 일정 (마일스톤)",
    `- 목표 패키지: ${label.name}`,
    `- 개발 착수: ${label.kickoffDate} / 개발검증시험: ${devTestStart}~ / 운용검증시험: ${opsTestStart}~ / 상용적용 목표: ${label.releaseDate} [담당자 보완 ${wroteDate}]`,
    "",
    "## 11. 미결 사항·확인 필요",
    `- ${service.vendorName} 상세 설계서 접수 시 '${item.nonFuncReqs[1].title}' 세부 파라미터 수치 교차 확인 필요`,
    "",
    "## 12. 참고 자료·출처",
    `- ${citations.src1}`,
    `- ${citations.src2}`,
    `- ${citations.src3}`,
    `- ${citations.src4}`,
    "",
    "## 변경 이력",
    "",
    "| 버전 | 일자 | 내용 |",
    "|---|---|---|",
    `| v1 | ${wroteDate} | 수집 회신 및 담당자 보완사항 기반 PRD 초안 작성 |`,
    ...(version > 1 ? [`| v${version} | ${wroteDate} | 수용 기준 수치 및 예외 처리 문구 검토 확정 |`] : []),
    "",
  ].join("\n");
}

export function buildArchArtifacts(ctx: BuildContext, prdContent: string, prdVersion: number, archAt: Date) {
  const { code, service, label, item } = ctx;
  const vendor = service.vendorName;
  const rawAttachName = `${sanitizeFilePart(service.name)}_${sanitizeFilePart(item.title)}_Architecture_설계서.md`;
  const registeredName = docFileName({ service: service.name, label: label.name, item: item.title }, "Architecture");

  const archMd = [
    `# ${item.title} Architecture 설계서`,
    "",
    `- 작성사: ${vendor} (${service.people.vendorDev.dept} ${service.people.vendorDev.name})`,
    `- 대상 패키지: ${service.name} / ${label.name} (${code})`,
    `- 작성일: ${fmtYmd(archAt)}`,
    "",
    "## 1. 설계 개요",
    item.archOverview,
    "",
    "## 2. 시스템 구성 및 대상 모듈",
    ...item.archModules.map((m, idx) => `- **모듈 ${idx + 1}**: ${m}`),
    `- **연동 구간**: ${item.linkedSystem}`,
    "",
    "## 3. 상세 처리 흐름 및 기능 설계",
    `### ${item.funcReqs[0].archSection}`,
    `- ${item.funcReqs[0].title}: ${item.archFlow[0]} → ${item.archFlow[1]}`,
    "",
    `### ${item.funcReqs[1].archSection}`,
    `- ${item.funcReqs[1].title}: ${item.archFlow[2]}`,
    "",
    `### ${item.funcReqs[2].archSection}`,
    `- ${item.funcReqs[2].title}: ${item.archFlow[3]}`,
    `- 보안·운영 보호장치: ${item.securityOps}`,
    "",
    "## 4. 비기능 및 운영 자원 설계",
    `- **성능 목표 (${item.nonFuncReqs[0].id})**: ${item.nonFuncReqs[0].archSpec}`,
    `- **보관·운용 정책 (${item.nonFuncReqs[1].id})**: ${item.nonFuncReqs[1].archSpec}`,
    "",
    "## 5. 운영 편의 부가 반영 사항",
    `- ${item.archExtraFeature}`,
    "",
  ].join("\n");

  const reqs = parseRequirements(prdContent);
  const reviewData: DocReviewResult = {
    rows: [
      {
        id: "FR-01",
        verdict: "반영",
        location: item.funcReqs[0].archSection,
        note: `${item.funcReqs[0].title} 처리 절차와 수용 기준이 모듈 흐름에 구체적으로 설계됨.`,
      },
      {
        id: "FR-02",
        verdict: "반영",
        location: item.funcReqs[1].archSection,
        note: `${item.funcReqs[1].title} 분기 로직 및 정합성 처리 방식이 명시됨.`,
      },
      {
        id: "FR-03",
        verdict: "반영",
        location: item.funcReqs[2].archSection,
        note: `${item.funcReqs[2].title} 예외 폴백 및 운영 보호장치가 포함됨.`,
      },
      {
        id: "NFR-01",
        verdict: "반영",
        location: "4. 비기능 및 운영 자원 설계",
        note: item.nonFuncReqs[0].archNote,
      },
      {
        id: "NFR-02",
        verdict: item.nonFuncReqs[1].archVerdict,
        location: "4. 비기능 및 운영 자원 설계",
        note: item.nonFuncReqs[1].archNote,
      },
    ],
    extras: [`5장 운영 편의 부가 사항: ${item.archExtraFeature} (PRD 범위 외 추가 제안 항목으로 일정 영향도 확인 필요)`],
    questions: [
      `NFR-02(${item.nonFuncReqs[1].title}) 관련하여 ${item.nonFuncReqs[1].archNote}`,
      `5장에 추가된 '${item.archExtraFeature}' 항목이 ${label.name} 개발 일정 및 FP 산정에 영향을 주는지 확인 부탁드립니다.`,
    ],
    gaps: [],
  };

  const reportMd = renderDocReview({
    kind: "arch",
    itemName: item.title,
    doc: { filename: registeredName, version: 1, createdAt: archAt.toISOString() },
    prdVersion,
    model: DEMO_MODEL,
    reqs,
    result: reviewData,
    now: archAt,
  });

  return {
    mailSubject: `${mailTag(code)} FW: [${vendor}] ${item.title} 아키텍처 설계서 송부`,
    mailBody: `안녕하세요. ${vendor} ${service.people.vendorDev.name} 책임으로부터 수신한 ${item.title} Architecture 설계서를 전달합니다.`,
    rawAttachName,
    registeredName,
    archMd,
    reportMd,
    verdictCounts: { ok: 4, partial: 1, missing: 0, unknown: 0 },
  };
}

export function buildQaArtifacts(ctx: BuildContext, prdContent: string, prdVersion: number, qaAt: Date) {
  const { code, service, label, item } = ctx;
  const vendor = service.vendorName;
  const rawAttachName = `${sanitizeFilePart(service.name)}_${sanitizeFilePart(item.title)}_QA_시험항목서.md`;
  const registeredName = docFileName({ service: service.name, label: label.name, item: item.title }, "QA");

  const qaMd = [
    `# ${item.title} 시험항목서 (QA)`,
    "",
    `- 작성사: ${vendor} (${service.people.vendorDev.name}) / 검증협조: ${service.people.qa.dept} ${service.people.qa.name}`,
    `- 대상 패키지: ${service.name} / ${label.name} (${code})`,
    `- 시험 환경: 지능망·서비스 통합 검증베드(TB)`,
    "",
    "## 1. 시험 항목 목록",
    "",
    "| TC ID | 구분 | 관련 요구사항 | 시험 절차 | 기대 결과 |",
    "|---|---|---|---|---|",
    `| TC-01 | 기능(정상) | FR-01 | ${item.funcReqs[0].qaStep} | ${item.funcReqs[0].qaExpected} |`,
    `| TC-02 | 기능(분기) | FR-02 | ${item.funcReqs[1].qaStep} | ${item.funcReqs[1].qaExpected} |`,
    `| TC-03 | 예외·폴백 | FR-03 | ${item.funcReqs[2].qaStep} | ${item.funcReqs[2].qaExpected} |`,
    `| TC-04 | 경계값 | FR-01, FR-02 | 설정 허용 상한치 및 중복 요청 동시 인가 | 오류 응답 또는 중복 차단 후 서비스 정상 유지 |`,
    `| TC-05 | 성능 | NFR-01 | 목표 피크 부하 조건에서 응답 지연 측정 | ${item.nonFuncReqs[0].criteria} 만족 |`,
    `| TC-06 | 기존호환 | 회귀 | 기존 가입 회선(신규 옵션 미설정) 표준 시나리오 점검 | 기존 통화·서비스 흐름 100% 동일 동작 |`,
    "",
  ].join("\n");

  const reqs = parseRequirements(prdContent);
  const reviewData: DocReviewResult = {
    rows: [
      { id: "FR-01", verdict: "반영", location: "TC-01, TC-04", note: "정상 처리 및 경계값 시험 케이스가 구체적으로 포함됨." },
      { id: "FR-02", verdict: "반영", location: "TC-02, TC-04", note: "분기 제어 및 동시 경합 조건 검증 항목이 매핑됨." },
      { id: "FR-03", verdict: "반영", location: "TC-03", note: "예외 유발 시 자동 우회 및 이력 적재 확인 절차가 반영됨." },
      { id: "NFR-01", verdict: "반영", location: "TC-05", note: `목표 응답 기준(${item.nonFuncReqs[0].criteria}) 실측 항목이 포함됨.` },
      {
        id: "NFR-02",
        verdict: "미반영",
        location: "-",
        note: `PRD의 '${item.nonFuncReqs[1].title}(${item.nonFuncReqs[1].criteria})' 충족 여부를 검증하는 시험 항목이 시험항목서에 누락됨.`,
      },
    ],
    extras: [],
    questions: [
      `NFR-02(${item.nonFuncReqs[1].title}) 검증을 위한 시험 케이스(TC-07)를 개발검증시험 착수 전까지 보완해 주세요.`,
      "상용 패키지 작업 중 롤백 스위치 동작을 확인하는 절차를 운용검증시험 항목에 추가 검토 부탁드립니다.",
    ],
    gaps: [
      { category: "비기능", note: `NFR-02(${item.nonFuncReqs[1].title}) 항목의 실측·검증 TC 누락` },
      { category: "예외·실패", note: `연동 대상(${item.linkedSystem.split(",")[0]}) 응답 지연 후 자동 복구 시점 재진입 검증 보강 권장` },
    ],
  };

  const reportMd = renderDocReview({
    kind: "qa",
    itemName: item.title,
    doc: { filename: registeredName, version: 1, createdAt: qaAt.toISOString() },
    prdVersion,
    model: DEMO_MODEL,
    reqs,
    result: reviewData,
    now: qaAt,
  });

  return {
    mailSubject: `${mailTag(code)} FW: [${vendor}] ${item.title} 시험항목서 송부`,
    mailBody: `${vendor}에서 작성한 ${item.title} 개발검증용 시험항목서(QA)를 전달합니다.`,
    rawAttachName,
    registeredName,
    qaMd,
    reportMd,
    verdictCounts: { ok: 4, partial: 0, missing: 1, unknown: 0 },
  };
}

export interface ProgressBundle {
  reqSubject: string;
  reqBody: string;
  replies: {
    subject: string;
    bodyText: string;
    extractedText: string;
    milestones: Milestone[];
    at: Date;
  }[];
}

/**
 * 6단계(진행중) 또는 7단계(완료) 개발사항의 진행상황 요청·회신·마일스톤 데이터를 생성한다.
 */
export function buildProgressArtifacts(
  ctx: BuildContext,
  targetStage: 6 | 7,
  variant: number,
  reqAt: Date,
  firstReplyAt: Date,
  secondReplyAt?: Date,
): ProgressBundle {
  const { code, service, label, item } = ctx;
  const p = service.people;
  const req = composeProgressRequest({
    code,
    service: service.name,
    label: label.name,
    item: item.title,
    keywords: item.keywords,
    searchPeriod: item.searchPeriod,
    memo: item.memo,
  });
  const replySubject = `RE: ${req.subject}`;

  const devStart = label.kickoffDate;
  const devEnd = fmtYmd(shiftDays(label.releaseDate, -26));
  const qaStart = fmtYmd(shiftDays(label.releaseDate, -23));
  const qaEnd = fmtYmd(shiftDays(label.releaseDate, -15));
  const opsStart = fmtYmd(shiftDays(label.releaseDate, -12));
  const opsEnd = fmtYmd(shiftDays(label.releaseDate, -5));
  const relDate = label.releaseDate;

  const makeReply = (rows: string[], intro: string, at: Date) => {
    const bodyText = [
      intro,
      "",
      progressStartMarker(code),
      "| 마일스톤 | 상태 | 시작일 | 완료일 (실적 또는 예정) | 근거 출처 | 비고 |",
      "|---|---|---|---|---|---|",
      ...rows,
      PROGRESS_END_MARKER,
    ].join("\n");
    const { text: extractedText } = extractProgressBlock(bodyText);
    const milestones = parseProgressTable(extractedText)!;
    return { subject: replySubject, bodyText, extractedText, milestones, at };
  };

  if (targetStage === 7) {
    // 1차 회신(운용검증 진행중) → 2차 회신(상용적용 실적 완료) 이력으로 자연스러운 변경 기록 제공
    const r1 = makeReply(
      [
        `| 개발중 | 완료 | ${devStart} | ${devEnd} (실적) | [Teams ${devEnd} ${p.vendorDev.name} "개발 완료 보고"] | |`,
        `| 개발검증시험 | 완료 | ${qaStart} | ${qaEnd} (실적) | [Outlook ${qaEnd} ${p.qa.name} "검증베드 시험 결과"] | 결함 1건 조치 완료 |`,
        `| 운용검증시험 | 진행중 | ${opsStart} | ${opsEnd} (예정) | [Teams ${opsStart} ${p.ops.name} "운용검증 착수"] | |`,
        `| 상용적용 | 예정 | | ${relDate} (예정) | [Outlook ${opsStart} ${p.pm.name} "${label.name} 적용 계획"] | 야간 작업창 반영 |`,
      ],
      "현재 패키지 검증 진행 현황 정리해 회신합니다.",
      firstReplyAt,
    );
    const r2 = makeReply(
      [
        `| 개발중 | 완료 | ${devStart} | ${devEnd} (실적) | [Teams ${devEnd} ${p.vendorDev.name} "개발 완료 보고"] | |`,
        `| 개발검증시험 | 완료 | ${qaStart} | ${qaEnd} (실적) | [Outlook ${qaEnd} ${p.qa.name} "검증베드 시험 결과"] | |`,
        `| 운용검증시험 | 완료 | ${opsStart} | ${opsEnd} (실적) | [Outlook ${opsEnd} ${p.ops.name} "운용검증 완료 통보"] | 특이사항 없음 |`,
        `| 상용적용 | 완료 | ${relDate} | ${relDate} (실적) | [Outlook ${relDate} ${p.ops.name} "${label.name} 상용 적용 완료"] | 새벽 작업 정상 종료 |`,
      ],
      `${label.name} 상용 반영까지 최종 완료되어 최신 현황 회신합니다.`,
      secondReplyAt ?? shiftDays(relDate, 1, 9, 40),
    );
    return { reqSubject: req.subject, reqBody: req.text, replies: [r1, r2] };
  }

  // targetStage === 6: 진행 중인 다양한 실무 상태 (개발검증 진행중 / 운용검증 예정·미정 / 일정 조정 이력)
  if (variant % 3 === 0 && secondReplyAt) {
    const delayedRel = fmtYmd(shiftDays(relDate, 5));
    const delayedQaEnd = fmtYmd(shiftDays(qaEnd, 3));
    const r1 = makeReply(
      [
        `| 개발중 | 완료 | ${devStart} | ${devEnd} (실적) | [Teams ${devEnd} ${p.vendorDev.name} "개발 완료 공유"] | |`,
        `| 개발검증시험 | 예정 | ${qaStart} | ${qaEnd} (예정) | [Outlook ${devEnd} ${p.qa.name} "개발검증 일정"] | |`,
        `| 운용검증시험 | 미정 | | | | 운용센터 작업창 협의 중 |`,
        `| 상용적용 | 예정 | | ${relDate} (예정) | [Outlook ${devEnd} ${p.pm.name} "${label.name} 일정"] | ${label.name} |`,
      ],
      "진행상황 확인 결과 회신합니다.",
      firstReplyAt,
    );
    const r2 = makeReply(
      [
        `| 개발중 | 완료 | ${devStart} | ${devEnd} (실적) | [Teams ${devEnd} ${p.vendorDev.name} "개발 완료 공유"] | |`,
        `| 개발검증시험 | 진행중 | ${qaStart} | ${delayedQaEnd} (예정) | [Outlook ${qaStart} ${p.qa.name} "검증 착수 및 일정 조정"] | 연동 환경 점검으로 3일 순연 |`,
        `| 운용검증시험 | 예정 | ${opsStart} | ${opsEnd} (예정) | [Teams ${qaStart} ${p.ops.name} "운용검증 일정 확정"] | |`,
        `| 상용적용 | 예정 | | ${delayedRel} (예정) | [Outlook ${qaStart} ${p.pm.name} "${label.name} 반영일 조정"] | ${relDate} → ${delayedRel} 순연 |`,
      ],
      "연동 검증 일정 조정 사항을 반영하여 최신 진행상황 회신합니다.",
      secondReplyAt,
    );
    return { reqSubject: req.subject, reqBody: req.text, replies: [r1, r2] };
  }

  if (variant % 3 === 1) {
    const r1 = makeReply(
      [
        `| 개발중 | 완료 | ${devStart} | ${devEnd} (실적) | [Teams ${devEnd} ${p.vendorDev.name} "기능 구현 완료"] | |`,
        `| 개발검증시험 | 완료 | ${qaStart} | ${qaEnd} (실적) | [Outlook ${qaEnd} ${p.qa.name} "개발검증 결과 보고"] | 전 항목 적합 |`,
        `| 운용검증시험 | 진행중 | ${opsStart} | ${opsEnd} (예정) | [Teams ${opsStart} ${p.ops.name} "운용검증 진행"] | 야간 호환성 점검 중 |`,
        `| 상용적용 | 예정 | | ${relDate} (예정) | [Outlook ${opsStart} ${p.pm.name} "${label.name} 상용 계획"] | ${label.name} |`,
      ],
      "현재 운용검증시험 단계 진행 중이며 상세 일정 회신합니다.",
      firstReplyAt,
    );
    return { reqSubject: req.subject, reqBody: req.text, replies: [r1] };
  }

  const r1 = makeReply(
    [
      `| 개발중 | 진행중 | ${devStart} | ${devEnd} (예정) | [Teams ${fmtYmd(firstReplyAt)} ${p.vendorDev.name} "주간 공정 공유"] | 핵심 모듈 구현 85% |`,
      `| 개발검증시험 | 예정 | ${qaStart} | ${qaEnd} (예정) | [Outlook ${fmtYmd(firstReplyAt)} ${p.qa.name} "검증베드 배정"] | |`,
      `| 운용검증시험 | 미정 | | | | 개발검증 완료 후 확정 예정 |`,
      `| 상용적용 | 예정 | | ${relDate} (예정) | [Outlook ${devStart} ${p.pm.name} "${label.name} 목표 범위"] | ${label.name} |`,
    ],
    "개발 진행 및 검증 예정 일정 정리하여 회신합니다.",
    firstReplyAt,
  );
  return { reqSubject: req.subject, reqBody: req.text, replies: [r1] };
}
