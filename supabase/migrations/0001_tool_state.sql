-- Phase 1: generic per-user cloud-state table for every stateful tool.
-- One row per (user, tool, item) — 'default' item_id for single-blob tools;
-- a doc/note id for tools that manage multiple independent items (e.g.
-- markdown-editor's documents). See plan.md's Contract section for the
-- full design rationale — this file is applied manually by the user via
-- the Supabase SQL editor or CLI (no live DB in this dev/CI environment).

create table tool_state (
  user_id    uuid not null references auth.users(id) on delete cascade,
  tool_id    text not null,
  item_id    text not null,             -- 'default' for single-blob tools; a doc/note id otherwise
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, tool_id, item_id)
);

alter table tool_state enable row level security;

create policy "select own rows" on tool_state
  for select using (auth.uid() = user_id);
create policy "insert own rows" on tool_state
  for insert with check (auth.uid() = user_id);
create policy "update own rows" on tool_state
  for update using (auth.uid() = user_id);
create policy "delete own rows" on tool_state
  for delete using (auth.uid() = user_id);
