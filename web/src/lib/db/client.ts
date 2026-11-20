import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: DB;
  /** 여러 문장으로 된 SQL 실행 (마이그레이션용) */
  exec(sql: string): Promise<void>;
  /** 단일 문장 + 파라미터 */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

type GlobalWithDb = typeof globalThis & { __aiddDb?: Promise<DbHandle> };
const g = globalThis as GlobalWithDb;

/** DATABASE_URL이 있으면 Neon(HTTP), 없으면 PGlite(로컬 파일 또는 메모리). */
export async function createHandle(opts?: { url?: string; pgliteDir?: string }): Promise<DbHandle> {
  const url = opts?.url ?? process.env.DATABASE_URL;
  if (url && url.startsWith("postgres")) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const sql = neon(url);
    const db = drizzle(sql, { schema }) as unknown as DB;
    return {
      db,
      async exec(text) {
        for (const stmt of splitStatements(text)) await sql.query(stmt);
      },
      async query<T>(text: string, params: unknown[] = []) {
        return (await sql.query(text, params)) as T[];
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir =
    opts?.pgliteDir ?? process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (dir !== "memory://") {
    const fs = await import("node:fs/promises");
    await fs.mkdir(dir, { recursive: true });
  }
  const pg = dir === "memory://" ? new PGlite() : new PGlite(dir);
  const db = drizzle(pg, { schema }) as unknown as DB;
  return {
    db,
    async exec(text) {
      await pg.exec(text);
    },
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };
}

export function splitStatements(text: string): string[] {
  return text
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function migrate(h: DbHandle): Promise<string[]> {
  await h.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());",
  );
  const done = new Set((await h.query<{ id: string }>("SELECT id FROM _migrations")).map((r) => r.id));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await h.exec(m.sql);
    await h.query("INSERT INTO _migrations (id) VALUES ($1) ON CONFLICT DO NOTHING", [m.id]);
    applied.push(m.id);
  }
  return applied;
}

/** 앱 전역에서 하나의 DB 핸들을 쓴다 (개발 중 HMR에서도 유지). */
export function getHandle(): Promise<DbHandle> {
  if (!g.__aiddDb) {
    g.__aiddDb = (async () => {
      const h = await createHandle();
      await migrate(h);
      return h;
    })().catch((e) => {
      g.__aiddDb = undefined;
      throw e;
    });
  }
  return g.__aiddDb;
}

/** 테스트에서 메모리 DB를 주입할 때 사용 */
export function setHandleForTest(h: DbHandle | undefined) {
  g.__aiddDb = h ? Promise.resolve(h) : undefined;
}
