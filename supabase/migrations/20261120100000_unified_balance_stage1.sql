-- ============================================================================
-- One balance for every factory, stage 1: approving a step makes it owed
-- ----------------------------------------------------------------------------
-- Until now an approved step left TSC at once: transferred to the factory's
-- Stripe account (api/_stripe.js releasePayment, asked for by the brand's
-- page), or moved into the withdrawal pool for PayPal, Wise and bank
-- (join_withdrawal_pool). Adding or switching a method moved owed money too
-- (join_owed_to_pool). Now approval only makes the money owed: it stays with
-- TSC, in the factory's one balance, and nothing moves until the factory
-- withdraws (stage 2 claims the steps at that moment, by one road).
--
--   1. order_payments.funds_available_at: when the brand's charge's money is
--      available on TSC's Stripe account (Stripe's available_on), recorded by
--      the server (record_payment_funds_available). Owed money still clearing
--      is Pending, not Available. A payment with no date counts as cleared
--      when it was not made through Stripe, or was confirmed over 7 days ago
--      (cards clear in about 2 business days), so no backfill is needed.
--   2. No pool join on approval or on adding a method: the three triggers go,
--      join_owed_to_pool() does nothing. Money already in the pool stays there
--      and is still withdrawn by PayPal, Wise or bank.
--   3. factory_balance(): the one balance, per factory and optionally per
--      brand: Awaiting approval, Available, Pending, Paid out, and Total as
--      their sum. Each dollar in exactly one. Stripe money already in the
--      factory's own Stripe account is added by the server, which reads Stripe
--      (api/stripe-connect.js `balance`).
--   4. The staff board and overview no longer count owed money waiting in a
--      balance as waiting on staff.
--   5. The factory's step-approved notification says the money was added to
--      its balance, and asks for a withdrawal method when it has none.
--
-- Safe with the live site while applied: one new nullable column, new
-- functions, dropped triggers, and replaced functions with their signatures
-- and return types unchanged. The live site's approval still asks
-- /api/stripe-release, which this deploy's server no longer lets transfer.
-- ============================================================================

-- 1. ---------------------------------------------------------------------------
alter table public.order_payments add column if not exists funds_available_at timestamptz;
comment on column public.order_payments.funds_available_at is
  'When the brand''s charge''s money is available on TSC''s Stripe account (Stripe balance_transaction.available_on). Recorded by the server. Null: see payment_clears_at().';

-- When a payment's money is available to pay out from. The one rule, used by
-- the balance and by stage 2's claim.
create or replace function public.payment_clears_at(p public.order_payments)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p.funds_available_at is not null then p.funds_available_at
    -- Not a Stripe charge (staff confirmed the money by hand): it is here.
    when p.stripe_charge_id is null then coalesce(p.confirmed_at, p.created_at)
    -- Recorded before the date was kept: a card clears in about 2 business days.
    else coalesce(p.confirmed_at, p.created_at) + interval '7 days'
  end;
$$;
revoke all on function public.payment_clears_at(public.order_payments) from public, anon, authenticated;

create or replace function public.payment_cleared(p public.order_payments)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select public.payment_clears_at(p) <= now();
$$;
revoke all on function public.payment_cleared(public.order_payments) from public, anon, authenticated;

-- The server records Stripe's date; nobody else can.
create or replace function public.record_payment_funds_available(target_payment uuid, available_at timestamptz)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.order_payments set funds_available_at = available_at
   where id = target_payment and available_at is not null
     and funds_available_at is distinct from available_at;
