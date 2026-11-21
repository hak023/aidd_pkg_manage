import { describe, expect, it } from "vitest";
import { canPlace, placementError } from "@/lib/domain/tree";
import { currentStage } from "@/lib/domain/stages";
import { docFileName, formatDevCode, mailTag, parseDevCode } from "@/lib/domain/naming";
import {
  checkCredentials,
  createSessionToken,
  getAuthConfig,
  hashPassword,
  isLoginBlocked,
  recordLoginFailure,
  verifySessionToken,
} from "@/lib/auth";

describe("트리 배치 규칙", () => {
  it("TC-P1-01 단위서비스는 최상위에만", () => {
    expect(canPlace("service", null)).toBe(true);
    expect(canPlace("service", "service")).toBe(false);
  });
  it("TC-P1-02 라벨링은 단위서비스 아래에만", () => {
    expect(canPlace("label", "service")).toBe(true);
    expect(canPlace("label", null)).toBe(false);
    expect(canPlace("label", "label")).toBe(false);
  });
  it("TC-P1-03 개발사항은 라벨링 또는 단위서비스 아래 (Q-01)", () => {
    expect(canPlace("item", "label")).toBe(true);
    expect(canPlace("item", "service")).toBe(true);
    expect(canPlace("item", null)).toBe(false);
    expect(canPlace("item", "item")).toBe(false);
  });
  it("TC-P1-04 거부 사유 메시지", () => {
    expect(placementError("label", null)).toContain("단위서비스 아래");
  });
});

describe("현재 단계 (순서 강제 없음)", () => {
  it("TC-P1-05 완료되지 않은 첫 단계", () => {
    expect(currentStage({})).toBe("collect");
    expect(currentStage({ collect: "done", review: "in_progress" })).toBe("review");
  });
  it("TC-P1-06 뒤 단계가 먼저 완료되어도 앞의 미완료 단계가 현재 단계", () => {
    expect(currentStage({ qa: "done" })).toBe("collect");
  });
  it("TC-P1-07 완료 단계가 완료면 done", () => {
    expect(currentStage({ done: "done" })).toBe("done");
  });
});

describe("이름 규칙", () => {
  it("TC-P1-08 개발사항 코드와 메일 태그", () => {
    expect(formatDevCode(1)).toBe("DEV-0001");
    expect(mailTag("DEV-0001")).toBe("[AX_AIDD][DEV-0001]");
    expect(parseDevCode("RE: [AX_AIDD][DEV-0012][수집요청] 통화매니저")).toBe("DEV-0012");
    expect(parseDevCode("FW: 설계서")).toBeNull();
  });
  it("TC-P1-09 문서 파일명", () => {
    expect(
      docFileName({ service: "통화매니저", label: "R181PKG_26.12", item: "통화매니저 SSO 로그인 기능 개발" }, "PRD"),
    ).toBe("통화매니저_R181PKG_26.12_통화매니저_SSO_로그인_기능_개발_PRD.md");
    expect(docFileName({ service: "통화매니저", label: null, item: "A/B 개선" }, "PRD")).toBe(
      "통화매니저_A_B_개선_PRD.md",
    );
  });
});

describe("로그인과 세션 토큰", () => {
  const legacy = getAuthConfig({
    NODE_ENV: "production",
    LOGIN_ID: "admin",
    LOGIN_PASSWORD: "pw",
    AUTH_SECRET: "s".repeat(32),
  } as NodeJS.ProcessEnv)!;
  it("TC-P1-10 계정 확인", async () => {
    expect(legacy.multiUser).toBe(false);
    expect((await checkCredentials(legacy, "admin", "pw"))?.id).toBe("admin");
    expect(await checkCredentials(legacy, "admin", "x")).toBeNull();
  });
  it("TC-P1-11 서명·만료·변조", async () => {
    const t = await createSessionToken(legacy, legacy.users[0]);
    expect((await verifySessionToken(legacy, t))?.id).toBe("admin");
    expect(await verifySessionToken({ ...legacy, secret: "other".repeat(8) }, t)).toBeNull();
    expect(await verifySessionToken(legacy, t, Date.now() + 15 * 24 * 3600 * 1000)).toBeNull();
    expect(await verifySessionToken(legacy, t.slice(0, -2) + "xx")).toBeNull();
  });

  it("TC-P1-23 다중 사용자: 해시 비밀번호로 로그인하고 비밀번호 변경·계정 삭제 시 세션 무효", async () => {
    const hashA = await hashPassword("alpha-pass-1");
    const hashB = await hashPassword("bravo-pass-2");
    const env = {
      NODE_ENV: "production",
      AUTH_SECRET: "s".repeat(32),
      AUTH_USERS: "alpha, Bravo, bad id!, nohash",
      USER_ALPHA_PASSWORD_HASH: hashA,
      USER_ALPHA_NAME: "알파",
      USER_ALPHA_GMAIL_ADDRESS: "alpha@example.com",
      USER_ALPHA_GMAIL_APP_PASSWORD: "aaaa bbbb cccc dddd",
      USER_ALPHA_COLLECT_TO_ADDRESS: "alpha-company@example.com",
      USER_BRAVO_PASSWORD_HASH: hashB,
    } as NodeJS.ProcessEnv;
    const cfg = getAuthConfig(env)!;
    expect(cfg.multiUser).toBe(true);
    expect(cfg.users.map((u) => u.id)).toEqual(["alpha", "bravo"]);
    expect(cfg.users[0].mail).toEqual({
      gmailAddress: "alpha@example.com",
      appPassword: "aaaabbbbccccdddd",
      collectTo: "alpha-company@example.com",
    });

    expect((await checkCredentials(cfg, "ALPHA", "alpha-pass-1"))?.name).toBe("알파");
    expect(await checkCredentials(cfg, "alpha", "bravo-pass-2")).toBeNull();
    expect(await checkCredentials(cfg, "nohash", "x")).toBeNull();

    const bravo = (await checkCredentials(cfg, "bravo", "bravo-pass-2"))!;
    const token = await createSessionToken(cfg, bravo);
    expect((await verifySessionToken(cfg, token))?.id).toBe("bravo");

    const changed = getAuthConfig({ ...env, USER_BRAVO_PASSWORD_HASH: await hashPassword("new-pass-3") })!;
    expect(await verifySessionToken(changed, token)).toBeNull();
    const removed = getAuthConfig({ ...env, AUTH_USERS: "alpha" })!;
    expect(await verifySessionToken(removed, token)).toBeNull();

    // 한 글자 숫자 ID도 사용할 수 있다 (USER_1_PASSWORD_HASH)
    const numeric = getAuthConfig({ ...env, AUTH_USERS: "1,2", USER_1_PASSWORD_HASH: hashA } as NodeJS.ProcessEnv)!;
    expect(numeric.users.map((u) => u.id)).toEqual(["1"]);
    expect((await checkCredentials(numeric, "1", "alpha-pass-1"))?.id).toBe("1");
  });

  it("TC-P1-24 로그인 실패 5회면 15분 차단", () => {
    const key = `tc-p1-24-${Date.now()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(isLoginBlocked(key, t0)).toBe(false);
      recordLoginFailure(key, t0);
    }
    expect(isLoginBlocked(key, t0 + 60_000)).toBe(true);
    expect(isLoginBlocked(key, t0 + 16 * 60_000)).toBe(false);
  });
});
