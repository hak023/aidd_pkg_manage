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
  {
    id: "0002_mail",
    sql: `
CREATE TABLE mails (
  id serial PRIMARY KEY,
  item_id integer REFERENCES dev_items(node_id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('out','in')),
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','simulated','matched','unmatched','ignored')),
  match_method text,
  message_id text,
  in_reply_to text,
  refs text NOT NULL DEFAULT '',
  from_addr text NOT NULL DEFAULT '',
  to_addrs text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body_text text NOT NULL DEFAULT '',
  simulated boolean NOT NULL DEFAULT false,
  mail_date timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mails_item_idx ON mails(item_id, mail_date);
CREATE INDEX mails_status_idx ON mails(status);
CREATE UNIQUE INDEX mails_dir_msgid_uq ON mails(direction, message_id) WHERE message_id IS NOT NULL;

CREATE TABLE mail_attachments (
  id serial PRIMARY KEY,
  mail_id integer NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL DEFAULT '',
  size integer NOT NULL DEFAULT 0,
  content text
);
CREATE INDEX mail_attachments_mail_idx ON mail_attachments(mail_id);

CREATE TABLE sim_inbox (
  id serial PRIMARY KEY,
  payload text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE TABLE app_state (
  key text PRIMARY KEY,
  value text NOT NULL
);
`,
  },
  {
    id: "0003_prd",
    sql: `
CREATE TABLE reviews (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES dev_items(node_id) ON DELETE CASCADE,
  mail_id integer REFERENCES mails(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('ok','failed')),
  provider text NOT NULL,
  model text NOT NULL DEFAULT '',
  source_text text NOT NULL DEFAULT '',
  result text,
  error text,
  answers text NOT NULL DEFAULT '{}',
  extra_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_item_idx ON reviews(item_id, id);

CREATE TABLE documents (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES dev_items(node_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('prd','arch','qa','arch_report','qa_report')),
  version integer NOT NULL,
  filename text NOT NULL,
  content text NOT NULL,
  source text NOT NULL CHECK (source IN ('llm','edit','mail')),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX documents_item_kind_ver_uq ON documents(item_id, kind, version);
`,
  },
  {
    id: "0004_docs",
    sql: `
ALTER TABLE documents
  ADD COLUMN source_mail_id integer REFERENCES mails(id) ON DELETE SET NULL,
  ADD COLUMN attachment_id integer REFERENCES mail_attachments(id) ON DELETE SET NULL,
  ADD COLUMN base_doc_id integer REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN prd_doc_id integer REFERENCES documents(id) ON DELETE SET NULL;
CREATE INDEX documents_attachment_idx ON documents(attachment_id);
ALTER TABLE mails ADD COLUMN suggestion text;
`,
  },
  {
    id: "0005_progress",
    sql: `
CREATE TABLE progress_reports (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES dev_items(node_id) ON DELETE CASCADE,
  mail_id integer REFERENCES mails(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('ok','failed')),
  provider text NOT NULL,
  model text NOT NULL DEFAULT '',
  source_text text NOT NULL DEFAULT '',
  milestones text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX progress_reports_item_idx ON progress_reports(item_id, id);
`,
  },
];
