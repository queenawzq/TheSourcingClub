-- ============================================================================
-- A factory buys credits, by card, through Stripe
-- ----------------------------------------------------------------------------
-- Sending a quote costs 25 credits (submit_quote), and until now nothing
-- could add any: "Purchase credits", "Get more credits" and "Purchase more
-- credits" all led to a dialog whose Continue only closed it. The design's
-- dialog offers three packs (500 credits for $50, 1,000 for $100, 2,500 for
-- $250); this is what stands behind it.
--
--   owner picks a pack -> /api/stripe-credits makes a credit_purchases row
--                         (create_credit_purchase) and a card PaymentIntent
--                         on TSC's own account, metadata kind
--                         'credit_purchase'
--   card is charged    -> the webhook, or /api/stripe-credits' sync for a
--                         page that just paid, records it: one ledger line
--                         'purchase' in the same transaction
--   card is declined   -> recorded as failed with Stripe's reason; paying
--                         again on the same PaymentIntent can still succeed
--
-- The packs live here, not in the browser: the server charges what
-- credit_packs() says a pack costs, whatever the page sent.
--
-- Credits once granted are granted once. credit_ledger_once_idx (005) is
-- unique on (org_id, reason, ref_id), and every purchase line carries the
-- purchase's id, so a webhook delivered twice, or a webhook and the page's
-- sync arriving together, write one line between them.
--
-- Only an owner buys: spending company money is an owner's act, as paying for
-- a step is (begin_payment_checkout). The functions are service-role only, so
-- the caller's user id is passed in by the server, which read it from the
-- caller's own session, and the owner test is made against that.
--
-- Safe with the current site live: one new table and new functions; nothing
-- existing changes.
-- ============================================================================

-- What each pack costs. 500 credits is $50, the rate the factory dashboard
-- and the Credits tab state. Every amount is minor units plus a currency.
create or replace function public.credit_packs()
returns table (credits integer, amount_cents bigint, currency char(3))
language sql
immutable
as $$
  values (500, 5000::bigint, 'USD'::char(3)),
         (1000, 10000::bigint, 'USD'::char(3)),
         (2500, 25000::bigint, 'USD'::char(3))
$$;

revoke all on function public.credit_packs() from public;
grant execute on function public.credit_packs() to authenticated, service_role;

create table public.credit_purchases (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.orgs (id) on delete cascade,

  -- The pack, as credit_packs() priced it when the purchase began.
  credits                   integer not null check (credits > 0),
  amount_cents              bigint not null check (amount_cents > 0),
  currency                  char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  stripe_payment_intent_id  text unique,

  -- pending   started; the card has not been charged
  -- failed    Stripe declined it; paying again on the same intent may still
  --           succeed, so this is not final
  -- succeeded charged, and the credits are on the ledger. Final.
  state                     text not null default 'pending'
                            check (state in ('pending', 'failed', 'succeeded')),
  failure_reason            text,
  -- "Visa ···4242", never more.
  payment_method_label      text,
  ledger_id                 uuid references public.credit_ledger (id) on delete set null,

  created_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  succeeded_at              timestamptz,
  failed_at                 timestamptz,

  constraint credit_purchase_state_stamps check (
    case state
      when 'succeeded' then succeeded_at is not null
      when 'failed'    then failed_at is not null
      else true
    end
  )
);

create index credit_purchases_org_idx on public.credit_purchases (org_id, created_at desc);

create trigger credit_purchases_touch
  before update on public.credit_purchases
  for each row execute function public.touch_updated_at();

-- The company's own members read its purchases; staff read everyone's, as
-- they read the ledger. Nobody writes from a client: default privileges hand
-- `authenticated` every privilege on a new table, so they are revoked
-- explicitly and only select is granted back.
alter table public.credit_purchases enable row level security;

create policy credit_purchases_read on public.credit_purchases
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

revoke all on public.credit_purchases from anon, authenticated;
grant select on public.credit_purchases to authenticated;

-- ---------------------------------------------------------------------------
-- Begin a purchase (service_role alone)
-- ---------------------------------------------------------------------------
-- The owner test comes first, before anything about the company is read, so
-- a stranger learns nothing from the answer. `buyer` is the caller's user id,
-- taken by the server from the caller's own session.
-- ---------------------------------------------------------------------------

create or replace function public.create_credit_purchase(
  target_org   uuid,
  pack_credits integer,
  buyer        uuid
)
returns public.credit_purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p     public.credit_purchases;
  kind  public.org_type;
  price bigint;
  cur   char(3);
begin
  if buyer is null or not exists (
    select 1 from public.org_members
    where org_id = target_org and user_id = buyer and role = 'owner'
  ) then
    raise exception 'only an owner of the company can buy credits' using errcode = '42501';
  end if;

  select type into kind from public.orgs where id = target_org;
  if kind is distinct from 'factory' then
    raise exception 'credits are for vendors sending quotes' using errcode = '22023';
  end if;

  select c.amount_cents, c.currency into price, cur
  from public.credit_packs() c
  where c.credits = pack_credits;
  if not found then
    raise exception 'there is no pack of % credits', pack_credits using errcode = '22023';
  end if;

  insert into public.credit_purchases (org_id, credits, amount_cents, currency, created_by)
  values (target_org, pack_credits, price, cur, buyer)
  returning * into p;
  return p;
