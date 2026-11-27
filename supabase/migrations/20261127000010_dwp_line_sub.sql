-- Department heads who asked the LINE bot for personal alerts ("ผูก <department code>" in a 1:1 chat).
-- RLS on with no policies: only the line-notify Edge Function (service role) reads or writes it.
-- Safe to run more than once.
create table if not exists public.dwp_line_sub (
  line_user_id text not null,
  dept         text not null,
  created_at   timestamptz not null default now(),
  primary key (line_user_id, dept)
);
alter table public.dwp_line_sub enable row level security;
revoke all on public.dwp_line_sub from anon, authenticated;
