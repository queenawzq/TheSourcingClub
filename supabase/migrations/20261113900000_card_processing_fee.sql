-- ============================================================================
-- Card processing fee, added on top of the brand's payment (Nov 13)
-- ----------------------------------------------------------------------------
-- Nov 12 call: TSC keeps only its 5-7% service fee, so the card fee Stripe
-- takes goes on top, the way Upwork does it (John, Queena). Youssef chose a
-- separate "Card processing fee" line next to the service fee (Nov 13). The
-- factory is still paid exactly the step amount.
--
--   Step amount            amount_cents                       (the factory's)
--   TSC service fee        floor(amount * fee_bps / 10000)    (unchanged)
--   Card processing fee    processing_fee_for(step + service fee, rate)
--   Total charged          the sum of the three: the PaymentIntent amount
--
-- The card fee covers Stripe's fee on the WHOLE charge (a gross-up): Stripe
-- takes its percentage of the total, fee included, so TSC receives the step
-- plus the service fee, or at most 1 cent more, never less.
--
-- The rate is a row (payment_processing_rates, by processor and currency),
-- never a constant: Stripe US standard 2.9% + 30c, TSC absorbing a foreign
-- card's extra 1.5% (Youssef, Nov 13). Each payment keeps a snapshot of the
-- rate it was priced at, as fee_bps does, fixed when the order's first payment
-- is made. Payments made before this migration keep a 0 rate, so a running
-- order, and any PaymentIntent already opened for it, keep their figures.
--
-- One figure, one source: only SQL works out a card fee. JavaScript selects
-- the computed fields below; the views, the checkout, the webhook's received-
-- amount check, the "is due" notice and the staff board all read them.
--
-- Additive while the old site is live: a new table, two columns with
-- defaults, new functions and a trigger; the functions and the view that
-- work out a brand's charge are their latest definitions with only the named
-- lines changed; admin_payment_board gains a column at the end.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The rate, per processor and currency. Only a migration changes it.
-- ---------------------------------------------------------------------------
create table public.payment_processing_rates (
  processor   text    not null,
  currency    char(3) not null,
  percent_bps integer not null check (percent_bps between 0 and 2000),
  fixed_cents bigint  not null check (fixed_cents >= 0),
  updated_at  timestamptz not null default now(),
  primary key (processor, currency)
);

insert into public.payment_processing_rates (processor, currency, percent_bps, fixed_cents)
values ('stripe_card', 'USD', 290, 30);

alter table public.payment_processing_rates enable row level security;

-- Not secret, and order_step_charges (security_invoker) reads it as the
-- caller. Default privileges hand `authenticated` every privilege on a new
-- table, so the writes are revoked explicitly.
revoke all on public.payment_processing_rates from public, anon, authenticated;
grant select on public.payment_processing_rates to authenticated;

create policy payment_processing_rates_read on public.payment_processing_rates
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- The snapshot on each payment. Default 0: every payment made before this
-- migration is charged as it always was.
-- ---------------------------------------------------------------------------
alter table public.order_payments
  add column processing_fee_bps integer not null default 0
    check (processing_fee_bps between 0 and 2000),
  add column processing_fee_fixed_cents bigint not null default 0
    check (processing_fee_fixed_cents >= 0);

-- ---------------------------------------------------------------------------
-- The gross-up, in one place.
--   total = the smallest T where  T - ceil(T * bps / 10000) - fixed >= base
--   fee   = total - base
-- ceil for the percentage is the safe side: Stripe rounds to the nearest
-- cent, so TSC nets the base or a cent over, never under. Integers only.
-- ---------------------------------------------------------------------------
create function public.processing_fee_for(base bigint, bps integer, fixed bigint)
returns bigint
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  t bigint;
begin
  if base is null or base <= 0 or (coalesce(bps, 0) = 0 and coalesce(fixed, 0) = 0) then
    return 0;
  end if;
  if bps < 0 or bps >= 10000 or fixed < 0 then
    raise exception 'a card processing rate of % bps + % is not a rate', bps, fixed
      using errcode = '22023';
  end if;

  -- The exact answer is within a cent or two of this; step to the minimum.
  t := ceil(((base + fixed) * 10000)::numeric / (10000 - bps))::bigint;
  while t - (t * bps + 9999) / 10000 - fixed < base loop
    t := t + 1;
  end loop;
  while (t - 1) - ((t - 1) * bps + 9999) / 10000 - fixed >= base loop
    t := t - 1;
  end loop;
  return t - base;
end;
$$;

revoke all on function public.processing_fee_for(bigint, integer, bigint) from public, anon;
grant execute on function public.processing_fee_for(bigint, integer, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Computed fields on order_payments: PostgREST selects them like columns
-- (`select=charge_cents`), in embeds too, so JavaScript computes nothing.
-- Invoker: the caller's own read of the payment row decides everything.
-- ---------------------------------------------------------------------------

-- The TSC service fee: the same figure as payment_fee_cents(uuid).
create function public.service_fee_cents(p public.order_payments)
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select ((p.amount_cents * p.fee_bps) / 10000)::bigint
$$;

-- What begin_payment_checkout charges for this payment now: the step, the
-- service fee and the card fee on both, at the payment's own snapshot. It is
-- also what the webhook must have received.
create function public.checkout_charge_cents(p public.order_payments)
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select (p.amount_cents + public.service_fee_cents(p)
          + public.processing_fee_for(p.amount_cents + public.service_fee_cents(p),
                                      p.processing_fee_bps, p.processing_fee_fixed_cents))::bigint
$$;

-- What the brand pays for this payment: what Stripe charged once it has
-- (charged_cents, recorded at checkout), otherwise what checkout charges now.
-- The same rule as order_step_charges and chargedCents() always used.
create function public.charge_cents(p public.order_payments)
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p.charged_cents is not null and p.state not in ('not_due', 'due', 'failed')
      then p.charged_cents
    else public.checkout_charge_cents(p)
  end::bigint
$$;

-- The card processing fee: the total less the step and the service fee, so
-- the three always add up. A payment charged without one (before this
-- migration, or a bank wire recorded by staff) reads 0.
create function public.processing_fee_cents(p public.order_payments)
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select (public.charge_cents(p) - p.amount_cents - public.service_fee_cents(p))::bigint
$$;

-- For RPC callers (the seed, tests): charge_cents of one payment.
create function public.payment_charge_cents(target_payment uuid)
returns bigint
language sql
stable
set search_path = public, pg_temp
as $$
  select public.charge_cents(p) from public.order_payments p where p.id = target_payment
$$;

revoke all on function public.service_fee_cents(public.order_payments)     from public, anon;
revoke all on function public.checkout_charge_cents(public.order_payments) from public, anon;
revoke all on function public.charge_cents(public.order_payments)          from public, anon;
revoke all on function public.processing_fee_cents(public.order_payments)  from public, anon;
revoke all on function public.payment_charge_cents(uuid)                   from public, anon;
grant execute on function public.service_fee_cents(public.order_payments)     to authenticated, service_role;
grant execute on function public.checkout_charge_cents(public.order_payments) to authenticated, service_role;
grant execute on function public.charge_cents(public.order_payments)          to authenticated, service_role;
grant execute on function public.processing_fee_cents(public.order_payments)  to authenticated, service_role;
grant execute on function public.payment_charge_cents(uuid)                   to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Every new payment gets its rate from the database, never from the inserter:
-- the order's first payment's rate (so a step added to a running order is
-- priced like its siblings, a 0 rate included), else the current rate for the
-- currency. A missing rate refuses rather than charging nothing.
-- ---------------------------------------------------------------------------
create function public.order_payment_processing_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sibling public.order_payments;
  rate    public.payment_processing_rates;
begin
  select * into sibling
  from public.order_payments p
  where p.order_id = new.order_id
  order by p.created_at
  limit 1;

  if found then
    new.processing_fee_bps := sibling.processing_fee_bps;
    new.processing_fee_fixed_cents := sibling.processing_fee_fixed_cents;
    return new;
  end if;

  select * into rate
  from public.payment_processing_rates r
  where r.processor = 'stripe_card' and r.currency = new.currency;

  if not found then
    raise exception 'no card processing rate for %', new.currency using errcode = '22023';
  end if;

  new.processing_fee_bps := rate.percent_bps;
  new.processing_fee_fixed_cents := rate.fixed_cents;
  return new;
end;
$$;

revoke all on function public.order_payment_processing_fee() from public, anon, authenticated;

create trigger order_payments_processing_fee
  before insert on public.order_payments
  for each row execute function public.order_payment_processing_fee();

-- ---------------------------------------------------------------------------
-- order_step_charges (20261023000300): the card fee joins the charge. Only
-- the lateral rate and charged_cents change; two columns are appended.
-- fee_cents stays "charged less the step": everything on top.
-- production_order_charges sums this view, so the brand's order header
-- gets the card fee with no change of its own.
-- ---------------------------------------------------------------------------
create or replace view public.order_step_charges
with (security_invoker = true) as
select
  c.milestone_id,
  c.order_id,
  c.payment_id,
  c.sort,
  c.state,
  c.amount_cents,
  c.fee_bps,
  (c.charged_cents - c.amount_cents)::bigint as fee_cents,
  c.charged_cents,
  c.service_fee_cents,
  (c.charged_cents - c.amount_cents - c.service_fee_cents)::bigint as processing_fee_cents
from (
  select
    m.id                                    as milestone_id,
    m.order_id,
    p.id                                    as payment_id,
    m.sort,
    p.state,
    coalesce(p.amount_cents, m.amount_cents)::bigint as amount_cents,
    r.fee_bps,
    ((coalesce(p.amount_cents, m.amount_cents) * r.fee_bps) / 10000)::bigint as service_fee_cents,
    case
      when p.charged_cents is not null and p.state not in ('not_due', 'due', 'failed')
        then p.charged_cents
      else coalesce(p.amount_cents, m.amount_cents)
           + (coalesce(p.amount_cents, m.amount_cents) * r.fee_bps) / 10000
           + public.processing_fee_for(
               coalesce(p.amount_cents, m.amount_cents)
                 + (coalesce(p.amount_cents, m.amount_cents) * r.fee_bps) / 10000,
               pr.bps, pr.fixed)
    end::bigint                             as charged_cents
  from public.order_milestones m
  join public.production_orders o on o.id = m.order_id
  left join public.order_payments p on p.milestone_id = m.id
  left join lateral (
    select coalesce(
      p.fee_bps,
      (select s.fee_bps from public.order_payments s
        where s.order_id = m.order_id
        order by s.created_at
        limit 1),
      case when coalesce(o.order_total_cents, 0) >= 500000 then 500 else 700 end
    ) as fee_bps
  ) r on true
  -- The card rate the payment has, else the one its first sibling has, else
  -- the one order_payment_processing_fee() will give it.
  left join lateral (
    select x.bps, x.fixed
    from (
      select p.processing_fee_bps as bps, p.processing_fee_fixed_cents as fixed, 0 as pick
       where p.id is not null
      union all
      select * from (
        select s.processing_fee_bps, s.processing_fee_fixed_cents, 1
          from public.order_payments s
         where s.order_id = m.order_id
         order by s.created_at
         limit 1
      ) sibling
      union all
      select rate.percent_bps, rate.fixed_cents, 2
        from public.payment_processing_rates rate
       where rate.processor = 'stripe_card' and rate.currency = o.currency
    ) x
    order by x.pick
    limit 1
  ) pr on true
  where coalesce(p.amount_cents, m.amount_cents, 0) > 0
) c;

-- ---------------------------------------------------------------------------
-- begin_payment_checkout (20261104100000): charges payment_charge_cents and
-- says the card fee; fee_cents and fee_bps stay the service fee. A charge a
-- card cannot carry is refused in words (Decision 8, Nov 13): Stripe takes at
-- most $999,999.99 in one card payment, and the brand was told "try again in
-- a few minutes", which never works.
-- ---------------------------------------------------------------------------
create or replace function public.begin_payment_checkout(target_payment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  fee bigint;
  charged bigint;
begin
  select * into p from public.order_payments where id = target_payment;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  perform public.require_org_permission(o.brand_org_id, 'releaseFunds');
  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order pays for its steps' using errcode = '42501';
  end if;

  if o.status <> 'active' then
    raise exception 'this order is %', o.status using errcode = '22023';
  end if;

  if p.state not in ('due', 'failed') then
    raise exception 'that payment is %, so there is nothing to pay', p.state
      using errcode = '22023';
  end if;

  select * into m from public.order_milestones where id = p.milestone_id;
  fee := public.payment_fee_cents(p.id);
  charged := public.payment_charge_cents(p.id);

  if charged > 99999999 then
    raise exception 'This payment is %, more than a card can be charged at once (%). Split this step into smaller steps, or contact TSC.',
      public.format_money(charged, p.currency), public.format_money(99999999, p.currency)
      using errcode = '22003';
  end if;

  return jsonb_build_object(
    'payment_id', p.id,
    'order_id', o.id,
    'order_number', o.order_number,
    'brand_org_id', o.brand_org_id,
    'factory_org_id', o.factory_org_id,
    'milestone_title', m.title,
    'amount_cents', p.amount_cents,
    'fee_bps', p.fee_bps,
    'fee_cents', fee,
    'processing_fee_cents', charged - p.amount_cents - fee,
    'charged_cents', charged,
    'currency', p.currency,
    'state', p.state,
    'stripe_payment_intent_id', p.stripe_payment_intent_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment_succeeded (20261022000300): what Stripe received is checked
-- against the full charge, card fee included. Missed, every new card payment
-- would be refunded as "amount changed". Only that line changes.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_succeeded(
  target_payment uuid,
  payment_intent text,
  charge text,
  method_type text,
  method_label text,
  received bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  problem text;
begin
  -- The order first, like update_order_milestone_details and close_order:
  -- an edit or a cancellation either finished before this check or waits
  -- until the money is recorded, after which it refuses to touch it.
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    return jsonb_build_object('funded', false, 'problem', 'payment_gone', 'payment', null);
  end if;

  if p.state in ('confirmed', 'released') and p.stripe_payment_intent_id = payment_intent then
    return jsonb_build_object('funded', true, 'payment', to_jsonb(p));
  end if;

  select * into m from public.order_milestones where id = p.milestone_id;

  problem := case
    when p.stripe_payment_intent_id is distinct from payment_intent then 'other_intent'
    when o.status <> 'active' then 'order_' || o.status::text
    when p.state not in ('due', 'failed', 'processing') then 'not_payable'
    when m.kind not in ('approval_and_payment', 'payment_only') then 'step_unpaid'
    -- The charge exactly as begin_payment_checkout works it out: the step,
    -- the service fee and the card processing fee.
    when received is distinct from public.checkout_charge_cents(p) then 'amount_changed'
  end;

  if problem is not null then
    return jsonb_build_object('funded', false, 'problem', problem, 'payment', to_jsonb(p));
  end if;

  p := public.record_payment_funded(target_payment, charge, method_type, method_label, received);
  return jsonb_build_object('funded', true, 'payment', to_jsonb(p));
end;
$$;

-- ---------------------------------------------------------------------------
-- advance_order_chain (20261107530000): the brand's "$X is due on TSC-..."
-- names the charge, card fee included: the Fund screen's total. Only that
-- figure changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_order_chain(target_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  next_sort integer;
  o         public.production_orders;
begin
  select * into o from public.production_orders where id = target_order;

  select min(sort) into next_sort
  from public.order_milestones
  where order_id = target_order
    and state not in ('complete', 'cancelled');

  if next_sort is null then
    update public.production_orders
       set status = 'completed', completed_at = now()
     where id = target_order and status = 'active';

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    select org_id, 'order_completed', 'order', o.id, o.id,
           format('%s is complete', o.order_number),
           'Every step on this order is done.'
    from (select o.brand_org_id as org_id union all select o.factory_org_id) parties;
    return;
  end if;

  -- Nothing opens while an earlier step is still outstanding.
  if exists (
    select 1 from public.order_milestones
    where order_id = target_order
      and sort < next_sort
      and state not in ('complete', 'cancelled')
  ) then
    return;
  end if;

  update public.order_milestones
     set state = 'active'
   where order_id = target_order and sort = next_sort and state = 'pending';

  -- A step that involves money is funded as it opens: TSC holds the money
  -- while the work happens and pays it on when the brand approves.
  update public.order_payments p
     set state = 'due', due_at = now()
    from public.order_milestones m
   where m.id = p.milestone_id
     and m.order_id = target_order
     and m.sort = next_sort
     and m.kind in ('payment_only', 'approval_and_payment')
     and p.state = 'not_due';

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  select p.id, 'not_due', 'due', 'system'
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    -- Only the ones this call made due (due_at is this transaction's now()).
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select o.brand_org_id, 'payment_due', 'payment', p.id, o.id,
         format('%s is due on %s', public.format_money(public.payment_charge_cents(p.id), p.currency), o.order_number),
         format('"%s". Fund it by card; TSC holds it until the step is done.', m.title)
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();
end;
$function$
;

-- ---------------------------------------------------------------------------
-- admin_payment_board (20261109300000): the card fee, as a column at the end
-- so the site still live while this runs reads the columns it always did.
-- fee_cents stays the service fee; charged_cents stays what was recorded.
-- ---------------------------------------------------------------------------
drop function public.admin_payment_board();

create function public.admin_payment_board()
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
      when 'confirmed' then case when p.release_requested_at is not null then 1 else 3 end
      when 'released' then 1
      when 'failed' then 2
      else 4
    end,
    coalesce(p.release_requested_at, p.sent_at, p.failed_at, p.processing_at, p.confirmed_at);
end;
$$;

revoke all on function public.admin_payment_board() from public;
grant execute on function public.admin_payment_board() to authenticated;
