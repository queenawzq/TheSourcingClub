-- Nov 12: admin_check_reason_for failed on every call with 42702
-- ("column reference written_for is ambiguous"): the parameter and the
-- column share a name. Same signature, the parameter now qualified.

create or replace function public.admin_check_reason_for(
  target_org  uuid,
  check_key   text,
  note        text,
  subject     uuid default null,
  written_for text default null
)
returns public.verification_check_reasons
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.verification_check_reasons;
  verdict text := nullif(trim(coalesce(admin_check_reason_for.written_for, '')), '');
begin
  -- admin_check_reason runs every staff test first.
  saved := public.admin_check_reason(target_org, check_key, note, subject);
  if saved.id is not null and verdict is not null then
    update public.verification_check_reasons r
       set written_for = left(verdict, 400)
     where r.id = saved.id
    returning r.* into saved;
  end if;
  return saved;
end;
$$;

revoke all on function public.admin_check_reason_for(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.admin_check_reason_for(uuid, text, text, uuid, text) to authenticated;
