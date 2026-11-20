/**
 * 순서대로 한 번씩 적용되는 SQL 마이그레이션.
 * schema.ts를 바꾸면 여기에 새 항목을 추가한다 (기존 항목은 수정하지 않는다).
 * 서버리스 배포에서 파일 경로 문제를 피하려고 SQL을 코드에 직접 둔다.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_init",
    sql: `
CREATE TABLE nodes (
  id serial PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('service','label','item')),
  name text NOT NULL,
  parent_id integer REFERENCES nodes(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX nodes_parent_idx ON nodes(parent_id);

CREATE SEQUENCE dev_code_seq START 1;

CREATE TABLE dev_items (
  node_id integer PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  keywords text NOT NULL DEFAULT '',
  search_period text NOT NULL DEFAULT '',
  memo text NOT NULL DEFAULT '',
  completed_at timestamptz
);

CREATE TABLE stages (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES dev_items(node_id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX stages_item_stage_uq ON stages(item_id, stage);

CREATE TABLE events (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES dev_items(node_id) ON DELETE CASCADE,
  kind text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_item_idx ON events(item_id, created_at);
`,
  },
];
