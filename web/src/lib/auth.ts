/**
 * 더미 로그인 (D-03): config의 LOGIN_ID / LOGIN_PASSWORD와 일치하면 통과.
 * 로그인 상태 유지는 HMAC 서명 쿠키 하나만 사용한다. 별도 세션 저장소는 없다.
 */

export const SESSION_COOKIE = "aidd_session";
export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 14; // 14일

const DEV_DEFAULTS = { id: "admin", password: "admin", secret: "aidd-dev-secret-not-for-production" };

export interface AuthConfig {
  id: string;
  password: string;
  secret: string;
  usingDevDefaults: boolean;
}

/** 운영에서 값이 하나라도 없으면 null (로그인 불가) */
export function getAuthConfig(): AuthConfig | null {
  const id = process.env.LOGIN_ID;
  const password = process.env.LOGIN_PASSWORD;
  const secret = process.env.AUTH_SECRET;
  if (id && password && secret) return { id, password, secret, usingDevDefaults: false };
  if (process.env.NODE_ENV !== "production") {
    return {
      id: id || DEV_DEFAULTS.id,
      password: password || DEV_DEFAULTS.password,
      secret: secret || DEV_DEFAULTS.secret,
      usingDevDefaults: true,
    };
  }
  return null;
}

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

export function checkCredentials(cfg: AuthConfig, id: unknown, password: unknown): boolean {
  return typeof id === "string" && typeof password === "string" && safeEqual(id, cfg.id) && safeEqual(password, cfg.password);
}

export async function createSessionToken(cfg: AuthConfig, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + SESSION_MAX_AGE_SEC;
  const payload = `${Buffer.from(cfg.id).toString("base64url")}.${exp}`;
  return `${payload}.${await hmac(cfg.secret, payload)}`;
}

export async function verifySessionToken(cfg: AuthConfig, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [idPart, expPart, sig] = parts;
  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  if (Buffer.from(idPart, "base64url").toString() !== cfg.id) return false;
  return safeEqual(sig, await hmac(cfg.secret, `${idPart}.${expPart}`));
}
