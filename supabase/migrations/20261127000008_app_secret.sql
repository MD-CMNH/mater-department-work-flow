-- Server-side settings for the line-notify Edge Function (LINE alert group, cron token).
-- RLS on with no policies: browsers (anon / signed-in) cannot read it; the Edge Function uses the service role.
-- Safe to run more than once.
create table if not exists public.app_secret (
  name  text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_secret enable row level security;
revoke all on public.app_secret from anon, authenticated;
-- token the daily reminder job sends to the Edge Function; generated here, never shown
insert into public.app_secret (name, value)
values ('dwp_cron', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;
