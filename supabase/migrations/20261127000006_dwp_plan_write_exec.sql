-- Department Work Plan: everyone signed in reads the task list (key dwp:plan),
-- but only the executive account (finance = true) may change it.
create or replace function private.can_write_key(k text)
returns boolean language sql stable security definer set search_path to ''
as $$
  select k not in ('act2569', 'dwp:plan') or exists (
    select 1 from public.allowed_users u
    where u.email = lower(auth.jwt() ->> 'email') and u.finance
  );
$$;
revoke all on function private.can_write_key(text) from public;
grant execute on function private.can_write_key(text) to authenticated;

drop policy if exists "insert: editors" on public.shared_state;
drop policy if exists "update: editors" on public.shared_state;
create policy "insert: editors" on public.shared_state for insert to authenticated
  with check ((select private.is_allowed(true)) and private.can_see_key(key) and private.can_write_key(key));
create policy "update: editors" on public.shared_state for update to authenticated
  using ((select private.is_allowed(true)) and private.can_see_key(key))
  with check ((select private.is_allowed(true)) and private.can_see_key(key) and private.can_write_key(key));
