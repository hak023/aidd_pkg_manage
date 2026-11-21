import { connection } from "next/server";
import { respond } from "@/lib/api";
import { getAuthConfig } from "@/lib/auth";
import { getMailConfig, MAIL_MODE_LABEL } from "@/lib/mail/config";

/** 설정 화면: 현재 config 확인 (비밀값은 설정 여부만 표시) */
export async function GET() {
  await connection();
  return respond(async () => {
    const mail = getMailConfig();
    const auth = getAuthConfig();
    const set = (v: string | undefined) => (v && v.trim() ? "설정됨" : "없음");
    return {
      mailMode: mail.mode,
      mailModeLabel: MAIL_MODE_LABEL[mail.mode],
      rows: [
        { key: "LOGIN_ID / LOGIN_PASSWORD", value: auth?.usingDevDefaults ? "개발용 기본값 사용 중" : "설정됨" },
        { key: "AUTH_SECRET", value: set(process.env.AUTH_SECRET) },
        { key: "DATABASE_URL", value: process.env.DATABASE_URL ? "Neon (설정됨)" : "로컬 PGlite" },
        { key: "SIMULATOR_MODE", value: process.env.SIMULATOR_MODE || "(비어 있음)" },
        { key: "GMAIL_ADDRESS", value: process.env.GMAIL_ADDRESS || "없음" },
        { key: "GMAIL_APP_PASSWORD", value: set(process.env.GMAIL_APP_PASSWORD) },
        { key: "COLLECT_TO_ADDRESS", value: process.env.COLLECT_TO_ADDRESS || "없음" },
        { key: "POLL_SECRET", value: set(process.env.POLL_SECRET) },
        { key: "MAIL_DAILY_LIMIT", value: String(mail.dailyLimit) },
        { key: "MAIL_LOOKBACK_DAYS", value: String(mail.initialLookbackDays) },
        { key: "GEMINI_API_KEY", value: set(process.env.GEMINI_API_KEY) },
        { key: "GEMINI_MODEL", value: process.env.GEMINI_MODEL || "(비어 있음 → Flash-Lite 자동 선택)" },
      ],
      effective: { from: mail.gmailAddress, collectTo: mail.collectTo },
    };
  });
}