$$;
revoke all on function public.record_payment_funds_available(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_payment_funds_available(uuid, timestamptz) to service_role;

-- 2. ---------------------------------------------------------------------------
-- Approving no longer joins the pool, and neither does saving or choosing a
-- method. The trigger functions stay, unused, for the site live during the
-- deploy.
drop trigger if exists order_payments_join_withdrawal_pool on public.order_payments;
drop trigger if exists factory_payout_accounts_join_owed on public.factory_payout_accounts;
drop trigger if exists factory_payout_preferences_join_owed on public.factory_payout_preferences;

-- Called by choose_payout_method() and by the live site's releasePayment();
-- moving owed money when a default changes is exactly what stops here.
create or replace function public.join_owed_to_pool(target_org uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return;
end;
$$;
revoke all on function public.join_owed_to_pool(uuid) from public, anon, authenticated;
grant execute on function public.join_owed_to_pool(uuid) to service_role;

-- 3. ---------------------------------------------------------------------------
-- Whether a factory can withdraw: a Stripe account that takes transfers and
-- pays out, or a saved method request_withdrawal() accepts (complete, and its
-- provider switched on; a bank account staff pay by hand is not one).
create or replace function public.factory_can_withdraw(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.stripe_connect_accounts s
                  where s.org_id = target_org and s.transfers_active and s.payouts_enabled)
      or exists (select 1 from public.factory_payout_accounts a
                  where a.org_id = target_org
                    and public.withdrawal_provider_for(a) in ('wise', 'paypal')
                    and (a.method <> 'bank' or (nullif(btrim(a.account_name), '') is not null and a.number_changed_at is not null))
                    and (a.method <> 'paypal' or nullif(btrim(a.paypal_email), '') is not null)
                    and public.payout_provider_enabled_for_account(a, public.withdrawal_provider_for(a)));
$$;
revoke all on function public.factory_can_withdraw(uuid) from public, anon, authenticated;

-- The one balance. Every figure the factory reads comes from here (and, for
-- money already in its own Stripe account, from the server adding Stripe's).
--
--   Awaiting approval  funded, the brand has not approved it
--   Available          owed (approved, not sent) and cleared, nothing moving
--                      it; plus pool money no withdrawal has taken
--   Pending            owed and still clearing; owed and moving (a release or
--                      provider payout an earlier version started, still
--                      under way or failed and on the staff board); pool money
--                      in a requested or paying withdrawal
--   Paid out           sent: by a Stripe transfer, by bank or a provider per
--                      step, or by a paid withdrawal (less its fee)
--   Total              the four added up
--
-- USD only, like factory_withdrawable(). A client (brand org) narrows the
-- payments; withdrawal fees span clients, so only the whole balance carries
-- them. Pool payments count amount_cents, as factory_withdrawable() does, and
-- are split oldest first: what paid withdrawals took, then what open ones hold,
-- then the rest is available.
create or replace function public.factory_balance(target_org uuid, target_client uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  paid_left bigint;
  open_left bigint;
  fees bigint;
  amt bigint;
  take_paid bigint;
  take_open bigint;
  mine boolean;
  out_rows jsonb := '[]'::jsonb;
  awaiting bigint := 0;
  owed_cleared bigint := 0;
  owed_clearing bigint := 0;
  owed_moving bigint := 0;
  pool_available bigint := 0;
  pool_open bigint := 0;
  pool_paid bigint := 0;
  stripe_released bigint := 0;
  other_released bigint := 0;
  next_at timestamptz;
  available bigint;
  pending bigint;
  paid_out bigint;
begin
  if not (public.is_org_member(target_org) or public.is_platform_admin()) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;

  select coalesce(sum(w.amount_cents) filter (where w.status = 'paid'), 0),
         coalesce(sum(w.amount_cents) filter (where w.status in ('requested', 'paying')), 0),
         coalesce(sum(w.fee_cents) filter (where w.status = 'paid'), 0)
    into paid_left, open_left, fees
    from public.factory_withdrawals w
   where w.org_id = target_org and w.currency = 'USD';

  -- Pool money (P3: it stays pool money), split across every client first.
  for r in
    select p.id, p.amount_cents, o.brand_org_id
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and p.withdrawal_pool and p.currency = 'USD'
       and p.state in ('confirmed', 'released')
     order by (p.state = 'released') desc, p.release_requested_at, p.id
  loop
    amt := r.amount_cents;
    take_paid := least(amt, paid_left);
    paid_left := paid_left - take_paid;
    take_open := least(amt - take_paid, open_left);
    open_left := open_left - take_open;
    mine := target_client is null or r.brand_org_id = target_client;
    continue when not mine;
    pool_paid := pool_paid + take_paid;
    pool_open := pool_open + take_open;
    pool_available := pool_available + (amt - take_paid - take_open);
    if take_paid > 0 then
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.id, 'figure', 'paid_out', 'amount_cents', take_paid, 'stripe', false));
    end if;
    if take_open > 0 then
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.id, 'figure', 'pending', 'amount_cents', take_open, 'stripe', false));
    end if;
    if amt - take_paid - take_open > 0 then
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', r.id, 'figure', 'available', 'amount_cents', amt - take_paid - take_open, 'stripe', false));
    end if;
  end loop;
  -- Withdrawals beyond the pool's payments still left (or are leaving).
  if target_client is null then
    pool_paid := pool_paid + paid_left;
    pool_open := pool_open + open_left;
  end if;

  -- Everything else, payment by payment.
  for r in
    select p, o.status as order_status,
           (case when p.charged_cents is not null then p.amount_cents
                 else coalesce(p.amount_received_cents, p.amount_cents) end
            - coalesce(p.payout_fee_cents, 0))::bigint as factory_cents,
           (select x.status from public.provider_payouts x where x.payment_id = p.id
             order by x.created_at desc limit 1) as attempt_status
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
     where o.factory_org_id = target_org and not p.withdrawal_pool and p.currency = 'USD'
       and p.state in ('confirmed', 'released')
       and (target_client is null or o.brand_org_id = target_client)
       -- Held on a cancelled order: on its way back to the brand.
       and not (p.state = 'confirmed' and p.release_requested_at is null and o.status = 'cancelled')
       -- Refunded since it was confirmed: there is nothing to pay from.
       and not (p.state = 'confirmed' and p.refunded_at is not null
                and p.refunded_at > coalesce(p.confirmed_at, '-infinity'::timestamptz))
  loop
    if (r.p).state = 'released' then
      if (r.p).stripe_transfer_id is not null then
        stripe_released := stripe_released + r.factory_cents;
      else
        other_released := other_released + r.factory_cents;
      end if;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'paid_out',
        'amount_cents', r.factory_cents, 'stripe', (r.p).stripe_transfer_id is not null));
    elsif (r.p).release_requested_at is null then
      awaiting := awaiting + r.factory_cents;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'awaiting',
        'amount_cents', r.factory_cents, 'stripe', false));
    -- Moving, or staff's to settle (the board lists it): an earlier version's
    -- Stripe release, a claim, or a Wise / PayPal payout per step that is
    -- under way or failed. Not the factory's to withdraw meanwhile.
    elsif (r.p).stripe_release_started or (r.p).release_claimed_at is not null
          or r.attempt_status in ('processing', 'failed') then
      owed_moving := owed_moving + r.factory_cents;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'pending',
        'amount_cents', r.factory_cents, 'stripe', false));
    elsif public.payment_cleared(r.p) then
      owed_cleared := owed_cleared + r.factory_cents;
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'available',
        'amount_cents', r.factory_cents, 'stripe', false));
    else
      owed_clearing := owed_clearing + r.factory_cents;
      next_at := least(coalesce(next_at, public.payment_clears_at(r.p)), public.payment_clears_at(r.p));
      out_rows := out_rows || jsonb_build_array(jsonb_build_object('payment_id', (r.p).id, 'figure', 'pending',
        'amount_cents', r.factory_cents, 'stripe', false, 'clears_at', public.payment_clears_at(r.p)));
    end if;
  end loop;

  if target_client is not null then
    fees := 0;
  end if;
  available := owed_cleared + pool_available;
  pending := owed_clearing + owed_moving + pool_open;
  paid_out := stripe_released + other_released + pool_paid - fees;

  return jsonb_build_object(
    'currency', 'USD',
    'client', target_client,
    'awaiting_cents', awaiting,
    'available_cents', available,
    'pending_cents', pending,
    'paid_out_cents', paid_out,
    'total_cents', awaiting + available + pending + paid_out,
    'has_method', public.factory_can_withdraw(target_org),
    'next_cleared_at', next_at,
    'parts', jsonb_build_object(
      'owed_cleared_cents', owed_cleared,
      'owed_clearing_cents', owed_clearing,
      'owed_moving_cents', owed_moving,
      'pool_available_cents', pool_available,
      'pool_open_cents', pool_open,
      'pool_paid_cents', pool_paid,
      'withdrawal_fees_cents', fees,
      'stripe_released_cents', stripe_released,
      'other_released_cents', other_released),
    'rows', out_rows
  );
