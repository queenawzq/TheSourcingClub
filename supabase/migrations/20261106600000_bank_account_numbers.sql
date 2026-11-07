-- ============================================================================
-- The full bank account number, so staff can pay a factory by bank
-- ----------------------------------------------------------------------------
-- John, Nov 5: staff paying by hand had a last four and nothing to send money
-- to. 030's reason for keeping no number ("the platform never touches funds")
-- stopped being true when payments moved to Stripe and TSC began holding them.
--
-- The number is in Supabase Vault. payout_account_numbers holds only which
-- secret belongs to which account: no plaintext, no hash (a 12-digit space can
-- be brute-forced), no grant to anyone but the database owner, no view, and it
-- is not in the Realtime publication. payout_number_plain() is the one place
-- that decrypts, and only the functions pinned in bank_numbers_test.sql may
-- call it.
--
-- The number never goes through api/: the browser sends it to
-- save_bank_payout_account() and reads it from reveal_payout_account_number().
-- No raise here ever carries a value.
--
-- What this cannot stop: anyone holding the database password or the server's
-- secret key reads vault.decrypted_secrets with no record. service_role's grant
-- comes from supabase_admin, so a migration cannot take it away.
--
-- Safe with the live site while applied: the board only gains columns, direct
-- writes to factory_payout_accounts stay open and are made safe by the guard
-- below. One thing the live site loses for those minutes: saving an IBAN.
-- ============================================================================

create extension if not exists supabase_vault with schema vault;

alter table public.factory_payout_accounts
  add column branch text,
  -- Null means no full number is stored: a last-four-only account, which TSC
  -- cannot pay. Set only by the guard, from the stored number.
  add column number_changed_at timestamptz,
  -- Set only by the guard. What the board's "changed recently" reads.
  add column details_changed_at timestamptz not null default now();

update public.factory_payout_accounts set details_changed_at = created_at;

create table public.payout_account_numbers (
  -- Deferred: the number is written first, so the row's own insert already
  -- reads as having one, and the company hears of it once.
  account_id uuid primary key
    references public.factory_payout_accounts (id) on delete cascade
    deferrable initially deferred,
  vault_secret_id uuid not null,
  number_kind text not null default 'account' check (number_kind in ('account', 'iban')),
  updated_at timestamptz not null default now()
);

alter table public.payout_account_numbers enable row level security;
revoke all on public.payout_account_numbers from public, anon, authenticated, service_role;

-- Who looked. Outlives the account and the company, so no foreign keys.
create table public.payout_number_reveals (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  org_id uuid not null,
  org_name text not null,
  bank_name text,
  last4 text,
  staff_user_id uuid not null,
  staff_email text,
  revealed_at timestamptz not null default now()
);

create index payout_number_reveals_account_idx on public.payout_number_reveals (account_id, revealed_at desc);
create index payout_number_reveals_time_idx on public.payout_number_reveals (revealed_at desc);

