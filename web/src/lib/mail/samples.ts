/**
 * 시뮬레이터 샘플 메일 (서비스 정의 7.3). "통화매니저 SSO 로그인 기능 개발" 기준 합성 데이터.
 * 실제 인물·메일·고객 정보가 아니다. 이름·부서·주소는 모두 가상이다.
 */
import { mailTag } from "@/lib/domain/naming";
import { KIND_SUBJECT_TAG, REPLY_END_MARKER, replyStartMarker } from "./compose";
import type { InboundMail } from "./match";
import type { SampleKey } from "./sample-labels";

export { SAMPLE_LABEL, isSampleKey, type SampleKey } from "./sample-labels";

export interface SampleContext {
  code: string | null;
  item: string;
  service: string | null;
  label: string | null;
  companyAddress: string;
  systemAddress: string;
  /** 해당 종류의 마지막 요청 메일 (회신 헤더용) */
  request?: { subject: string; messageId: string | null } | null;
}

function collectReplyBody(code: string): string {
  return [
    "안녕하세요. 요청하신 내용을 Copilot으로 정리해 회신드립니다.",
    "",
    replyStartMarker(code),
    "## 01. 관련자",
    "| 이름 | 부서 | 역할 | 이메일 |",
    "|---|---|---|---|",
    "| 김가상 | 가상서비스기획팀 | 요청 | kim.gasang@example.com |",
    "| 이예시 | 가상플랫폼개발팀 | 결정 | lee.yesi@example.com |",
    "| 박샘플 | 가상협력개발사 | 개발 | park.sample@example.com |",
    "| 최테스트 | 가상품질검증팀 | 검증 | choi.test@example.com |",
    "",
    "## 02. 요청 배경",
    "통화매니저 웹 관리자 화면이 별도 계정·비밀번호를 쓰고 있어 사내 통합인증(SSO)과 맞춰 달라는 요청이 있었습니다. [Outlook 2026-08-15 김가상 \"통화매니저 로그인 개선 요청\"]",
    "분기 보안 점검에서 별도 계정의 비밀번호 주기 관리가 지적 사항으로 나왔습니다. [Teams 2026-08-20 이예시 \"플랫폼개발 채널\"]",
    "",
    "## 03. 히스토리 (의사결정 과정)",
    "| 일자 | 채널 | 참여자 | 논의 내용 | 결정 사항 | 출처 |",
    "|---|---|---|---|---|---|",
    "| 2026-08-15 | 메일 | 김가상, 이예시 | SSO 적용 요청 | 검토 착수 | [Outlook 2026-08-15 김가상 \"통화매니저 로그인 개선 요청\"] |",
    "| 2026-09-03 | 회의 | 김가상, 이예시, 박샘플 | 연동 방식 (SAML vs OIDC) | OIDC 우선 검토 | [Teams 2026-09-03 회의록 \"SSO 연동 방식 검토\"] |",
    "| 2026-09-24 | Teams | 이예시, 박샘플 | 기존 계정 병행 기간 | [상충] 이예시: 1개월 병행 / 박샘플: 병행 없이 일괄 전환 | [Teams 2026-09-24 \"플랫폼개발 채널\"] |",
    "| 2026-10-10 | 메일 | 이예시 | 적용 PKG | R181PKG_26.12에 포함 | [Outlook 2026-10-10 이예시 \"26.12 PKG 범위\"] |",
    "",
    "## 04. 기존 문제점·현행 방식",
    "관리자 화면은 자체 계정 DB로 로그인하며, 비밀번호 변경·잠금 해제를 운영자가 수작업으로 처리합니다. 월 20건 안팎의 잠금 해제 요청이 있습니다. [Teams 2026-08-20 이예시 \"플랫폼개발 채널\"]",
    "",
    "## 05. 목표·기대효과",
    "사내 SSO 계정으로 로그인하고 별도 계정을 없앱니다. 잠금 해제 문의 0건을 목표로 언급했습니다. [Teams 2026-09-03 회의록 \"SSO 연동 방식 검토\"]",
    "",
    "## 06. 요구사항 (기능 / 비기능)",
    "- 기능: OIDC 기반 SSO 로그인, 로그아웃 시 SSO 세션 연동 종료, 세션 만료(30분 무활동) 처리, 권한은 기존 역할 매핑 유지 [Teams 2026-09-03 회의록]",
    "- 기능: SSO 장애 시 비상 로그인 경로 — 확인 안 됨",
    "- 비기능: 로그인 응답 3초 이내, 인증 로그 1년 보관 [Outlook 2026-09-05 이예시 \"SSO 회의 후속\"]",
    "",
    "## 07. 범위·비범위",
    "- 범위: 관리자 웹 화면 로그인",
    "- 비범위: 고객용 모바일 앱 로그인 [Teams 2026-09-03 회의록]",
    "",
    "## 08. 연동 시스템·부서",
    "사내 통합인증 시스템(IdP) — 담당 부서 가상인증팀, 연동 협의 상태 확인 안 됨",
    "",
    "## 09. 제약·보안·운영 고려",
    "보안 심의 필요 여부 확인 안 됨. 운영 전환은 야간 작업 창에서 진행해야 한다는 의견이 있음. [Teams 2026-09-24 \"플랫폼개발 채널\"]",
    "",
    "## 10. 일정",
    "R181PKG_26.12 상용 반영 목표. 세부 마일스톤 확인 안 됨. [Outlook 2026-10-10 이예시 \"26.12 PKG 범위\"]",
    "",
    "## 11. 미결·쟁점",
    "- [상충] 기존 계정 병행 기간 (1개월 vs 없음)",
    "- SSO 장애 시 비상 로그인 방식 미정",
    "",
    "## 12. 참고 자료·출처 (검색하지 못한 범위 포함)",
    "- Outlook 메일 3건, Teams 회의록 1건, Teams 채널 2건",
    "- Confluence 검색 불가",
    REPLY_END_MARKER,
  ].join("\n");
}

