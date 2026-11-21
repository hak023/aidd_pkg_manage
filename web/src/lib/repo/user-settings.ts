/**
 * 사용자별 메일 설정 (설정 화면 '내 메일 설정').
 * 우선순위: 사용자가 화면에서 입력한 값 → 관리자 환경 변수(USER_<ID>_* 또는 전역 GMAIL_*).
 * 앱 비밀번호는 암호화해 저장하고, 화면으로는 설정 여부만 돌려준다.
 */
import { eq } from "drizzle-orm";
import { isMultiUser, type AuthUser, type UserMailEnv } from "@/lib/auth";
import { getHandle } from "@/lib/db/client";
import { userSettings } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { badRequest } from "./errors";

export type SettingSource = "user" | "admin" | "none";

export interface MyMailSettingsDTO {
  gmailAddress: string;
  collectTo: string;
  appPasswordSet: boolean;
  /** 저장된 앱 비밀번호를 복호화하지 못함 (암호화 키가 바뀜) → 다시 입력 필요 */
  appPasswordUnreadable: boolean;
  source: { gmailAddress: SettingSource; appPassword: SettingSource; collectTo: SettingSource };
  updatedAt: string | null;
}

/** 관리자 환경 변수 값 (다중 사용자: USER_<ID>_*, 단일 계정: 전역 GMAIL_*) */
function adminMail(user: AuthUser): UserMailEnv {
  if (user.mail) return user.mail;
  if (isMultiUser()) return { gmailAddress: "", appPassword: "", collectTo: "" };
  const env = process.env;
  return {
    gmailAddress: (env.GMAIL_ADDRESS ?? "").trim(),
    appPassword: (env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""),
    collectTo: (env.COLLECT_TO_ADDRESS ?? "").trim(),
  };
}

async function loadRow(userId: string) {
  const { db } = await getHandle();
  const [r] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return r ?? null;
}

function merge(user: AuthUser, row: Awaited<ReturnType<typeof loadRow>>) {
  const admin = adminMail(user);
  const pw = row?.appPasswordEnc ? decryptSecret(row.appPasswordEnc) : null;
  const pick = (mine: string | null | undefined, adm: string): [string, SettingSource] =>
    mine ? [mine, "user"] : adm ? [adm, "admin"] : ["", "none"];
  const [gmailAddress, gSrc] = pick(row?.gmailAddress, admin.gmailAddress);
  const [appPassword, pSrc] = pick(pw, admin.appPassword);
  const [collectTo, cSrc] = pick(row?.collectTo, admin.collectTo);
  return {
    mail: { gmailAddress, appPassword, collectTo },
    source: { gmailAddress: gSrc, appPassword: pSrc, collectTo: cSrc },
    unreadable: !!row?.appPasswordEnc && pw === null,
    row,
  };
}

/**
 * 요청 처리에 쓸 메일 설정. 사용자가 저장한 값이 없고 단일 계정 방식이면 null
 * (기존과 같이 전역 환경 변수를 그대로 쓴다).
 */
export async function effectiveMailFor(user: AuthUser): Promise<UserMailEnv | null> {
  const row = await loadRow(user.id);
  if (!row && !user.mail) return null;
  return merge(user, row).mail;
}

export async function getMyMailSettings(user: AuthUser): Promise<MyMailSettingsDTO> {
  const m = merge(user, await loadRow(user.id));
  return {
    gmailAddress: m.mail.gmailAddress,
    collectTo: m.mail.collectTo,
    appPasswordSet: !!m.mail.appPassword,
    appPasswordUnreadable: m.unreadable,
    source: m.source,
    updatedAt: m.row ? m.row.updatedAt.toISOString() : null,
  };
}

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function cleanEmail(v: unknown, label: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw badRequest(`${label} 형식이 올바르지 않습니다.`);
  const s = v.trim();
  if (s && (!EMAIL_RE.test(s) || s.length > 254)) throw badRequest(`${label} 형식이 올바르지 않습니다: ${s}`);
  return s;
}

/**
 * 내 메일 설정 저장.
 * - gmailAddress, collectTo: 문자열이면 저장 (빈 문자열 = 내 값 지우고 관리자 값 사용)
 * - appPassword: 비어 있지 않은 문자열이면 새 값으로 교체, 없거나 빈 문자열이면 유지
 * - clearAppPassword: true면 내 앱 비밀번호 삭제
 */
export async function saveMyMailSettings(
  user: AuthUser,
  input: { gmailAddress?: unknown; collectTo?: unknown; appPassword?: unknown; clearAppPassword?: unknown },
): Promise<MyMailSettingsDTO> {
  const gmailAddress = cleanEmail(input.gmailAddress, "Gmail 주소");
  const collectTo = cleanEmail(input.collectTo, "수집 요청 받는 주소");
  let appPasswordEnc: string | undefined;
  if (input.clearAppPassword === true) appPasswordEnc = "";
  else if (typeof input.appPassword === "string" && input.appPassword.trim()) {
    const pw = input.appPassword.replace(/\s+/g, "");
    if (pw.length < 8 || pw.length > 64) throw badRequest("앱 비밀번호 길이가 올바르지 않습니다 (Gmail 앱 비밀번호는 16자).");
    appPasswordEnc = encryptSecret(pw);
  } else if (input.appPassword !== undefined && typeof input.appPassword !== "string") {
    throw badRequest("앱 비밀번호 형식이 올바르지 않습니다.");
  }

  const prev = await loadRow(user.id);
  const next = {
    userId: user.id,
    gmailAddress: gmailAddress ?? prev?.gmailAddress ?? "",
    collectTo: collectTo ?? prev?.collectTo ?? "",
    appPasswordEnc: appPasswordEnc ?? prev?.appPasswordEnc ?? "",
    updatedAt: new Date(),
  };
  const { db } = await getHandle();
  await db
    .insert(userSettings)
    .values(next)
    .onConflictDoUpdate({ target: userSettings.userId, set: next });
  return getMyMailSettings(user);
}
