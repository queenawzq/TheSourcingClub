-- ============================================================================
-- Payments held by TSC, through Stripe Connect
-- ----------------------------------------------------------------------------
-- Until now the platform never held a cent: a brand wired money to a factory
-- and staff confirmed it had arrived. From here (John, 2026-10-11) the brand
-- pays TSC by card or US bank account through Stripe, TSC holds the money,
-- and the factory is paid when the brand approves the step:
--
--   step opens       -> its payment is due: the brand funds it BEFORE the work
--   brand pays       -> processing (bank, ~4 business days) or straight to
--                       confirmed (card); failed if it comes back
--   confirmed        -> TSC holds it ("funded"); the factory may start
--   brand approves   -> the step completes, the chain moves on, and the payout
--                       is requested (release_requested_at)
--   payout           -> a Stripe transfer to the factory's connected account,
--                       or a bank transfer by staff where Stripe cannot pay
--                       out (a US platform reaches only US/UK/EEA/CA/CH
--                       accounts) -> released
--
-- A payment-only step (a deposit or balance) has nothing to approve: once
-- funded it completes, and its payout is requested at once.
--
-- The service fee is ADDED to the brand's payment, not taken from the
-- factory's: 5% when the order is $5,000 or more, 7% under. It is fixed per
-- order, when the order's payments are created, so a brand is never charged a
-- rate it was not shown. Payments that already exist keep 0.
--
-- Stripe's word is final: only server code holding the service key moves a
-- payment through processing / confirmed / failed / released, from a signed
-- webhook or a direct read of the PaymentIntent. The browser can only ask to
-- start a checkout, and only a brand owner, for a payment that is due.
--
-- The chain still advances on the brand's act (approval, or funding a
-- payment-only step), never on the transfer: a payout that fails must not
-- freeze the order.
--
-- Safe with the old site live: everything here is added; the checks that
-- change are loosened; the old wire path (mark_payment_sent ->
-- confirm_payment_received -> release_payment_to_factory) and
-- admin_payment_queue() are untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- What Stripe tells us about a payment
-- ---------------------------------------------------------------------------

alter table public.order_payments
  add column stripe_payment_intent_id text unique,
  add column stripe_charge_id         text,
  add column stripe_transfer_id       text,
  -- 'card' or 'us_bank_account', and what a person reads ("Visa ···4242").
  -- Never more than the brand and the last four digits.
  add column payment_method_type      text,
  add column payment_method_label     text,
  -- amount_cents plus the fee: what the brand's card or bank was charged.
  add column charged_cents            bigint check (charged_cents is null or charged_cents > 0),
  add column failure_reason           text,
  add column processing_at            timestamptz,
  add column failed_at                timestamptz,
  -- Set when the money may go to the factory (the brand approved the step,
  -- or a payment-only step was funded). Cleared by nothing: released_at says
  -- when it actually went.
  add column release_requested_at     timestamptz;

-- Stripe confirms and releases without a person, so a confirmation or a
-- release may now carry no user. The old rule (a stamp is a time AND a user)
-- still holds for everything staff do by hand. Loosened, never tightened.
alter table public.order_payments
  drop constraint payment_confirmed_stamp,
  drop constraint payment_released_stamp,
  drop constraint payment_state_implies_stamps;

alter table public.order_payments
  add constraint payment_confirmed_stamp check (confirmed_by is null or confirmed_at is not null),
  add constraint payment_released_stamp  check (released_by is null or released_at is not null),
  add constraint payment_state_implies_stamps check (
    case state
      when 'sent'       then sent_at is not null
      when 'processing' then processing_at is not null
      when 'failed'     then failed_at is not null
      when 'confirmed'  then confirmed_at is not null
      when 'released'   then confirmed_at is not null and released_at is not null
      else true
    end
  );

create index order_payments_release_idx on public.order_payments (release_requested_at)
  where state = 'confirmed' and release_requested_at is not null;

-- ---------------------------------------------------------------------------
-- The service fee, fixed per order
-- ---------------------------------------------------------------------------
-- 500 bps at $5,000 and over, 700 under, from the order's total. An order
-- that already has payments keeps their rate, so a step added later (Queena's
-- update_order_milestone_details) is charged like the rest, and an order
-- that started before this migration stays at 0.
-- ---------------------------------------------------------------------------

create or replace function public.order_payment_fee_bps()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sibling integer;
  total   bigint;
begin
  if new.fee_bps <> 0 then
    return new;
  end if;

  select p.fee_bps into sibling
  from public.order_payments p
  where p.order_id = new.order_id
  order by p.created_at
  limit 1;

  if found then
    new.fee_bps := sibling;
    return new;
  end if;

  select order_total_cents into total from public.production_orders where id = new.order_id;
  new.fee_bps := case when coalesce(total, 0) >= 500000 then 500 else 700 end;
  return new;
end;
$$;