const ARCH_MD = `# 통화매니저 SSO 로그인 Architecture 설계서 (가상 개발사 작성)

## 1. 개요
관리자 웹 로그인을 사내 IdP와 OIDC Authorization Code Flow로 연동한다.

## 2. 구성
- 관리자 웹 → 인증 게이트웨이 → 사내 IdP
- 권한 매핑: IdP 그룹 → 기존 관리자 역할 테이블

## 3. 처리 흐름
1. 미로그인 사용자를 IdP 로그인 화면으로 리다이렉트
2. Authorization Code 수신 후 토큰 교환
3. 세션 생성 (무활동 30분 만료)
4. 로그아웃 시 IdP end_session 호출

## 4. 비기능
- 로그인 처리 목표 2초
- 인증 로그는 감사 로그 저장소에 180일 보관

## 5. 전환 계획
- 기존 계정은 일괄 전환 (병행 기간 없음)
`;

const QA_MD = `# 통화매니저 SSO 로그인 시험항목서 (가상 개발사 작성)

| ID | 시험 항목 | 기대 결과 |
|---|---|---|
| TC-01 | SSO 로그인 성공 | 관리자 메인 화면 진입 |
| TC-02 | 권한 매핑 확인 | IdP 그룹별 메뉴 노출이 기존 역할과 동일 |
| TC-03 | 로그아웃 | IdP 세션까지 종료 |
| TC-04 | 30분 무활동 | 세션 만료 후 로그인 화면 이동 |
| TC-05 | 잘못된 코드로 콜백 호출 | 오류 화면, 로그 기록 |
`;

function progressReplyBody(code: string): string {
  return [
    "진행상황 회신드립니다.",
    "",
    `<<<AX_AIDD_PROGRESS_START ${code}>>>`,
    "| 마일스톤 | 상태 | 시작일 | 완료일 (실적 또는 예정) | 근거 출처 | 비고 |",
    "|---|---|---|---|---|---|",
    "| 개발중 | 진행중 | 2026-10-20 | 2026-11-28 (예정) | [Teams 2026-11-10 박샘플 \"개발 현황\"] | |",
    "| 개발검증시험 | 예정 | 2026-12-01 | 2026-12-05 (예정) | [Outlook 2026-11-12 최테스트 \"시험 일정\"] | |",
    "| 운용검증시험 | 미정 | | | | 일정 협의 중 |",
    "| 상용적용 | 예정 | | 2026-12-22 (예정) | [Outlook 2026-10-10 이예시 \"26.12 PKG 범위\"] | R181PKG_26.12 |",
    "<<<AX_AIDD_PROGRESS_END>>>",
  ].join("\n");
}

export function buildSample(key: SampleKey, ctx: SampleContext): InboundMail {
  const base = {
    messageId: `<sim-${key}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@simulator.local>`,
    from: `회사 사용자 <${ctx.companyAddress}>`,
    to: ctx.systemAddress,
    date: new Date(),
    references: [] as string[],
    inReplyTo: null as string | null,
    attachments: [] as InboundMail["attachments"],
  };
  const tag = ctx.code ? mailTag(ctx.code) : "";
  const code = ctx.code ?? "DEV-0000";
  switch (key) {
    case "collect_reply": {
      const subject = ctx.request?.subject ?? `${tag}${KIND_SUBJECT_TAG.collect} ${ctx.item}`;
      const reply = ctx.request?.messageId ?? null;
      return {
        ...base,
        subject: `RE: ${subject}`,
        inReplyTo: reply,
        references: reply ? [reply] : [],
        text: collectReplyBody(code),
      };
    }
    case "progress_reply": {
      const subject = ctx.request?.subject ?? `${tag}${KIND_SUBJECT_TAG.progress} ${ctx.item}`;
      const reply = ctx.request?.messageId ?? null;
      return {
        ...base,
        subject: `RE: ${subject}`,
        inReplyTo: reply,
        references: reply ? [reply] : [],
        text: progressReplyBody(code),
      };
    }
    case "architecture":
      return {
        ...base,
        subject: `${tag} FW: [가상개발사] 통화매니저 SSO 로그인 아키텍처 설계서`.trim(),
        text: "개발사에서 받은 Architecture 설계서를 전달합니다.",
        attachments: [att("SSO_Architecture.md", ARCH_MD)],
      };
    case "qa":
      return {
        ...base,
        subject: `${tag} FW: [가상개발사] 통화매니저 SSO 로그인 시험항목서`.trim(),
        text: "개발사에서 받은 시험항목서를 전달합니다.",
        attachments: [att("SSO_QA_시험항목서.md", QA_MD)],
      };
    case "untagged_doc":
      return {
        ...base,
        subject: "FW: [가상개발사] 설계서 송부",
        text: "태그 없이 전달한 메일입니다.",
        attachments: [att("설계서.md", ARCH_MD)],
      };
  }
}

function att(filename: string, content: string) {
  return {
    filename,
    contentType: "text/markdown",
    size: Buffer.byteLength(content, "utf8"),
    content,
  };
}