alter table public.payout_number_reveals enable row level security;
revoke all on public.payout_number_reveals from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A number with its spaces and punctuation gone, full-width digits made plain.
-- ---------------------------------------------------------------------------
create or replace function public.payout_number_normal(value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select upper(regexp_replace(normalize(coalesce(value, ''), NFKC), '[^[:alnum:]]', '', 'g'))
$$;

revoke all on function public.payout_number_normal(text) from public, anon, authenticated, service_role;

create or replace function public.payout_iban_valid(value text)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  rearranged text;
  ch text;
  remainder integer := 0;
  piece text;
begin
  if value !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    return false;
  end if;
  rearranged := substr(value, 5) || substr(value, 1, 4);
  foreach ch in array regexp_split_to_array(rearranged, '') loop
    piece := case when ch ~ '[A-Z]' then (ascii(ch) - 55)::text else ch end;
    remainder := ((remainder::text || piece)::bigint % 97)::integer;
  end loop;
  return remainder = 1;
end;
$$;

revoke all on function public.payout_iban_valid(text) from public, anon, authenticated, service_role;

-- The one place that decrypts.
create or replace function public.payout_number_plain(target uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.decrypted_secret
    from public.payout_account_numbers n
    join vault.decrypted_secrets d on d.id = n.vault_secret_id
   where n.account_id = target
$$;

revoke all on function public.payout_number_plain(uuid) from public, anon, authenticated, service_role;

/** Whether a text holds this company's stored number, however it was spaced. */
create or replace function public.payout_text_holds_number(target_org uuid, value text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.payout_account_numbers n
      join public.factory_payout_accounts a on a.id = n.account_id
     where a.org_id = target_org
       and position(public.payout_number_normal(public.payout_number_plain(n.account_id))
                    in public.payout_number_normal(value)) > 0
  )
$$;

revoke all on function public.payout_text_holds_number(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Removing a number removes its secret: Vault's table has no foreign key to
-- ours, so a deleted company would otherwise leave its number behind.
-- ---------------------------------------------------------------------------
create or replace function public.payout_number_forget_secret()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from vault.secrets where id = old.vault_secret_id;
  return null;
end;
$$;

revoke all on function public.payout_number_forget_secret() from public, anon, authenticated, service_role;

create trigger payout_account_numbers_forget_secret
  after delete on public.payout_account_numbers
  for each row execute function public.payout_number_forget_secret();

-- ---------------------------------------------------------------------------
-- An IBAN is a full account number, and iban is an open column every member
-- and all staff can read. Any already there moves. The column stays for the
-- live site's selects; the guard below refuses new values.
-- ---------------------------------------------------------------------------
do $$
declare
  row_ record;
  plain text;
  secret uuid;
begin
  for row_ in
    select id, iban from public.factory_payout_accounts
     where method = 'bank' and iban is not null and btrim(iban) <> ''
  loop
    plain := public.payout_number_normal(row_.iban);
    secret := vault.create_secret(plain, 'payout-number-' || row_.id::text);
    insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
    values (row_.id, secret, 'iban');
    update public.factory_payout_accounts
       set iban = null,
           number_changed_at = now(),
           account_number_last4 = nullif(right(regexp_replace(plain, '[^0-9]', '', 'g'), 4), '')
     where id = row_.id;
  end loop;
  update public.factory_payout_accounts set iban = null where iban is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Direct writes to the row stay open (the live site inserts while this
-- applies; Payoneer still does). This keeps them honest:
--   - a row cannot move to another company, and its number with it;
--   - an IBAN is refused in the open column;
--   - the stored number cannot be pasted into another field, however spaced;
--   - a last four that disagrees with the stored number drops the number, so
--     the row reads as last-four-only rather than as a mismatch;
--   - becoming a Payoneer row removes the number;
--   - number_changed_at and details_changed_at cannot be written by a client:
--     hiding a swap from staff by setting the date back was the obvious move.
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
     or public.payout_text_holds_number(new.org_id, new.instructions) then
    raise exception 'an account number belongs only in the account number field'
      using errcode = '22023', hint = 'number_in_field';
  end if;

  new.number_changed_at := stored.updated_at;

  if tg_op = 'INSERT' then
    new.details_changed_at := clock_timestamp();
  elsif (new.method, new.payoneer_email, new.bank_name, new.account_name, new.account_number_last4,
         new.swift, new.branch, new.instructions, new.bank_country, new.number_changed_at)
        is distinct from
        (old.method, old.payoneer_email, old.bank_name, old.account_name, old.account_number_last4,
         old.swift, old.branch, old.instructions, old.bank_country, old.number_changed_at)
        or (new.is_primary and not old.is_primary) then
    new.details_changed_at := clock_timestamp();
  else
    new.details_changed_at := old.details_changed_at;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payout_account_fields() from public, anon, authenticated, service_role;

create trigger factory_payout_accounts_guard_fields
  before insert or update on public.factory_payout_accounts
  for each row execute function public.guard_payout_account_fields();

-- ---------------------------------------------------------------------------
-- The factory's owner saves a bank account. Everything but the number goes on
-- the row; the number goes in Vault. Blank on an edit keeps the one stored.
-- Typed twice here as well as on the form: a typo pays a stranger.
-- Returns the row, which has no number on it.
-- ---------------------------------------------------------------------------
create or replace function public.save_bank_payout_account(
  target_org uuid,
  target_account uuid default null,
  bank_name text default null,
  account_name text default null,
  bank_country text default null,
  swift text default null,
  branch text default null,
  instructions text default null,
  account_number text default null,
  account_number_again text default null,
  number_kind text default 'account'
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
  kind text := coalesce(number_kind, 'account');
  plain text;
  holder text := nullif(btrim(coalesce(account_name, '')), '');
  bank text := nullif(btrim(coalesce(bank_name, '')), '');
  country text := nullif(upper(btrim(coalesce(bank_country, ''))), '');
  code text := nullif(upper(regexp_replace(coalesce(swift, ''), '\s', '', 'g')), '');
  where_ text := nullif(btrim(coalesce(branch, '')), '');
  extra text := nullif(btrim(coalesce(instructions, '')), '');
  last_four text;
  org_kind text;
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

  if bank is null or holder is null then
    raise exception 'add the bank and the name on the account'
      using errcode = '22023', hint = 'bank_details_missing';
  end if;
  if code is null or code !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$' then
    raise exception 'a SWIFT / BIC is 8 or 11 letters and digits'
      using errcode = '22023', hint = 'swift_format';
  end if;
  if country is not null and country !~ '^[A-Z]{2}$' then
    raise exception 'that is not a country code'
      using errcode = '22023', hint = 'country_format';
  end if;
  if country is null and extra is null then
    raise exception 'name your bank''s country in the instructions'
      using errcode = '22023', hint = 'country_missing';
  end if;
  if kind not in ('account', 'iban') then
    raise exception 'unknown kind of number' using errcode = '22023', hint = 'number_format';
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

  if position(typed in public.payout_number_normal(concat_ws(' ', bank, holder, code, where_, extra))) > 0 then
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
      (id, org_id, bank_name, account_name, account_number_last4, swift, branch, bank_country, instructions, is_primary)
    values
      (the_id, target_org, bank, holder, last_four, code, where_, country, extra,
       not exists (select 1 from public.factory_payout_accounts x where x.org_id = target_org and x.is_primary))
    returning * into saved;
  else
    update public.factory_payout_accounts as a
       set bank_name = bank, account_name = holder, account_number_last4 = last_four, swift = code,
           branch = where_, bank_country = country, instructions = extra
     where a.id = the_id
    returning * into saved;
  end if;

  return saved;
end;
$$;

revoke all on function public.save_bank_payout_account(uuid, uuid, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_bank_payout_account(uuid, uuid, text, text, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A person on the staff reads one number, to pay it now.
--
-- Refused for: staff who belong to the company (they would be paying
-- themselves), staff in a brand with an order at this factory, an account that
-- is not the one TSC pays, and any factory TSC owes nothing by hand. Seeing a
-- number is for paying it, so a number nobody is about to pay stays hidden.
--
-- The record and the read are one transaction: a read with no record cannot
-- happen. A refused attempt is not recorded, because it saw nothing.
-- ---------------------------------------------------------------------------
create or replace function public.reveal_payout_account_number(target_account uuid)
returns table (account_number text, number_kind text, changed_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
  kind text;
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

  select n.number_kind into kind from public.payout_account_numbers n where n.account_id = a.id;
  if kind is null then
    raise exception 'no full account number is on file'
      using errcode = '22023', hint = 'no_number';
  end if;

  insert into public.payout_number_reveals
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid())
    from public.orgs o where o.id = a.org_id;

  return query select public.payout_number_plain(a.id), kind, a.details_changed_at;
end;
$$;

revoke all on function public.reveal_payout_account_number(uuid) from public, anon;
grant execute on function public.reveal_payout_account_number(uuid) to authenticated;

create or replace function public.payout_number_reveal_log(max_rows integer default 100)
returns table (
  account_id uuid, org_name text, bank_name text, last4 text, staff_email text, revealed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;
  return query
    select r.account_id, r.org_name, r.bank_name, r.last4, r.staff_email, r.revealed_at
      from public.payout_number_reveals r
     order by r.revealed_at desc
     limit least(greatest(coalesce(max_rows, 100), 1), 500);
end;
$$;

revoke all on function public.payout_number_reveal_log(integer) from public, anon;
grant execute on function public.payout_number_reveal_log(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- notify_default_bank_change (from 20261106300000). Changed: a new number that
-- keeps the same last four, and a new branch or country, are changes too. The
-- swap that keeps the last four is the one nobody would notice.
-- ---------------------------------------------------------------------------
create or replace function public.notify_default_bank_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
  what text;
  named text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;
  if not exists (select 1 from public.orgs where id = org) then
    return null;
  end if;

  if tg_op <> 'DELETE' and new.method = 'bank' and new.is_primary
     and (tg_op = 'INSERT' or not old.is_primary or old.method <> 'bank') then
    -- It may have lost the default again before the transaction ended.
    if not exists (
      select 1 from public.factory_payout_accounts where id = new.id and is_primary
    ) then
      return null;
    end if;
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    if exists (
      select 1 from public.notifications n
       where n.org_id = org and n.kind = 'payout_method_changed' and n.created_at = now()
         and starts_with(n.body, format('TSC now pays your bank account at %s, instead of Payoneer account', named))
    ) then
      return null;
    end if;
    what := format('TSC now pays your bank account at %s.', named);

  elsif tg_op = 'UPDATE' and new.method = 'bank' and new.is_primary and old.is_primary and old.method = 'bank'
        and (new.bank_name, new.account_name, new.account_number_last4, new.swift, new.branch,
             new.bank_country, new.instructions, new.number_changed_at)
            is distinct from
            (old.bank_name, old.account_name, old.account_number_last4, old.swift, old.branch,
             old.bank_country, old.instructions, old.number_changed_at) then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format('The bank account TSC pays changed: it is now %s, in the name of %s.', named, new.account_name);

  elsif old.method = 'bank' and old.is_primary
        and (tg_op = 'DELETE' or not new.is_primary or new.method <> 'bank')
        and not exists (select 1 from public.factory_payout_accounts where org_id = org and is_primary) then
    named := old.bank_name || case when old.account_number_last4 is not null
      then format(' ending %s', old.account_number_last4) else '' end;
    what := format('TSC no longer pays your bank account at %s, and you have no default payout method.', named);
  end if;

  if what is not null then
    insert into public.notifications (org_id, kind, title, body)
    values (org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
  return null;
end;
$$;

revoke all on function public.notify_default_bank_change() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The staff payments board (from 20261104300100). The return type gains
-- columns, so it is dropped and recreated in this one transaction. Everything
-- staff need to send the money and to ask the factory about it, on the row,
-- with no number: the number comes from reveal_payout_account_number() alone.
-- payout_changed_recently is the server's word, for all staff alike.
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
  last_viewed_at           timestamptz
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
    case when a.method = 'payoneer' then 'Payoneer: ' || a.payoneer_email else
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
    viewed.staff_email, viewed.revealed_at
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