revoke all on function public.order_payment_fee_bps() from public, authenticated;

create trigger order_payments_fee
  before insert on public.order_payments
  for each row execute function public.order_payment_fee_bps();

-- ---------------------------------------------------------------------------
-- Stripe objects we keep
-- ---------------------------------------------------------------------------
-- All three are written only by server code with the service key. Default
-- privileges hand `authenticated` every privilege on a new table, so the
-- writes are revoked explicitly.
-- ---------------------------------------------------------------------------

-- One Stripe customer per brand company: the bank-debit mandate and any
-- saved payment method belong to it.
create table public.stripe_customers (
  org_id             uuid primary key references public.orgs (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

alter table public.stripe_customers enable row level security;
revoke all on public.stripe_customers from anon, authenticated;

-- A factory's Stripe Express account, and what Stripe last said about it.
create table public.stripe_connect_accounts (
  org_id             uuid primary key references public.orgs (id) on delete cascade,
  stripe_account_id  text not null unique,
  country            char(2) not null,
  details_submitted  boolean not null default false,
  payouts_enabled    boolean not null default false,
  -- The transfers capability is 'active': a payout can be sent.
  transfers_active   boolean not null default false,
  requirements_due   text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger stripe_connect_accounts_touch
  before update on public.stripe_connect_accounts
  for each row execute function public.touch_updated_at();

alter table public.stripe_connect_accounts enable row level security;

-- The factory's own members see their payout status, staff see everyone's.
-- A brand never reads it: it has no reason to know how a factory is paid.
create policy stripe_connect_accounts_read on public.stripe_connect_accounts
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

revoke all on public.stripe_connect_accounts from anon, authenticated;
grant select on public.stripe_connect_accounts to authenticated;

-- Every webhook event handled, by Stripe's id. Stripe delivers at least once;
-- a second delivery finds its id here and does nothing.
create table public.stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The brand starts a checkout
-- ---------------------------------------------------------------------------
-- Called by /api/stripe-checkout with the BRAND'S OWN session, so this is
-- where the authorisation lives: an owner (paying is a statement that money
-- leaves the company, as mark_payment_sent always required), an active
-- order, a payment that is due or failed. Returns what the server needs to
-- create or reuse the PaymentIntent.
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
begin
  select * into p from public.order_payments where id = target_payment;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  if not public.is_org_owner(o.brand_org_id) then
    raise exception 'only a brand owner can pay for a step' using errcode = '42501';
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
    'charged_cents', p.amount_cents + fee,
    'currency', p.currency,
    'state', p.state,
    'stripe_payment_intent_id', p.stripe_payment_intent_id
  );
end;
$$;

revoke all on function public.begin_payment_checkout(uuid) from public;
grant execute on function public.begin_payment_checkout(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What only the server records (service_role alone)
-- ---------------------------------------------------------------------------
-- Each one is a no-op when the payment is already past the state it records,
-- so a repeated or out-of-order webhook cannot move money backwards.
-- ---------------------------------------------------------------------------

create or replace function public.attach_payment_intent(
  target_payment uuid,
  payment_intent text,
  charged bigint
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if p.stripe_payment_intent_id is not null and p.stripe_payment_intent_id <> payment_intent then
    raise exception 'this payment already has a different PaymentIntent' using errcode = '22023';
  end if;

  update public.order_payments
     set stripe_payment_intent_id = payment_intent, charged_cents = charged
   where id = p.id
  returning * into p;
  return p;
end;
$$;

-- The brand paid by bank; it has not cleared.
create or replace function public.record_payment_processing(
  target_payment uuid,
  method_type text,
  method_label text
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state not in ('due', 'failed') then
    return p;
  end if;
  was := p.state;

  update public.order_payments
     set state = 'processing', processing_at = now(),
         payment_method_type = coalesce(method_type, payment_method_type),
         payment_method_label = coalesce(method_label, payment_method_label),
         failure_reason = null
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, was, 'processing', 'system');

  select * into m from public.order_milestones where id = p.milestone_id;

  -- Told carefully, like "sent" always was: on its way is not arrived.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'payment_processing', 'payment', p.id, o.id,
    format('A bank payment for "%s" is on its way', m.title),
    format('%s on %s. Bank payments take about 4 business days to clear. We will tell you when TSC holds it; please do not start this work yet.',
           public.format_money(p.amount_cents, p.currency), o.order_number)
  );

  return p;
end;
$$;

-- The payment did not go through (a bank payment that came back, or a card
-- that failed after the form). The brand can pay again.
create or replace function public.record_payment_failed(target_payment uuid, reason text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
  why text := coalesce(nullif(btrim(coalesce(reason, '')), ''), 'The payment did not go through.');
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state not in ('due', 'processing') then
    return p;
  end if;
  was := p.state;

  update public.order_payments
     set state = 'failed', failed_at = now(), failure_reason = why
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, 'failed', 'system', why);

  select * into m from public.order_milestones where id = p.milestone_id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_failed', 'payment', p.id, o.id,
    format('Your payment for "%s" did not go through', m.title),
    format('%s Pay again from the step''s payment page on %s.', why, o.order_number)
  );

  -- The factory was told a bank payment was on its way; tell it that it is not.
  if was = 'processing' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_failed', 'payment', p.id, o.id,
      format('The bank payment for "%s" did not go through', m.title),
      format('Nothing is held for this step on %s yet. The brand has been asked to pay again.', o.order_number)
    );
  end if;

  return p;
end;
$$;

-- The money arrived: TSC holds it.
create or replace function public.record_payment_funded(
  target_payment uuid,
  charge text,
  method_type text,
  method_label text,
  received bigint
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
  pays_out boolean := false;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state in ('confirmed', 'released') then
    return p;
  end if;
  -- A cancelled payment can still be charged (a bank payment already on its
  -- way when the order was cancelled): the money arrived, so record it.
  -- Staff see it held on a cancelled order and refund it.
  was := p.state;

  select * into m from public.order_milestones where id = p.milestone_id for update;

  -- Nothing to approve on a payment-only step; a step approved under the old
  -- rules (approve first, pay after) was waiting only for this.
  pays_out := o.status = 'active'
    and (m.kind = 'payment_only' or m.state = 'approved');

  update public.order_payments
     set state = 'confirmed', confirmed_at = now(), confirmed_by = null,
         amount_received_cents = coalesce(received, p.charged_cents, p.amount_cents),
         stripe_charge_id = coalesce(charge, stripe_charge_id),
         payment_method_type = coalesce(method_type, payment_method_type),
         payment_method_label = coalesce(method_label, payment_method_label),
         failure_reason = null,
         release_requested_at = case when pays_out then now() else release_requested_at end
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, was, 'confirmed', 'system');

  if pays_out then
    update public.order_milestones
       set state = 'complete', completed_at = now()
     where id = m.id and state in ('active', 'approved');
    perform public.advance_order_chain(o.id);
  end if;

  if o.status = 'active' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Payment held for "%s"', m.title),
      case when pays_out
        then format('TSC received %s on %s. It is on its way to you.',
                    public.format_money(p.amount_cents, p.currency), o.order_number)
        else format('TSC holds %s for this step on %s. You can start this work; it is paid to you when the brand approves it.',
                    public.format_money(p.amount_cents, p.currency), o.order_number)
      end
    );

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.brand_org_id, 'payment_confirmed', 'payment', p.id, o.id,
      format('Your payment for "%s" is funded', m.title),
      case when pays_out
        then format('%s received on %s and paid on to the factory.',
                    public.format_money(p.charged_cents, p.currency), o.order_number)
        else format('%s received. TSC holds it and pays the factory when you approve this step.',
                    public.format_money(coalesce(p.charged_cents, p.amount_cents), p.currency))
      end
    );
  end if;

  return p;
