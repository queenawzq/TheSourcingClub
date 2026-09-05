-- ============================================================================
-- 026  Production orders
-- ----------------------------------------------------------------------------
-- An awarded quote becomes work that runs. This table is the contract: the
-- commercial terms are COPIED here at award, not joined back to the quote, so
-- a later revision cannot rewrite what an executed order says. "They agreed
-- $18.40" has to stay answerable after the quote has moved on.
--
-- Money never passes through this platform. It moves by bank transfer between
-- the two parties, and what is recorded here is the fact that it happened and
-- who confirmed it. That is the whole reason the payment tables downstream
-- look like an audit log rather than a wallet.
-- ============================================================================

create type public.order_status as enum (
  'pending_schedule',  -- milestones drafted, waiting for both sides to agree
  'active',            -- work is running
  'completed',
  'cancelled'
);

-- A bank transfer needs a reference a human can read down a phone line.
create sequence public.order_number_seq;

create table public.production_orders (
  id             uuid primary key default gen_random_uuid(),
  order_number   text not null unique
                   default 'TSC-' || lpad(nextval('public.order_number_seq')::text, 6, '0'),

  rfq_id         uuid not null references public.rfqs (id),
  -- One order per quote, and this index is what actually makes a double award
  -- impossible. award_quote's row lock only makes the error message nicer.
  quote_id       uuid not null unique references public.quotes (id),
  brand_org_id   uuid not null references public.orgs (id),
  factory_org_id uuid not null references public.orgs (id),
  status         public.order_status not null default 'pending_schedule',

  -- ── the contract snapshot ────────────────────────────────────────────────
  -- bigint, not integer: unit_price_cents * production_quantity passes int4 at
  -- 100,000 units of a $250 jacket. A unit price never overflows, which is why
  -- quotes.unit_price_cents stays integer; a total does.
  unit_price_cents      bigint  not null check (unit_price_cents >= 0),
  production_quantity   integer not null check (production_quantity > 0),
  bulk_subtotal_cents   bigint  not null check (bulk_subtotal_cents >= 0),
  sample_subtotal_cents bigint  not null check (sample_subtotal_cents >= 0),
  order_total_cents     bigint  not null check (order_total_cents >= 0),
  currency              char(3) not null default 'USD' check (currency = 'USD'),

  bulk_lead_time_days   integer check (bulk_lead_time_days is null or bulk_lead_time_days >= 0),
  deposit_pct           numeric(5,2) not null check (deposit_pct between 0 and 100),
  balance_pct           numeric(5,2) not null check (balance_pct between 0 and 100),
  incoterm_id           uuid references public.taxonomy_terms (id),
  payment_term_id       uuid references public.taxonomy_terms (id),
  capacity_window_start date,
  capacity_window_end   date,

  -- The design system asks for exactly one editable "Contract specifics"
  -- field. This is it, and it is the only part of the snapshot that is prose.
  agreed_scope          text,
  contract_document_id  uuid references public.documents (id),

  -- ── both sides agree before work starts ──────────────────────────────────
  schedule_revision          integer not null default 1 check (schedule_revision > 0),
  schedule_brand_agreed_at   timestamptz,
  schedule_brand_agreed_by   uuid references auth.users (id) on delete set null,
  schedule_factory_agreed_at timestamptz,
  schedule_factory_agreed_by uuid references auth.users (id) on delete set null,

  -- ── leaving early ────────────────────────────────────────────────────────
  cancel_proposed_by_org uuid references public.orgs (id),
  cancel_proposed_at     timestamptz,
  cancel_reason          text,

  activated_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint order_deposit_balance_sum check (deposit_pct + balance_pct = 100),
  constraint order_totals_add_up check (
    order_total_cents = bulk_subtotal_cents + sample_subtotal_cents
  ),
  constraint order_capacity_window_ordered check (
    capacity_window_start is null
    or capacity_window_end is null
    or capacity_window_start <= capacity_window_end
  ),
  constraint order_brand_agree_stamp check (
    (schedule_brand_agreed_at is null) = (schedule_brand_agreed_by is null)
  ),
  constraint order_factory_agree_stamp check (
    (schedule_factory_agreed_at is null) = (schedule_factory_agreed_by is null)
  ),
  -- The structural form of "both sides must agree". Whatever a function does,
  -- an active order with one signature cannot exist.
  constraint order_active_needs_both check (
    status <> 'active'
    or (schedule_brand_agreed_at is not null and schedule_factory_agreed_at is not null)
  ),
  constraint order_parties_differ check (brand_org_id <> factory_org_id)
);

create index production_orders_brand_idx   on public.production_orders (brand_org_id, status);
create index production_orders_factory_idx on public.production_orders (factory_org_id, status);
create index production_orders_status_idx  on public.production_orders (status);
create index production_orders_rfq_idx     on public.production_orders (rfq_id);

