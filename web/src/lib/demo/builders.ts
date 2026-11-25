/**
 * 시연 시나리오(DemoScenario)와 일정(DemoTimeline)으로 단계별 메일·점검·문서·마일스톤 산출물을 만든다.
 * 실제 화면이 만드는 것과 같은 양식(수집 요청, PRD 머리글, 검토 리포트, 진행상황 표)을 쓴다.
 */
import { docFileName, mailTag } from "@/lib/domain/naming";
import { parseRequirements, renderDocReview, type DocReviewResult, type Verdict } from "@/lib/llm/docreview";
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
import type { DemoTimeline, TimeKey } from "./timeline";
import type { DemoRequirement, DemoScenario, HistoryEntry, PersonProfile } from "./types";

export const DEMO_MODEL = "gemini-2.5-flash";
export const DEMO_SYSTEM_EMAIL = "inservice.aidd@gmail.com";

export interface BuildContext {
  code: string;
  sc: DemoScenario;
  tl: DemoTimeline;
}

export function makeMsgId(d: Date, seq: number, domain: string): string {
  const stamp = new Date(d.getTime() + 9 * 3600_000)
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  return `<${stamp}.${String(seq).padStart(5, "0")}@${domain}>`;
}

export function stakeholders(sc: DemoScenario): PersonProfile[] {
  return [sc.people.requester, sc.people.reviewer, sc.people.ops];
}

/** 메일 머리글의 보낸 사람 표기 */
export function mailbox(p: PersonProfile): string {
  return `${p.name} <${p.email}>`;
}

function historySource({ tl }: BuildContext, h: HistoryEntry): string {
  return `[${h.sourceChannel} ${tl.ymd(h.key)} ${h.author} "${h.title}"]`;
}

function sourceOf(ctx: BuildContext, key: HistoryEntry["key"]): string {
  return historySource(ctx, ctx.sc.history.find((h) => h.key === key)!);
}

function collectTarget({ code, sc }: BuildContext) {
  return {
    code,
    service: sc.service,
    label: sc.label,
    item: sc.title,
    keywords: sc.keywords,
    searchPeriod: sc.searchPeriod,
    memo: sc.memo,
  };
}

function stakeholderTable(sc: DemoScenario): string[] {
  return [
    "| 이름 | 부서 | 역할 | 이메일 |",
    "|---|---|---|---|",
    ...stakeholders(sc).map((p) => `| ${p.name} | ${p.dept} | ${p.role} | ${p.email} |`),
  ];
}

// ------------------------------------------------------------ 1·2단계: 수집 요청·회신·점검

