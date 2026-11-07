-- ============================================================================
-- Where a factory in China is paid: a bank account Wise can pay, or PayPal
-- ----------------------------------------------------------------------------
-- Meeting, Nov 6: Stripe cannot reach mainland China, so it goes by Wise bank
-- transfer and PayPal, both called by the server. Payoneer leaves the choices;
-- rows already saved keep working on the staff board.
--
-- A bank account Wise can pay is still method 'bank', so staff's "Mark paid out
-- by bank" stays the fallback with no second path: holder, SWIFT, country and
-- last four sit on the usual columns, the number in Vault as #77 has it. Wise's
-- own form (its field keys and values, whatever they are for this currency) is
-- wise_details, with no number in it, ever.
--
-- What the factory reads about a payment on its way is provider_payouts: never
-- on order_payments, which the brand can read.
--
-- Safe with the live site while applied: columns are only added, a method the
-- live site does not know is not written by it, and the board only gains columns.
-- ============================================================================

alter table public.factory_payout_accounts
  drop constraint factory_payout_accounts_method_check,
  add constraint factory_payout_accounts_method_check check (method in ('bank', 'payoneer', 'paypal')),
  add column paypal_email text,
  -- Set together by save_wise_payout_account(). Null: a bank account only staff can pay.
  add column wise_recipient_type text,
  add column wise_currency char(3),
  add column wise_number_key text,
  add column wise_details jsonb,
  -- The recipient Wise made from these details. Set by set_wise_recipient();
  -- the guard clears it the moment anything it was made from changes.
  add column wise_recipient_id text;

alter table public.factory_payout_accounts
  drop constraint factory_payout_method_details,
  add constraint factory_payout_method_details check (
    case method
      when 'bank' then bank_name is not null and btrim(bank_name) <> '' and payoneer_email is null and paypal_email is null
      when 'payoneer' then
        payoneer_email is not null
        and payoneer_email = lower(btrim(payoneer_email))
        and length(payoneer_email) <= 254
        and payoneer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and paypal_email is null
        and bank_name is null and account_number_last4 is null and swift is null and iban is null
      when 'paypal' then
        paypal_email is not null
        and paypal_email = lower(btrim(paypal_email))
        and length(paypal_email) <= 254
        and paypal_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and payoneer_email is null
        and bank_name is null and account_number_last4 is null and swift is null and iban is null
        and wise_details is null
    end
  ) not valid;

create unique index factory_payout_one_paypal_email
  on public.factory_payout_accounts (org_id, paypal_email) where method = 'paypal';

