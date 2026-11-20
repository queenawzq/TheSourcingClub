-- ============================================================================
-- A Stripe withdrawal's part goes back to the balance only from the call
-- that holds the withdrawal
-- ----------------------------------------------------------------------------
-- Staff's "Check again" and a call carrying the same withdrawal on could both
-- settle one part: one transfer it (after Stripe's key window, a new
-- transfer), the other hand it back, so the same money could be withdrawn
-- twice. Now:
--   lease_stripe_withdrawal()  staff's check takes the row's lease, in any
--                              state, or gets nothing while another call holds it
--   return_take_leased()       returns a part only when the caller holds the
--                              row's lease, or nobody does
--   return_take()              (older callers) refused while anyone holds it
-- Safe with the live site while applied: new functions, one replaced with
-- its signature unchanged.
-- ============================================================================

create or replace function public.lease_stripe_withdrawal(target uuid)
returns public.stripe_withdrawals
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.stripe_withdrawals s
     set lease_until = now() + interval '2 minutes', updated_at = now()
   where s.id = target and (s.lease_until is null or s.lease_until < now())
  returning *;
$$;
revoke all on function public.lease_stripe_withdrawal(uuid) from public, anon, authenticated;
grant execute on function public.lease_stripe_withdrawal(uuid) to service_role;

create or replace function public.return_take_leased(target_take uuid, lease timestamptz)
returns public.payment_takes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t public.payment_takes;
  s public.stripe_withdrawals;
begin
  select * into t from public.payment_takes where id = target_take;
  if not found or t.road <> 'stripe' then
    raise exception 'take not found' using errcode = 'P0002';
  end if;
  select * into s from public.stripe_withdrawals where id = t.stripe_withdrawal_id for update;
  if s.lease_until is not null and s.lease_until > now() and s.lease_until is distinct from lease then
    raise exception 'this withdrawal is being processed' using errcode = '22023', hint = 'withdrawal_busy';
  end if;
  update public.payment_takes set status = 'returned', updated_at = now()
   where id = t.id and status = 'held'
  returning * into t;
  if not found then
    select * into t from public.payment_takes where id = target_take;
  end if;
  return t;
end;
$$;
revoke all on function public.return_take_leased(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.return_take_leased(uuid, timestamptz) to service_role;

create or replace function public.return_take(target_take uuid)
returns public.payment_takes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A caller that cannot say it holds the withdrawal: only while nobody does.
  return public.return_take_leased(target_take, null);
end;
$$;
revoke all on function public.return_take(uuid) from public, anon, authenticated;
grant execute on function public.return_take(uuid) to service_role;