export function buildCollect(ctx: BuildContext) {
  const { code, sc, tl } = ctx;
  const { requester, reviewer, ops } = sc.people;
  const [s1, s2, s3, s4, s5, s6] = sc.history.map((h) => historySource(ctx, h));
  const req = composeCollectRequest(collectTarget(ctx));
  const conflict = sc.history.find((h) => h.key === "h4")!.decision;
  const unsourced = "연휴 직전 이틀간 변경 요청이 평시 대비 약 9배";

  const innerText = [
    "## 01. 관련자",
    ...stakeholderTable(sc),
    `- 개발사: ${sc.vendorName} (담당자 확인 안 됨)`,
    "",
    "## 02. 요청 배경",
    `설·추석 연휴 직전에 소상공인 가입자의 휴무 안내 멘트 변경이 몰리고, 문구를 직접 써야 해서 고객센터 문의가 늘어남. ${requester.dept} ${requester.name}이 지난 명절 VoC를 근거로 추천 문구 템플릿과 예약 전환 개선을 요청함. ${s1}`,
    `${reviewer.dept} ${reviewer.name}도 점주들이 연휴가 끝난 뒤 평소 멘트로 되돌리는 것을 자주 잊는다는 현장 의견을 전달함. ${s4}`,
    "",
    "## 03. 히스토리 (의사결정 과정)",
    "| 일자 | 채널 | 참여자 | 논의 내용 | 결정 사항 | 출처 |",
    "|---|---|---|---|---|---|",
    ...sc.history.map(
      (h) => `| ${tl.ymd(h.key)} | ${h.channel} | ${h.participants} | ${h.topic} | ${h.decision} | ${historySource(ctx, h)} |`,
    ),
    "",
    "## 04. 기존 문제점·현행 방식",
    `- 점주가 비즈링고 포털에서 휴무 안내 문구를 처음부터 직접 작성해야 함. ${s1}`,
    `- 연휴가 끝나면 점주가 직접 평소 멘트로 되돌려야 하고, 잊으면 휴무 안내가 계속 송출됨. 지난 명절 연휴 뒤 관련 민원이 월 40건 수준. ${s1}`,
    `- 변경 요청이 연휴 직전에 몰려 TTS 합성 대기가 길어짐. ${unsourced}.`,
    "",
    "## 05. 목표·기대효과",
    `- 추천 문구 템플릿으로 문구 작성 부담을 줄이고, 종료 일시 자동 복귀로 연휴 뒤 휴무 안내 오송출 민원을 월 40건에서 5건 이하로 줄임. ${s2}`,
    `- 예약 시점에 음원을 미리 합성해 연휴 당일의 TTS 합성 집중을 없앰. ${s3}`,
    "",
    "## 06. 요구사항 (기능 / 비기능)",
    `- 기능 1: 업종·시즌별 추천 문구 템플릿 제공 (업종 6종 × 시즌 5종, 상호명·휴무 기간만 입력, 미리듣기) ${s2}`,
    `- 기능 2: 시작·종료 일시 예약 전환 및 자동 복귀 (복귀 누락 0건) ${s2}`,
    `- 기능 3: 종료 일시 입력 방식 — [상충] ${requester.dept}은 선택 입력(점주 편의), ${ops.dept}는 필수 입력(오송출 방지) 의견 ${s4}`,
    `- 기능 4: 예약 등록 시점 음원 사전 합성·선배포 (전환 시각의 실시간 합성 0건) ${s3}`,
    `- 기능 5: 전환·복귀 결과 알림. 실패 시 재시도 횟수와 대체 채널 기준은 확인 안 됨 ${s3}`,
    `- 비기능 1: 5만 회선 동시 예약 기준, 정각 후 60초 이내 전환 완료 ${s3}`,
    `- 비기능 2: 이중화 WAS 환경에서 스케줄러 중복 실행·중복 알림 0건 ${s3}`,
    "",
    "## 07. 범위·비범위",
    `- 포함: 시즌 추천 문구 템플릿 관리, 시작·종료 예약과 자동 복귀, 예약 시점 음원 사전 합성, 전환·복귀 결과 알림 ${s2}`,
    `- 제외: 프랜차이즈 본사의 가맹점 일괄 적용, 매장 POS 영업 상태 실시간 연동 (다음 패키지에서 다시 검토) ${s5}`,
    "",
    "## 08. 연동 시스템·부서",
    `- 비즈링고 포털(웹/앱): 템플릿 선택·예약 화면 추가 ${s2}`,
    `- 음성합성(TTS) 서버, 지능망 MRF: 사전 합성 음원 적재 ${s3}`,
    `- 음성링고 예약 스케줄러: 신규 ${s3}`,
    "- 알림 발송(앱 푸시·문자): 담당 부서와 협의 상태 확인 안 됨",
    "",
    "## 09. 제약·보안·운영 고려",
    `- 연휴 시작 정각에 전환이 몰려도 DB 락 경합이 없도록 1,000건 단위로 나눠 전환. ${s3}`,
    `- 상용 작업은 야간 작업 시간(02:00~04:00)에 하고, 문제가 생기면 기존 수동 설정 방식으로 되돌릴 수 있어야 함. ${s3}`,
    `- 추천 문구에는 상호명 외의 개인정보를 넣지 않음. ${s2}`,
    "",
    "## 10. 일정",
    `${sc.label} 반영 대상에 포함, 연말연시 인사말부터 적용. 개발검증시험·운용검증시험 일정은 확인 안 됨. ${s6}`,
    "",
    "## 11. 미결·쟁점",
    `- ${conflict} ${s4}`,
    "- 알림 실패 시 재시도 횟수와 대체 채널 기준",
    "- 알림 발송 연동 담당 부서",
    "",
    "## 12. 참고 자료·출처 (검색하지 못한 범위 포함)",
    `- Outlook 메일 3건 (${tl.ymd("h1")}, ${tl.ymd("h4")}, ${tl.ymd("h6")}), Teams 회의록 2건 (${tl.ymd("h2")}, ${tl.ymd("h5")}), Teams 채널 1건 (${tl.ymd("h3")})`,
    "- Confluence 검색 불가",
  ].join("\n");

  const replyText = [
    "안녕하세요. Outlook 메일과 Teams 논의 이력을 정리해 회신합니다.",
    "",
    replyStartMarker(code),
    innerText,
    REPLY_END_MARKER,
  ].join("\n");

  const section = (
    no: string,
    status: ReviewResult["sections"][number]["status"],
    summary: string,
    sources: string[],
  ): ReviewResult["sections"][number] => ({
    no,
    title: COLLECT_SECTIONS.find((s) => s.no === no)!.title,
    status,
    summary,
    sources,
  });

  const review: ReviewResult = {
    sections: [
      section("01", "충분", `요청(${requester.name})·검토(${reviewer.name})·운영·검증(${ops.name}) 3명의 부서와 메일 주소가 확인됨. 개발사(${sc.vendorName}) 담당자는 확인 안 됨.`, []),
      section("02", "충분", `연휴 직전에 휴무 안내 멘트 변경이 몰리고 문구 작성이 어려워 ${requester.name}이 개선을 요청함 ${s1}. 현장에서도 연휴 뒤 복귀 누락 의견을 전달함 ${s4}.`, [s1, s4]),
      section("03", "충분", `${tl.ymd("h1")} 개선 요청 → ${tl.ymd("h2")} 템플릿·예약 전환 방향 채택 → ${tl.ymd("h5")} 범위 조정 → ${tl.ymd("h6")} ${sc.label} 반영 확정. 종료 일시 입력 방식에 [상충] 1건.`, [s1, s2, s3, s4, s5, s6]),
      section("04", "충분", `문구를 직접 작성해야 하고, 연휴 뒤 수동 복귀를 잊어 휴무 안내가 계속 송출됨(민원 월 40건 수준) ${s1}. 연휴 직전 변경 요청 집중 수치는 출처가 없음.`, [s1]),
      section("05", "충분", `연휴 뒤 오송출 민원을 월 40건에서 5건 이하로 줄이고 ${s2}, 연휴 당일 TTS 합성 집중을 없앰 ${s3}.`, [s2, s3]),
      section("06", "부족", `기능 5건과 비기능 2건이 있으나, 종료 일시 입력 방식이 [상충] 상태이고 알림 실패 시 재시도·대체 채널 기준이 없음. ${s2} ${s3} ${s4}`, [s2, s3, s4]),
      section("07", "충분", `포함: 템플릿 관리, 예약·자동 복귀, 사전 합성, 결과 알림 ${s2}. 제외: 프랜차이즈 본사 일괄 적용, POS 연동 ${s5}.`, [s2, s5]),
      section("08", "부족", `비즈링고 포털, TTS 서버, MRF, 예약 스케줄러가 확인됨 ${s2} ${s3}. 알림 발송 연동의 담당 부서와 협의 상태는 확인 안 됨.`, [s2, s3]),
      section("09", "충분", `1,000건 단위 분할 전환, 야간 작업 시간 적용과 수동 방식 복귀 수단, 문구 내 개인정보 제외. ${s3} ${s2}`, [s2, s3]),
      section("10", "부족", `${sc.label} 반영과 연말연시 적용 목표는 확인됨 ${s6}. 개발검증시험·운용검증시험 일정은 확인 안 됨.`, [s6]),
      section("11", "부족", `${conflict} ${s4}. 알림 실패 처리 기준과 알림 연동 담당 부서도 미결.`, [s4]),
      section("12", "충분", "Outlook 메일 3건, Teams 회의록 2건, Teams 채널 1건. Confluence는 검색하지 못함.", [s1, s2, s3, s4, s5, s6]),
    ],
    stakeholders: stakeholders(sc),
    conflicts: [`${conflict} ${s4}`],
    unsourced: [`04. 기존 문제점·현행 방식: "${unsourced}"`],
    questions: [
      { section: "11", question: "[상충] 종료 일시를 지정하지 않은 예약을 허용합니까? 최종 기준은 무엇입니까?" },
      { section: "06", question: "전환·복귀 알림이 실패하면 몇 번 재시도하고, 어떤 채널로 대신 알립니까?" },
      { section: "10", question: `${sc.label}의 개발검증시험·운용검증시험·상용적용 목표 일정은 어떻게 됩니까?` },
      { section: "08", question: "알림 발송(앱 푸시·문자) 연동은 어느 부서가 담당하며 협의는 어디까지 되었습니까?" },
      { section: "04", question: `"${unsourced}"라는 수치의 출처는 무엇입니까?` },
    ],
  };

  const answers = [
    `운용 의견대로 필수 입력으로 확정했습니다. 시즌 템플릿을 고르면 종료 일시 기본값(연휴 다음 영업일 08:00)을 자동으로 채우고, 비어 있으면 저장할 수 없게 합니다. 2차 검토 회의(${tl.ymd("h5")}) 뒤 ${requester.name}·${ops.name} 확인.`,
    "실패 건은 5분 간격으로 3회 재시도하고, 그래도 실패하면 운용자에게 알립니다. 앱 푸시를 받지 못한 점주에게는 문자로 대신 보냅니다.",
    `개발검증시험 ${tl.ymd("devTestStart")}~${tl.ymd("devTestPlanEnd")}, 운용검증시험 ${tl.ymd("opsTestPlanStart")}~${tl.ymd("opsTestEnd")}, 상용적용 ${tl.ymd("launch")} 목표입니다.`,
    `알림은 기존 비즈링고 알림 발송 경로를 그대로 쓰며 새 연동은 없습니다. ${ops.dept} ${ops.name} 확인.`,
    "운용 주간보고의 지난 설 연휴 집계 수치입니다. 문서 위치를 확인하지 못해 PRD에는 '확인 필요'로 남깁니다.",
  ];

  return {
    request: req,
    reply: { subject: `RE: ${req.subject}`, text: replyText, innerText },
    review,
    answers,
    extraNote: "여름휴가·임시휴무 템플릿도 같은 구조로 포함합니다. 프랜차이즈 본사 일괄 적용은 이번 범위에서 제외합니다.",
  };
}

