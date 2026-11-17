-- ============================================================================
-- Tazapay step 3: the factory saves its Tazapay details, staff see them
-- ----------------------------------------------------------------------------
-- 1. save_tazapay_payout_account(): the factory owner's one save for a bank
--    account in mainland China or Hong Kong, number included, with
--    save_wise_payout_account()'s refusals (owner only, typed twice, an English
--    name; the guard keeps the number out of every other field). SWIFT is
--    optional for China, where Tazapay doesn't need it. A mainland
--    account takes the company's own USCC from company_registrations when one
--    is on file, whatever was typed: any other number is refused when paying.
-- 2. admin_payment_board() gains the Tazapay details at the end, so the board
--    shows them and can say what an account still needs before staff press.
--
-- Safe with the live site while applied: one new function; the board only
-- gains columns at the end.
-- ============================================================================

create or replace function public.save_tazapay_payout_account(
  target_org uuid,
  target_account uuid default null,
  bank_country text default null,
  bank_name text default null,
  account_name text default null,
  holder_name_local text default null,
  registration_number text default null,
  bank_code text default null,
  swift text default null,
  address_line1 text default null,
  address_city text default null,
  address_state text default null,
  account_number text default null,
  account_number_again text default null
)
returns public.factory_payout_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  country text := upper(btrim(coalesce(save_tazapay_payout_account.bank_country, '')));
  existing public.factory_payout_accounts;
  stored public.payout_account_numbers;
  saved public.factory_payout_accounts;
  the_id uuid := coalesce(target_account, gen_random_uuid());
  typed text := public.payout_number_normal(account_number);
  again text := public.payout_number_normal(account_number_again);
  bank text := nullif(btrim(coalesce(save_tazapay_payout_account.bank_name, '')), '');
  holder text := nullif(btrim(coalesce(save_tazapay_payout_account.account_name, '')), '');
  code text := nullif(upper(regexp_replace(coalesce(save_tazapay_payout_account.swift, ''), '\s', '', 'g')), '');
  registered text;
  org_kind text;
  last_four text;
  plain text;
