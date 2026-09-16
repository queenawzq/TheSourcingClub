-- ============================================================================
-- 030  Factory payout accounts
-- ----------------------------------------------------------------------------
-- A brand cannot "see payment instructions" without somewhere to read them
-- from. This is that place.
--
-- There is deliberately NO full account number column. The platform never
-- touches funds, so it has no operational need for one, and storing one would
-- create a breach class the rest of this schema does not have — a single
-- compromised read would hand over every factory's banking details. A factory
-- that wants to put its full number in front of a brand can put it in
-- `instructions`, which is its own choice about its own data rather than ours
-- about everyone's.
--
-- Writes require is_org_OWNER, not member. Changing where a factory's money is
-- sent is the single highest-value target in this system: an attacker with a
-- junior member's session does not need to breach anything else if they can
-- redirect a $50,000 balance payment.
-- ============================================================================

create table public.factory_payout_accounts (
  id     uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,

  label        text,
  bank_name    text,
  account_name text,
  -- Enough to recognise the account on a statement, useless to an attacker.
  account_number_last4 text check (
    account_number_last4 is null or account_number_last4 ~ '^[0-9]{2,4}$'
  ),
  swift        text,
  iban         text,
  bank_country char(2),
  instructions text,

  is_primary boolean not null default false,

  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index factory_payout_one_primary
  on public.factory_payout_accounts (org_id) where is_primary;

create index factory_payout_org_idx on public.factory_payout_accounts (org_id);

create trigger factory_payout_accounts_touch
  before update on public.factory_payout_accounts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Who may read a factory's bank details
-- ---------------------------------------------------------------------------
-- A brand, and only once it actually owes this factory money. `not_due` is
-- deliberately excluded from the test: bank details appear when there is a
-- payment to make, not the moment a contract exists. An agreed schedule is not
-- a reason to hand over banking information.
-- ---------------------------------------------------------------------------

create or replace function public.caller_may_see_payout_account(factory_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.production_orders o
    join public.order_payments p on p.order_id = o.id
    where o.factory_org_id = factory_org
      and o.status = 'active'
      and o.brand_org_id in (select public.current_org_ids())
      and p.state in ('due', 'sent', 'confirmed', 'released')
  );
$$;

revoke all on function public.caller_may_see_payout_account(uuid) from public;
grant execute on function public.caller_may_see_payout_account(uuid) to authenticated;

alter table public.factory_payout_accounts enable row level security;

create policy factory_payout_read on public.factory_payout_accounts
  for select to authenticated
  using (
    public.is_org_member(org_id)
    or public.is_platform_admin()
    or public.caller_may_see_payout_account(org_id)
  );

create policy factory_payout_write on public.factory_payout_accounts
  for insert to authenticated
  with check (public.is_org_owner(org_id));

create policy factory_payout_update on public.factory_payout_accounts
  for update to authenticated
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

create policy factory_payout_delete on public.factory_payout_accounts
  for delete to authenticated
  using (public.is_org_owner(org_id));

grant select, insert, update, delete on public.factory_payout_accounts to authenticated;
