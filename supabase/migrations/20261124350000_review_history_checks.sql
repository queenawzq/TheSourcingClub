-- Staff verification, simpler: the review history also lists staff's own
-- results on the address, factory-or-trader and licence checks, and each
-- decision (approved, declined, asked for more information), so a supervisor
-- can see who decided what.
--
-- Additive: one wider check constraint and two triggers. Nothing existing is
-- recreated; admin_review_changes() already returns every row.

alter table public.org_review_changes drop constraint if exists org_review_changes_kind_check;
alter table public.org_review_changes add constraint org_review_changes_kind_check
  check (kind in ('registry_check', 'certificate_check', 'vendor_kind', 'address',
                  'address_check', 'scope_check', 'licence_check', 'decision'));

-- A staff result on the address, scope or licence check (admin_record_signal).
create or replace function public.log_staff_check_result()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.org_review_changes (org_id, kind, subject_id, details, changed_by, changed_at)
  values (new.org_id, new.kind || '_check', new.id,
          jsonb_strip_nulls(jsonb_build_object('result', new.result, 'note', new.note)),
          new.checked_by, new.checked_at);
  return null;
end;
$$;
revoke all on function public.log_staff_check_result() from public, anon, authenticated;

drop trigger if exists verification_signals_staff_history on public.verification_signals;
create trigger verification_signals_staff_history
  after insert on public.verification_signals
  for each row when (not new.automatic and new.kind in ('address', 'scope', 'licence'))
  execute function public.log_staff_check_result();

-- A decision on the review, whichever function made it.
create or replace function public.log_review_decision()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.state in ('approved', 'declined', 'needs_information')
     and (tg_op = 'INSERT' or old.state is distinct from new.state) then
    insert into public.org_review_changes (org_id, kind, details, changed_by, changed_at)
    values (new.org_id, 'decision', jsonb_build_object('state', new.state::text),
            coalesce(new.decided_by, auth.uid()), clock_timestamp());
  end if;
  return null;
end;
$$;
revoke all on function public.log_review_decision() from public, anon, authenticated;

drop trigger if exists org_reviews_decision_history on public.org_reviews;
create trigger org_reviews_decision_history
  after insert or update of state on public.org_reviews
  for each row execute function public.log_review_decision();
