-- ============================================================================
-- One balance without webhooks; staff's "Balance after" is the one balance
-- ----------------------------------------------------------------------------
-- 1. payment_charge_checks: when the server last read a brand's charge from
--    Stripe (refund, dispute) outside a webhook. Balance reads check the few
--    least recently checked owed steps, so a refund or dispute whose event
--    never came still leaves the balance (record_charges_checked(), service
--    role). A table of its own, not a column on order_payments: the pages
--    re-read on every order_payments change, and a check is not a change.
-- 2. admin_withdrawals(): balance_after_cents is the factory's Available
--    (factory_balance()), not only what PayPal / Wise reach.
-- Safe with the live site while applied: a new table, a new function, one replaced function with its signature unchanged.
-- ============================================================================

create table if not exists public.payment_charge_checks (
  payment_id uuid primary key references public.order_payments (id) on delete cascade,
  checked_at timestamptz not null default now()
);
alter table public.payment_charge_checks enable row level security;
revoke all on public.payment_charge_checks from public, anon, authenticated, service_role;
grant select on public.payment_charge_checks to service_role;

create or replace function public.record_charges_checked(targets uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.payment_charge_checks (payment_id, checked_at)
  select t, now() from unnest(targets) t
  on conflict (payment_id) do update set checked_at = excluded.checked_at;
$$;
revoke all on function public.record_charges_checked(uuid[]) from public, anon, authenticated;
grant execute on function public.record_charges_checked(uuid[]) to service_role;

-- 20261120260000's admin_withdrawals(), with balance_after_cents from factory_balance().
CREATE OR REPLACE FUNCTION public.admin_withdrawals()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_platform_admin() then
    raise exception 'limited to platform staff' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'withdrawals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'org_id', w.org_id, 'factory_name', g.name, 'provider', w.provider, 'status', w.status,
        'amount_cents', w.amount_cents, 'currency', w.currency, 'paid_to', w.paid_to,
        'fee_cents', w.fee_cents, 'receives_minor', w.receives_minor, 'receives_currency', w.receives_currency,
        'provider_ref', w.provider_ref, 'reason', w.reason, 'staff_sentence', w.staff_sentence,
        'created_at', w.created_at, 'paid_at', w.paid_at, 'wise_currency', a.wise_currency,
        -- The factory's one balance left (what it could still withdraw by any
        -- road from TSC), not only what PayPal / Wise reach.
        'balance_after_cents', (public.factory_balance(w.org_id) ->> 'available_cents')::bigint,
        -- Whether approving would be refused (the same checks as
        -- claim_withdrawal and the takes guard), so the row says so first.
        'covered', w.status not in ('requested', 'paying') or public.withdrawal_covered(w)
      ) order by w.created_at desc)
      from public.factory_withdrawals w
      join public.orgs g on g.id = w.org_id
      left join public.factory_payout_accounts a on a.id = w.account_id
     where w.status in ('requested', 'paying') or w.updated_at > now() - interval '30 days'
    ), '[]'::jsonb),
    'pool_payment_ids', coalesce((
      select jsonb_agg(p.id) from public.order_payments p
       where p.state = 'confirmed'
         and (p.withdrawal_pool
              or exists (select 1 from public.payment_takes t where t.payment_id = p.id and t.status in ('held', 'sent')))
    ), '[]'::jsonb)
  );
end;
$function$;
