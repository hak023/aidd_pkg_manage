import { beforeEach, describe, expect, it } from "vitest";
import { createHandle, migrate, setHandleForTest } from "@/lib/db/client";
import { MIGRATIONS } from "@/lib/db/migrations";
import {
  createNode,
  deleteNode,
  getItemDetail,
  listTree,
  moveNode,
  renameNode,
  setStageStatus,
  updateItemFields,
} from "@/lib/repo/tree";

beforeEach(async () => {
  const h = await createHandle({ url: "", pgliteDir: "memory://" });
  await migrate(h);
  setHandleForTest(h);
});

async function seed() {
  const svc = await createNode({ type: "service", name: "통화매니저", parentId: null });
  const lbl = await createNode({ type: "label", name: "R181PKG_26.12", parentId: svc.id });
  const item = await createNode({
    type: "item",
    name: "통화매니저 SSO 로그인 기능 개발",
    parentId: lbl.id,
    fields: { keywords: "SSO, 로그인" },
  });
  return { svc, lbl, item };
}

describe("트리 저장소", () => {
  it("TC-P1-12 마이그레이션은 두 번 실행해도 안전", async () => {
    const h = await createHandle({ url: "", pgliteDir: "memory://" });
    expect(await migrate(h)).toEqual([
      "0001_init",
      "0002_mail",
      "0003_prd",
      "0004_docs",
      "0005_progress",
      "0006_demo_scope_accounts",
    ]);
    expect(await migrate(h)).toEqual([]);
  });

  it("TC-P1-28 0006 적용 시 기존 자료는 시연 데이터로, 이후 새 자료는 실제 데이터로 표시", async () => {
    const h = await createHandle({ url: "", pgliteDir: "memory://" });
    await h.exec("CREATE TABLE _migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());");
    for (const m of MIGRATIONS.filter((x) => x.id < "0006")) {
      await h.exec(m.sql);
      await h.query("INSERT INTO _migrations (id) VALUES ($1)", [m.id]);
    }
    await h.query("INSERT INTO nodes (type, name) VALUES ('service', '기존 서비스')");
    expect(await migrate(h)).toEqual(["0006_demo_scope_accounts"]);
    await h.query("INSERT INTO nodes (type, name) VALUES ('service', '새 서비스')");
    expect(await h.query("SELECT name, is_demo FROM nodes ORDER BY id")).toEqual([
      { name: "기존 서비스", is_demo: true },
      { name: "새 서비스", is_demo: false },
    ]);
  });

  it("TC-P1-13 생성: 코드 부여, 7단계 대기 상태, 생성 이력", async () => {
    const { item } = await seed();
    expect(item.item?.code).toBe("DEV-0001");
    const d = await getItemDetail(item.id);
    expect(d.path.service?.name).toBe("통화매니저");
    expect(d.path.label?.name).toBe("R181PKG_26.12");
    expect(Object.values(d.statuses).every((s) => s.status === "pending")).toBe(true);
    expect(d.currentStage).toBe("collect");
    expect(d.fields.keywords).toBe("SSO, 로그인");
    expect(d.events[0].message).toContain("DEV-0001");
  });

  it("TC-P1-14 코드는 삭제 후에도 재사용하지 않음", async () => {
    const { item, lbl } = await seed();
    await deleteNode(item.id);
    const next = await createNode({ type: "item", name: "두 번째", parentId: lbl.id });
    expect(next.item?.code).toBe("DEV-0002");
  });

  it("TC-P1-15 잘못된 배치는 거부", async () => {
    const { svc, item } = await seed();
    await expect(createNode({ type: "label", name: "x", parentId: null })).rejects.toThrow("최상위");
    await expect(createNode({ type: "item", name: "x", parentId: item.id })).rejects.toThrow();
    await expect(moveNode(svc.id, item.id)).rejects.toThrow();
    await expect(createNode({ type: "service", name: "   ", parentId: null })).rejects.toThrow("이름");
  });

  it("TC-P1-16 개발사항을 단위서비스 바로 아래로 이동 (Q-01)", async () => {
    const { svc, item } = await seed();
    await moveNode(item.id, svc.id);
    const d = await getItemDetail(item.id);
    expect(d.path.label).toBeNull();
    expect(d.path.service?.id).toBe(svc.id);
    expect(d.events.some((e) => e.kind === "moved")).toBe(true);
  });

  it("TC-P1-17 라벨링을 다른 단위서비스로 옮기면 하위 개발사항도 함께 이동", async () => {
    const { lbl, item } = await seed();
    const svc2 = await createNode({ type: "service", name: "다른서비스", parentId: null });
    await moveNode(lbl.id, svc2.id);
    expect((await getItemDetail(item.id)).path.service?.name).toBe("다른서비스");
  });

  it("TC-P1-18 삭제는 하위 항목까지 함께", async () => {
    const { svc } = await seed();
    expect(await deleteNode(svc.id)).toBe(3);
    expect(await listTree()).toHaveLength(0);
  });

  it("TC-P1-19 단계 상태: 순서 강제 없음, 완료 처리, 이력", async () => {
    const { item } = await seed();
    await setStageStatus(item.id, "qa", "done");
    let d = await getItemDetail(item.id);
    expect(d.statuses.qa.status).toBe("done");
    expect(d.currentStage).toBe("collect");

    await setStageStatus(item.id, "done", "done");
    d = await getItemDetail(item.id);
    expect(d.completedAt).not.toBeNull();
    expect(d.currentStage).toBe("done");

    await setStageStatus(item.id, "done", "pending");
    d = await getItemDetail(item.id);
    expect(d.completedAt).toBeNull();
    expect(d.events.filter((e) => e.kind === "stage")).toHaveLength(3);
  });

  it("TC-P1-20 이름 변경과 수집 조건 수정", async () => {
    const { item } = await seed();
    await renameNode(item.id, "  SSO   로그인 개발 ");
    await updateItemFields(item.id, { searchPeriod: "최근 3개월", memo: "IdP 확인" });
    const d = await getItemDetail(item.id);
    expect(d.name).toBe("SSO 로그인 개발");
    expect(d.fields.searchPeriod).toBe("최근 3개월");
    expect(d.fields.keywords).toBe("SSO, 로그인");
  });

  it("TC-P1-21 트리 목록에 개발사항 요약 포함", async () => {
    await seed();
    const nodes = await listTree();
    const it = nodes.find((n) => n.type === "item")!;
    expect(it.item?.currentStage).toBe("collect");
    expect(it.item?.lastEventAt).not.toBeNull();
  });
});
