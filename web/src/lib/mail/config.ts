/**
 * 메일 config (서비스 정의 7.2). 값은 환경 변수에만 둔다.
 *
 * 모드 결정 순서
 * 1. SIMULATOR_MODE=true            → simulator (실제 메일 대신 가상 메일함)
 * 2. Gmail 주소·앱 비밀번호·수신 주소가 모두 있음 → gmail
 * 3. 로컬 개발(next dev)            → simulator
 * 4. 운영에서 값이 부족함            → unconfigured (발송·수신 불가)
 */

export type MailMode = "gmail" | "simulator" | "unconfigured";

export interface MailConfig {
  mode: MailMode;
  gmailAddress: string;
  appPassword: string;
  /** 수집·진행상황 요청 메일을 받는 회사 주소. 자동 발송은 이 주소로만 한다 (AGENTS.md 4-4). */
  collectTo: string;
  pollSecret: string;
  /** 하루(최근 24시간) 실제 발송 한도 (R3) */
  dailyLimit: number;
  /** 첫 수신 확인 때 거슬러 올라가 확인할 일수 */
  initialLookbackDays: number;
}

export const SIM_GMAIL_ADDRESS = "aidd-system@simulator.local";
export const SIM_COLLECT_TO = "company-user@simulator.local";

export function getMailConfig(): MailConfig {
  const env = process.env;
  const gmailAddress = (env.GMAIL_ADDRESS ?? "").trim();
  const appPassword = (env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");
  const collectTo = (env.COLLECT_TO_ADDRESS ?? "").trim();
  const simFlag = (env.SIMULATOR_MODE ?? "").trim().toLowerCase();
  const limit = Number(env.MAIL_DAILY_LIMIT);
  const lookback = Number(env.MAIL_LOOKBACK_DAYS);

  let mode: MailMode;
  if (simFlag === "true" || simFlag === "1") mode = "simulator";
  else if (gmailAddress && appPassword && collectTo) mode = "gmail";
  else if (env.NODE_ENV !== "production") mode = "simulator";
  else mode = "unconfigured";

  return {
    mode,
    gmailAddress: mode === "simulator" ? gmailAddress || SIM_GMAIL_ADDRESS : gmailAddress,
    appPassword,
    collectTo: mode === "simulator" ? collectTo || SIM_COLLECT_TO : collectTo,
    pollSecret: (env.POLL_SECRET ?? "").trim(),
    dailyLimit: Number.isInteger(limit) && limit > 0 ? limit : 30,
    initialLookbackDays: Number.isInteger(lookback) && lookback > 0 ? lookback : 3,
  };
}

export const MAIL_MODE_LABEL: Record<MailMode, string> = {
  gmail: "Gmail 연동",
  simulator: "시뮬레이터 (가상 메일함)",
  unconfigured: "설정 필요",
};
