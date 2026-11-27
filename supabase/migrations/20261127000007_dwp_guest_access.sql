-- Work Plan app without a password: the page signs visitors in anonymously (Supabase anonymous sign-in).
-- Anonymous users reach only the Work Plan records (keys dwp:*), and cannot change the task list (dwp:plan).
-- Everything else (CEO dashboard, finance) still needs the team or staff password.
create or replace function private.is_guest()
returns boolean language sql stable set search_path to ''
as $$ select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $$;
revoke all on function private.is_guest() from public;
grant execute on function private.is_guest() to authenticated;

create policy "guest read: work plan" on public.shared_state for select to authenticated
  using ((select private.is_guest()) and key like 'dwp:%');
create policy "guest insert: work plan" on public.shared_state for insert to authenticated
  with check ((select private.is_guest()) and key like 'dwp:%' and key <> 'dwp:plan');
create policy "guest update: work plan" on public.shared_state for update to authenticated
  using ((select private.is_guest()) and key like 'dwp:%' and key <> 'dwp:plan')
  with check ((select private.is_guest()) and key like 'dwp:%' and key <> 'dwp:plan');
