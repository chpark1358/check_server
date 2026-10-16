-- Separate shared-database change requiring its own deployment approval.
-- Align an existing profiles_self_insert policy with the original bootstrap
-- migration: an authenticated user may provision only their own viewer profile.
-- If the profile is absent, an id-only INSERT policy would otherwise let the
-- user choose an elevated role. No existing profile or role is changed here.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and role = 'viewer'
);

commit;
notify pgrst, 'reload schema';
