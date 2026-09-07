-- ============================================================================
-- 005  Credit ledger and discount codes  (schema only — no UI in Phase 1)
-- ----------------------------------------------------------------------------
-- Neither of these exists in the prototypes; both are described in the product
-- walkthrough. They are built now because a ledger cannot be retrofitted: once
-- balances have moved without a recorded history, the referral maths can never
-- be reconstructed or defended in a dispute.
--
-- Balance is ALWAYS sum(delta). There is deliberately no mutable balance
-- column anywhere in this file.
--
-- Open question, deliberately unenforced: what spending a credit actually
-- buys. The walkthrough grants 500 on factory onboarding, sells more, and
-- grants 500 per referral, but never says what consumes one. The most likely
-- rule by analogy is one credit per quote submitted, so 'quote_submission'
-- exists in the reason enum. Nothing in this migration spends anything.
-- ============================================================================

create type public.credit_reason as enum (
  'onboarding_grant',
  'referral_grant',
  'purchase',
  'admin_adjustment',
  'quote_submission',   -- reserved; see note above
  'refund'
);

create table public.credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,

  -- Positive grants, negative spends. Never zero.
  delta       integer not null check (delta <> 0),
  reason      public.credit_reason not null,

  -- What caused this line: an order, a quote, a referral, a purchase.
  ref_type    text,
  ref_id      uuid,

  note        text,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index credit_ledger_org_idx on public.credit_ledger (org_id, created_at desc);

-- Grant a given reason at most once per org per referenced thing. Stops a
-- double-fired onboarding grant from silently doubling someone's balance.
create unique index credit_ledger_once_idx
  on public.credit_ledger (org_id, reason, ref_id)
  where ref_id is not null;

create or replace function public.credit_balance(org uuid)
returns integer
language sql
stable
as $$
  select coalesce(sum(delta), 0)::integer
  from public.credit_ledger
  where org_id = org;
$$;

-- ---------------------------------------------------------------------------
-- Discount codes
-- ---------------------------------------------------------------------------
-- The $50 join credit, and the codes a brand generates to invite other brands.
-- Currency is stored on every monetary row from the start: v1 offers USD only,
-- but RMB is a certainty and adding a currency column to a populated payments
-- table later is invasive.
-- ---------------------------------------------------------------------------

create table public.discount_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9-]{4,32}$'),

  -- The org that owns/generated the code. Null for platform-wide codes.
  owner_org_id  uuid references public.orgs (id) on delete cascade,

  amount_cents  integer not null check (amount_cents > 0),
  currency      char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  max_uses      integer not null default 1 check (max_uses > 0),
  expires_at    timestamptz,
  revoked_at    timestamptz,

  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index discount_codes_owner_idx on public.discount_codes (owner_org_id);

create table public.discount_redemptions (
  id            uuid primary key default gen_random_uuid(),
  code_id       uuid not null references public.discount_codes (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,

  -- Set once the code is actually applied to an order (Phase 4).
  order_id      uuid,
  amount_cents  integer not null check (amount_cents > 0),
  currency      char(3) not null default 'USD',

  redeemed_at   timestamptz not null default now(),

  -- One org may only ever redeem a given code once.
  unique (code_id, org_id)
);

create index discount_redemptions_org_idx on public.discount_redemptions (org_id);

-- ---------------------------------------------------------------------------
-- Referrals — brand invites brand, factory invites factory
-- ---------------------------------------------------------------------------

create table public.referrals (
  id              uuid primary key default gen_random_uuid(),
  referrer_org_id uuid not null references public.orgs (id) on delete cascade,
  email           text not null check (email = lower(email)),
  message         text,

  -- Set when the invited party actually signs up and creates an org.
  referred_org_id uuid references public.orgs (id) on delete set null,
  accepted_at     timestamptz,

  discount_code_id uuid references public.discount_codes (id) on delete set null,

  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index referrals_referrer_idx on public.referrals (referrer_org_id);
create unique index referrals_pending_idx on public.referrals (referrer_org_id, email)
  where accepted_at is null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- The ledger is readable by its org but writable by nobody: every line is
-- written by a security-definer function or an admin, never by a client. That
-- is the whole point of an append-only ledger.
-- ---------------------------------------------------------------------------

alter table public.credit_ledger         enable row level security;
alter table public.discount_codes        enable row level security;
alter table public.discount_redemptions  enable row level security;
alter table public.referrals             enable row level security;

create policy credit_ledger_read on public.credit_ledger
  for select to authenticated
  using (org_id in (select public.current_org_ids()) or public.is_platform_admin());

-- A code is readable by its owner, and by anyone holding the exact code
-- string (checked in the redemption RPC, not here).
create policy discount_codes_owner_read on public.discount_codes
  for select to authenticated
  using (
    owner_org_id in (select public.current_org_ids())
    or public.is_platform_admin()
  );

create policy discount_redemptions_read on public.discount_redemptions
  for select to authenticated
  using (org_id in (select public.current_org_ids()) or public.is_platform_admin());

create policy referrals_own on public.referrals
  for all to authenticated
  using (public.is_org_member(referrer_org_id) or public.is_platform_admin())
  with check (public.is_org_member(referrer_org_id));

grant select                         on public.credit_ledger        to authenticated;
grant select                         on public.discount_codes       to authenticated;
grant select                         on public.discount_redemptions to authenticated;
grant select, insert, update, delete on public.referrals            to authenticated;