// ------------------------------------------------------------ 3단계: PRD

export const PRD_V2_NOTE = "NFR-03(예약·전환 이력 12개월 보관) 추가, 11장 미결 사항 정리";

export function buildPrd(ctx: BuildContext, version: 1 | 2): string {
  const { code, sc, tl } = ctx;
  const { reviewer, ops } = sc.people;
  const collect = buildCollect(ctx);
  const draftDate = tl.ymd("prd1");
  const added = `[담당자 보완 ${draftDate}]`;
  const reqSource = (r: DemoRequirement) =>
    r.source === "answer" ? (r.sinceVersion === 2 ? `[담당자 보완 ${tl.ymd("prd2")}]` : added) : sourceOf(ctx, r.source);
  const reqRows = (list: DemoRequirement[]) =>
    list
      .filter((r) => r.sinceVersion <= version)
      .map((r) => `| ${r.id} | ${r.title} | ${r.priority} | ${r.criteria} | ${reqSource(r)} |`);
  const [s1, s2, s3, s4, s5, s6] = sc.history.map((h) => historySource(ctx, h));

  return [
    `# ${sc.title} PRD`,
    "",
    `- 단위서비스: ${sc.service} / 라벨링: ${sc.label} / 개발사항 ID: ${code}`,
    version === 1
      ? `- 버전: v1 / 작성일: ${draftDate} / 작성: AX_AIDD 시스템 초안 (담당자 검토 필요)`
      : `- 버전: v2 / 작성일: ${tl.ymd("prd2")} / 작성: AX_AIDD 시스템 초안, ${reviewer.name} 검토·편집`,
    `- 상태: ${version === 1 ? "초안" : "검토 완료"} · 근거: 수집 회신 "${collect.reply.subject}" (${tl.ymd("collectReply")}), 담당자 추가 입력 ${draftDate}`,
    "",
    "## 1. 배경",
    `설·추석 연휴 직전에 소상공인 가입자의 휴무 안내 멘트 변경이 몰리고, 점주가 문구를 직접 써야 해서 고객센터 문의가 늘어난다. ${sc.people.requester.dept} ${sc.people.requester.name}이 지난 명절 VoC를 근거로 추천 문구 템플릿과 예약 전환 개선을 요청했다. ${s1}`,
    `영업 현장에서도 점주들이 연휴가 끝난 뒤 평소 멘트로 되돌리는 것을 자주 잊는다는 의견이 있었다. ${s4}`,
    "",
    "## 2. 히스토리 (의사결정 과정)",
    "| 일자 | 채널 | 참여자 | 논의 내용 | 결정 사항 | 출처 |",
    "|---|---|---|---|---|---|",
    ...sc.history.map(
      (h) =>
        `| ${tl.ymd(h.key)} | ${h.channel} | ${h.participants} | ${h.topic} | ${h.resolved ?? h.decision} | ${historySource(ctx, h)}${h.resolved ? ` ${added}` : ""} |`,
    ),
    "",
    "## 3. 기존 문제점 (현행 방식)",
    `- 점주가 비즈링고 포털에서 휴무 안내 문구를 처음부터 직접 작성한다. ${s1}`,
    `- 연휴가 끝나면 점주가 직접 평소 멘트로 되돌려야 하며, 잊으면 휴무 안내가 계속 송출된다. 지난 명절 연휴 뒤 관련 민원이 월 40건 수준이었다. ${s1}`,
    "- 변경 요청이 연휴 직전에 몰려 TTS 합성 대기가 길어진다. 집중 정도를 나타내는 수치는 출처를 확인하지 못했다. (11장 참고)",
    "",
    "## 4. 목표 및 기대효과",
    `- 추천 문구 템플릿으로 문구 작성 부담을 줄인다. ${s2}`,
    `- 종료 일시 자동 복귀로 연휴 뒤 휴무 안내 오송출 민원을 월 40건에서 5건 이하로 줄인다. ${s2}`,
    `- 예약 시점에 음원을 미리 합성해 연휴 당일의 TTS 합성 집중을 없앤다. ${s3}`,
    "",
    "## 5. 범위",
    "### 5.1 포함",
    `- 업종·시즌별 추천 문구 템플릿 관리 (설·추석·연말연시, 여름휴가·임시휴무 포함) ${s2} ${added}`,
    `- 시작·종료 일시 예약과 자동 복귀 ${s2}`,
    `- 예약 시점 음원 사전 합성·선배포 ${s3}`,
    `- 전환·복귀 결과 알림 ${s3}`,
    "### 5.2 제외",
    `- 프랜차이즈 본사의 가맹점 일괄 적용 (다음 패키지에서 다시 검토) ${s5}`,
    `- 매장 POS 영업 상태 실시간 연동 ${s5}`,
    "",
    "## 6. 이해관계자 (관련자·역할)",
    ...stakeholderTable(sc),
    "",
    `- 개발사: ${sc.vendorName} (담당자 확인 필요)`,
    "",
    "## 7. 요구사항",
    "### 7.1 기능 요구사항",
    "| ID | 요구사항 | 우선순위 | 수용 기준 | 출처 |",
    "|---|---|---|---|---|",
    ...reqRows(sc.funcReqs),
    "",
    "### 7.2 비기능 요구사항",
    "| ID | 요구사항 | 우선순위 | 수용 기준 | 출처 |",
    "|---|---|---|---|---|",
    ...reqRows(sc.nonFuncReqs),
    "",
    "## 8. 연동 시스템·인터페이스",
    `- 비즈링고 포털(웹/앱): 템플릿 선택, 예약 등록·조회·취소 화면 추가 ${s2}`,
    `- 음성합성(TTS) 서버: 예약 시점 사전 합성 요청 ${s3}`,
    `- 지능망 MRF: 사전 합성 음원 적재, 전환 시각에 활성 음원 전환 ${s3}`,
    `- 음성링고 예약 스케줄러: 신규 ${s3}`,
    `- 알림 발송(앱 푸시·문자): 기존 비즈링고 알림 발송 경로 사용, 새 연동 없음 ${added}`,
    "",
    "## 9. 제약·보안·운영 고려사항",
    `- 연휴 시작 정각에 전환이 몰려도 DB 락 경합이 없도록 1,000건 단위로 나눠 전환한다. ${s3}`,
    `- 상용 작업은 야간 작업 시간(02:00~04:00)에 하고, 문제가 생기면 기존 수동 설정 방식으로 되돌릴 수 있어야 한다. ${s3}`,
    `- 추천 문구에는 상호명 외의 개인정보를 넣지 않는다. ${s2}`,
    `- 종료 일시는 필수 입력이며 기본값은 연휴 다음 영업일 08:00이다. ${added}`,
    "",
    "## 10. 일정 (마일스톤)",
    `- 목표 패키지: ${sc.label}, 연말연시 인사말부터 적용 ${s6}`,
    "",
    "| 마일스톤 | 일정 | 출처 |",
    "|---|---|---|",
    `| 개발 | ${tl.ymd("kickoff")} ~ ${tl.ymd("devEnd")} | ${added} |`,
    `| 개발검증시험 | ${tl.ymd("devTestStart")} ~ ${tl.ymd("devTestPlanEnd")} | ${added} |`,
    `| 운용검증시험 | ${tl.ymd("opsTestPlanStart")} ~ ${tl.ymd("opsTestEnd")} | ${added} |`,
    `| 상용적용 | ${tl.ymd("launch")} | ${added} |`,
    "",
    "## 11. 미결 사항·확인 필요",
    `- "연휴 직전 이틀간 변경 요청이 평시 대비 약 9배"라는 수치의 출처 확인 필요 (운용 주간보고 위치 미확인) ${added}`,
    `- 개발사(${sc.vendorName}) 담당자 연락처 확인 필요`,
    ...(version === 1 ? ["- 예약·전환 이력의 보관 기간 요구가 정해지지 않음 (운용 확인 필요)"] : []),
    "",
    "## 12. 참고 자료·출처",
    ...[s1, s2, s3, s4, s5, s6].map((s) => `- ${s}`),
    "- Confluence는 검색하지 못함 (수집 회신 12번)",
    "",
    "## 변경 이력",
    "",
    "| 버전 | 일자 | 내용 |",
    "|---|---|---|",
    `| v1 | ${draftDate} | 시스템 초안 생성 |`,
    ...(version === 2 ? [`| v2 | ${tl.ymd("prd2")} | ${PRD_V2_NOTE} (${ops.name} 검토 의견 반영) |`] : []),
    "",
  ].join("\n");
}

