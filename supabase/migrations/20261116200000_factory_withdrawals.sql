-- ============================================================================
-- Withdrawals: the factory decides when its money leaves TSC
-- ----------------------------------------------------------------------------
-- A factory not paid through Stripe (Wise, PayPal, a bank transfer staff make)
-- used to be paid step by step, whenever staff pressed Pay on the board. Now an
-- approved step adds to the factory's balance, and nothing is sent until an
-- owner asks for it. Staff approve the request, and the provider pays it.
--
-- One figure, one source: `factory_withdrawable()` is the balance. The screen,
-- the request, staff's approval and the board all read it.
--
--   balance = approved pool earnings (confirmed, or released by a withdrawal)
--           - withdrawals requested, being paid, or paid
--
-- A payment joins the pool once, when it is approved for a factory paid by a
-- method it saved with TSC (`withdraws_from_balance()`), and stays in it
-- (`order_payments.withdrawal_pool`): a factory that
-- later switches to Stripe cannot have the same money paid by both. Pool
-- payments are never paid one by one again: a trigger refuses the old per-step
-- paths (Wise/PayPal attempts, mark paid by bank or Payoneer, Stripe's claim).
-- When withdrawals are paid, the oldest pool payments they cover in full are
-- marked released, so "Paid" on the order and on Payments stays true.
--
-- States: requested -> paying -> paid | failed ; requested -> declined |
-- cancelled ; paying -> requested (nothing was sent: the provider was short).
-- One open request (requested or paying) per company, enforced by an index.
--
-- Who: an owner requests and cancels; staff decline and claim; only the server
-- (service_role) records what a provider said. Every step notifies the whole
-- factory company. Nothing here is writable through the API: grant select and
-- nothing else.
--
-- Safe with the live site while applied: new table, new column, new
-- functions, and triggers that only refuse paths for pool payments.
-- ============================================================================

alter table public.order_payments add column withdrawal_pool boolean not null default false;

create table public.factory_withdrawals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  account_id uuid references public.factory_payout_accounts (id) on delete set null,
  -- The adapter that pays it. Decided by the database from the account, never
  -- taken from the browser. 'tazapay' is reserved for its adapter.
  provider text not null check (provider in ('wise', 'paypal', 'bank', 'tazapay')),
  status text not null default 'requested'
    check (status in ('requested', 'paying', 'paid', 'failed', 'declined', 'cancelled')),
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'USD',
  -- What the factory reads: "Bank of Ningbo ending 0154", or an email.
  paid_to text not null,
  -- The account's details as they were when asked: a change since is refused.
  paid_to_changed_at timestamptz,
  -- Recorded by the server from the provider's own answer.
  fee_cents bigint check (fee_cents is null or fee_cents >= 0),
  receives_minor bigint,
  receives_currency char(3),
  provider_ref text,
  attempt_key uuid not null unique default gen_random_uuid(),
  lease_until timestamptz,
  -- The sentence the factory reads (a decline's reason, a failure).
  reason text,
  -- What staff read: where an attempt is.
  staff_sentence text,
  requested_by uuid references auth.users (id) on delete set null,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  paid_at timestamptz,
  check ((status = 'paid') = (paid_at is not null)),
  check (status <> 'declined' or reason is not null)
);

create unique index factory_withdrawals_one_open on public.factory_withdrawals (org_id)
  where status in ('requested', 'paying');
create index factory_withdrawals_org_idx on public.factory_withdrawals (org_id, created_at desc);

alter table public.factory_withdrawals enable row level security;
create policy factory_withdrawals_read on public.factory_withdrawals
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());
revoke all on public.factory_withdrawals from public, anon, authenticated;
grant select on public.factory_withdrawals to authenticated;
grant select, insert, update on public.factory_withdrawals to service_role;
alter publication supabase_realtime add table public.factory_withdrawals;

