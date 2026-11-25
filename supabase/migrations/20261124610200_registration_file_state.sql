-- Flow check R2S7: a company that replaces its licence is told the new file's own state.
--
-- Right after a replacement, the review step showed the OLD number with the old number's "already used by
-- another company", and later the new number with no warning although the new licence image was another
-- company's too (the photo check had flagged it, for staff only). The page could not tell whether the new
-- file had been read yet, nor see the file copy.
--
-- registration_file_state(target_org) answers, for the newest registration FILE only, never naming another
-- company:
--   read         the automatic reading of this file has been recorded;
--   numberRead   that reading set the number on file (apply_reading_number, China); false when the file was
--                unreadable or its number failed its check, so the number on file is not this file's;
--   copy         an exact copy of this file (photo_fingerprints.sha256) was uploaded earlier by another
--                company (two demo companies excepted, as in photo_copies); null until the file has a
--                fingerprint (the photo check runs a few seconds after the upload).
-- Additive: a new function, nothing else changes.

create or replace function public.registration_file_state(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  newest uuid;
  newest_at timestamptz;
  print text;
  reading jsonb;
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;
  select d.id, d.created_at into newest, newest_at
    from public.documents d
   where d.org_id = target_org and d.kind = 'business_registration'
   order by d.created_at desc
   limit 1;
  if newest is null then
    return jsonb_build_object('file', false, 'read', false, 'numberRead', false, 'copy', false);
  end if;
  select s.details into reading
    from public.verification_signals s
   where s.org_id = target_org and s.kind = 'document_reading' and s.automatic and s.subject_id = newest
   order by s.checked_at desc
   limit 1;
  select f.sha256 into print from public.photo_fingerprints f where f.document_id = newest;
  return jsonb_build_object(
    'file', true,
    'read', reading is not null,
    'numberRead', coalesce((reading ->> 'numberFromDocument')::boolean, false),
    'copy', case when print is null then null else exists (
      select 1
        from public.photo_fingerprints f
        join public.documents d on d.id = f.document_id
       where f.sha256 = print
         and f.org_id <> target_org
         and public.copy_group(d.kind::text) = 'license'
         and d.created_at <= newest_at
         and not (public.org_is_demo(target_org) and public.org_is_demo(f.org_id))
    ) end
  );
end;
$$;

revoke all on function public.registration_file_state(uuid) from public, anon;
grant execute on function public.registration_file_state(uuid) to authenticated;