// ------------------------------------------------------------ 4·5단계: 개발사 문서와 검토 리포트

function countVerdicts(rows: DocReviewResult["rows"]): Record<Verdict, number> {
  const c: Record<Verdict, number> = { 반영: 0, 부분: 0, 미반영: 0, "확인 불가": 0 };
  for (const r of rows) c[r.verdict] += 1;
  return c;
}

/** PRD 버전에 들어 있는 요구사항만 대조 대상으로 삼는다 */
function reviewRows(sc: DemoScenario, prdVersion: number, kind: "arch" | "qa"): DocReviewResult["rows"] {
  return [...sc.funcReqs, ...sc.nonFuncReqs]
    .filter((r) => r.sinceVersion <= prdVersion)
    .map((r) => ({ id: r.id, ...r[kind] }));
}

export function buildArch(ctx: BuildContext, prdContent: string, prdVersion: number) {
  const { code, sc, tl } = ctx;
  const rawAttachName = "architecture.md";
  const registeredName = docFileName({ service: sc.service, label: sc.label, item: sc.title }, "Architecture");
  const archAt = tl.at("archMail");

  const docMd = [
    `# ${sc.title} Architecture 설계서`,
    "",
    `- 작성: ${sc.vendorName}`,
    `- 대상: ${sc.service} / ${sc.label} (${code})`,
    `- 작성일: ${tl.ymd("archMail")}`,
    `- 기준 문서: PRD v${prdVersion}`,
    "",
    "## 1. 설계 개요",
    "점주가 시즌 템플릿을 골라 예약을 저장하면 음원을 미리 합성해 MRF에 적재하고, 예약 시작·종료 시각에는 회선의 활성 음원 포인터만 바꾼다. 연휴 시작 정각의 합성·전환 부하를 예약 시점으로 옮기는 것이 핵심이다.",
    "",
    "## 2. 시스템 구성",
    "| 구성 요소 | 구분 | 역할 |",
    "|---|---|---|",
    "| 비즈링고 포털(웹/앱) | 변경 | 템플릿 선택, 예약 등록·조회·취소 화면 |",
    "| 시즌 템플릿 엔진 | 신규 | 업종·시즌별 문구 관리, 변수 치환 |",
    "| 음원 사전 합성기 | 신규 | 예약 저장 시 TTS 합성 요청, MRF 적재 |",
    "| 예약 스케줄러 | 신규 | 시작·종료 시각의 전환·복귀 실행 |",
    "| 음성합성(TTS) 서버 | 기존 | 문구 합성 |",
    "| 지능망 MRF | 기존 | 음원 저장·송출 |",
    "| 알림 발송 모듈 | 기존 | 앱 푸시·문자 발송 |",
    "",
    "## 3. 기능 설계",
    "### 3.1 시즌 템플릿 엔진",
    "- 템플릿은 업종 코드(6종)와 시즌 코드(5종)의 조합으로 30종을 관리한다.",
    "- 문구의 상호명, 휴무 시작일, 휴무 종료일 변수를 점주 입력값으로 바꾼다.",
    "- 변수와 무관한 고정 인사말 구간은 캐시해 두고, 미리듣기는 변수 구간만 합성해 3초 안에 재생한다.",
    "",
    "### 3.2 예약 전환·자동 복귀 스케줄러",
    "- 예약 저장 시 시작 일시, 종료 일시, 직전 영업 음원 ID를 예약 테이블에 기록한다.",
    "- 시작 일시에 회선의 활성 음원 포인터를 시즌 음원으로 바꾸고, 종료 일시에 직전 영업 음원으로 되돌린다.",
    "- 종료 일시는 권장 입력이며, 입력하지 않으면 연휴 마지막 날 24:00에 복귀한다.",
    "- 예약을 취소하면 사전 합성 음원을 삭제하고 전환 대상에서 뺀다.",
    "",
    "### 3.3 음원 사전 합성·선배포",
    "- 예약 저장 직후 비동기 큐에 합성 작업을 넣고, 합성된 음원을 MRF에 미리 적재한다 (목표 10분 이내).",
    "- 전환 시각에는 합성하지 않고 포인터만 바꾼다.",
    "- 합성에 실패하면 3회 재시도하고, 계속 실패하면 예약 상태를 '합성 실패'로 바꿔 점주에게 알린다.",
    "",
    "### 3.4 전환 결과 알림·실패 처리",
    "- 전환·복귀가 끝나면 5분 이내에 점주 앱으로 푸시를 보낸다. 푸시를 받지 못하면 문자로 대신 보낸다.",
    "- 전환·복귀 실패 건은 5분 간격으로 3회 재시도하고, 그래도 실패하면 운용자 알림을 발생시킨다.",
    "",
    "## 4. 데이터 설계",
    "| 테이블 | 주요 항목 | 보관 기간 |",
    "|---|---|---|",
    "| season_template | 업종 코드, 시즌 코드, 문구, 사용 여부 | 상시 |",
    "| ringo_reservation | 회선, 템플릿, 시작·종료 일시, 직전 음원 ID, 상태 | 종료 후 6개월 |",
    "| ringo_switch_history | 회선, 전환·복귀 구분, 실행 시각, 결과 | 6개월 |",
    "",
    "## 5. 인터페이스",
    "| 구간 | 방식 | 내용 |",
    "|---|---|---|",
    "| 포털 → 템플릿 엔진 | REST | 템플릿 목록 조회, 미리듣기 |",
    "| 포털 → 예약 스케줄러 | REST | 예약 등록·조회·취소 |",
    "| 사전 합성기 → TTS 서버 | 기존 합성 API | 문구 합성 요청 |",
    "| 사전 합성기 → MRF | 기존 음원 배포 API | 음원 적재 |",
    "| 스케줄러 → 알림 발송 모듈 | 기존 알림 API | 푸시·문자 발송 |",
    "",
    "## 6. 비기능 설계",
    "- 처리 시간: 전환 대상을 1,000건 단위로 나눠 병렬 처리한다. 5만 회선 기준 25초 완료를 목표로 한다.",
    "- 스케줄러 실행: 스케줄러 서버의 Cron으로 매분 실행한다.",
    "- 장애 대응: TTS 서버 응답이 없으면 합성 작업을 큐에 남겨 두고 복구 후 다시 처리한다.",
    "",
    "## 7. 운영 편의 추가 사항",
    "- 운영자가 시즌 추천 문구를 추가·수정하고 바로 노출할 수 있는 관리 화면을 추가한다.",
    "",
    "## 8. 배포·되돌리기",
    "- 야간 작업 시간(02:00~04:00)에 배포한다.",
    "- 기능 스위치를 끄면 기존 수동 설정 방식으로 즉시 돌아간다.",
    "",
  ].join("\n");

  const result: DocReviewResult = {
    rows: reviewRows(sc, prdVersion, "arch"),
    extras: ["7장 운영 편의 추가 사항: 운영자용 시즌 추천 문구 관리 화면 (PRD 범위에 없음. 일정·개발 규모 영향 확인 필요)"],
    questions: [
      "FR-03: 종료 일시를 '권장 입력'이 아니라 필수 입력으로 바꾸고, 기본값을 '연휴 다음 영업일 08:00'으로 맞출 수 있습니까?",
      "NFR-02: 이중화 WAS 환경에서 스케줄러 중복 실행을 어떻게 막습니까? 방식(분산 락 등)을 설계서에 적어 주세요.",
      "NFR-03: 예약·전환 이력 보관 기간을 6개월에서 12개월로 바꿀 수 있습니까?",
      `7장의 운영자용 관리 화면이 ${sc.label} 일정과 개발 규모에 영향을 줍니까?`,
    ],
    gaps: [],
  };

  const reportMd = renderDocReview({
    kind: "arch",
    itemName: sc.title,
    doc: { filename: registeredName, version: 1, createdAt: archAt.toISOString() },
    prdVersion,
    model: DEMO_MODEL,
    reqs: parseRequirements(prdContent),
    result,
    now: archAt,
  });

  return {
    mailSubject: `${mailTag(code)} FW: [${sc.vendorName}] ${sc.title} Architecture 설계서 송부`,
    mailBody: [
      `개발사(${sc.vendorName})에서 받은 Architecture 설계서(${rawAttachName})를 전달합니다.`,
      `PRD v${prdVersion} 기준으로 작성된 문서입니다.`,
    ].join("\n"),
    rawAttachName,
    registeredName,
    reportName: docFileName({ service: sc.service, label: sc.label, item: sc.title }, "Architecture_검토리포트"),
    docMd,
    reportMd,
    counts: countVerdicts(result.rows),
  };
}

