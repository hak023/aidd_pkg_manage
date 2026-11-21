import { describe, expect, it } from "vitest";
import { canPlace, placementError } from "@/lib/domain/tree";
import { currentStage } from "@/lib/domain/stages";
import { docFileName, formatDevCode, mailTag, parseDevCode } from "@/lib/domain/naming";
import { checkCredentials, createSessionToken, verifySessionToken } from "@/lib/auth";

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

describe("더미 로그인 토큰", () => {
  const cfg = { id: "admin", password: "pw", secret: "s".repeat(32), usingDevDefaults: false };
  it("TC-P1-10 계정 확인", () => {
    expect(checkCredentials(cfg, "admin", "pw")).toBe(true);
    expect(checkCredentials(cfg, "admin", "x")).toBe(false);
  });
  it("TC-P1-11 서명·만료·변조", async () => {
    const t = await createSessionToken(cfg);
    expect(await verifySessionToken(cfg, t)).toBe(true);
    expect(await verifySessionToken({ ...cfg, secret: "other".repeat(8) }, t)).toBe(false);
    expect(await verifySessionToken(cfg, t, Date.now() + 15 * 24 * 3600 * 1000)).toBe(false);
    expect(await verifySessionToken(cfg, t.slice(0, -2) + "xx")).toBe(false);
  });
});
