-- ============================================================================
-- Staff's certificate check is what the factory reads about its certificate.
-- ----------------------------------------------------------------------------
-- admin_save_certificate_check (20261124300000) records Found / Expired /
-- Not found as a staff-only signal and leaves factory_certifications.status
-- as it was, so a factory whose GOTS staff found expired still read "GOTS
-- pending" on its own profile. A person's check now sets the status the
-- factory reads, when it is made: Found -> verified, Expired or Not found ->
-- rejected. Couldn't check changes nothing. The staff note stays staff-only.
-- Each change is written to matching_evidence_history with what set it.
--
-- Existing checks are applied once, and only where nothing came after them:
-- the certificate is still pending or unverified, the check is newer than its
-- file (a file replaced after the check was never seen by it), and no
-- document review came after the check. The history trigger is held for that
-- one update so it does not write "Claim submitted or updated" rows for it.
-- Additive: no signature changes.
-- ============================================================================

create or replace function public.certificate_check_sets_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  decided public.verification_status := case new.result
    when 'found' then 'verified'::public.verification_status
    when 'expired' then 'rejected'::public.verification_status
    when 'not_found' then 'rejected'::public.verification_status
  end;
  changed public.factory_certifications;
begin
  if new.kind <> 'certificate' or new.automatic or new.subject_id is null or decided is null then
    return new;
  end if;
  update public.factory_certifications c
     set status = decided
   where c.id = new.subject_id
     and c.org_id = new.org_id
     and c.status is distinct from decided
  returning * into changed;
  if changed.id is not null then
    insert into public.matching_evidence_history (org_id, evidence_id, evidence_type, decision, reviewer, note)
    values (changed.org_id, changed.id, 'certificate', decided::text, new.checked_by,
            format('Status set from the staff certificate check of %s', to_char(coalesce(new.checked_at, now()) at time zone 'UTC', 'YYYY-MM-DD')));
  end if;
  return new;
end;
$$;

revoke all on function public.certificate_check_sets_status() from public, anon, authenticated;

drop trigger if exists verification_signals_certificate_status on public.verification_signals;
create trigger verification_signals_certificate_status
  after insert on public.verification_signals
  for each row execute function public.certificate_check_sets_status();

-- Checks already recorded: the latest person's check per certificate, where nothing came after it.
create temporary table certificate_check_backfill as
select c.id, c.org_id, s.checked_by, s.checked_at,
       (case s.result when 'found' then 'verified' else 'rejected' end)::public.verification_status as decided
  from public.factory_certifications c
  join (
    select distinct on (v.subject_id) v.subject_id, v.org_id, v.result, v.checked_by, v.checked_at
      from public.verification_signals v
     where v.kind = 'certificate' and not v.automatic and v.subject_id is not null
       and v.result in ('found', 'expired', 'not_found', 'could_not_check')
     order by v.subject_id, v.checked_at desc
  ) s on s.subject_id = c.id and s.org_id = c.org_id
  left join public.documents d on d.id = c.document_id
 where s.result <> 'could_not_check'
   and c.status in ('pending', 'unverified')
   and s.checked_at >= coalesce(d.created_at, c.created_at)
   and (d.reviewed_at is null or d.reviewed_at <= s.checked_at)
   and c.status is distinct from (case s.result when 'found' then 'verified' else 'rejected' end)::public.verification_status;

alter table public.factory_certifications disable trigger matching_certificate_audit;

update public.factory_certifications c
   set status = b.decided
  from certificate_check_backfill b
 where c.id = b.id;

alter table public.factory_certifications enable trigger matching_certificate_audit;

insert into public.matching_evidence_history (org_id, evidence_id, evidence_type, decision, reviewer, note)
select b.org_id, b.id, 'certificate', b.decided::text, b.checked_by,
       format('Status set from the staff certificate check of %s', to_char(b.checked_at at time zone 'UTC', 'YYYY-MM-DD'))
  from certificate_check_backfill b;

drop table certificate_check_backfill;