export function buildQa(ctx: BuildContext, prdContent: string, prdVersion: number) {
  const { code, sc, tl } = ctx;
  const rawAttachName = "qa.md";
  const registeredName = docFileName({ service: sc.service, label: sc.label, item: sc.title }, "QA");
  const qaAt = tl.at("qaMail");

  const docMd = [
    `# ${sc.title} 시험항목서 (QA)`,
    "",
    `- 작성: ${sc.vendorName}`,
    `- 대상: ${sc.service} / ${sc.label} (${code})`,
    `- 작성일: ${tl.ymd("qaMail")}`,
    "- 시험 환경: 음성링고 검증베드 (TTS 서버, MRF, 예약 스케줄러 2대, 비즈링고 포털 검증 환경)",
    `- 기준 문서: PRD v${prdVersion}, Architecture 설계서`,
    "",
    "## 1. 시험 범위",
    "시즌 템플릿, 예약 전환·자동 복귀, 음원 사전 합성, 전환 결과 알림, 대량 전환 처리 시간, 기존 가입자 호환.",
    "",
    "## 2. 시험 항목",
    "",
    "| TC ID | 구분 | 관련 요구사항 | 시험 절차 | 기대 결과 |",
    "|---|---|---|---|---|",
    "| TC-01 | 기능 | FR-01 | 업종 6종과 시즌 5종을 차례로 골라 템플릿을 조회하고 상호명·휴무 기간을 입력 | 30종이 모두 조회되고 입력값이 문구에 반영됨 |",
    "| TC-02 | 기능 | FR-01 | 템플릿 문구를 완성한 뒤 미리듣기 실행 | 3초 이내 재생 시작 |",
    "| TC-03 | 기능 | FR-02 | 시작·종료 일시를 지정해 예약하고 각 시각에 발신 호로 음원 확인 | 시작 시각에 시즌 음원, 종료 시각에 직전 영업 음원 송출 |",
    "| TC-04 | 기능 | FR-02 | 시작 전에 예약을 취소하고 시작 시각에 음원 확인 | 전환되지 않고 기존 음원 유지 |",
    "| TC-05 | 기능 | FR-03 | 시즌 템플릿을 고른 뒤 종료 일시 기본값 확인, 종료 일시를 지우고 저장 시도 | 기본값이 연휴 다음 영업일 08:00으로 채워지고, 비우면 저장되지 않음 |",
    "| TC-06 | 기능 | FR-04 | 예약 저장 후 MRF 적재 완료 시각과 전환 시각의 TTS 요청 로그 확인 | 10분 이내 적재 완료, 전환 시각 합성 요청 0건 |",
    "| TC-07 | 기능 | FR-05 | 전환·복귀 완료 후 점주 앱 알림 확인 | 5분 이내 푸시 수신 |",
    "| TC-08 | 성능 | NFR-01 | 같은 시작 시각으로 5만 회선을 예약한 뒤 전환 완료 시간 측정 | 정각 후 60초 이내 전 회선 전환 |",
    "| TC-09 | 회귀 | - | 예약을 쓰지 않는 기존 가입 회선의 음원 설정·송출 확인 | 기존과 같게 동작 |",
    "| TC-10 | 기능 | NFR-03 | 운용자 화면에서 회선별 전환·복귀 이력 조회, 보관 기간 설정값 확인 | 이력이 조회되고 보관 기간이 12개월로 설정됨 |",
    "",
    "## 3. 시험 일정",
    `- 개발검증시험: ${tl.ymd("devTestStart")} ~ ${tl.ymd("devTestPlanEnd")}`,
    `- 운용검증시험: ${tl.ymd("opsTestPlanStart")} ~ ${tl.ymd("opsTestEnd")}`,
    "",
    "## 4. 합격 기준",
    "- 전 항목 기대 결과 충족, 중대 결함 0건",
    "",
  ].join("\n");

  const result: DocReviewResult = {
    rows: reviewRows(sc, prdVersion, "qa"),
    extras: [],
    questions: [
      "NFR-02: 스케줄러 2대를 동시에 띄운 상태에서 중복 실행·중복 알림이 없는지 확인하는 시험을 추가할 수 있습니까?",
      "FR-05: 문자 대체 발송과 3회 재시도 후 운용자 알림 시험을 TC-07에 추가하거나 별도 항목으로 나눠 주세요.",
      "기능 스위치를 꺼서 기존 수동 설정 방식으로 되돌리는 절차를 운용검증시험 항목에 넣을 수 있습니까?",
    ],
    gaps: [
      { category: "비기능", note: "NFR-02(스케줄러 중복 실행 방지)를 확인하는 시험이 없음" },
      { category: "예외·실패", note: "전환·복귀 실패 시 3회 재시도와 운용자 알림, 푸시 미수신 시 문자 대체 발송 시험이 없음" },
      { category: "예외·실패", note: "TTS 서버 장애로 사전 합성이 실패한 예약의 처리 시험이 없음" },
    ],
  };

  const reportMd = renderDocReview({
    kind: "qa",
    itemName: sc.title,
    doc: { filename: registeredName, version: 1, createdAt: qaAt.toISOString() },
    prdVersion,
    model: DEMO_MODEL,
    reqs: parseRequirements(prdContent),
    result,
    now: qaAt,
  });

  return {
    mailSubject: `${mailTag(code)} FW: [${sc.vendorName}] ${sc.title} 시험항목서 송부`,
    mailBody: [
      `개발사(${sc.vendorName})에서 받은 시험항목서(${rawAttachName})를 전달합니다.`,
      "Architecture 검토 때 보낸 질문 중 FR-03(종료 일시 필수 입력)은 반영되었다고 합니다.",
    ].join("\n"),
    rawAttachName,
    registeredName,
    reportName: docFileName({ service: sc.service, label: sc.label, item: sc.title }, "QA_검토리포트"),
    docMd,
    reportMd,
    counts: countVerdicts(result.rows),
  };
}