create trigger production_orders_touch
  before update on public.production_orders
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Notifications gain an order
-- ---------------------------------------------------------------------------
-- A milestone or payment notification is not addressable without knowing which
-- order it belongs to, and notificationLink() needs to build a URL from the
-- row alone. subject_id carries the milestone or payment; this carries the
-- order they hang off.
-- ---------------------------------------------------------------------------

alter table public.notifications
  add column order_id uuid references public.production_orders (id) on delete cascade;

create index notifications_order_idx on public.notifications (order_id) where order_id is not null;

-- ---------------------------------------------------------------------------
-- Party helpers
-- ---------------------------------------------------------------------------
-- security definer, and built before anything needs them. There is no policy
-- cycle today — production_orders' own policy does not read milestones — but
-- the moment a policy anywhere reads across these tables the loop closes, and
-- this project has hit "infinite recursion detected in policy" twice already.
-- ---------------------------------------------------------------------------

create or replace function public.order_brand_org(target_order uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select brand_org_id from public.production_orders where id = target_order; $$;

create or replace function public.order_factory_org(target_order uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select factory_org_id from public.production_orders where id = target_order; $$;

create or replace function public.order_status_of(target_order uuid)
returns public.order_status
language sql stable security definer
set search_path = public, pg_temp
as $$ select status from public.production_orders where id = target_order; $$;

create or replace function public.order_currency_of(target_order uuid)
returns char(3)
language sql stable security definer
set search_path = public, pg_temp
as $$ select currency from public.production_orders where id = target_order; $$;

-- The single question every downstream policy asks.
create or replace function public.is_order_party(target_order uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.production_orders o
    where o.id = target_order
      and (o.brand_org_id in (select public.current_org_ids())
        or o.factory_org_id in (select public.current_org_ids()))
  );
$$;

revoke all on function public.order_brand_org(uuid)   from public;
revoke all on function public.order_factory_org(uuid) from public;
revoke all on function public.order_status_of(uuid)   from public;
revoke all on function public.order_currency_of(uuid) from public;
revoke all on function public.is_order_party(uuid)    from public;

grant execute on function public.order_brand_org(uuid)   to authenticated;
grant execute on function public.order_factory_org(uuid) to authenticated;
grant execute on function public.order_status_of(uuid)   to authenticated;
grant execute on function public.order_currency_of(uuid) to authenticated;
grant execute on function public.is_order_party(uuid)    to authenticated;

-- ---------------------------------------------------------------------------
-- The snapshot is immutable
-- ---------------------------------------------------------------------------
-- RLS below grants select and nothing else, which settles the browser. It does
-- NOT settle service_role: migration 008 grants it full DML on every future
-- table by default privilege, and it carries BYPASSRLS. So "the terms cannot
-- be edited" is enforced by a trigger, because a policy would not be enforcing
-- it against the one caller that could do the most damage.
-- ---------------------------------------------------------------------------

create or replace function public.production_orders_snapshot_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.rfq_id                is distinct from old.rfq_id
     or new.quote_id           is distinct from old.quote_id
     or new.brand_org_id       is distinct from old.brand_org_id
     or new.factory_org_id     is distinct from old.factory_org_id
     or new.order_number       is distinct from old.order_number
     or new.unit_price_cents   is distinct from old.unit_price_cents
     or new.production_quantity is distinct from old.production_quantity
     or new.bulk_subtotal_cents is distinct from old.bulk_subtotal_cents
     or new.sample_subtotal_cents is distinct from old.sample_subtotal_cents
     or new.order_total_cents  is distinct from old.order_total_cents
     or new.currency           is distinct from old.currency
     or new.deposit_pct        is distinct from old.deposit_pct
     or new.balance_pct        is distinct from old.balance_pct
     or new.incoterm_id        is distinct from old.incoterm_id
     or new.payment_term_id    is distinct from old.payment_term_id
  then
    raise exception 'the agreed terms of an order cannot be changed; a real change needs a new quote'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger production_orders_snapshot_guard
  before update on public.production_orders
  for each row execute function public.production_orders_snapshot_immutable();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.production_orders enable row level security;

-- Parties and admins. Deliberately NO branch for a factory that merely quoted:
-- a losing factory learns from its quote_declined notification that it lost,
-- and nothing else — not who won, not at what price, not on what schedule.
create policy production_orders_read on public.production_orders
  for select to authenticated
  using (
    brand_org_id in (select public.current_org_ids())
    or factory_org_id in (select public.current_org_ids())
    or public.is_platform_admin()
  );

-- Select only. Every mutation goes through a definer function, following
-- credit_ledger — and for a reason a policy structurally cannot cover: an
-- UPDATE policy's `using` clause can gate the source state, but its
-- `with check` cannot stop the same statement writing a confirmation stamp
-- alongside it. A policy gates the transition; it cannot gate the payload.
grant select on public.production_orders to authenticated;