-- ---------------------------------------------------------------------------
-- Joining the pool: approved, for a factory paid by a method saved with TSC
-- (Wise or bank, PayPal): it chose one over Stripe, or it has no active Stripe
-- account and its default is one. A factory with no method yet keeps the old
-- path until it saves one (then what it is owed joins, below): Stripe pays it
-- once its account is active (releaseOwedTo).
-- ---------------------------------------------------------------------------
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

create or replace function public.join_withdrawal_pool()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare factory uuid;
begin
  if new.withdrawal_pool or new.release_requested_at is null or new.state <> 'confirmed'
     or new.stripe_release_started or new.release_claimed_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.release_requested_at is not null then
    return new;
  end if;
  select o.factory_org_id into factory from public.production_orders o where o.id = new.order_id;
  if factory is null or not public.withdraws_from_balance(factory) then
    return new;
  end if;
  if exists (select 1 from public.provider_payouts x where x.payment_id = new.id and x.status in ('processing', 'paid')) then
    return new;
  end if;
  new.withdrawal_pool := true;
  return new;
end;
$$;
revoke all on function public.join_withdrawal_pool() from public, anon, authenticated;

create trigger order_payments_join_withdrawal_pool
  before insert or update of release_requested_at, state on public.order_payments
  for each row execute function public.join_withdrawal_pool();

-- Pool payments are paid only by a withdrawal. Released only by
-- record_withdrawal (it sets tsc.withdrawal_release for its own transaction).
create or replace function public.guard_withdrawal_pool()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.withdrawal_pool and not new.withdrawal_pool then
    raise exception 'a payment stays in the withdrawal balance' using errcode = '22023', hint = 'withdrawal_pool';
  end if;
  if old.withdrawal_pool and new.state = 'released' and old.state <> 'released'
     and coalesce(current_setting('tsc.withdrawal_release', true), '') <> 'on' then
    raise exception 'this payment is in the factory''s balance: it is paid when the factory withdraws'
      using errcode = '22023', hint = 'withdrawal_pool';
  end if;
  if old.withdrawal_pool and new.release_claimed_at is not null and old.release_claimed_at is null then
    raise exception 'this payment is in the factory''s balance: it is paid when the factory withdraws'
      using errcode = '22023', hint = 'withdrawal_pool';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_withdrawal_pool() from public, anon, authenticated;

create trigger order_payments_guard_withdrawal_pool
  before update on public.order_payments
  for each row execute function public.guard_withdrawal_pool();

create or replace function public.guard_provider_payout_pool()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.order_payments p where p.id = new.payment_id and p.withdrawal_pool) then
    raise exception 'this payment is in the factory''s balance: it is paid when the factory withdraws'
      using errcode = '22023', hint = 'withdrawal_pool';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_provider_payout_pool() from public, anon, authenticated;

create trigger provider_payouts_guard_pool
  before insert on public.provider_payouts
  for each row execute function public.guard_provider_payout_pool();

-- What is owed and not started joins the pool: today, and whenever a factory
-- saves a default it withdraws to.
create or replace function public.join_owed_to_pool(target_org uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.order_payments p set withdrawal_pool = true
    from public.production_orders o
   where o.id = p.order_id and o.factory_org_id = target_org
     and not p.withdrawal_pool
     and p.state = 'confirmed' and p.release_requested_at is not null
     and not p.stripe_release_started and p.release_claimed_at is null
     and public.withdraws_from_balance(target_org)
     and not exists (select 1 from public.provider_payouts x where x.payment_id = p.id and x.status in ('processing', 'paid'));
$$;
revoke all on function public.join_owed_to_pool(uuid) from public, anon, authenticated;

create or replace function public.join_owed_on_method()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_primary then
    perform public.join_owed_to_pool(new.org_id);
  end if;
  return null;
end;
$$;
revoke all on function public.join_owed_on_method() from public, anon, authenticated;

create trigger factory_payout_accounts_join_owed
  after insert or update of is_primary, method on public.factory_payout_accounts
  for each row execute function public.join_owed_on_method();

create or replace function public.join_owed_on_route()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.join_owed_to_pool(new.org_id);
  return null;
end;
$$;
revoke all on function public.join_owed_on_route() from public, anon, authenticated;

create trigger factory_payout_preferences_join_owed
  after insert or update on public.factory_payout_preferences
  for each row execute function public.join_owed_on_route();

select public.join_owed_to_pool(id) from public.orgs where type = 'factory';

-- ---------------------------------------------------------------------------
-- The balance. Internal: callers below check who is asking first.
-- ---------------------------------------------------------------------------
create or replace function public.factory_withdrawable(target_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select sum(p.amount_cents) from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and p.withdrawal_pool and p.currency = 'USD'
       and p.state in ('confirmed', 'released')
  ), 0)::bigint - coalesce((
    select sum(w.amount_cents) from public.factory_withdrawals w
     where w.org_id = target_org and w.currency = 'USD' and w.status in ('requested', 'paying', 'paid')
  ), 0)::bigint;