// ------------------------------------------------------------ 6·7단계: 진행상황

export interface ProgressRound {
  requestAt: TimeKey;
  replyAt: TimeKey;
  request: { subject: string; text: string };
  reply: { subject: string; text: string; extractedText: string; milestones: Milestone[] };
}

/** 진행상황 요청·회신 3회: 개발검증 진행중 → 운용검증 진행중(일정 변경 이력) → 상용적용 완료 */
export function buildProgress(ctx: BuildContext): ProgressRound[] {
  const { code, sc, tl } = ctx;
  const { requester, reviewer, ops } = sc.people;
  const request = composeProgressRequest(collectTarget(ctx));
  const d = tl.ymd;

  const dev = `| 개발중 | 완료 | ${d("kickoff")} | ${d("devEnd")} (실적) | [Teams ${d("devEnd")} ${reviewer.name} "음성링고 ${sc.label} 개발 진행 공유"] | 개발사 개발 완료 보고 |`;
  const devTestDone = `| 개발검증시험 | 완료 | ${d("devTestStart")} | ${d("devTestEnd")} (실적) | [Outlook ${d("devTestEnd")} ${ops.name} "${sc.label} 개발검증시험 결과"] | 결함 1건(복귀 알림 중복 발송) 조치로 ${d("devTestPlanEnd")} → ${d("devTestEnd")} 하루 지연 |`;

  const round = (requestAt: TimeKey, replyAt: TimeKey, intro: string, rows: string[]): ProgressRound => {
    const text = [
      intro,
      "",
      progressStartMarker(code),
      "| 마일스톤 | 상태 | 시작일 | 완료일 (실적 또는 예정) | 근거 출처 | 비고 |",
      "|---|---|---|---|---|---|",
      ...rows,
      PROGRESS_END_MARKER,
    ].join("\n");
    const extractedText = extractProgressBlock(text).text;
    return {
      requestAt,
      replyAt,
      request,
      reply: { subject: `RE: ${request.subject}`, text, extractedText, milestones: parseProgressTable(extractedText)! },
    };
  };

  return [
    round("progReq1", "progReply1", "개발은 끝났고 개발검증시험을 진행 중입니다. 확인한 일정을 회신합니다.", [
      dev,
      `| 개발검증시험 | 진행중 | ${d("devTestStart")} | ${d("devTestPlanEnd")} (예정) | [Outlook ${d("devTestStart")} ${ops.name} "${sc.label} 개발검증시험 착수"] | |`,
      `| 운용검증시험 | 예정 | ${d("opsTestPlanStart")} | ${d("opsTestEnd")} (예정) | [Outlook ${d("devTestStart")} ${ops.name} "${sc.label} 개발검증시험 착수"] | |`,
      `| 상용적용 | 예정 | | ${d("launch")} (예정) | [Outlook ${d("h6")} ${requester.name} "${sc.label} 반영 범위 확정"] | 야간 작업 02:00~04:00 |`,
    ]),
    round("progReq2", "progReply2", "개발검증시험이 하루 늦게 끝나 운용검증시험 착수일이 바뀌었습니다. 상용적용 일정은 그대로입니다.", [
      dev,
      devTestDone,
      `| 운용검증시험 | 진행중 | ${d("opsTestStart")} | ${d("opsTestEnd")} (예정) | [Teams ${d("opsTestStart")} ${ops.name} "음성링고 운용협의"] | 착수 ${d("opsTestPlanStart")} → ${d("opsTestStart")} |`,
      `| 상용적용 | 예정 | | ${d("launch")} (예정) | [Outlook ${d("opsTestStart")} ${requester.name} "${sc.label} 상용적용 계획"] | 일정 변동 없음 |`,
    ]),
    round("progReq3", "progReply3", `${sc.label} 상용적용까지 끝났습니다. 최종 일정을 회신합니다.`, [
      dev,
      devTestDone,
      `| 운용검증시험 | 완료 | ${d("opsTestStart")} | ${d("opsTestEnd")} (실적) | [Outlook ${d("opsTestEnd")} ${ops.name} "${sc.label} 운용검증시험 완료"] | 특이사항 없음 |`,
      `| 상용적용 | 완료 | ${d("launch")} | ${d("launch")} (실적) | [Outlook ${d("launch")} ${ops.name} "${sc.label} 상용적용 완료"] | 야간 작업 정상 종료 |`,
    ]),
  ];
}
