-- Scope: shared database access controls, not a Preview-only setting.
-- The app writes generated_documents through service-role server APIs after
-- authentication/ownership checks. No browser workflow writes this table.
-- Client metadata writes could otherwise redirect a service-role download to
-- another object's path or change expiry. Admin deletion also belongs on a
-- server path so document metadata cannot be deleted without Storage cleanup.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

drop policy if exists "generated_documents_owner_or_admin_update" on public.generated_documents;
drop policy if exists "generated_documents_admin_delete" on public.generated_documents;
revoke insert, update, delete on table public.generated_documents from anon, authenticated;

-- Preserve the operator minimum while matching the server's owner/admin scope.
-- This does not grant viewers access to send history or change the table's data.
drop policy if exists "ticket_sends_operator_select" on public.ticket_sends;
create policy "ticket_sends_operator_select"
on public.ticket_sends
for select
to authenticated
using (
  public.current_profile_rank() >= 2
  and (sent_by = auth.uid() or public.current_profile_role() = 'admin')
);

commit;
notify pgrst, 'reload schema';
