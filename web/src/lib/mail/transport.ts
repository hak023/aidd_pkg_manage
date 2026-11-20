/**
 * 메일 송수신 어댑터.
 * - gmail: SMTP(발송) + IMAP(수신), Gmail 앱 비밀번호 사용 (서비스 정의 7.1)
 * - simulator: 실제 메일 없이 가상 메일함(sim_inbox) 사용 (7.3)
 */
import { randomBytes } from "node:crypto";
import type { MailConfig } from "./config";
import type { InboundAttachment, InboundMail } from "./match";

export interface OutgoingMail {
  to: string[];
  subject: string;
  text: string;
  attachments?: { filename: string; content: string; contentType?: string }[];
  inReplyTo?: string;
}

export interface FetchState {
  uidValidity: string | null;
  lastUid: number;
}

export interface FetchResult {
  mails: InboundMail[];
  state: FetchState;
}

export const MAX_TEXT = 200_000;
export const MAX_ATTACHMENT_TEXT = 1_000_000;
/** 한 번의 확인에서 가져올 최대 메일 수 (서버리스 실행 시간 제한 대비) */
export const MAX_FETCH = 30;

export function newMessageId(code: string | null): string {
  const rand = randomBytes(6).toString("hex");
  return `<aidd-${(code ?? "sys").toLowerCase()}-${Date.now()}-${rand}@ax-aidd.local>`;
}

export async function sendViaGmail(cfg: MailConfig, mail: OutgoingMail, messageId: string): Promise<void> {
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: cfg.gmailAddress, pass: cfg.appPassword },
  });
  await transporter.sendMail({
    from: `AX_AIDD 시스템 <${cfg.gmailAddress}>`,
    to: mail.to.join(", "),
    subject: mail.subject,
    text: mail.text,
    messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.inReplyTo,
    attachments: mail.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType ?? "text/markdown; charset=utf-8",
    })),
  });
}

/**
 * Gmail 받은편지함에서 새 메일을 가져온다.
 * 처음에는 최근 N일, 이후에는 마지막으로 본 UID 다음부터 가져온다.
 */
export async function fetchViaImap(cfg: MailConfig, prev: FetchState): Promise<FetchResult> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: cfg.gmailAddress, pass: cfg.appPassword },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const box = client.mailbox;
    const uidValidity = box && typeof box === "object" ? String(box.uidValidity) : null;
    const fresh = prev.uidValidity === null || prev.uidValidity !== uidValidity;

    let uids: number[];
    if (fresh) {
      const since = new Date(Date.now() - cfg.initialLookbackDays * 86_400_000);
      uids = ((await client.search({ since }, { uid: true })) || []) as number[];
    } else {
      uids = ((await client.search({ uid: `${prev.lastUid + 1}:*` }, { uid: true })) || []) as number[];
      uids = uids.filter((u) => u > prev.lastUid);
    }
    uids.sort((a, b) => a - b);
    const batch = uids.slice(0, MAX_FETCH);

    const mails: InboundMail[] = [];
    let lastUid = fresh ? 0 : prev.lastUid;
    if (batch.length > 0) {
      for await (const msg of client.fetch(batch.join(","), { uid: true, source: true }, { uid: true })) {
        lastUid = Math.max(lastUid, msg.uid);
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        mails.push(fromParsed(parsed));
      }
    } else if (fresh) {
      // 새 메일이 없으면 현재 UIDNEXT 직전을 기준으로 삼는다
      const next = box && typeof box === "object" ? Number(box.uidNext) : 1;
      lastUid = Math.max(0, next - 1);
    }
    return { mails, state: { uidValidity, lastUid } };
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
}

type Parsed = Awaited<ReturnType<typeof import("mailparser").simpleParser>>;

function addressText(a: Parsed["from"] | Parsed["to"]): string {
  if (!a) return "";
  const list = Array.isArray(a) ? a : [a];
  return list.map((x) => x.text).join(", ");
}

function fromParsed(p: Parsed): InboundMail {
  const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  const text = (p.text ?? "").slice(0, MAX_TEXT);
  return {
    messageId: p.messageId ?? null,
    inReplyTo: p.inReplyTo ?? null,
    references: refs,
    from: addressText(p.from),
    to: addressText(p.to),
    subject: p.subject ?? "",
    text,
    date: p.date ?? new Date(),
    attachments: (p.attachments ?? []).map((a): InboundAttachment => {
      const filename = a.filename ?? "attachment";
      const contentType = a.contentType ?? "";
      const isText = /\.(md|markdown|txt)$/i.test(filename) || contentType.startsWith("text/");
      return {
        filename,
        contentType,
        size: a.size ?? a.content.length,
        content: isText ? a.content.toString("utf8").slice(0, MAX_ATTACHMENT_TEXT) : null,
      };
    }),
  };
}
