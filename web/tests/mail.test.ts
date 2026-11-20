import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createHandle, getHandle, migrate, setHandleForTest } from "@/lib/db/client";
import { mails } from "@/lib/db/schema";
import { getMailConfig } from "@/lib/mail/config";
import { composeCollectRequest, replyStartMarker, REPLY_END_MARKER } from "@/lib/mail/compose";
import { detectKind, isRelevant, matchMail, type InboundMail } from "@/lib/mail/match";
import {
  assignMail,
  getMail,
  ignoreMail,
  ingestMail,
  injectSample,
  listItemMails,
  listMailsByStatus,
  mailStatus,
  pollMail,
  previewCollectRequest,
  sendCollectRequest,
} from "@/lib/repo/mail";
import { createNode, deleteNode, getItemDetail } from "@/lib/repo/tree";

const target = {
  code: "DEV-0001",
  service: "통화매니저",
  label: "R181PKG_26.12",
  item: "통화매니저 SSO 로그인 기능 개발",
  keywords: "",
  searchPeriod: "",
  memo: "",
};

function inbound(p: Partial<InboundMail>): InboundMail {
  return {
    messageId: null,
    inReplyTo: null,
    references: [],
    from: "회사 <company@example.com>",
    to: "system@example.com",
    subject: "",
    text: "",
    date: new Date(),
    attachments: [],
    ...p,
  };
}

describe("수집 요청 메일 작성", () => {
  it("제목 태그·지침·회신 양식 표식을 포함", () => {
    const m = composeCollectRequest(target);
    expect(m.subject).toBe(
      "[AX_AIDD][DEV-0001][수집요청] 통화매니저 / R181PKG_26.12 / 통화매니저 SSO 로그인 기능 개발",
    );
    expect(m.text).toContain("메일 내용 회신내용 작성해줘");
    expect(m.text).toContain("[검색 키워드] 통화매니저 SSO 로그인 기능 개발"); // 키워드가 없으면 개발사항명
    expect(m.text).toContain("[검색 기간] 최근 6개월");
    expect(m.text).toContain(replyStartMarker("DEV-0001"));
    expect(m.text).toContain(REPLY_END_MARKER);
    expect(m.text).toContain("## 12. 참고 자료·출처");
  });

  it("라벨이 없으면 제목 경로에서 생략", () => {
    const m = composeCollectRequest({ ...target, label: null, keywords: "SSO", searchPeriod: "2026-06~" });
    expect(m.subject).toBe("[AX_AIDD][DEV-0001][수집요청] 통화매니저 / 통화매니저 SSO 로그인 기능 개발");
    expect(m.text).toContain("[검색 키워드] SSO");
    expect(m.text).toContain("[검색 기간] 2026-06~");
  });
});

describe("수신 메일 분류·매칭", () => {
  it("종류 판별: 제목 태그 > 본문 표식 > md 첨부", () => {
    expect(detectKind(inbound({ subject: "RE: [AX_AIDD][DEV-0001][수집요청] x" }))).toBe("collect_reply");
    expect(detectKind(inbound({ subject: "회신: [AX_AIDD][DEV-0001][진행상황요청] x" }))).toBe("progress_reply");
    expect(detectKind(inbound({ text: "<<<AX_AIDD_REPLY_START DEV-0003>>>" }))).toBe("collect_reply");
    expect(
      detectKind(inbound({ attachments: [{ filename: "a.md", contentType: "", size: 1, content: "x" }] })),
    ).toBe("doc_forward");
    expect(detectKind(inbound({ subject: "hello" }))).toBe("other");
  });

  it("매칭 우선순위: 태그 > 헤더 > 표식", () => {
    const lookup = (id: string) => (id === "<a@x>" ? "DEV-0002" : null);
    expect(matchMail(inbound({ subject: "[AX_AIDD][DEV-0001] FW: 설계서", inReplyTo: "<a@x>" }), lookup)).toEqual({
      code: "DEV-0001",
      method: "tag",
    });
    expect(matchMail(inbound({ subject: "RE: 제목 바뀜", inReplyTo: "a@x" }), lookup)).toEqual({
      code: "DEV-0002",
      method: "header",
    });
    expect(matchMail(inbound({ text: "<<<AX_AIDD_REPLY_START DEV-0009>>>" }), lookup)).toEqual({
      code: "DEV-0009",
      method: "marker",
    });
    expect(matchMail(inbound({ subject: "FW: 설계서" }), lookup)).toEqual({ code: null, method: null });
  });

  it("관계없는 Gmail 메일은 건너뜀 (태그·표식·회사 주소 발신만 기록)", () => {
    expect(isRelevant(inbound({ subject: "광고", from: "ad@shop.com" }), "company@example.com")).toBe(false);
    expect(
      isRelevant(inbound({ subject: "FW: 설계서", from: "Me <Company@Example.com>" }), "company@example.com"),
    ).toBe(true);
    expect(isRelevant(inbound({ subject: "[AX_AIDD][DEV-0001] x", from: "a@b.c" }), "company@example.com")).toBe(
      true,
    );
  });
});

