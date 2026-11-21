/**
 * 로그인 (D-03 확장, 2026-11-22 다중 사용자).
 *
 * - AUTH_USERS가 있으면 다중 사용자: 관리자가 환경 변수로 계정을 관리한다.
 *   AUTH_USERS=hak,kim
 *   USER_HAK_PASSWORD_HASH=scrypt$...   (npm run hash-password로 생성)
 *   USER_HAK_NAME=이름(선택)
 *   USER_HAK_GMAIL_ADDRESS / USER_HAK_GMAIL_APP_PASSWORD / USER_HAK_COLLECT_TO_ADDRESS
 * - AUTH_USERS가 없으면 기존 단일 계정(LOGIN_ID / LOGIN_PASSWORD)과 전역 GMAIL_* 값을 쓴다.
 * 로그인 상태는 HMAC 서명 쿠키 하나로 유지한다. 비밀번호 해시가 바뀌면 기존 세션은 무효가 된다.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "aidd_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14일

const DEV_DEFAULTS = { id: "admin", password: "admin", secret: "aidd-dev-secret-not-for-production" };
const USER_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export interface UserMailEnv {
  gmailAddress: string;
  appPassword: string;
  collectTo: string;
}

export interface AuthUser {
  id: string;
  name: string;
  /** 다중 사용자: scrypt 해시 */
  passwordHash?: string;
  /** 단일 계정(기존 방식): 평문 비교 */
  password?: string;
  /** 다중 사용자일 때 사용자별 메일 설정. null이면 전역 GMAIL_* 사용 */
  mail: UserMailEnv | null;
}

export interface AuthConfig {
  secret: string;
  users: AuthUser[];
  multiUser: boolean;
  usingDevDefaults: boolean;
}

export function isMultiUser(): boolean {
  return !!process.env.AUTH_USERS?.trim();
}

/** 사용자 ID → 환경 변수 접두어 (hak-1 → USER_HAK_1_) */
export function userEnvPrefix(id: string): string {
  return `USER_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_`;
}

export function parseUserIds(raw: string | undefined): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => USER_ID_RE.test(s)),
    ),
  ];
}

function loadMultiUsers(env: NodeJS.ProcessEnv): AuthUser[] {
  const users: AuthUser[] = [];
  for (const id of parseUserIds(env.AUTH_USERS)) {
    const p = userEnvPrefix(id);
    const hash = (env[`${p}PASSWORD_HASH`] ?? "").trim();
    if (!hash.startsWith("scrypt$")) continue; // 비밀번호가 없는 계정은 로그인 불가
    users.push({
      id,
      name: (env[`${p}NAME`] ?? "").trim() || id,
      passwordHash: hash,
      mail: {
        gmailAddress: (env[`${p}GMAIL_ADDRESS`] ?? "").trim(),
        appPassword: (env[`${p}GMAIL_APP_PASSWORD`] ?? "").replace(/\s+/g, ""),
        collectTo: (env[`${p}COLLECT_TO_ADDRESS`] ?? "").trim(),
      },
    });
  }
  return users;
}

/** 쿠키 서명·설정 암호화에 쓰는 비밀값 (로컬 개발은 기본값) */
export function getAuthSecret(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUTH_SECRET || (env.NODE_ENV !== "production" ? DEV_DEFAULTS.secret : "");
}

/** 운영에서 필요한 값이 없으면 null (로그인 불가) */
export function getAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const dev = env.NODE_ENV !== "production";
  const secret = getAuthSecret(env);
  if (!secret) return null;

  if (env.AUTH_USERS?.trim()) {
    const users = loadMultiUsers(env);
    if (users.length === 0) return null;
    return { secret, users, multiUser: true, usingDevDefaults: !env.AUTH_SECRET };
  }

  const id = env.LOGIN_ID;
  const password = env.LOGIN_PASSWORD;
  if (id && password && env.AUTH_SECRET) {
    return { secret, users: [{ id, name: id, password, mail: null }], multiUser: false, usingDevDefaults: false };
  }
  if (!dev) return null;
  return {
    secret,
    users: [{ id: id || DEV_DEFAULTS.id, name: id || DEV_DEFAULTS.id, password: password || DEV_DEFAULTS.password, mail: null }],
    multiUser: false,
    usingDevDefaults: true,
  };
}

// ------------------------------------------------------------ 비밀번호 해시 (scrypt)

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ------------------------------------------------------------ 계정 확인과 세션 토큰

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Buffer.from(sig).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const DUMMY_HASH = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function checkCredentials(cfg: AuthConfig, id: unknown, password: unknown): Promise<AuthUser | null> {
  if (typeof id !== "string" || typeof password !== "string") return null;
  const key = cfg.multiUser ? id.trim().toLowerCase() : id;
  const user = cfg.users.find((u) => u.id === key);
  if (cfg.multiUser) {
    // 없는 ID도 같은 시간이 걸리도록 해시 비교를 수행한다
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    return user && ok ? user : null;
  }
  return user?.password !== undefined && safeEqual(id, user.id) && safeEqual(password, user.password) ? user : null;
}

/** 비밀번호(해시)가 바뀌면 달라지는 값. 토큰에 넣어 기존 세션을 무효화한다. */
async function credentialVersion(user: AuthUser): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(user.passwordHash ?? user.password ?? ""));
  return Buffer.from(digest).toString("base64url").slice(0, 12);
}

export async function createSessionToken(cfg: AuthConfig, user: AuthUser, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE_SEC;
  const payload = `${Buffer.from(user.id).toString("base64url")}.${exp}.${await credentialVersion(user)}`;
  return `${payload}.${await hmac(cfg.secret, payload)}`;
}

export async function verifySessionToken(
  cfg: AuthConfig,
  token: string | undefined,
  now = Date.now(),
): Promise<AuthUser | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [idPart, expPart, verPart, sig] = parts;
  if (!safeEqual(sig, await hmac(cfg.secret, `${idPart}.${expPart}.${verPart}`))) return null;
  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp * 1000 < now) return null;
  const user = cfg.users.find((u) => u.id === Buffer.from(idPart, "base64url").toString());
  if (!user) return null; // 계정 삭제 = 세션 무효
  return safeEqual(verPart, await credentialVersion(user)) ? user : null;
}

// ------------------------------------------------------------ 로그인 시도 제한 (인스턴스 메모리 기준)

const FAIL_LIMIT = 5;
const FAIL_WINDOW_MS = 15 * 60_000;
type GlobalWithFails = typeof globalThis & { __aiddLoginFails?: Map<string, { n: number; first: number }> };
const g = globalThis as GlobalWithFails;

function fails() {
  if (!g.__aiddLoginFails) g.__aiddLoginFails = new Map();
  return g.__aiddLoginFails;
}

export function isLoginBlocked(key: string, now = Date.now()): boolean {
  const f = fails().get(key);
  if (!f) return false;
  if (now - f.first > FAIL_WINDOW_MS) {
    fails().delete(key);
    return false;
  }
  return f.n >= FAIL_LIMIT;
}

export function recordLoginFailure(key: string, now = Date.now()) {
  const f = fails().get(key);
  if (!f || now - f.first > FAIL_WINDOW_MS) fails().set(key, { n: 1, first: now });
  else f.n += 1;
}

export function clearLoginFailures(key: string) {
  fails().delete(key);
}