end;
$$;

-- The money went to the factory (a Stripe transfer).
create or replace function public.record_payment_released(target_payment uuid, transfer text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
begin
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if p.state <> 'confirmed' then
    return p;
  end if;

  select * into o from public.production_orders where id = p.order_id;

  update public.order_payments
     set state = 'released', released_at = now(), released_by = null,
         stripe_transfer_id = transfer,
         released_note = 'Paid out through Stripe.'
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, 'confirmed', 'released', 'system');

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s paid out to you', public.format_money(p.amount_cents, p.currency)),
    format('Sent to your Stripe account against %s.', o.order_number)
  );

  return p;
end;
$$;

revoke all on function public.attach_payment_intent(uuid, text, bigint)               from public, authenticated;
revoke all on function public.record_payment_processing(uuid, text, text)             from public, authenticated;
revoke all on function public.record_payment_failed(uuid, text)                       from public, authenticated;
revoke all on function public.record_payment_funded(uuid, text, text, text, bigint)   from public, authenticated;
revoke all on function public.record_payment_released(uuid, text)                     from public, authenticated;
grant execute on function public.attach_payment_intent(uuid, text, bigint)             to service_role;
grant execute on function public.record_payment_processing(uuid, text, text)           to service_role;
grant execute on function public.record_payment_failed(uuid, text)                     to service_role;
grant execute on function public.record_payment_funded(uuid, text, text, text, bigint) to service_role;
grant execute on function public.record_payment_released(uuid, text)                   to service_role;

-- ---------------------------------------------------------------------------
-- advance_order_chain (from 033), unchanged apart from: a Paid release step's
-- payment now falls due when the step OPENS, like a payment-only step's, so
-- the brand funds the work before it starts; and the notification asks the
-- brand to fund it rather than to wire it.
-- ---------------------------------------------------------------------------