-- ---------------------------------------------------------------------------
-- Whether a name is in Latin characters: what Wise requires for CNY to a
-- company. Printable ASCII and accented Latin, with at least one letter.
-- Full-width letters are refused: they look Latin and are not.
-- ---------------------------------------------------------------------------
create or replace function public.payout_name_is_latin(value text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(value, '') !~ '[^ -~À-ɏ’]'
     and coalesce(value, '') ~ '[A-Za-zÀ-ɏ]'
$$;

revoke all on function public.payout_name_is_latin(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The guard (from 20261106600000). Changed: Wise's form is held to the same
-- rule as every other field, no number in it however it is keyed or spaced;
-- only the server writes wise_recipient_id, and any change to what it was made
-- from clears it, or the next payment would go to the old account. PayPal's
-- address and Wise's form count as a change of where the money goes.
-- ---------------------------------------------------------------------------
create or replace function public.guard_payout_account_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored public.payout_account_numbers;
  plain text;
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'a payout account stays with its company'
      using errcode = '42501', hint = 'payout_org_locked';
  end if;

  if new.iban is not null and btrim(new.iban) <> ''
     and (tg_op = 'INSERT' or new.iban is distinct from old.iban) then
    raise exception 'an IBAN belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;
  new.iban := null;

  select * into stored from public.payout_account_numbers where account_id = new.id;

  if stored.account_id is not null and new.method <> 'bank' then
    delete from public.payout_account_numbers where account_id = new.id;
    stored := null;
  end if;

  if stored.account_id is not null then
    plain := public.payout_number_plain(new.id);
    if new.account_number_last4 is distinct from right(regexp_replace(plain, '[^0-9]', '', 'g'), 4) then
      delete from public.payout_account_numbers where account_id = new.id;
      stored := null;
    end if;
  end if;

  if public.payout_text_holds_number(new.org_id, concat_ws(' ', new.label)) then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;
  if public.payout_text_holds_number(new.org_id, new.bank_name)
     or public.payout_text_holds_number(new.org_id, new.account_name)
     or public.payout_text_holds_number(new.org_id, new.branch)
     or public.payout_text_holds_number(new.org_id, new.swift)
     or public.payout_text_holds_number(new.org_id, new.instructions)
     or public.payout_text_holds_number(new.org_id, new.wise_details::text) then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;

  if new.wise_details is not null and exists (
    select 1 from jsonb_object_keys(new.wise_details) as k(name)
     where k.name ~* '(account.?number|iban|card.?number|clabe)'
        or k.name = new.wise_number_key
  ) then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;

  new.number_changed_at := stored.updated_at;

  if coalesce(auth.role(), '') = 'authenticated' then
    new.wise_recipient_id := case when tg_op = 'UPDATE' then old.wise_recipient_id end;
  end if;

  if tg_op = 'INSERT' then
    new.details_changed_at := clock_timestamp();
  elsif (new.method, new.payoneer_email, new.paypal_email, new.bank_name, new.account_name, new.account_number_last4,
         new.swift, new.branch, new.instructions, new.bank_country, new.number_changed_at,
         new.wise_recipient_type, new.wise_currency, new.wise_number_key, new.wise_details)
        is distinct from
        (old.method, old.payoneer_email, old.paypal_email, old.bank_name, old.account_name, old.account_number_last4,
         old.swift, old.branch, old.instructions, old.bank_country, old.number_changed_at,
         old.wise_recipient_type, old.wise_currency, old.wise_number_key, old.wise_details) then
    new.details_changed_at := clock_timestamp();
    new.wise_recipient_id := null;
  elsif new.is_primary and not old.is_primary then
    new.details_changed_at := clock_timestamp();
  else
    new.details_changed_at := old.details_changed_at;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payout_account_fields() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The factory's owner saves a bank account Wise can pay. `details` is Wise's
-- form as a flat map of its own keys ("accountHolderName", "address.city"), the
-- number apart. Wise's own rules (its regular expressions) are checked on the
-- form, and by Wise when the recipient is made; here is what must hold whatever
-- the form said. Typed twice here as well: a typo pays a stranger. Blank on an
-- edit keeps the number stored. Wise's CNY declaration is never the factory's
-- to make, so it is dropped if sent.
-- ---------------------------------------------------------------------------
create or replace function public.save_wise_payout_account(
  target_org uuid,
  target_account uuid default null,
  bank_name text default null,
  recipient_type text default null,
  currency text default null,
  details jsonb default null,
  number_key text default null,
  account_number text default null,
  account_number_again text default null
)
returns public.factory_payout_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.factory_payout_accounts;
  stored public.payout_account_numbers;
  saved public.factory_payout_accounts;
  the_id uuid := coalesce(target_account, gen_random_uuid());
  typed text := public.payout_number_normal(account_number);
  again text := public.payout_number_normal(account_number_again);
  kind text := case when number_key ilike 'iban' then 'iban' else 'account' end;
  bank text := nullif(btrim(coalesce(bank_name, '')), '');
  form jsonb := coalesce(details, '{}'::jsonb) - 'isContractDenotedInCny';
  holder text;
  code text;
  country text;
  last_four text;
  org_kind text;
  plain text;
begin
  if target_account is not null then
    select * into existing from public.factory_payout_accounts a where a.id = target_account;
  end if;
  -- One refusal for "not yours" and "does not exist".
  if (target_account is not null and (existing.id is null or existing.org_id <> target_org))
     or not public.is_org_owner(target_org) then
    raise exception 'only a company owner can change payout methods'
      using errcode = '42501', hint = 'payout_owner_only';
  end if;

  select o.type::text into org_kind from public.orgs o where o.id = target_org;
  if org_kind = 'brand' then
    raise exception 'only a company owner can change payout methods'
      using errcode = '42501', hint = 'payout_owner_only';
  end if;

  if existing.id is not null and existing.method <> 'bank' then
    raise exception 'that payout method is not a bank account'
      using errcode = '22023', hint = 'payout_not_bank';
  end if;

  if recipient_type is null or recipient_type !~ '^[a-z0-9_]{2,64}$'
     or currency is null or upper(currency) !~ '^[A-Z]{3}$'
     or number_key is null or number_key !~ '^[A-Za-z][A-Za-z.]{0,63}$'
     or jsonb_typeof(form) <> 'object' then
    raise exception 'that is not a form we can pay'
      using errcode = '22023', hint = 'wise_form_invalid';
  end if;
  if exists (
    select 1 from jsonb_each(form) as f(key, value)
     where f.key !~ '^[A-Za-z][A-Za-z.]{0,63}$' or jsonb_typeof(f.value) <> 'string' or length(f.value #>> '{}') > 255
  ) then
    raise exception 'that is not a form we can pay'
      using errcode = '22023', hint = 'wise_form_invalid';
  end if;

  holder := nullif(btrim(coalesce(form ->> 'accountHolderName', '')), '');
  if bank is null or holder is null then
    raise exception 'add the bank and the name on the account'
      using errcode = '22023', hint = 'bank_details_missing';
  end if;
  if not public.payout_name_is_latin(holder) then
    raise exception 'the name on the account must be in English letters'
      using errcode = '22023', hint = 'name_not_latin';
  end if;

  code := nullif(upper(regexp_replace(coalesce(form ->> 'swiftCode', ''), '\s', '', 'g')), '');
  if code is not null and code !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$' then
    raise exception 'a SWIFT / BIC is 8 or 11 letters and digits'
      using errcode = '22023', hint = 'swift_format';
  end if;
  country := nullif(upper(btrim(coalesce(form ->> 'address.country', ''))), '');
  if country is not null and country !~ '^[A-Z]{2}$' then
    raise exception 'that is not a country code'
      using errcode = '22023', hint = 'country_format';
  end if;

  select * into stored from public.payout_account_numbers n where n.account_id = the_id;

  if typed = '' and again = '' then
    if stored.account_id is null then
      raise exception 'add the full account number so TSC can pay you'
        using errcode = '22023', hint = 'number_required';
    end if;
    kind := stored.number_kind;
    typed := public.payout_number_normal(public.payout_number_plain(the_id));
  else
    if typed <> again then
      raise exception 'the two account numbers do not match'
        using errcode = '22023', hint = 'number_mismatch';
    end if;
    if typed !~ '^[A-Z0-9]{5,34}$' or length(regexp_replace(typed, '[^0-9]', '', 'g')) < 4 then
      raise exception 'an account number is 5 to 34 letters and digits'
        using errcode = '22023', hint = 'number_format';
    end if;
    if kind = 'iban' and not public.payout_iban_valid(typed) then
      raise exception 'that IBAN does not check out'
        using errcode = '22023', hint = 'iban_invalid';
    end if;
  end if;

  if form ? number_key
     or position(typed in public.payout_number_normal(concat_ws(' ', bank, form::text))) > 0 then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;

  last_four := right(regexp_replace(typed, '[^0-9]', '', 'g'), 4);

  -- Written before the row: the guard reads it, so one save is one notice.
  if stored.account_id is null then
    insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
    values (the_id, vault.create_secret(typed, 'payout-number-' || the_id::text), kind);
  else
    plain := public.payout_number_normal(public.payout_number_plain(the_id));
    if plain <> typed then
      perform vault.update_secret(stored.vault_secret_id, typed);
      update public.payout_account_numbers n set number_kind = kind, updated_at = clock_timestamp()
       where n.account_id = the_id;
    elsif stored.number_kind <> kind then
      update public.payout_account_numbers n set number_kind = kind where n.account_id = the_id;
    end if;
  end if;

  if existing.id is null then
    insert into public.factory_payout_accounts as a
      (id, org_id, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
       wise_recipient_type, wise_currency, wise_number_key, wise_details)
    values
      (the_id, target_org, bank, holder, last_four, code, country,
       not exists (select 1 from public.factory_payout_accounts x where x.org_id = target_org and x.is_primary),
       recipient_type, upper(currency), number_key, form)
    returning * into saved;
  else
    update public.factory_payout_accounts as a
       set bank_name = bank, account_name = holder, account_number_last4 = last_four, swift = code,
           bank_country = country, branch = null, instructions = null,
           wise_recipient_type = recipient_type, wise_currency = upper(currency),
           wise_number_key = number_key, wise_details = form
     where a.id = the_id
    returning * into saved;
  end if;

  return saved;
end;
$$;

revoke all on function public.save_wise_payout_account(uuid, uuid, text, text, text, jsonb, text, text, text) from public, anon;
grant execute on function public.save_wise_payout_account(uuid, uuid, text, text, text, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What the server sends Wise to make a recipient, read with the staff member's
-- own token when they press Pay with Wise. This is the one place the full
-- number leaves the database for our server, because Wise needs it: the same
-- refusals as reveal_payout_account_number, and the same record of who.
-- Not needed once wise_recipient_id is set: the board carries that.
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
  if not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      left join public.stripe_connect_accounts s on s.org_id = o.factory_org_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       and not (coalesce(s.transfers_active, false) and p.stripe_payment_intent_id is not null)
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
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid())
    from public.orgs o where o.id = a.org_id;

  return query select a.wise_recipient_type, a.wise_currency::text, a.wise_number_key,
    public.payout_number_plain(a.id), a.wise_details, a.details_changed_at;
end;
$$;

revoke all on function public.payout_wise_recipient(uuid) from public, anon;
grant execute on function public.payout_wise_recipient(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The server keeps the recipient Wise made. `made_from` is changed_at from
-- payout_wise_recipient: a factory that changed its details since keeps none.
-- ---------------------------------------------------------------------------
create or replace function public.set_wise_recipient(target_account uuid, recipient_id text, made_from timestamptz)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.factory_payout_accounts
     set wise_recipient_id = recipient_id
   where id = target_account and details_changed_at = made_from;
  return found;
end;
$$;

revoke all on function public.set_wise_recipient(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_wise_recipient(uuid, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Every PayPal change is said to the whole company, as Payoneer's is
-- (20261104300100): a typo or a takeover here pays a stranger.
-- ---------------------------------------------------------------------------
create or replace function public.notify_paypal_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
  what text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;

  if tg_op = 'INSERT' and new.method = 'paypal' then
    what := format('PayPal account %s was added.', new.paypal_email);
  elsif tg_op = 'DELETE' and old.method = 'paypal' then
    what := format('PayPal account %s was removed.', old.paypal_email);
  elsif tg_op = 'UPDATE' and new.method = 'paypal' then
    if new.paypal_email is distinct from old.paypal_email then
      what := format('The PayPal account changed from %s to %s.', coalesce(old.paypal_email, 'none'), new.paypal_email);
    elsif new.is_primary and not old.is_primary then
      what := format('TSC now pays PayPal account %s.', new.paypal_email);
    end if;
  end if;

  if what is not null and exists (select 1 from public.orgs where id = org) then
    insert into public.notifications (org_id, kind, title, body)
    values (org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
  return null;
end;
$$;

revoke all on function public.notify_paypal_change() from public, anon, authenticated;

create trigger factory_payout_accounts_paypal_notice
  after insert or update or delete on public.factory_payout_accounts
  for each row execute function public.notify_paypal_change();

-- ---------------------------------------------------------------------------
-- A payment sent through Wise or PayPal, one row per attempt, and the factory's
-- Withdrawals row. Written by the server's functions only; read by the factory
-- and staff, never the brand. A failure's raw words stay out of this table:
-- failure_code is what the factory acts on.
--
-- While 'processing' the payment stays 'confirmed' and approved. 'paid' and the
-- payment becoming 'released' are one transaction. After 'failed' the payment
-- is still owed, and the next attempt is a new row. The index is the last word
-- on a double press: one attempt under way or paid per payment.
-- ---------------------------------------------------------------------------
create table public.provider_payouts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.order_payments (id) on delete cascade,
  factory_org_id uuid not null references public.orgs (id) on delete cascade,
  account_id uuid references public.factory_payout_accounts (id) on delete set null,
  provider text not null check (provider in ('wise', 'paypal')),
  status text not null default 'processing' check (status in ('processing', 'paid', 'failed')),
  -- What the factory reads, kept as it was: "Bank of Ningbo ending 0154", or an email.
  paid_to text not null,
  amount_cents bigint not null,
  currency char(3) not null,
  -- What reached the factory when known, in minor units: its bank is paid in CNY.
  received_minor bigint,
  received_currency char(3),
  -- Wise's transfer id, PayPal's batch id.
  provider_ref text,
  failure_code text check (failure_code in ('details_rejected', 'other')),
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  check ((status = 'failed') = (failure_code is not null)),
  check ((status = 'paid') = (paid_at is not null))
);

create unique index provider_payouts_one_active on public.provider_payouts (payment_id) where status in ('processing', 'paid');
create index provider_payouts_org_idx on public.provider_payouts (factory_org_id, created_at desc);
create index provider_payouts_payment_idx on public.provider_payouts (payment_id);

alter table public.provider_payouts enable row level security;

create policy provider_payouts_read on public.provider_payouts
  for select to authenticated
  using (public.is_org_member(factory_org_id) or public.is_platform_admin());

revoke all on public.provider_payouts from public, anon, authenticated;
grant select on public.provider_payouts to authenticated;

alter publication supabase_realtime add table public.provider_payouts;

-- ---------------------------------------------------------------------------
-- The staff payments board (from 20261106600000). Only gains columns.
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
  provider_at              timestamptz
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
    coalesce(sca.transfers_active, false),
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
    attempt.provider, attempt.status, attempt.provider_ref, attempt.failure_code, attempt.updated_at
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.stripe_connect_accounts sca on sca.org_id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  left join public.payout_account_numbers num on num.account_id = a.id
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
