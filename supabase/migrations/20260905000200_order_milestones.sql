-- ============================================================================
-- 027  Order milestones
-- ----------------------------------------------------------------------------
-- The prototype carries TWO milestone vocabularies and neither is complete.
-- src/prototype/main.jsx:576 names the actions "Approve fund" / "Approve" /
-- "Fund milestone"; line 629 of the same file names the types "Paid release" /
-- "Approval only" / "Update only". They are not two names for one set:
--
--     approval?  payment?   prototype action   prototype type
--     yes        yes        Approve fund       Paid release
--     yes        no         Approve            Approval only
--     no         yes        Fund milestone     —              (bulk deposit)
--     no         no         —                  Update only    (bulk production)
--
-- Each list is missing a row the other has, and both rows are populated by
-- real entries in the prototype's own data. The union is the full 2x2, so the
-- enum has four values and neither set of strings survives.
--
-- The two sides' differing wording — "Waiting for sample approval" to the
-- factory, "Fit sample ready" to the brand — is derived in the client from
-- (kind, state, payment state). There is no label column anywhere.
-- ============================================================================

create type public.milestone_type as enum (
  'approval_and_payment',  -- a sample: brand reviews it, and money follows
  'approval_only',         -- lab dip, QC photos: sign-off, no money
  'payment_only',          -- bulk deposit: money, nothing to review
  'progress_only'          -- bulk production: neither, but it takes time
);

create type public.milestone_state as enum (
  'pending',
  'active',      -- the factory may work on it
  'submitted',   -- the factory says it is ready for the brand
  'approved',    -- the brand accepted it; payment (if any) is now due
  'complete',
  'cancelled'
);

create table public.order_milestones (
  id       uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.production_orders (id) on delete cascade,

  -- NOT unique with order_id. Ties are how genuine parallelism is expressed:
  -- a lab dip and a strike-off run at the same time and open together.
  sort     integer not null default 0,

  kind        public.milestone_type not null,
  title       text not null check (length(btrim(title)) > 0),
  description text,

  -- Provenance only. The amount is snapshotted below, so editing the quote's
  -- sample lines afterwards cannot rewrite what this order costs.
  source_sample_line_id uuid references public.quote_sample_lines (id) on delete set null,

  amount_cents bigint check (amount_cents is null or amount_cents >= 0),
  currency     char(3) not null default 'USD' check (currency = 'USD'),
  due_on       date,

  state         public.milestone_state not null default 'pending',
  submitted_at  timestamptz,
  approved_by   uuid references auth.users (id) on delete set null,
  approved_at   timestamptz,
  approval_note text,
  completed_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- This is the schema-level answer to "does an approval-only milestone get a
  -- payment row?". No: it cannot even carry an amount. A zero-amount payment
  -- placeholder would sit in the admin's queue forever and make the obvious
  -- "is anything outstanding" query permanently true.
  constraint milestone_amount_matches_kind check (
    (kind in ('approval_and_payment', 'payment_only')
      and amount_cents is not null and amount_cents > 0)
    or
    (kind in ('approval_only', 'progress_only') and amount_cents is null)
  ),
  constraint milestone_approval_stamp check ((approved_at is null) = (approved_by is null)),
  constraint milestone_approved_needs_approvable check (
    state <> 'approved' or kind in ('approval_and_payment', 'approval_only')
  ),
  constraint milestone_complete_stamp check (state <> 'complete' or completed_at is not null)
);

create index order_milestones_order_idx on public.order_milestones (order_id, sort);
create index order_milestones_state_idx on public.order_milestones (order_id, state);

create trigger order_milestones_touch
  before update on public.order_milestones
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Currency must match the order
-- ---------------------------------------------------------------------------
-- Every currency check in this schema is per-row, so nothing today says a
-- milestone's currency matches the order it belongs to. Only USD is offered,
-- so this cannot fire yet — which is exactly why it is cheap to add now. The
-- day RMB lands, summing mixed rows returns a number that is plausible,
-- displayed, and meaningless, and that is not a bug anyone finds by looking.
-- ---------------------------------------------------------------------------

create or replace function public.order_milestone_currency_matches()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.currency is distinct from public.order_currency_of(new.order_id) then
    raise exception 'a milestone must be in the same currency as its order'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger order_milestones_currency_guard
  before insert or update on public.order_milestones
  for each row execute function public.order_milestone_currency_matches();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.milestone_order(target_milestone uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select order_id from public.order_milestones where id = target_milestone; $$;

create or replace function public.milestone_kind_of(target_milestone uuid)
returns public.milestone_type
language sql stable security definer
set search_path = public, pg_temp
as $$ select kind from public.order_milestones where id = target_milestone; $$;

revoke all on function public.milestone_order(uuid)    from public;
revoke all on function public.milestone_kind_of(uuid)  from public;
grant execute on function public.milestone_order(uuid)   to authenticated;
grant execute on function public.milestone_kind_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.order_milestones enable row level security;

create policy order_milestones_read on public.order_milestones
  for select to authenticated
  using (public.is_order_party(order_id) or public.is_platform_admin());

grant select on public.order_milestones to authenticated;