begin
  if target_account is not null then
    select * into existing from public.factory_payout_accounts a where a.id = target_account;
  end if;
  -- One refusal for "not yours" and "does not exist".
  if (target_account is not null and (existing.id is null or existing.org_id <> target_org))
     or not public.is_org_owner(target_org) then
    raise exception 'only a company owner can change payout methods' using errcode = '42501', hint = 'payout_owner_only';
  end if;
  select o.type::text into org_kind from public.orgs o where o.id = target_org;
  if org_kind = 'brand' then
    raise exception 'only a company owner can change payout methods' using errcode = '42501', hint = 'payout_owner_only';
  end if;
  if existing.id is not null and existing.method <> 'bank' then
    raise exception 'that payout method is not a bank account' using errcode = '22023', hint = 'payout_not_bank';
  end if;
  if country not in ('CN', 'HK') then
    raise exception 'Tazapay pays bank accounts in mainland China and Hong Kong only' using errcode = '22023', hint = 'tazapay_not_set_up';
  end if;
  if bank is null or holder is null then
    raise exception 'add the bank and the name on the account' using errcode = '22023', hint = 'bank_details_missing';
  end if;
  if not public.payout_name_is_latin(holder) then
    raise exception 'the name on the account must be in English letters' using errcode = '22023', hint = 'name_not_latin';
  end if;
  if code is not null and code !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$' then
    raise exception 'a SWIFT / BIC is 8 or 11 letters and digits' using errcode = '22023', hint = 'swift_format';
  end if;

  -- The number, typed twice, as save_wise_payout_account() keeps it.
  select * into stored from public.payout_account_numbers n where n.account_id = the_id;
  if typed = '' and again = '' then
    if stored.account_id is null then
      raise exception 'add the full account number so TSC can pay you' using errcode = '22023', hint = 'number_required';
    end if;
    typed := public.payout_number_normal(public.payout_number_plain(the_id));
  else
    if typed <> again then
      raise exception 'the two account numbers do not match' using errcode = '22023', hint = 'number_mismatch';
    end if;
    if typed !~ '^[A-Z0-9]{5,34}$' or length(regexp_replace(typed, '[^0-9]', '', 'g')) < 4 then
      raise exception 'an account number is 5 to 34 letters and digits' using errcode = '22023', hint = 'number_format';
    end if;
  end if;
  last_four := right(regexp_replace(typed, '[^0-9]', '', 'g'), 4);

  -- Written before the row: the guard reads it.
  if stored.account_id is null then
    insert into public.payout_account_numbers (account_id, vault_secret_id, number_kind)
    values (the_id, vault.create_secret(typed, 'payout-number-' || the_id::text), 'account');
  else
    plain := public.payout_number_normal(public.payout_number_plain(the_id));
    if plain <> typed then
      perform vault.update_secret(stored.vault_secret_id, typed);
      update public.payout_account_numbers n set number_kind = 'account', updated_at = clock_timestamp() where n.account_id = the_id;
    end if;
  end if;

  if country = 'CN' then
    select r.number into registered from public.company_registrations r where r.org_id = target_org and r.country_code = 'CN';
  end if;

  if existing.id is null then
    insert into public.factory_payout_accounts as a
      (id, org_id, method, bank_name, account_name, account_number_last4, swift, bank_country, is_primary,
       holder_name_local, registration_number, bank_code, address_line1, address_city, address_state)
    values
      (the_id, target_org, 'bank', bank, holder, last_four, code, country,
       not exists (select 1 from public.factory_payout_accounts x where x.org_id = target_org and x.is_primary),
       nullif(btrim(coalesce(save_tazapay_payout_account.holder_name_local, '')), ''),
       case when country = 'CN'
         then coalesce(registered, nullif(public.normalise_registration_number('CN', save_tazapay_payout_account.registration_number), ''))
         else nullif(public.normalise_registration_number('HK', save_tazapay_payout_account.registration_number), '') end,
       nullif(btrim(coalesce(save_tazapay_payout_account.bank_code, '')), ''),
       nullif(btrim(coalesce(save_tazapay_payout_account.address_line1, '')), ''),
       case when country = 'HK' then 'Hong Kong' else nullif(btrim(coalesce(save_tazapay_payout_account.address_city, '')), '') end,
       nullif(btrim(coalesce(save_tazapay_payout_account.address_state, '')), ''))
    returning * into saved;
  else
    update public.factory_payout_accounts as a
       set bank_name = bank, account_name = holder, account_number_last4 = last_four, swift = code, bank_country = country,
           branch = null, instructions = null,
           wise_recipient_type = null, wise_currency = null, wise_number_key = null, wise_details = null,
           holder_name_local = nullif(btrim(coalesce(save_tazapay_payout_account.holder_name_local, '')), ''),
           registration_number = case when country = 'CN'
             then coalesce(registered, nullif(public.normalise_registration_number('CN', save_tazapay_payout_account.registration_number), ''))
             else nullif(public.normalise_registration_number('HK', save_tazapay_payout_account.registration_number), '') end,
           bank_code = nullif(btrim(coalesce(save_tazapay_payout_account.bank_code, '')), ''),
           address_line1 = nullif(btrim(coalesce(save_tazapay_payout_account.address_line1, '')), ''),
           address_city = case when country = 'HK' then 'Hong Kong' else nullif(btrim(coalesce(save_tazapay_payout_account.address_city, '')), '') end,
           address_state = nullif(btrim(coalesce(save_tazapay_payout_account.address_state, '')), '')
     where a.id = the_id
    returning * into saved;
  end if;
  return saved;
end;
$$;
revoke all on function public.save_tazapay_payout_account(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_tazapay_payout_account(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The staff board (from 20261113900000), with the Tazapay details at the end.
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
  processing_fee_cents     bigint,
  payout_holder_local      text,
  payout_registration      text,
  payout_bank_code         text,
  payout_address_line1     text,
  payout_address_city      text,
  payout_address_state     text,
  payout_number_changed_at timestamptz
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
    public.processing_fee_cents(p),
    a.holder_name_local, a.registration_number, a.bank_code,
    a.address_line1, a.address_city, a.address_state, a.number_changed_at
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