create or replace function public.advance_order_chain(target_order uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
         format('%s is due on %s', public.format_money(p.amount_cents, p.currency), o.order_number),
         format('"%s". Fund it by card or bank account; TSC holds it until the step is done.', m.title)
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();
end;
$$;

revoke all on function public.advance_order_chain(uuid) from public;

-- ---------------------------------------------------------------------------
-- approve_milestone (from 065, order_interior), unchanged apart from the Paid
-- release branch: the step's money must already be held, and approving it
-- completes the step, opens the next one and requests the payout. Before,
-- approving made the payment due and the step waited for the wire.
-- ---------------------------------------------------------------------------

create or replace function public.approve_milestone(target_milestone uuid, note text default null)
returns public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- Approving a paid step releases money, so it takes an owner, matching
  -- award_quote. Signing off a lab dip does not, and requiring an owner for
  -- every colour approval would put the founder in the middle of daily work.
  if m.kind = 'approval_and_payment' then
    if not public.is_org_owner(o.brand_org_id) then
      raise exception 'approving a step that releases a payment is limited to a brand owner'
        using errcode = '42501';
    end if;
  elsif not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order approves its steps' using errcode = '42501';
  end if;

  -- Also the double-approve guard: a second concurrent call blocks on the row
  -- lock above, then reads the new state and lands here.
  --
  -- An ACTIVE step is approvable once the factory has posted on it: the brand
  -- approves from the update it has seen. Before anything is posted there is
  -- nothing to approve, and a brand's own comment is not the factory's work.
  if m.state = 'active' then
    if not exists (
      select 1 from public.milestone_updates u
       where u.milestone_id = m.id and u.author_org_id = o.factory_org_id
    ) then
      raise exception 'the factory has not posted an update on "%" yet, so there is nothing to approve', m.title
        using errcode = '22023';
    end if;
  elsif m.state <> 'submitted' then
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
      coalesce(
        nullif(btrim(coalesce(note, '')), ''),
        format('The brand approved this step. %s held by TSC is on its way to you.',
               public.format_money(p.amount_cents, p.currency))
      )
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
$$;

revoke all on function public.approve_milestone(uuid, text) from public;
grant execute on function public.approve_milestone(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- close_order (from 035), unchanged apart from: a payment that failed is
-- cancelled with the rest of what was never paid. A payment still clearing
-- (processing) is left alone, like money already held: it is real money on
-- its way, and staff refund it once it lands.
-- ---------------------------------------------------------------------------

create or replace function public.close_order(target_order uuid, reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
begin
  select * into o from public.production_orders where id = target_order for update;
  if o.status not in ('pending_schedule', 'active') then
    raise exception 'this order is % already', o.status using errcode = '22023';
  end if;

  update public.production_orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = reason
   where id = o.id;

  update public.order_milestones
     set state = 'cancelled'
   where order_id = o.id and state not in ('complete', 'cancelled');

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
  select id, state, 'cancelled', auth.uid(), 'system', reason
  from public.order_payments
  where order_id = o.id and state in ('not_due', 'due', 'sent', 'failed');

  -- A confirmed or released payment is NOT cancelled. The money moved; the
  -- record of it moving survives the order it was for.
  update public.order_payments
     set state = 'cancelled'
   where order_id = o.id and state in ('not_due', 'due', 'sent', 'failed');

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select org_id, 'order_cancelled', 'order', o.id, o.id,
         format('%s was cancelled', o.order_number), reason
  from (select o.brand_org_id as org_id union all select o.factory_org_id) parties;
end;
$$;

revoke all on function public.close_order(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- update_order_milestone_details (from 20261011000400), unchanged apart from
-- the payment state it writes:
--   * an open Paid release step's payment is due, like a payment-only one's
--     (the brand funds a step as it opens);
--   * only a payment that has not moved (not due, or due with nothing paid)
--     has its state set. Before, any edit reset every payment to the state
--     its step "should" have, so renaming a finished step put money that had
--     been confirmed, or paid out, back to "not due".
-- ---------------------------------------------------------------------------

create or replace function public.update_order_milestone_details(target_order uuid, lines jsonb)
returns setof public.order_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.production_orders;
  item jsonb;
  existing public.order_milestones;
  payment public.order_payments;
  item_id uuid;
  item_kind public.milestone_type;
  item_amount bigint;
  total bigint := 0;
  idx integer := 0;
  has_payment boolean;
  commercial_changed boolean;
  desired_payment_state public.payment_state;
begin
  select * into o from public.production_orders where id = target_order for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if not public.is_org_member(o.brand_org_id) then
    raise exception 'only the brand on this order may manage its milestones'
      using errcode = '42501';
  end if;

  if o.status not in ('pending_schedule', 'active') then
    raise exception 'milestones cannot be changed on this order'
      using errcode = '22023';
  end if;

  if jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0 then
    raise exception 'a schedule needs at least one milestone' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(lines) entry
    where nullif(entry ->> 'id', '') is not null
    group by entry ->> 'id'
    having count(*) > 1
  ) then
    raise exception 'a milestone appears more than once' using errcode = '22023';
  end if;

  -- Validate the complete proposed schedule before touching any row.
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    begin
      item_kind := (item ->> 'kind')::public.milestone_type;
      item_id := nullif(item ->> 'id', '')::uuid;
      item_amount := nullif(item ->> 'amount_cents', '')::bigint;
    exception when others then
      raise exception 'step % contains an invalid id, type, or amount', idx
        using errcode = '22023';
    end;

    if length(btrim(coalesce(item ->> 'title', ''))) = 0 then
      raise exception 'step % needs a title', idx using errcode = '22023';
    end if;

    if item_kind in ('approval_and_payment', 'payment_only') then
      if item_amount is null or item_amount <= 0 then
        raise exception 'step % involves a payment, so it needs an amount', idx
          using errcode = '22023';
      end if;
      total := total + item_amount;
    elsif item_amount is not null then
      raise exception 'step % has no payment, so it cannot carry an amount', idx
        using errcode = '22023';
    end if;

    if item_id is not null and not exists (
      select 1 from public.order_milestones
      where id = item_id and order_id = target_order
    ) then
      raise exception 'a milestone does not belong to this order'
        using errcode = '22023';
    end if;
  end loop;

  if total <> o.order_total_cents then
    raise exception 'the steps total %.2f but the agreed order is %.2f',
      total / 100.0, o.order_total_cents / 100.0 using errcode = '22023';
  end if;

  -- Omitted rows are removals. Work that has started is history, not a form
  -- row, and a payment that moved beyond not-due must never disappear.
  for existing in
    select m.*
    from public.order_milestones m
    where m.order_id = target_order
      and not exists (
        select 1 from jsonb_array_elements(lines) entry
        where nullif(entry ->> 'id', '') = m.id::text
      )
    for update
  loop
    if existing.state <> 'pending' then
      raise exception '"%" has already started and cannot be removed', existing.title
        using errcode = '22023';
    end if;
    if exists (select 1 from public.milestone_updates where milestone_id = existing.id) then
      raise exception '"%" has updates and cannot be removed', existing.title
        using errcode = '22023';
    end if;
    if exists (
      select 1 from public.order_payments
      where milestone_id = existing.id and state <> 'not_due'
    ) then
      raise exception '"%" has payment activity and cannot be removed', existing.title
        using errcode = '22023';
    end if;
  end loop;

  delete from public.order_milestones m
  where m.order_id = target_order
    and not exists (
      select 1 from jsonb_array_elements(lines) entry
      where nullif(entry ->> 'id', '') = m.id::text
    );

  idx := 0;
  for item in select * from jsonb_array_elements(lines) loop
    idx := idx + 1;
    item_id := nullif(item ->> 'id', '')::uuid;
    item_kind := (item ->> 'kind')::public.milestone_type;
    item_amount := nullif(item ->> 'amount_cents', '')::bigint;

    if item_id is null then
      insert into public.order_milestones
        (order_id, sort, kind, title, description, amount_cents, currency, due_on, state)
      values (
        target_order,
        coalesce(nullif(item ->> 'sort', '')::integer, idx * 10),
        item_kind,
        btrim(item ->> 'title'),
        nullif(btrim(coalesce(item ->> 'description', '')), ''),
        item_amount,
        o.currency,
        nullif(item ->> 'due_on', '')::date,
        'pending'
      ) returning id into item_id;

      if item_kind in ('approval_and_payment', 'payment_only') then
        insert into public.order_payments
          (order_id, milestone_id, amount_cents, currency, state)
        values (target_order, item_id, item_amount, o.currency, 'not_due');
      end if;
      continue;
    end if;

    select * into existing
    from public.order_milestones
    where id = item_id and order_id = target_order
    for update;

    select * into payment
    from public.order_payments
    where milestone_id = item_id
    for update;
    has_payment := found;

    commercial_changed := existing.kind is distinct from item_kind
      or existing.amount_cents is distinct from item_amount;

    if commercial_changed and existing.state not in ('pending', 'active') then
      raise exception '"%" is already under review or complete, so its payment type cannot change', existing.title
        using errcode = '22023';
    end if;

    if commercial_changed and has_payment and payment.state not in ('not_due', 'due') then
      raise exception '"%" has payment activity, so its amount or type cannot change', existing.title
        using errcode = '22023';
    end if;

    if has_payment and item_kind not in ('approval_and_payment', 'payment_only') then
      delete from public.order_payments where id = payment.id;
      has_payment := false;
    end if;

    update public.order_milestones
       set kind = item_kind,
           title = btrim(item ->> 'title'),
           description = nullif(btrim(coalesce(item ->> 'description', '')), ''),
           amount_cents = item_amount,
           due_on = nullif(item ->> 'due_on', '')::date,
           sort = coalesce(nullif(item ->> 'sort', '')::integer, idx * 10)
     where id = item_id;

    if item_kind in ('approval_and_payment', 'payment_only') then
      desired_payment_state := case
        when existing.state in ('active', 'submitted', 'approved') then 'due'::public.payment_state
        else 'not_due'::public.payment_state
      end;

      if has_payment then
        -- Only money that has not moved follows the step. Anything paid,
        -- clearing, failed or held keeps its state and its history.
        if payment.state in ('not_due', 'due') then
          if payment.state is distinct from desired_payment_state then
            insert into public.payment_events
              (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
            values (
              payment.id, payment.state, desired_payment_state, auth.uid(), 'brand',
              'Payment timing changed while managing production steps.'
            );
          end if;
          update public.order_payments
             set amount_cents = item_amount,
                 state = desired_payment_state,
                 due_at = case when desired_payment_state = 'due' then coalesce(due_at, now()) else null end
           where id = payment.id;
        end if;
      else
        insert into public.order_payments
          (order_id, milestone_id, amount_cents, currency, state, due_at)
        values (
          target_order, item_id, item_amount, o.currency, desired_payment_state,
          case when desired_payment_state = 'due' then now() else null end
        );
      end if;
    end if;
  end loop;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'schedule_updated', 'order', o.id, o.id,
    format('The brand updated milestones on %s', o.order_number),
    'Review the updated production steps, payment amounts, and due dates.'
  );

  return query
    select * from public.order_milestones
    where order_id = target_order
    order by sort;
end;
$$;

revoke all on function public.update_order_milestone_details(uuid, jsonb) from public;
grant execute on function public.update_order_milestone_details(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- production_order_summary (from 035), same columns. Changed: a payment that
-- is clearing or failed is still outstanding; a failed one waits on the
-- brand like a due one; and an open step whose money is not held yet is not
-- the factory's turn.
-- ---------------------------------------------------------------------------

create or replace view public.production_order_summary
with (security_invoker = true) as
select
  o.*,
  coalesce(ms.total_cents, 0)::bigint  as total_cents,
  coalesce(pm.paid_cents, 0)::bigint   as paid_cents,
  (coalesce(ms.total_cents, 0) - coalesce(pm.paid_cents, 0))::bigint as outstanding_cents,
  nx.amount_cents                      as next_payment_cents,
  nx.due_on                            as next_payment_due_on,
  cur.id                               as current_milestone_id,
  cur.title                            as current_milestone_title,
  -- Whose turn it is, computed here so both sides read the same answer.
  (o.status = 'pending_schedule' and o.schedule_brand_agreed_at is null)
    or exists (
      select 1 from public.order_milestones m
      where m.order_id = o.id and m.state = 'submitted'
    )
    or exists (
      select 1 from public.order_payments p
      where p.order_id = o.id and p.state in ('due', 'failed')
    )                                  as awaiting_brand,
  (o.status = 'pending_schedule' and o.schedule_factory_agreed_at is null)
    or exists (
      select 1 from public.order_milestones m
      where m.order_id = o.id and m.state = 'active' and m.kind <> 'payment_only'
        and not exists (
          select 1 from public.order_payments p
          where p.milestone_id = m.id and p.state in ('not_due', 'due', 'processing', 'failed', 'sent')
        )
    )                                  as awaiting_factory
from public.production_orders o
left join lateral (
  select sum(amount_cents) as total_cents
  from public.order_milestones where order_id = o.id
) ms on true
left join lateral (
  -- Held or paid out. A payment still clearing is not funding: a bank
  -- payment can come back days later.
  select sum(amount_cents) as paid_cents
  from public.order_payments
  where order_id = o.id and state in ('confirmed', 'released')
) pm on true
left join lateral (
  select p.amount_cents, m.due_on
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where p.order_id = o.id and p.state in ('not_due', 'due', 'sent', 'processing', 'failed')
  order by m.sort
  limit 1
) nx on true
left join lateral (
  select m.id, m.title
  from public.order_milestones m
  where m.order_id = o.id and m.state not in ('complete', 'cancelled')
  order by m.sort
  limit 1
) cur on true;

grant select on public.production_order_summary to authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_snapshot (from 039), same columns. Changed: a failed payment is
-- owed like a due one, and a bank payment clearing counts as in flight, next
-- to the legacy "sent".
-- ---------------------------------------------------------------------------

create or replace function public.dashboard_snapshot(target_org uuid)
returns table (
  is_factory                 boolean,
  orders_active              integer,
  orders_awaiting_schedule   integer,
  steps_awaiting_you         integer,
  steps_you_are_working_on   integer,
  payments_due_cents         bigint,
  payments_in_flight_cents   bigint,
  payments_received_cents    bigint,
  unread_messages            integer,
  rfqs_open                  integer,
  quotes_to_compare          integer,
  quotes_awaiting_decision   integer
)
language sql
stable
as $$
  with me as (
    select o.id, o.type = 'factory' as factory
    from public.orgs o where o.id = target_org
  ),
  mine as (
    select s.*
    from public.production_order_summary s, me
    where s.brand_org_id = me.id or s.factory_org_id = me.id
  )
  select
    me.factory,

    (select count(*) from mine where status = 'active')::integer,
    (select count(*) from mine where status = 'pending_schedule')::integer,

    -- Waiting on YOU. For a brand that is a step the factory has sent for
    -- approval; for a factory it is a step that is open and is not simply a
    -- payment it is waiting to receive.
    (select count(*)
       from public.order_milestones m
       join mine on mine.id = m.order_id
      where mine.status = 'active'
        and case when me.factory
                 then m.state = 'active' and m.kind <> 'payment_only'
                 else m.state = 'submitted'
            end)::integer,

    -- In flight on the other side.
    (select count(*)
       from public.order_milestones m
       join mine on mine.id = m.order_id
      where mine.status = 'active'
        and case when me.factory
                 then m.state = 'submitted'
                 else m.state = 'active' and m.kind <> 'payment_only'
            end)::integer,

    -- Money. A brand sees what it owes; a factory sees what is owed to it.
    coalesce((select sum(p.amount_cents)
                from public.order_payments p
                join mine on mine.id = p.order_id
               where p.state in ('due', 'failed')), 0)::bigint,

    -- Paid but not cleared (a bank payment), or a legacy wire claimed sent:
    -- worth showing both sides so it cannot sit unnoticed.
    coalesce((select sum(p.amount_cents)
                from public.order_payments p
                join mine on mine.id = p.order_id
               where p.state in ('sent', 'processing')), 0)::bigint,

    coalesce((select sum(p.amount_cents)
                from public.order_payments p
                join mine on mine.id = p.order_id
               where p.state in ('confirmed', 'released')), 0)::bigint,

    coalesce((select sum(t.unread_count)
                from public.message_thread_summary t
               where t.brand_org_id = target_org or t.factory_org_id = target_org), 0)::integer,

    -- A brand counts its own live requests. A factory counts the ones it can
    -- see and has not already quoted, which is the only number that tells it
    -- whether there is anything to do here today.
    (select count(*) from public.rfqs r
      where r.status = 'open'
        and case when me.factory
                 then not exists (select 1 from public.quotes q
                                   where q.rfq_id = r.id
                                     and q.factory_org_id = target_org
                                     and q.status in ('submitted', 'accepted'))
                 else r.brand_org_id = target_org
            end)::integer,

    (select count(distinct r.id) from public.rfqs r
      join public.quotes q on q.rfq_id = r.id and q.status = 'submitted'
     where not me.factory and r.brand_org_id = target_org and r.status = 'open')::integer,

    (select count(*) from public.quotes q
      where me.factory and q.factory_org_id = target_org and q.status = 'submitted')::integer

  from me;
$$;

grant execute on function public.dashboard_snapshot(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The staff payments board
-- ---------------------------------------------------------------------------
-- A new function rather than a wider admin_payment_queue(), which the old
-- site keeps reading unchanged while this deploys. Lists every payment staff
-- may need to look at or act on:
--   sent        a legacy wire claim: confirm or reject, as before
--   processing  a bank payment clearing (nothing to do; visible)
--   failed      came back; the brand has been asked to pay again
--   confirmed   held by TSC. With release_requested_at set, the factory is
--               owed it now: "Retry payout" when it has a Stripe account,
--               otherwise staff pay it by bank and mark it paid out
--   and anything held on a cancelled order, to refund in Stripe.
-- ---------------------------------------------------------------------------

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
  payout_summary           text
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
    p.brand_reference, p.payment_method_label, p.failure_reason,
    p.stripe_payment_intent_id, p.stripe_transfer_id,
    p.sent_at, p.processing_at, p.failed_at, p.confirmed_at, p.release_requested_at,
    coalesce(sca.transfers_active, false),
    coalesce(a.bank_name || ' ····' || coalesce(a.account_number_last4, ''), 'no bank details on file')
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.stripe_connect_accounts sca on sca.org_id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  where p.state in ('sent', 'processing', 'failed', 'confirmed')
  order by
    case p.state
      when 'sent' then 0
      when 'confirmed' then case when p.release_requested_at is not null then 1 else 3 end
      when 'failed' then 2
      else 4
    end,
    coalesce(p.release_requested_at, p.sent_at, p.failed_at, p.processing_at, p.confirmed_at);
end;
$$;

revoke all on function public.admin_payment_board() from public;
grant execute on function public.admin_payment_board() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_overview_metrics(): the overview's payments card
-- ---------------------------------------------------------------------------
-- Copied from 20260912000100, with one change. Staff have no org and cannot
-- be notified, so this count is the only prompt they get. It used to count
-- bank-wire claims (sent) only; it now also counts the payments only a person
-- can move on: payouts owed that Stripe did not make (a factory in mainland
-- China, say, is paid by bank by staff) and money still held on a cancelled
-- order. The column keeps its name, so the old admin page reads it unchanged.
-- ---------------------------------------------------------------------------

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
      where p.state = 'sent'
         or (p.state = 'confirmed' and p.release_requested_at is not null)
         or (p.state in ('confirmed', 'processing') and o.status = 'cancelled')),
    (select count(*)::integer from public.admin_verification_queue() q
      where q.submitted_at >= date_trunc('day', now()));
end;
$$;

revoke all on function public.admin_overview_metrics() from public;
grant execute on function public.admin_overview_metrics() to authenticated;

-- ---------------------------------------------------------------------------
-- order_activity(): a bank payment clearing, and one that came back
-- ---------------------------------------------------------------------------
-- Copied from 20260930000300, with one change: the payment events it lists
-- now include processing and failed, so the order's activity says when a
-- bank payment is clearing and when one did not go through.
-- ---------------------------------------------------------------------------

create or replace function public.order_activity(target_order uuid)
returns table (
  at              timestamptz,
  kind            text,
  actor_org_id    uuid,
  milestone_title text,
  detail          text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with o as (
    select * from public.production_orders where id = target_order
  )
  select * from (
    select o.created_at, 'order_created', null::uuid, null::text, o.order_number from o
    union all
    select o.schedule_brand_agreed_at, 'schedule_agreed', o.brand_org_id, null, null
      from o where o.schedule_brand_agreed_at is not null
    union all
    select o.schedule_factory_agreed_at, 'schedule_agreed', o.factory_org_id, null, null
      from o where o.schedule_factory_agreed_at is not null
    union all
    select o.activated_at, 'order_activated', null, null, null
      from o where o.activated_at is not null
    union all
    select o.cancel_proposed_at, 'cancellation_proposed', o.cancel_proposed_by_org, null, o.cancel_reason
      from o where o.cancel_proposed_at is not null
    union all
    select o.completed_at, 'order_completed', null, null, null
      from o where o.completed_at is not null
    union all
    select o.cancelled_at, 'order_cancelled', null, null, null
      from o where o.cancelled_at is not null

    union all
    select m.submitted_at, 'step_submitted', o.factory_org_id, m.title, null
      from public.order_milestones m join o on o.id = m.order_id
     where m.submitted_at is not null
    union all
    select m.approved_at, 'step_approved', o.brand_org_id, m.title, m.approval_note
      from public.order_milestones m join o on o.id = m.order_id
     where m.approved_at is not null
    union all
    -- A step that was approved and completed in one go already has its line.
    select m.completed_at, 'step_completed', null, m.title, null
      from public.order_milestones m join o on o.id = m.order_id
     where m.completed_at is not null
       and m.completed_at is distinct from m.approved_at

    union all
    select u.created_at, 'update_posted', u.author_org_id, m.title, left(u.body, 140)
      from public.milestone_updates u
      join public.order_milestones m on m.id = u.milestone_id
     where u.order_id = target_order

    union all
    select e.created_at, 'payment_' || e.to_state::text,
           case e.actor_kind when 'brand' then o.brand_org_id
                             when 'factory' then o.factory_org_id end,
           m.title, p.amount_cents::text
      from public.payment_events e
      join public.order_payments p on p.id = e.payment_id
      join public.order_milestones m on m.id = p.milestone_id
      join o on o.id = p.order_id
     where e.to_state in ('due', 'sent', 'processing', 'failed', 'confirmed', 'released')

    union all
    (select msg.created_at, 'message', msg.sender_org_id, null, null
       from public.messages msg
       join public.message_threads t on t.id = msg.thread_id
      where t.order_id = target_order
      order by msg.created_at desc
      limit 1)
  ) activity (at, kind, actor_org_id, milestone_title, detail)
  order by at desc;
$$;

revoke all on function public.order_activity(uuid) from public;
grant execute on function public.order_activity(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Orders already under way
-- ---------------------------------------------------------------------------
-- An open Paid release step used to wait for approval before its money fell
-- due. Under the new rule it is funded as it opens, so those payments are
-- due now. Steps the brand already approved under the old rule are due
-- already, and funding them completes them (record_payment_funded).
-- ---------------------------------------------------------------------------

with opened as (
  update public.order_payments p
     set state = 'due', due_at = now()
    from public.order_milestones m, public.production_orders o
   where m.id = p.milestone_id
     and o.id = p.order_id
     and o.status = 'active'
     and m.kind = 'approval_and_payment'
     and m.state in ('active', 'submitted')
     and p.state = 'not_due'
  returning p.id
)
insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
select id, 'not_due', 'due', 'system', 'Paid steps are now funded as they open.'
from opened;
