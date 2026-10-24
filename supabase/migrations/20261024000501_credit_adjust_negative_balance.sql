-- ============================================================================
-- Staff can add credits to a company below zero
-- ----------------------------------------------------------------------------
-- A refunded pack takes its credits back even when they were already spent
-- (20261023000500), so a balance can be negative. admin_adjust_credits()
-- checked every adjustment against the balance, so staff could not add 100
-- to a company at -300: "this company has -300 credits; you cannot remove
-- 100". Only a removal is checked against the balance now; an addition is
-- always allowed.
--
-- Safe with the current site live: the same function, same signature and
-- grants, refusing less.
-- ============================================================================

create or replace function public.admin_adjust_credits(
  target_org uuid,
  amount     integer,
  reason     text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target  public.orgs;
  why     text := btrim(coalesce(reason, ''));
  balance integer;
begin
  if not public.is_platform_admin() then
    raise exception 'only TSC staff can adjust credits' using errcode = '42501';
  end if;

  select * into target from public.orgs where id = target_org for update;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if target.type <> 'factory' then
    raise exception 'credits are for factories; % is a brand', target.name using errcode = '22023';
  end if;

  if amount is null or amount = 0 or abs(amount) > 10000 then
    raise exception 'enter an amount between 1 and 10,000 credits' using errcode = '22023';
  end if;
  if length(why) < 5 or length(why) > 300 then
    raise exception 'give a reason the company will understand (5 to 300 characters)' using errcode = '22023';
  end if;

  -- Only a removal can take the balance below what the company has.
  balance := public.credit_balance(target_org);
  if amount < 0 and balance + amount < 0 then
    raise exception 'this company has % credits; you cannot remove %', balance, abs(amount)
      using errcode = '22023';
  end if;

  insert into public.credit_ledger (org_id, delta, reason, note, created_by)
  values (target_org, amount, 'admin_adjustment', why, auth.uid());

  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body)
  values (target_org, 'credits_adjusted', 'credits', target_org,
          case when amount > 0
               then format('TSC added %s credits', amount)
               else format('TSC removed %s credits', abs(amount)) end,
          why);

  return balance + amount;
end;
$$;

revoke all on function public.admin_adjust_credits(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;