describe("메일 저장소 (시뮬레이터)", () => {
  beforeEach(async () => {
    vi.stubEnv("SIMULATOR_MODE", "true");
    vi.stubEnv("COLLECT_TO_ADDRESS", "company@example.com");
    const h = await createHandle({ url: "", pgliteDir: "memory://" });
    await migrate(h);
    setHandleForTest(h);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedItem() {
    const svc = await createNode({ type: "service", name: "통화매니저", parentId: null });
    const lbl = await createNode({ type: "label", name: "R181PKG_26.12", parentId: svc.id });
    return createNode({ type: "item", name: "통화매니저 SSO 로그인 기능 개발", parentId: lbl.id });
  }

  it("config: SIMULATOR_MODE=true면 시뮬레이터, 운영에서 값이 없으면 설정 필요", () => {
    expect(getMailConfig().mode).toBe("simulator");
    vi.stubEnv("SIMULATOR_MODE", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GMAIL_ADDRESS", "");
    expect(getMailConfig().mode).toBe("unconfigured");
    vi.stubEnv("GMAIL_ADDRESS", "sys@example.com");
    vi.stubEnv("GMAIL_APP_PASSWORD", "abcd efgh ijkl mnop");
    const c = getMailConfig();
    expect(c.mode).toBe("gmail");
    expect(c.appPassword).toBe("abcdefghijklmnop");
  });

  it("1단계 전체 흐름: 발송 → 회신 주입 → 메일 확인 → 수집 완료, 검토 진행중", async () => {
    const item = await seedItem();
    const preview = await previewCollectRequest(item.id);
    expect(preview.to).toBe("company@example.com");

    const sent = await sendCollectRequest(item.id);
    expect(sent.status).toBe("simulated");
    expect(sent.to).toBe("company@example.com");
    let d = await getItemDetail(item.id);
    expect(d.statuses.collect.status).toBe("in_progress");

    await injectSample("collect_reply", item.id);
    expect((await mailStatus()).pendingSimulated).toBe(1);
    const r = await pollMail();
    expect(r).toMatchObject({ fetched: 1, stored: 1, matched: 1, unmatched: 0 });

    d = await getItemDetail(item.id);
    expect(d.statuses.collect.status).toBe("done");
    expect(d.statuses.review.status).toBe("in_progress");
    expect(d.currentStage).toBe("review");
    expect(d.events.some((e) => e.message.startsWith("수집 회신 수신"))).toBe(true);

    const list = await listItemMails(item.id);
    expect(list.map((m) => [m.direction, m.kind])).toEqual([
      ["in", "collect_reply"],
      ["out", "collect_request"],
    ]);
    const reply = await getMail(list[0].id);
    expect(reply.body).toContain("## 01. 관련자");
    expect(reply.matchMethod).toBe("tag");
    expect((await mailStatus()).pendingSimulated).toBe(0);
  });

  it("헤더 매칭: 제목 태그가 지워져도 In-Reply-To로 찾음", async () => {
    const item = await seedItem();
    const sent = await sendCollectRequest(item.id);
    const { db } = await getHandle();
    const [row] = await db.select().from(mails).where(eq(mails.id, sent.id));
    const res = await ingestMail(
      getMailConfig(),
      inbound({ messageId: "<r1@company>", subject: "RE: 태그 없음", inReplyTo: row.messageId, text: "회신" }),
      true,
    );
    expect(res).toBe("matched");
    const [m] = await listItemMails(item.id);
    expect(m.matchMethod).toBe("header");
  });

  it("같은 Message-ID는 한 번만 기록", async () => {
    const item = await seedItem();
    const code = (await getItemDetail(item.id)).code;
    const mail = inbound({ messageId: "<dup@x>", subject: `[AX_AIDD][${code}] FW: 설계서` });
    expect(await ingestMail(getMailConfig(), mail, true)).toBe("matched");
    expect(await ingestMail(getMailConfig(), mail, true)).toBe("skipped");
  });

  it("미분류함: 태그 없는 전달 메일 → 수동 지정 / 무시", async () => {
    const item = await seedItem();
    await injectSample("untagged_doc", null);
    await injectSample("untagged_doc", null);
    const r = await pollMail();
    expect(r.unmatched).toBe(2);
    const un = await listMailsByStatus("unmatched");
    expect(un).toHaveLength(2);
    expect(un[0].attachments[0]).toMatchObject({ filename: "설계서.md", isDoc: true });
    expect((await mailStatus()).unmatched).toBe(2);

    await assignMail(un[0].id, item.id);
    const assigned = await getMail(un[0].id);
    expect(assigned).toMatchObject({ status: "matched", matchMethod: "manual", itemId: item.id });
    expect(assigned.attachments[0].content).toContain("Architecture");
    expect((await getItemDetail(item.id)).events.some((e) => e.message.startsWith("문서 전달 메일 수신"))).toBe(
      true,
    );

    await ignoreMail(un[1].id);
    expect(await listMailsByStatus("unmatched")).toHaveLength(0);
    expect(await listMailsByStatus("ignored")).toHaveLength(1);
  });

  it("진행상황 회신은 진행상황 체크 단계를 완료", async () => {
    const item = await seedItem();
    await injectSample("progress_reply", item.id);
    await pollMail();
    expect((await getItemDetail(item.id)).statuses.progress.status).toBe("done");
  });

  it("개발사항을 삭제해도 메일 기록은 남음", async () => {
    const item = await seedItem();
    await sendCollectRequest(item.id);
    await deleteNode(item.id);
    const { db } = await getHandle();
    const rows = await db.select().from(mails);
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBeNull();
  });

  it("시뮬레이터가 아니면 샘플 주입 거부", async () => {
    vi.stubEnv("SIMULATOR_MODE", "false");
    vi.stubEnv("NODE_ENV", "production");
    await expect(injectSample("collect_reply", null)).rejects.toThrow(/시뮬레이터 모드/);
  });
});
