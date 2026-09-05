-- ============================================================================
-- 029  Order payments
-- ----------------------------------------------------------------------------
-- The platform never holds a cent. A brand wires money to a factory, an admin
-- confirms it arrived, and the factory starts work on the confirmation rather
-- than on the brand's word. That last clause is the entire product: a factory
-- in Ningbo has no reason to trust a brand in Brooklyn, and this table is what
-- it trusts instead.
--
-- Which is why the factory reads its own payment rows including every stamp.
-- Redacting confirmed_by from the factory would remove the only thing here
-- worth having.
-- ============================================================================

create type public.payment_state as enum (
  'not_due',    -- the milestone it belongs to has not been reached
  'due',        -- the brand owes it
  'sent',       -- the brand says it wired it; NOT the same as arrived
  'confirmed',  -- an admin saw it land. work may start
  'released',   -- paid on to the factory
  'cancelled'
);

create table public.order_payments (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.production_orders (id) on delete cascade,

  -- One payment per milestone, always. The unique index is what makes
  -- "the amount outstanding" a question with one answer.
  milestone_id uuid not null unique references public.order_milestones (id) on delete cascade,

  -- Snapshotted from the milestone rather than read through it, so an admin
  -- correcting a milestone's title can never move money.
  amount_cents bigint  not null check (amount_cents > 0),
  currency     char(3) not null default 'USD' check (currency = 'USD'),

  -- Frozen per payment at creation. Charged at zero today; the column exists
  -- so that turning the fee on later cannot retroactively rewrite what a brand
  -- was already shown. The fee itself is COMPUTED from this — see
  -- payment_fee_cents below — because storing both would be two sources of
  -- truth for a number nobody collects.
  fee_bps integer not null default 0 check (fee_bps between 0 and 10000),

  state public.payment_state not null default 'not_due',

  due_at          timestamptz,
  brand_reference text,          -- the reference the brand quoted to its bank

  sent_by   uuid references auth.users (id) on delete set null,
  sent_at   timestamptz,
  sent_note text,

  confirmed_by   uuid references auth.users (id) on delete set null,
  confirmed_at   timestamptz,
  confirmed_note text,
  -- May legitimately differ from amount_cents after bank charges or FX. It is
  -- recorded, not validated equal: a $4 shortfall is a fact about the world,
  -- not a reason to refuse the confirmation.
  amount_received_cents bigint check (amount_received_cents is null or amount_received_cents >= 0),

  released_by   uuid references auth.users (id) on delete set null,
  released_at   timestamptz,
  released_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payment_sent_stamp      check ((sent_at is null)      = (sent_by is null)),
  constraint payment_confirmed_stamp check ((confirmed_at is null) = (confirmed_by is null)),
  constraint payment_released_stamp  check ((released_at is null)  = (released_by is null)),
  constraint payment_state_implies_stamps check (
    case state
      when 'sent'      then sent_at is not null
      when 'confirmed' then sent_at is not null and confirmed_at is not null
      when 'released'  then confirmed_at is not null and released_at is not null
      else true
    end
  )
);

create index order_payments_order_idx on public.order_payments (order_id, state);
-- The admin queue reads this one.
create index order_payments_state_idx on public.order_payments (state, sent_at);

create trigger order_payments_touch
  before update on public.order_payments
  for each row execute function public.touch_updated_at();

-- Against service_role, which holds a blanket write grant and BYPASSRLS. The
-- milestone_amount_matches_kind constraint already makes an approval-only
-- milestone unable to carry an amount; this makes it unable to carry a
-- payment row either, from any caller.
create or replace function public.payment_requires_paying_milestone()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.milestone_kind_of(new.milestone_id)
     not in ('approval_and_payment', 'payment_only') then
    raise exception 'that milestone does not involve a payment'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger order_payments_kind_guard
  before insert or update on public.order_payments
  for each row execute function public.payment_requires_paying_milestone();

-- Computed, never stored. Same reasoning as quote_sample_subtotal(): nothing
-- to keep in sync, and no way for the total to disagree with its parts.
create or replace function public.payment_fee_cents(target_payment uuid)
returns bigint
language sql stable
as $$
  select coalesce((amount_cents * fee_bps) / 10000, 0)
  from public.order_payments
  where id = target_payment;
$$;

grant execute on function public.payment_fee_cents(uuid) to authenticated;

create or replace function public.payment_order(target_payment uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select order_id from public.order_payments where id = target_payment; $$;

create or replace function public.payment_brand_org(target_payment uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select o.brand_org_id
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  where p.id = target_payment;
$$;

revoke all on function public.payment_order(uuid)      from public;
revoke all on function public.payment_brand_org(uuid)  from public;
grant execute on function public.payment_order(uuid)     to authenticated;
grant execute on function public.payment_brand_org(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- payment_events
-- ---------------------------------------------------------------------------
-- The stamp columns above answer "who confirmed this". They structurally
-- cannot answer "was this ever bounced back", because a rejection returns the
-- row to `due` and it keeps its last sent stamps. In a dispute that second
-- question is the one that gets asked.
-- ---------------------------------------------------------------------------

create table public.payment_events (
  id         uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments (id) on delete cascade,

  from_state public.payment_state,
  to_state   public.payment_state not null,

  actor_user_id uuid references auth.users (id) on delete set null,
  actor_kind    text not null check (actor_kind in ('brand', 'factory', 'admin', 'system')),
  note          text,

  created_at timestamptz not null default now()
);

create index payment_events_payment_idx on public.payment_events (payment_id, created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.order_payments enable row level security;
alter table public.payment_events enable row level security;

create policy order_payments_read on public.order_payments
  for select to authenticated
  using (public.is_order_party(order_id) or public.is_platform_admin());

create policy payment_events_read on public.payment_events
  for select to authenticated
  using (
    public.is_order_party(public.payment_order(payment_id))
    or public.is_platform_admin()
  );

-- Select only, on both. credit_ledger exactly.
grant select on public.order_payments to authenticated;
grant select on public.payment_events to authenticated;
