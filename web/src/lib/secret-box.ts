/**
 * 사용자 설정 비밀값(Gmail 앱 비밀번호) 암호화. AES-256-GCM.
 * 키: SETTINGS_ENCRYPTION_KEY가 있으면 그 값, 없으면 AUTH_SECRET에서 파생한다.
 * (AUTH_SECRET을 바꾸면 저장된 앱 비밀번호를 다시 입력해야 한다)
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getAuthSecret } from "./auth";

function key(): Buffer {
  const explicit = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  const base = explicit || getAuthSecret();
  if (!base) throw new Error("암호화 키가 없습니다. AUTH_SECRET 또는 SETTINGS_ENCRYPTION_KEY를 설정하세요.");
  return createHash("sha256").update(`aidd-user-settings:v1:${base}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

/** 복호화 실패(키 변경·변조)면 null */
export function decryptSecret(enc: string): string | null {
  const [v, iv, tag, ct] = enc.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