$$;
revoke all on function public.factory_withdrawable(uuid) from public, anon, authenticated;
grant execute on function public.factory_withdrawable(uuid) to service_role;

-- What the payouts page reads: the balance, and the open request.
create or replace function public.my_withdrawal_balance(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'available_cents', greatest(public.factory_withdrawable(target_org), 0),
    'currency', 'USD',
    'pool', exists (select 1 from public.order_payments p join public.production_orders o on o.id = p.order_id
                     where o.factory_org_id = target_org and p.withdrawal_pool)
  );
end;
$$;
revoke all on function public.my_withdrawal_balance(uuid) from public, anon;
grant execute on function public.my_withdrawal_balance(uuid) to authenticated;

-- Which adapter pays an account.
create or replace function public.withdrawal_provider_for(a public.factory_payout_accounts)
returns text
language sql
immutable
as $$
  select case
    when a.method = 'paypal' then 'paypal'
    when a.method = 'bank' and a.wise_recipient_type is not null then 'wise'
    when a.method = 'bank' then 'bank'
  end;
$$;
revoke all on function public.withdrawal_provider_for(public.factory_payout_accounts) from public, anon, authenticated;

create or replace function public.withdrawal_notice(w public.factory_withdrawals, title text, body text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
  values (w.org_id, case when w.status = 'paid' then 'funds_released' else 'withdrawal' end,
          'withdrawal', w.id, title, body,
          jsonb_build_object('amount_cents', w.amount_cents, 'currency', w.currency,
                             'fee_cents', w.fee_cents, 'receives_minor', w.receives_minor,
                             'receives_currency', w.receives_currency));
$$;
revoke all on function public.withdrawal_notice(public.factory_withdrawals, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Factory: request and cancel. Owners only.
-- ---------------------------------------------------------------------------
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
  -- One request at a time per company: two tabs queue here.
  perform 1 from public.orgs where id = target_org for update;
  if exists (select 1 from public.factory_withdrawals x where x.org_id = target_org and x.status in ('requested', 'paying')) then
    raise exception 'You already have a withdrawal waiting.' using errcode = '22023', hint = 'withdrawal_open';
  end if;
  if amount is null or amount <= 0 then
    raise exception 'Enter an amount to withdraw.' using errcode = '22023', hint = 'withdrawal_amount';
  end if;
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

create or replace function public.cancel_withdrawal(target_withdrawal uuid)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare w public.factory_withdrawals;
begin
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found or not public.is_org_owner(w.org_id) then
    raise exception 'Only a company owner can cancel a withdrawal.' using errcode = '42501', hint = 'withdraw_owner_only';
  end if;
  if w.status <> 'requested' then
    raise exception 'TSC has already started sending this, so it can no longer be cancelled.'
      using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  update public.factory_withdrawals set status = 'cancelled', decided_at = now(), updated_at = now()
   where id = w.id returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s cancelled', public.format_money(w.amount_cents, w.currency)),
    'The amount is back in your balance.');
  return w;
end;
$$;
revoke all on function public.cancel_withdrawal(uuid) from public, anon;
grant execute on function public.cancel_withdrawal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Staff: decline, claim, mark paid by bank. The staff test comes first.
-- ---------------------------------------------------------------------------
create or replace function public.decline_withdrawal(target_withdrawal uuid, why text)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.factory_withdrawals;
  said text := nullif(btrim(coalesce(why, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'deciding a withdrawal is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  if w.status <> 'requested' then
    raise exception 'only a waiting withdrawal can be declined' using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  if said is null or length(said) < 3 or length(said) > 300 then
    raise exception 'say why, in a sentence the factory will read' using errcode = '22023', hint = 'withdrawal_reason';
  end if;
  update public.factory_withdrawals
     set status = 'declined', reason = said, decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = w.id returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s declined', public.format_money(w.amount_cents, w.currency)),
    format('The amount is back in your balance. TSC''s reason: %s', said));
  return w;
end;
$$;
revoke all on function public.decline_withdrawal(uuid, text) from public, anon;
grant execute on function public.decline_withdrawal(uuid, text) to authenticated;

-- Approve: re-checks the balance and the account, then holds a lease while the
-- server calls the provider. Pressing again resumes the same attempt and key.
create or replace function public.claim_withdrawal(target_withdrawal uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.factory_withdrawals;
  a public.factory_payout_accounts;
  resumed boolean := false;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  perform 1 from public.orgs where id = w.org_id for update;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if w.status = 'paying' then
    if w.lease_until is not null and w.lease_until > now() then
      raise exception 'this is already being paid' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    resumed := true;
  elsif w.status <> 'requested' then
    raise exception 'this withdrawal is %', w.status using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  -- This request is counted in the balance, so what is left must not be negative.
  if public.factory_withdrawable(w.org_id) < 0 then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  select * into a from public.factory_payout_accounts x where x.id = w.account_id;
  if not found or a.details_changed_at is distinct from w.paid_to_changed_at
     or public.withdrawal_provider_for(a) is distinct from w.provider then
    raise exception 'this factory changed where it is paid' using errcode = '22023', hint = 'payout_changed';
  end if;
  update public.factory_withdrawals
     set status = 'paying', lease_until = now() + interval '90 seconds', updated_at = now(),
         decided_by = coalesce(decided_by, auth.uid()), decided_at = coalesce(decided_at, now())
   where id = w.id returning * into w;
  return jsonb_build_object(
    'withdrawal_id', w.id, 'key', w.attempt_key, 'resumed', resumed, 'provider', w.provider,
    'provider_ref', w.provider_ref, 'amount_cents', w.amount_cents, 'currency', w.currency,
    'org_id', w.org_id, 'account_id', a.id, 'paypal_email', a.paypal_email,
    'wise_recipient_id', a.wise_recipient_id, 'wise_currency', a.wise_currency
  );
end;
$$;
revoke all on function public.claim_withdrawal(uuid) from public, anon;
grant execute on function public.claim_withdrawal(uuid) to authenticated;

-- Released in order, as far as paid withdrawals cover them in full.
create or replace function public.release_withdrawn_payments(target_org uuid, by_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  paid bigint;
  covered bigint := 0;
  r record;
begin
  select coalesce(sum(amount_cents), 0) into paid from public.factory_withdrawals
   where org_id = target_org and status = 'paid' and currency = 'USD';
  perform set_config('tsc.withdrawal_release', 'on', true);
  for r in select p.id, p.amount_cents, p.state from public.order_payments p
             join public.production_orders o on o.id = p.order_id
            where o.factory_org_id = target_org and p.withdrawal_pool and p.currency = 'USD'
              and p.state in ('confirmed', 'released')
            order by p.release_requested_at, p.id
  loop
    covered := covered + r.amount_cents;
    exit when covered > paid;
    if r.state = 'confirmed' then
      update public.order_payments set state = 'released', released_at = now(), released_by = by_user,
             released_note = 'Withdrawn'
       where id = r.id;
      insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
      values (r.id, 'confirmed', 'released', by_user, 'admin');
    end if;
  end loop;
  perform set_config('tsc.withdrawal_release', '', true);
end;
$$;
revoke all on function public.release_withdrawn_payments(uuid, uuid) from public, anon, authenticated;

-- What a provider said. Server only.
--   sent      the provider has it (ref kept), still paying
--   paid      done: the factory is told the fee and what arrived
--   failed    nothing arrives; the amount is back in the balance
--   requeue   nothing was sent (short balance, refused before sending): back to waiting
create or replace function public.record_withdrawal(
  target_withdrawal uuid, outcome text,
  ref text default null, fee bigint default null, receives bigint default null,
  receives_in char(3) default null, sentence text default null
)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare w public.factory_withdrawals;
begin
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  if w.status in ('paid', 'failed', 'declined', 'cancelled') then
    return w;
  end if;
  update public.factory_withdrawals
     set provider_ref = coalesce(ref, provider_ref),
         fee_cents = coalesce(fee, fee_cents),
         receives_minor = coalesce(receives, receives_minor),
         receives_currency = coalesce(receives_in, receives_currency),
         staff_sentence = coalesce(sentence, staff_sentence),
         updated_at = now()
   where id = w.id returning * into w;
  if outcome = 'sent' then
    return w;
  elsif outcome = 'requeue' then
    if w.provider_ref is not null then
      raise exception 'the provider has this one: it cannot go back to waiting' using errcode = '22023';
    end if;
    -- A new key: the next press must not be answered with this attempt's refusal.
    update public.factory_withdrawals
       set status = 'requested', lease_until = null, attempt_key = gen_random_uuid(), updated_at = now()
     where id = w.id returning * into w;
  elsif outcome = 'paid' then
    update public.factory_withdrawals set status = 'paid', paid_at = now(), lease_until = null, updated_at = now()
     where id = w.id returning * into w;
    perform public.release_withdrawn_payments(w.org_id, w.decided_by);
    perform public.withdrawal_notice(w,
      format('%s paid out to you', public.format_money(w.amount_cents, w.currency)),
      case when w.fee_cents is not null and w.receives_minor is not null then
        format('Sent to %s. Fee %s; you receive %s.', w.paid_to, public.format_money(w.fee_cents, w.currency),
               public.format_money(w.receives_minor, coalesce(w.receives_currency, w.currency)))
      else format('Sent to %s.', w.paid_to) end);
  elsif outcome = 'failed' then
    update public.factory_withdrawals
       set status = 'failed', lease_until = null, reason = coalesce(sentence, 'This withdrawal did not go through.'), updated_at = now()
     where id = w.id returning * into w;
    perform public.withdrawal_notice(w,
      format('Withdrawal of %s did not go through', public.format_money(w.amount_cents, w.currency)),
      'The amount is back in your balance. Check your withdrawal method, then withdraw again.');
  else
    raise exception 'unknown outcome' using errcode = '22023';
  end if;
  return w;
end;
$$;
revoke all on function public.record_withdrawal(uuid, text, text, bigint, bigint, char, text) from public, anon, authenticated;
grant execute on function public.record_withdrawal(uuid, text, text, bigint, bigint, char, text) to service_role;

-- The bank adapter: staff sent it by bank themselves and say so with the
-- bank's reference. The factory reads the reference, so never a number.
create or replace function public.mark_withdrawal_paid_by_bank(target_withdrawal uuid, reference text, fee bigint default 0)
returns public.factory_withdrawals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  w public.factory_withdrawals;
  said text := nullif(btrim(coalesce(reference, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  if w.status <> 'requested' then
    raise exception 'only a waiting withdrawal can be marked paid' using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  if w.provider <> 'bank' then
    raise exception 'this withdrawal is paid through its provider' using errcode = '22023', hint = 'withdrawal_provider';
  end if;
  if said is null or length(said) < 3 or length(said) > 200 or said !~ '[[:alnum:]]' then
    raise exception 'enter the bank''s reference for this transfer' using errcode = '22023', hint = 'reference_required';
  end if;
  if public.payout_text_holds_number(w.org_id, said) then
    raise exception 'the factory can read this, so it cannot hold the account number' using errcode = '22023', hint = 'reference_holds_number';
  end if;
  if coalesce(fee, 0) < 0 or coalesce(fee, 0) >= w.amount_cents then
    raise exception 'the fee must be less than the amount' using errcode = '22023', hint = 'withdrawal_fee';
  end if;
  if public.factory_withdrawable(w.org_id) < 0 then
    raise exception 'the factory''s balance no longer covers this' using errcode = '22023', hint = 'withdrawal_over_balance';
  end if;
  update public.factory_withdrawals
     set status = 'paid', paid_at = now(), provider_ref = said, fee_cents = coalesce(fee, 0),
         receives_minor = w.amount_cents - coalesce(fee, 0), receives_currency = w.currency,
         decided_by = auth.uid(), decided_at = now(), updated_at = now()
   where id = w.id returning * into w;
  perform public.release_withdrawn_payments(w.org_id, auth.uid());
  perform public.withdrawal_notice(w,
    format('%s paid out to you', public.format_money(w.amount_cents, w.currency)),
    format('Sent by bank transfer to %s. Reference: %s', w.paid_to, said));
  return w;
end;
$$;
revoke all on function public.mark_withdrawal_paid_by_bank(uuid, text, bigint) from public, anon;
grant execute on function public.mark_withdrawal_paid_by_bank(uuid, text, bigint) to authenticated;

-- The board: open and recent withdrawals, each with its company's balance, and
-- the pool payments the per-step list must leave out.
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
        'balance_after_cents', public.factory_withdrawable(w.org_id)
      ) order by w.created_at desc)
      from public.factory_withdrawals w
      join public.orgs g on g.id = w.org_id
      left join public.factory_payout_accounts a on a.id = w.account_id
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

-- ---------------------------------------------------------------------------
-- Wise needs the account's number for a withdrawal being paid (from 20261108163459).
-- ---------------------------------------------------------------------------
create or replace function public.payout_wise_recipient(target_account uuid)
returns table (
  recipient_type text,
  currency text,
  number_key text,
  account_number text,
  details jsonb,
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
  -- New: a withdrawal waiting on, or being paid by, staff to this account is owed too, whichever
  -- of the company's accounts it is.
  if exists (select 1 from public.factory_withdrawals w where w.account_id = a.id and w.status in ('requested', 'paying')) then
    null;
  elsif not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      left join public.stripe_connect_accounts s on s.org_id = o.factory_org_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       and not (public.uses_stripe_payout(o.factory_org_id) and p.stripe_payment_intent_id is not null)
  ) then
    raise exception 'TSC does not owe this company a payout by hand, so its number stays hidden'
      using errcode = '22023', hint = 'reveal_not_owed';
  end if;
  if a.wise_recipient_type is null then
    raise exception 'this bank account was not set up for Wise'
      using errcode = '22023', hint = 'wise_not_set_up';
  end if;
  if not exists (select 1 from public.payout_account_numbers n where n.account_id = a.id) then
    raise exception 'no full account number is on file'
      using errcode = '22023', hint = 'no_number';
  end if;

  insert into public.payout_number_reveals
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email, how)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid()), 'sent_to_wise'
    from public.orgs o where o.id = a.org_id;

  return query select a.wise_recipient_type, a.wise_currency::text, a.wise_number_key,
    public.payout_number_plain(a.id), a.wise_details, a.details_changed_at;
end;
$$;
revoke all on function public.payout_wise_recipient(uuid) from public, anon;
grant execute on function public.payout_wise_recipient(uuid) to authenticated;
