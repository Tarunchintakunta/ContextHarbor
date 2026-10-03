import pg from "pg";

export type Db = pg.Pool;

export function connect(url: string): Db {
  return new pg.Pool({ connectionString: url, max: 5, ssl: /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: true } : undefined });
}

// ponytail: idempotent schema on boot; switch to numbered migrations once tables need altering.
export const SCHEMA = `
create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text,
  role text not null check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  workspace_id uuid unique references workspaces(id),
  session_version int not null default 1,
  created_at timestamptz not null default now(),
  check ((role = 'member') = (workspace_id is not null))
);
create unique index if not exists users_single_admin on users ((true)) where role = 'admin';
create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_version int not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists invitations (
  token_hash text primary key,
  kind text not null check (kind in ('setup', 'member')),
  user_id uuid references users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  uploaded_by uuid not null references users(id),
  name text not null check (length(name) between 1 and 200),
  format text not null check (format in ('md', 'pdf', 'docx')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  sha256 text not null,
  state text not null check (state in ('ready', 'needs_review', 'failed', 'deleted')),
  warnings jsonb not null default '[]',
  reason text,
  pages int,
  text text,
  blob_key text,
  limitations_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists documents_dedupe on documents (workspace_id, sha256) where state <> 'deleted';
create index if not exists documents_workspace on documents (workspace_id, created_at desc);
create table if not exists upload_tickets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create table if not exists desktop_codes (
  code_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  challenge text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);
create table if not exists device_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  session_version int not null,
  label text not null default 'Desktop app',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create table if not exists audit_events (
  id bigserial primary key,
  actor uuid,
  action text not null,
  target text,
  at timestamptz not null default now()
);
`;

export async function migrate(db: Db) {
  await db.query(SCHEMA);
}