end;
$$;
revoke all on function public.factory_balance(uuid, uuid) from public, anon;
grant execute on function public.factory_balance(uuid, uuid) to authenticated, service_role;

-- 4. ---------------------------------------------------------------------------
-- The staff board: owed money in a balance waits on the factory. Staff still
-- see, first, a payout an earlier release or provider started (Retry settles
-- what Stripe did; a provider's failure needs a person). Same columns.
create or replace function public.admin_payment_board()
returns table (
  payment_id               uuid,
  state                    public.payment_state,
  amount_cents             bigint,
  fee_cents                bigint,
  charged_cents            bigint,
  currency                 char(3),
  order_id                 uuid,
  order_number             text,
  order_status             text,
  brand_name               text,
  factory_name             text,
  milestone_title          text,
  milestone_state          text,
  brand_reference          text,
  payment_method_label     text,
  failure_reason           text,
  stripe_payment_intent_id text,
  stripe_transfer_id       text,
  sent_at                  timestamptz,
  processing_at            timestamptz,
  failed_at                timestamptz,
  confirmed_at             timestamptz,
  release_requested_at     timestamptz,
  factory_stripe_ready     boolean,
  payout_summary           text,
  payout_method            text,
  payoneer_email           text,
  payoneer_payment_id      text,
  payout_account_id        uuid,
  payout_holder            text,
  payout_bank              text,
  payout_branch            text,
  payout_country           text,
  payout_swift             text,
  payout_instructions      text,
  payout_last4             text,
  payout_has_number        boolean,
  payout_number_kind       text,
  payout_changed_at        timestamptz,
  payout_changed_recently  boolean,
  contact_name             text,
  contact_email            text,
  contact_phone            text,
  last_viewed_by           text,
  last_viewed_at           timestamptz,
  paypal_email             text,
  wise_recipient_type      text,
  wise_currency            text,
  wise_recipient_id        text,
  wise_details             jsonb,
  provider                 text,
  provider_status          text,
  provider_ref             text,
  provider_failure_code    text,
  provider_at              timestamptz,
  refund_failed_at         timestamptz,
  refund_failure           text,
  stripe_release_started   boolean,
  brand_contact_name       text,
  brand_contact_email      text,
  brand_contact_phone      text,
  processing_fee_cents     bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this board is limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.state, p.amount_cents, public.payment_fee_cents(p.id), p.charged_cents, p.currency,
    o.id, o.order_number, o.status::text,
    b.name, f.name,
    m.title, m.state::text,
    p.brand_reference, p.payment_method_label,
    case when p.state = 'released' then refund.note else p.failure_reason end,
    p.stripe_payment_intent_id, p.stripe_transfer_id,
    p.sent_at, p.processing_at, p.failed_at, p.confirmed_at, p.release_requested_at,
    (p.stripe_transfer_id is not null or (p.state <> 'released' and public.uses_stripe_payout(o.factory_org_id))),
    case when a.method = 'payoneer' then 'Payoneer: ' || a.payoneer_email
         when a.method = 'paypal' then 'PayPal: ' || a.paypal_email else
    coalesce(nullif(concat_ws(' · ',
      nullif(btrim(a.account_name), ''),
      nullif(btrim(a.bank_name), ''),
      nullif(btrim(a.bank_country), ''),
      '····' || nullif(btrim(a.account_number_last4), ''),
      'SWIFT ' || nullif(btrim(a.swift), '')
    ), ''), 'no bank details on file') end,
    a.method, a.payoneer_email, sent.payoneer_payment_id,
    a.id, a.account_name, a.bank_name, a.branch, a.bank_country::text, a.swift, a.instructions,
    a.account_number_last4,
    a.number_changed_at is not null,
    num.number_kind,
    a.details_changed_at,
    coalesce(a.details_changed_at > now() - interval '14 days', false),
    contact.full_name, contact.email, phone.phone,
    viewed.staff_email, viewed.revealed_at,
    a.paypal_email, a.wise_recipient_type, a.wise_currency::text, a.wise_recipient_id, a.wise_details,
    attempt.provider, attempt.status, attempt.provider_ref, attempt.failure_code, attempt.updated_at,
    p.refund_failed_at, case when p.refund_failed_at is not null then staff_note.failure end,
    p.stripe_release_started,
    brand_contact.full_name, brand_contact.email, brand_phone.phone,
    public.processing_fee_cents(p)
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.stripe_connect_accounts sca on sca.org_id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  left join public.payout_account_numbers num on num.account_id = a.id
  left join public.payment_refund_staff_notes staff_note on staff_note.payment_id = p.id
  left join public.payoneer_payouts sent on sent.payment_id = p.id
  left join public.company_contact_details phone on phone.org_id = o.factory_org_id
  left join lateral (
    select coalesce(up.full_name, '') as full_name, u.email::text as email
      from public.org_members om
      join auth.users u on u.id = om.user_id
      left join public.user_profiles up on up.id = om.user_id
     where om.org_id = o.factory_org_id
     order by ('primaryContact' = any(om.permissions)) desc, (om.role = 'owner') desc, om.created_at
     limit 1
  ) contact on true
  left join public.company_contact_details brand_phone on brand_phone.org_id = o.brand_org_id
  left join lateral (
    select coalesce(up.full_name, '') as full_name, u.email::text as email
      from public.org_members om
      join auth.users u on u.id = om.user_id
      left join public.user_profiles up on up.id = om.user_id
     where om.org_id = o.brand_org_id
     order by ('primaryContact' = any(om.permissions)) desc, (om.role = 'owner') desc, om.created_at
     limit 1
  ) brand_contact on true
  left join lateral (
    select r.staff_email, r.revealed_at from public.payout_number_reveals r
     where r.account_id = a.id
     order by r.revealed_at desc
     limit 1
  ) viewed on true
  left join lateral (
    select e.note from public.payment_events e
     where p.state = 'released'
       and e.payment_id = p.id and e.from_state = 'released' and e.to_state = 'released'
       and e.note like '%' || format(' (Stripe %s)', p.stripe_payment_intent_id)
     order by e.created_at desc
     limit 1
  ) refund on true
  left join lateral (
    select x.provider, x.status, x.provider_ref, x.failure_code, x.updated_at
      from public.provider_payouts x
     where x.payment_id = p.id
     order by x.created_at desc
     limit 1
  ) attempt on true
  where p.state in ('sent', 'processing', 'failed', 'confirmed')
     or (p.state = 'released' and refund.note is not null)
  order by
    case p.state
      when 'sent' then 0
      -- Owed money waits in the factory's balance until it withdraws: staff
      -- act only on a payout an earlier release or provider started.
      when 'confirmed' then case when p.release_requested_at is not null and not p.withdrawal_pool
                                  and (p.stripe_release_started or attempt.status in ('processing', 'failed'))
                             then 1 else 3 end
      when 'released' then 1
      when 'failed' then 2
      else 4
    end,
    coalesce(p.release_requested_at, p.sent_at, p.failed_at, p.processing_at, p.confirmed_at);
end;
$$;

revoke all on function public.admin_payment_board() from public;
grant execute on function public.admin_payment_board() to authenticated;

-- The overview's payments card: what is waiting on staff. Owed money in a
-- balance is not; a payout an earlier release or provider started is, as are
-- withdrawals to approve and refunds Stripe refused. Same columns.
create or replace function public.admin_overview_metrics()
returns table (
  profiles_awaiting_review integer,
  rfqs_submitted_today     integer,
  quotes_submitted_today   integer,
  payments_awaiting_confirmation integer,
  profiles_submitted_today integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'these metrics are limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::integer from public.admin_verification_queue() q
      where q.state in ('ready_for_review', 'in_review', 'needs_information')),
    (select count(*)::integer from public.rfqs r
      where r.published_at >= date_trunc('day', now())),
    (select count(*)::integer from public.quotes q
      where q.submitted_at >= date_trunc('day', now())),
    (select count(*)::integer from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      where (p.state = 'confirmed' and p.release_requested_at is not null and not p.withdrawal_pool
             and (p.stripe_release_started
                  or (select x.status from public.provider_payouts x where x.payment_id = p.id
                       order by x.created_at desc limit 1) in ('processing', 'failed')))
         or (p.state in ('confirmed', 'processing') and o.status = 'cancelled'
             and p.refund_failed_at is not null))
     + (select count(*)::integer from public.factory_withdrawals w where w.status in ('requested', 'paying')),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$$;

-- 5. ---------------------------------------------------------------------------
-- approve_milestone (20261107540000): only the factory's notification body
-- changes. "TSC will send you $X" is no longer what happens.
CREATE OR REPLACE FUNCTION public.approve_milestone(target_milestone uuid, note text DEFAULT NULL::text)
 RETURNS order_milestones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  m public.order_milestones;
  o public.production_orders;
  p public.order_payments;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_milestones where id = target_milestone)
   for update;
  if not found then
    raise exception 'milestone not found' using errcode = 'P0002';
  end if;

  select * into m from public.order_milestones where id = target_milestone for update;

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if m.kind = 'payment_only' then
    raise exception 'there is nothing to approve on a payment step' using errcode = '22023';
  end if;

  -- Approving is Approve samples; a step that releases money also needs
  -- Release funds (both, so neither alone pays a factory).
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order approves its steps' using errcode = '42501';
  end if;
  perform public.require_org_permission(o.brand_org_id, 'approve');
  if m.kind = 'approval_and_payment' then
    perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  end if;

  -- Also the double-approve guard: a second concurrent call blocks on the row
  -- lock above, then reads the new state and lands here.
  if m.state not in ('active', 'submitted') then
    raise exception 'that step is %, so it is not waiting on you', m.state
      using errcode = '22023';
  end if;

  if m.kind = 'approval_and_payment' then
    select * into p from public.order_payments where milestone_id = m.id for update;

    -- Approving pays the factory, so there has to be money to pay it with.
    if not found or p.state <> 'confirmed' then
      raise exception 'fund "%" first: TSC pays the factory from the money it holds when you approve',
        m.title using errcode = '22023';
    end if;

    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    update public.order_payments
       set release_requested_at = now()
     where id = p.id
    returning * into p;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      -- The amount always, then what the factory must do first when it has no
      -- way to withdraw, then the brand's note. Nothing is sent on approval:
      -- the money waits in the factory's balance until it withdraws.
      format('The brand approved this step. %s added to your balance.%s%s',
             public.format_money(p.amount_cents, p.currency),
             case when not public.factory_can_withdraw(o.factory_org_id)
                  then ' Add a withdrawal method to receive earnings.' else '' end,
             coalesce(' Their note: ' || nullif(btrim(coalesce(note, '')), ''), ''))
    );

    -- The chain moves on the brand's approval, never on the payout: a
    -- transfer that fails must not freeze the order.
    perform public.advance_order_chain(o.id);
  else
    update public.order_milestones
       set state = 'complete', approved_by = auth.uid(), approved_at = now(),
           approval_note = nullif(btrim(coalesce(note, '')), ''), completed_at = now()
     where id = m.id
    returning * into m;

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'milestone_approved', 'milestone', m.id, o.id,
      format('"%s" was approved', m.title),
      coalesce(nullif(btrim(coalesce(note, '')), ''), 'You can carry on to the next step.')
    );

    perform public.advance_order_chain(o.id);
  end if;

  return m;
end;
$function$
;
