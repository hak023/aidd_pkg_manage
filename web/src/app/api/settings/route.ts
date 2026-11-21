import { connection } from "next/server";
import { respond } from "@/lib/api";
import { getAuthConfig, isMultiUser } from "@/lib/auth";
import { getMailConfig, MAIL_MODE_LABEL } from "@/lib/mail/config";
import { currentUser } from "@/lib/session";

/** 설정 화면: 현재 로그인 사용자 기준 config 확인 (비밀값은 설정 여부만 표시, 다른 사용자 정보는 보이지 않음) */
export async function GET() {
  await connection();
  return respond(async () => {
    const mail = getMailConfig();
    const auth = getAuthConfig();
    const user = currentUser();
    const set = (v: string | undefined) => (v && v.trim() ? "설정됨" : "없음");
    return {
      mailMode: mail.mode,
      mailModeLabel: MAIL_MODE_LABEL[mail.mode],
      user: user ? { id: user.id, name: user.name } : null,
      multiUser: isMultiUser(),
      rows: [
        {
          key: isMultiUser() ? "AUTH_USERS (다중 사용자)" : "LOGIN_ID / LOGIN_PASSWORD",
          value: isMultiUser()
            ? `${auth?.users.length ?? 0}명 사용 가능 · 현재 ${user?.id ?? "-"}`
            : auth?.usingDevDefaults
              ? "개발용 기본값 사용 중"
              : "설정됨",
        },
        { key: "AUTH_SECRET", value: set(process.env.AUTH_SECRET) },
        { key: "DATABASE_URL", value: process.env.DATABASE_URL ? "Neon (설정됨)" : "로컬 PGlite" },
        { key: "SIMULATOR_MODE", value: process.env.SIMULATOR_MODE || "(비어 있음)" },
        { key: "SETTINGS_ENCRYPTION_KEY", value: process.env.SETTINGS_ENCRYPTION_KEY ? "설정됨" : "없음 (AUTH_SECRET에서 파생)" },
        { key: "MAIL_DAILY_LIMIT", value: `${mail.dailyLimit} (계정별)` },
        { key: "MAIL_LOOKBACK_DAYS", value: String(mail.initialLookbackDays) },
        { key: "GEMINI_API_KEY", value: set(process.env.GEMINI_API_KEY) },
        { key: "GEMINI_MODEL", value: process.env.GEMINI_MODEL || "(비어 있음 → Flash-Lite 자동 선택)" },
      ],
      effective: { from: mail.gmailAddress, collectTo: mail.collectTo },
    };
  });
}