end;
$$;

-- The PaymentIntent made for it. One per purchase.
create or replace function public.attach_credit_purchase_intent(
  target_purchase uuid,
  payment_intent  text
)
returns public.credit_purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.credit_purchases;
begin
  select * into p from public.credit_purchases where id = target_purchase for update;
  if not found then
    raise exception 'credit purchase not found' using errcode = 'P0002';
  end if;
  if p.stripe_payment_intent_id is not null and p.stripe_payment_intent_id <> payment_intent then
    raise exception 'this purchase already has a different PaymentIntent' using errcode = '22023';
  end if;

  update public.credit_purchases
     set stripe_payment_intent_id = payment_intent
   where id = p.id
  returning * into p;
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- What only the server records (service_role alone)
-- ---------------------------------------------------------------------------
-- Stripe charged the card: write the credits and mark the purchase, in one
-- transaction. Running it again changes nothing (the purchase is already
-- succeeded, and the ledger's unique index would refuse a second line).
-- ---------------------------------------------------------------------------

create or replace function public.record_credit_purchase_succeeded(
  target_purchase uuid,
  payment_intent  text,
  received        bigint,
  method_label    text
)
returns public.credit_purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p    public.credit_purchases;
  line uuid;
begin
  select * into p from public.credit_purchases where id = target_purchase for update;
  if not found then
    raise exception 'credit purchase not found' using errcode = 'P0002';
  end if;
  if p.state = 'succeeded' then
    return p;
  end if;
  if p.stripe_payment_intent_id is not null and p.stripe_payment_intent_id <> payment_intent then
    raise exception 'this purchase was paid on a different PaymentIntent' using errcode = '22023';
  end if;
  -- The intent is made at the pack's price and never changed, so anything
  -- else is not this purchase's money: grant nothing and say so.
  if received is distinct from p.amount_cents then
    raise exception 'received % but this pack costs %', received, p.amount_cents using errcode = '22023';
  end if;

  insert into public.credit_ledger (org_id, delta, reason, ref_type, ref_id, note, created_by)
  values (p.org_id, p.credits, 'purchase', 'credit_purchase', p.id,
          to_char(p.credits, 'FM999,999,999') || ' credits bought', p.created_by)
  -- Matches credit_ledger_once_idx, which is partial on ref_id.
  on conflict (org_id, reason, ref_id) where ref_id is not null do nothing
  returning id into line;

  if line is null then
    select id into line from public.credit_ledger
    where org_id = p.org_id and reason = 'purchase' and ref_id = p.id;
  end if;

  update public.credit_purchases
     set state = 'succeeded',
         succeeded_at = now(),
         failure_reason = null,
         stripe_payment_intent_id = payment_intent,
         payment_method_label = coalesce(method_label, payment_method_label),
         ledger_id = line
   where id = p.id
  returning * into p;
  return p;
end;
$$;

-- Stripe declined the card. Never overrides a success: events arrive in any
-- order, and a decline followed by a successful retry must end succeeded.
create or replace function public.record_credit_purchase_failed(
  target_purchase uuid,
  payment_intent  text,
  reason          text
)
returns public.credit_purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.credit_purchases;
begin
  select * into p from public.credit_purchases where id = target_purchase for update;
  if not found then
    raise exception 'credit purchase not found' using errcode = 'P0002';
  end if;
  if p.state = 'succeeded' then
    return p;
  end if;
  if p.stripe_payment_intent_id is not null and p.stripe_payment_intent_id <> payment_intent then
    raise exception 'this purchase belongs to a different PaymentIntent' using errcode = '22023';
  end if;

  update public.credit_purchases
     set state = 'failed',
         failed_at = now(),
         failure_reason = coalesce(nullif(reason, ''), 'The payment did not go through.'),
         stripe_payment_intent_id = payment_intent
   where id = p.id
  returning * into p;
  return p;
end;
$$;

revoke all on function public.create_credit_purchase(uuid, integer, uuid)                   from public, anon, authenticated;
revoke all on function public.attach_credit_purchase_intent(uuid, text)                     from public, anon, authenticated;
revoke all on function public.record_credit_purchase_succeeded(uuid, text, bigint, text)    from public, anon, authenticated;
revoke all on function public.record_credit_purchase_failed(uuid, text, text)               from public, anon, authenticated;
grant execute on function public.create_credit_purchase(uuid, integer, uuid)                to service_role;
grant execute on function public.attach_credit_purchase_intent(uuid, text)                  to service_role;
grant execute on function public.record_credit_purchase_succeeded(uuid, text, bigint, text) to service_role;
grant execute on function public.record_credit_purchase_failed(uuid, text, text)            to service_role;
