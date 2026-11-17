-- ============================================================================
-- Factories banking in mainland China and Hong Kong withdraw through Tazapay
-- ----------------------------------------------------------------------------
-- 20261116300100 kept a factory whose default is a bank account Tazapay pays
-- (tazapay_pays_account(): CN or HK, no Wise recipient) on the per-step path,
-- because withdrawals had no Tazapay adapter. The adapter exists now
-- (api/_withdrawal-adapters.js), so such a factory withdraws like any other:
--
--  1. withdrawal_provider_for() names 'tazapay' for such an account. Before,
--     it said 'bank' (staff sent it by hand). A 'bank' withdrawal already
--     asked to such an account is still marked paid by bank by staff
--     (mark_withdrawal_paid_by_bank reads only the withdrawal's provider).
--  2. withdraws_from_balance() drops the carve-out: #115's rule again.
--  3. What such factories are owed joins their balance (join_owed_to_pool:
--     confirmed, approved, not started). A step with a per-step payout
--     already processing or paid finishes on its own and never joins. Setting
--     the flag on is never refused by the pool guard, so no trigger is
--     disabled (which would also lock order_payments while applied).
--  4. payout_tazapay_beneficiary() reads the number for a Tazapay withdrawal
--     waiting on, or being paid by, staff, as payout_wise_recipient() does for
--     Wise; for a single step it now also needs the step to be outside the
--     balance, since a step in the balance is paid only by a withdrawal.
--  5. The provider switch gains Tazapay, on: one row, 'china'. Tazapay pays
--     only accounts in mainland China and Hong Kong, so that one switch
--     covers every account it pays, whatever the company's own country.
--     Off: no new Tazapay account is saved (the switch trigger now also runs
--     when an account's bank country changes), request_withdrawal() refuses a
--     new Tazapay withdrawal (hint withdrawal_provider_off), and withdrawals
--     already asked for finish.
--  6. request_withdrawal() refuses a Tazapay account Tazapay could not pay
--     (tazapay_account_check(): details missing, a USCC not the company's),
--     as "Complete this withdrawal method first."
--  7. "Pay with Tazapay" on one step (claim_provider_payout) is refused for a
--     step in the balance by provider_payouts_guard_pool, unchanged; a step
--     whose per-step payout already started resumes as before.
--  8. Why a withdrawal failed, in the provider's own code, kept for staff only
--     (withdrawal_failure_codes; the board reads it through admin_withdrawals).
--     Never the webhook body, never an account number.
--  9. withdrawal_invoice_steps(): the steps a withdrawal pays, as the database
--     releases them, for the Tazapay invoice. Server only.
--
-- Safe with the live site while applied: replaces functions with the same
-- signatures, adds a check value, a switch row, a staff-only table and two
-- server-only functions, recreates one trigger with one more column, and sets
-- withdrawal_pool on steps no payout has started.
-- ============================================================================

-- 1. Which adapter pays an account.
create or replace function public.withdrawal_provider_for(a public.factory_payout_accounts)
returns text
language sql
immutable
as $$
  select case
    when a.method = 'paypal' then 'paypal'
    when a.method = 'bank' and a.wise_recipient_type is not null then 'wise'
    when public.tazapay_pays_account(a) then 'tazapay'
    when a.method = 'bank' then 'bank'
  end;
$$;
revoke all on function public.withdrawal_provider_for(public.factory_payout_accounts) from public, anon, authenticated;

-- 2. 20261116200000's rule, without 20261116300100's carve-out.
create or replace function public.withdraws_from_balance(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.uses_stripe_payout(target_org)
     and (exists (select 1 from public.factory_payout_preferences r where r.org_id = target_org and r.route = 'manual')
          or (not exists (select 1 from public.stripe_connect_accounts s where s.org_id = target_org and s.transfers_active)
              and exists (select 1 from public.factory_payout_accounts a
                           where a.org_id = target_org and a.is_primary and a.method in ('bank', 'paypal'))));
$$;
revoke all on function public.withdraws_from_balance(uuid) from public, anon, authenticated;

-- 3. What a Tazapay factory is owed and no payout has started joins its balance.
select public.join_owed_to_pool(x.org_id)
  from (select distinct a.org_id from public.factory_payout_accounts a
         where a.is_primary and public.tazapay_pays_account(a)) x;

-- 4. The number for Tazapay (from 20261115600100), with the open withdrawal.
create or replace function public.payout_tazapay_beneficiary(target_account uuid)
returns table (
  account_number text,
  account_name text,
  holder_name_local text,
  registration_number text,
  bank_name text,
  bank_country text,
  bank_code text,
  swift text,
  address_line1 text,
  address_city text,
  address_state text,
  address_postal_code text,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;

  select * into a from public.factory_payout_accounts x where x.id = target_account;
  if not found then
    raise exception 'that account does not exist' using errcode = 'P0002';
  end if;

  if public.is_org_member(a.org_id) then
    raise exception 'you belong to this company, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (
    select 1 from public.production_orders o
     where o.factory_org_id = a.org_id and public.is_org_member(o.brand_org_id)
  ) then
    raise exception 'your company has an order with this factory, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'reveal_brand_side';
  end if;
  -- New: a Tazapay withdrawal to this account, waiting on or being paid by staff.
  if exists (select 1 from public.factory_withdrawals w
              where w.account_id = a.id and w.provider = 'tazapay' and w.status in ('requested', 'paying')) then
    null;
  elsif not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       -- New: a step in the balance is paid only by a withdrawal.
       and not p.withdrawal_pool
       and not (public.uses_stripe_payout(o.factory_org_id) and p.stripe_payment_intent_id is not null)
  ) then
    raise exception 'TSC does not owe this company a payout by hand, so its number stays hidden'
      using errcode = '22023', hint = 'reveal_not_owed';
  end if;
  perform public.tazapay_account_check(a);

  insert into public.payout_number_reveals
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email, how)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid()), 'sent_to_tazapay'
    from public.orgs o where o.id = a.org_id;

  return query select public.payout_number_plain(a.id), a.account_name, a.holder_name_local, a.registration_number,
    a.bank_name, upper(a.bank_country::text), a.bank_code, a.swift, a.address_line1, a.address_city, a.address_state,
    a.address_postal_code, a.details_changed_at;
end;
$$;
revoke all on function public.payout_tazapay_beneficiary(uuid) from public, anon;
grant execute on function public.payout_tazapay_beneficiary(uuid) to authenticated;

-- 5. The switch: Tazapay, on, one row.
alter table public.payout_provider_settings
  drop constraint if exists payout_provider_settings_provider_check,
  add constraint payout_provider_settings_provider_check check (provider in ('paypal', 'wise', 'tazapay'));
insert into public.payout_provider_settings (provider, region, enabled) values ('tazapay', 'china', true)
on conflict (provider, region) do nothing;

-- Tazapay's one switch covers every account it pays (all in CN or HK).
create or replace function public.payout_provider_enabled(target_org uuid, which text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    case when which = 'tazapay'
      then (select s.enabled from public.payout_provider_settings s where s.provider = 'tazapay' and s.region = 'china')
      else (select s.enabled from public.payout_provider_settings s
             where s.provider = which and s.region = public.payout_region(target_org))
    end, true);
$$;
revoke all on function public.payout_provider_enabled(uuid, text) from public, anon, authenticated;

create or replace function public.payout_providers_for(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501', hint = 'payout_owner_only';
  end if;
  return jsonb_build_object(
    'region', public.payout_region(target_org),
    'paypal', public.payout_provider_enabled(target_org, 'paypal'),
    'wise', public.payout_provider_enabled(target_org, 'wise'),
    'tazapay', public.payout_provider_enabled(target_org, 'tazapay')
  );
end;
$$;
revoke all on function public.payout_providers_for(uuid) from public, anon, authenticated;
grant execute on function public.payout_providers_for(uuid) to authenticated;

-- A bank account moved into China or Hong Kong becomes a Tazapay account, so
-- the switch is checked on that change too. The function is unchanged.
drop trigger if exists factory_payout_accounts_provider_switch on public.factory_payout_accounts;
create trigger factory_payout_accounts_provider_switch
  before insert or update of method, wise_recipient_type, bank_country on public.factory_payout_accounts
  for each row execute function public.guard_payout_provider_switch();

-- 6. 20261117200000's request_withdrawal(), refusing a Tazapay account Tazapay can't pay.
create or replace function public.request_withdrawal(target_org uuid, amount bigint, target_account uuid)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
  w public.factory_withdrawals;
  which text;
  available bigint;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can withdraw.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  -- Two tabs asking at once are checked one after the other against the balance.
  perform 1 from public.orgs where id = target_org for update;
  if amount is null or amount <= 0 then
    raise exception 'Enter an amount to withdraw.' using errcode = '22023', hint = 'withdrawal_amount';
  end if;
  -- Net of every request still open, so several requests can never add up to more.
  available := public.factory_withdrawable(target_org);
  if amount > available then
    raise exception 'That is more than your balance.' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  select * into a from public.factory_payout_accounts x where x.id = target_account and x.org_id = target_org;
  if not found then
    raise exception 'Choose one of your saved withdrawal methods.' using errcode = '22023', hint = 'withdrawal_method';
  end if;
  which := public.withdrawal_provider_for(a);
  if which is null
     or (a.method = 'bank' and (nullif(btrim(a.account_name), '') is null or a.number_changed_at is null))
     or (a.method = 'paypal' and nullif(btrim(a.paypal_email), '') is null) then
    raise exception 'Complete this withdrawal method first.' using errcode = '22023', hint = 'withdrawal_method';
  end if;
  -- Staff switched this provider off for the company's region.
  if not public.payout_provider_enabled(target_org, which) then
    raise exception 'This withdrawal method is not available right now.' using errcode = '22023', hint = 'withdrawal_provider_off';
  end if;
  -- New: what Tazapay needs on the account (the same check as paying it).
  if which = 'tazapay' then
    begin
      perform public.tazapay_account_check(a);
    exception when sqlstate '22023' then
      raise exception 'Complete this withdrawal method first.' using errcode = '22023', hint = 'withdrawal_method';
    end;
  end if;
  if which = 'bank' and amount <= public.bank_payout_fee_cents() then
    raise exception 'this withdrawal is not more than the bank transfer fee, so nothing would arrive'
      using errcode = '22023', hint = 'fee_too_large';
  end if;
  insert into public.factory_withdrawals
    (org_id, account_id, provider, amount_cents, currency, paid_to, paid_to_changed_at, requested_by)
  values (target_org, a.id, which, amount, 'USD',
          case when a.method = 'paypal' then a.paypal_email
               else format('%s ending %s', coalesce(a.bank_name, 'Bank account'), a.account_number_last4) end,
          a.details_changed_at, auth.uid())
  returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s requested', public.format_money(w.amount_cents, w.currency)),
    format('To %s. TSC will send it after checking.', w.paid_to));
  return w;
end;
$$;
revoke all on function public.request_withdrawal(uuid, bigint, uuid) from public, anon;
grant execute on function public.request_withdrawal(uuid, bigint, uuid) to authenticated;

-- 8. The provider's failure code, for staff only. Written by the server.
create table if not exists public.withdrawal_failure_codes (
  withdrawal_id uuid primary key references public.factory_withdrawals (id) on delete cascade,
  provider text not null,
  -- A code such as PF020101: letters, digits and a little punctuation, never a sentence.
  code text not null check (code ~ '^[A-Za-z0-9_.:-]{1,40}$'),
  recorded_at timestamptz not null default now()
);
alter table public.withdrawal_failure_codes enable row level security;
-- No policy: nobody reads or writes it through the API. Staff read it in admin_withdrawals().
revoke all on public.withdrawal_failure_codes from public, anon, authenticated;

create or replace function public.record_withdrawal_failure_code(target_withdrawal uuid, failure_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.factory_withdrawals;
  said text := btrim(coalesce(failure_code, ''));
begin
  select * into w from public.factory_withdrawals x where x.id = target_withdrawal;
  if not found or w.status <> 'failed' or said !~ '^[A-Za-z0-9_.:-]{1,40}$' then
    return false;
  end if;
  -- Staff read it, so never a bank number, whatever the provider sent.
  if public.payout_text_holds_number(w.org_id, said) then
    return false;
  end if;
  insert into public.withdrawal_failure_codes (withdrawal_id, provider, code)
  values (w.id, w.provider, said)
  on conflict (withdrawal_id) do update set code = excluded.code, recorded_at = now();
  return true;
end;
$$;
revoke all on function public.record_withdrawal_failure_code(uuid, text) from public, anon, authenticated;
grant execute on function public.record_withdrawal_failure_code(uuid, text) to service_role;

-- The board (from 20261116200000), with the failure code.
create or replace function public.admin_withdrawals()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
        'balance_after_cents', public.factory_withdrawable(w.org_id),
        'failure_code', c.code
      ) order by w.created_at desc)
      from public.factory_withdrawals w
      join public.orgs g on g.id = w.org_id
      left join public.factory_payout_accounts a on a.id = w.account_id
      left join public.withdrawal_failure_codes c on c.withdrawal_id = w.id
     where w.status in ('requested', 'paying') or w.updated_at > now() - interval '30 days'
    ), '[]'::jsonb),
    'pool_payment_ids', coalesce((
      select jsonb_agg(p.id) from public.order_payments p where p.withdrawal_pool and p.state = 'confirmed'
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_withdrawals() from public, anon;
grant execute on function public.admin_withdrawals() to authenticated;

-- 9. The steps a withdrawal pays, for its invoice. release_withdrawn_payments()
-- releases the balance's steps oldest first, as far as the total paid covers
-- them, so a withdrawal pays the steps after those of the withdrawals ahead of
-- it: every paid one (in the order they were paid), then those being paid that
-- staff approved first. Nothing when the steps don't cover it.
create or replace function public.withdrawal_invoice_steps(target_withdrawal uuid)
returns table (payment_id uuid, order_number text, step_title text, amount_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  w public.factory_withdrawals;
  ahead bigint;
  pooled bigint;
  left_over bigint;
  take bigint;
  r record;
begin
  select * into w from public.factory_withdrawals x where x.id = target_withdrawal;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  select coalesce(sum(x.amount_cents), 0) into ahead
    from public.factory_withdrawals x
   where x.org_id = w.org_id and x.currency = w.currency and x.id <> w.id
     and x.status in ('paid', 'paying')
     and (coalesce(x.paid_at, 'infinity'::timestamptz), coalesce(x.decided_at, x.created_at), x.created_at, x.id)
       < (coalesce(w.paid_at, 'infinity'::timestamptz), coalesce(w.decided_at, w.created_at), w.created_at, w.id);
  select coalesce(sum(p.amount_cents), 0) into pooled
    from public.order_payments p
    join public.production_orders o on o.id = p.order_id
   where o.factory_org_id = w.org_id and p.withdrawal_pool and p.currency = w.currency
     and p.state in ('confirmed', 'released');
  if pooled - ahead < w.amount_cents then
    return;
  end if;
  left_over := w.amount_cents;
  for r in select p.id, p.amount_cents as cents, o.order_number as num, m.title as title
             from public.order_payments p
             join public.production_orders o on o.id = p.order_id
             left join public.order_milestones m on m.id = p.milestone_id
            where o.factory_org_id = w.org_id and p.withdrawal_pool and p.currency = w.currency
              and p.state in ('confirmed', 'released')
            order by p.release_requested_at, p.id
  loop
    exit when left_over <= 0;
    if ahead >= r.cents then
      ahead := ahead - r.cents;
      continue;
    end if;
    take := least(r.cents - ahead, left_over);
    ahead := 0;
    left_over := left_over - take;
    payment_id := r.id;
    order_number := r.num::text;
    step_title := coalesce(r.title, '')::text;
    amount_cents := take;
    return next;
  end loop;
end;
$$;
revoke all on function public.withdrawal_invoice_steps(uuid) from public, anon, authenticated;
grant execute on function public.withdrawal_invoice_steps(uuid) to service_role;
