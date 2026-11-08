-- A default chooses where payouts not yet started are sent. Existing Stripe
-- balances stay there. A switch is refused while either provider owns a payout.
-- A Stripe call can succeed remotely even when its response is lost. Keep the
-- route pinned after the first claim until reconciliation records it released;
-- clearing or expiring a lease must never make it payable through another rail.
alter table public.order_payments add column stripe_release_started boolean not null default false;
-- Outstanding Stripe-funded releases predate the durable marker. Reconcile
-- them through Stripe before allowing a switch, including lost old responses.
update public.order_payments p set stripe_release_started=true
where p.release_claimed_at is not null or (
  p.state='confirmed' and p.release_requested_at is not null and p.stripe_charge_id is not null
  and exists(select 1 from public.production_orders o join public.stripe_connect_accounts s on s.org_id=o.factory_org_id
    where o.id=p.order_id and s.transfers_active)
);

create table public.factory_payout_preferences (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  route text not null check (route in ('stripe', 'manual')),
  changed_at timestamptz not null default now()
);
alter table public.factory_payout_preferences enable row level security;
revoke all on public.factory_payout_preferences from public, anon, authenticated;
grant select on public.factory_payout_preferences to authenticated;
grant all on public.factory_payout_preferences to service_role;
create policy payout_preference_read on public.factory_payout_preferences for select to authenticated
  using (public.is_org_member(org_id) or public.is_platform_admin());

create function public.uses_stripe_payout(target_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.stripe_connect_accounts s where s.org_id=target_org and s.transfers_active)
    and not exists (select 1 from public.factory_payout_preferences r where r.org_id=target_org and r.route='manual');
$$;
revoke all on function public.uses_stripe_payout(uuid) from public, anon, authenticated;
grant execute on function public.uses_stripe_payout(uuid) to service_role;

create function public.choose_payout_method(target_org uuid, target_account uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.factory_payout_accounts;
begin
  if not public.is_org_owner(target_org) then
    raise exception 'Only a company owner can change the default withdrawal method.' using errcode='42501';
  end if;
  -- This is the same row lock acquired by both provider claims below.
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  if exists (select 1 from public.order_payments p join public.production_orders o on o.id=p.order_id
      where o.factory_org_id=target_org and p.state='confirmed' and (p.release_claimed_at is not null or p.stripe_release_started))
    or exists (select 1 from public.provider_payouts x join public.order_payments p on p.id=x.payment_id
      join public.production_orders o on o.id=p.order_id where o.factory_org_id=target_org and x.status='processing') then
    raise exception 'Finish or reconcile the pending payout before changing the default.' using errcode='22023';
  end if;
  if target_account is null then
    if not exists (select 1 from public.stripe_connect_accounts s where s.org_id=target_org and s.transfers_active) then
      raise exception 'Finish bank-account verification before choosing it as the default.' using errcode='22023';
    end if;
  else
    select * into a from public.factory_payout_accounts where id=target_account and org_id=target_org;
    if not found or a.method not in ('bank','paypal') then
      raise exception 'Choose a saved bank transfer or PayPal account for this company.' using errcode='22023';
    end if;
    if (a.method='bank' and (nullif(btrim(a.account_name),'') is null or nullif(btrim(a.bank_name),'') is null or a.number_changed_at is null))
       or (a.method='paypal' and nullif(btrim(a.paypal_email),'') is null) then
      raise exception 'Complete the withdrawal details before choosing this method.' using errcode='22023';
    end if;
    if not a.is_primary then perform public.set_primary_payout_account(target_account); end if;
  end if;
  insert into public.factory_payout_preferences(org_id,route) values(target_org,case when target_account is null then 'stripe' else 'manual' end)
    on conflict(org_id) do update set route=excluded.route, changed_at=now();
end; $$;
revoke all on function public.choose_payout_method(uuid,uuid) from public, anon;
grant execute on function public.choose_payout_method(uuid,uuid) to authenticated;

-- Retain the existing access and payment guards; change only routing.
create or replace function public.guard_payout_account_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owed_cents bigint;
  owed_currency text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or not old.is_primary then
    return old;
  end if;

  if exists (select 1 from public.factory_payout_accounts a
              where a.org_id = old.org_id and a.id <> old.id) then
    raise exception 'this is the account TSC pays: choose another account for TSC to pay before removing it'
      using errcode = 'P0001', hint = 'payout_primary';
  end if;

  if exists (select 1 from public.stripe_connect_accounts s
              where s.org_id = old.org_id and public.uses_stripe_payout(old.org_id)) then
    return old;
  end if;

  select sum(p.amount_cents), min(p.currency)
    into owed_cents, owed_currency
    from public.order_payments p
    join public.production_orders o on o.id = p.order_id
   where o.factory_org_id = old.org_id
     and p.state = 'confirmed'
     and p.release_requested_at is not null;

  if coalesce(owed_cents, 0) > 0 then
    raise exception 'TSC is about to pay this account, so it cannot be removed until that payment is sent'
      using errcode = 'P0001',
            hint = 'payout_owed',
            detail = owed_cents::text || ' ' || owed_currency;
  end if;

  return old;
end;
$$;

-- Retain the existing access and payment guards; change only routing.
create or replace function public.release_payment_by_payoneer(
  target_payment uuid,
  paid_to text,
  payoneer_payment_id text,
  note text default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  current_email text;
  reference text := btrim(coalesce(payoneer_payment_id, ''));
begin
  if not public.is_platform_admin() then
    raise exception 'recording a payout is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  if public.is_org_member(o.factory_org_id) then
    raise exception 'you belong to this company, so someone else on the staff must record its payout'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (select 1 from public.provider_payouts x where x.payment_id = p.id and x.status = 'processing') then
    raise exception 'a Wise or PayPal payment is under way for this: cancel it first, or it could be paid twice'
      using errcode = '22023', hint = 'payout_in_progress';
  end if;
  if p.state = 'released' then
    raise exception 'that payout was already marked as paid'
      using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' then
    raise exception 'that payment is %; only a confirmed one can be released', p.state
      using errcode = '22023';
  end if;
  if p.stripe_charge_id is not null and p.release_requested_at is null then
    raise exception 'the brand has not approved this step yet: money paid through Stripe is paid out once the brand approves it'
      using errcode = '22023';
  end if;
  if p.stripe_payment_intent_id is not null and exists (
    select 1 from public.stripe_connect_accounts s
     where s.org_id = o.factory_org_id and public.uses_stripe_payout(o.factory_org_id)
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead'
      using errcode = '22023', hint = 'payout_stripe';
  end if;

  select a.payoneer_email into current_email
    from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and a.is_primary and a.method = 'payoneer';
  if current_email is null or current_email <> lower(btrim(coalesce(paid_to, ''))) then
    raise exception 'this factory changed where it is paid'
      using errcode = '22023', hint = 'payout_changed';
  end if;

  if reference !~ '^[A-Za-z0-9._/-]{3,64}$' then
    raise exception 'the Payoneer payment ID is 3 to 64 letters, numbers or - _ . /'
      using errcode = '22023', hint = 'payoneer_id_format';
  end if;
  if exists (
    select 1 from public.payoneer_payouts x
     where lower(x.payoneer_payment_id) = lower(reference)
       and x.factory_org_id <> o.factory_org_id
  ) then
    raise exception 'that Payoneer payment ID is recorded for another factory'
      using errcode = '22023', hint = 'payoneer_id_used';
  end if;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now()
   where id = p.id
  returning * into p;

  insert into public.payoneer_payouts
    (payment_id, factory_org_id, paid_to_email, payoneer_payment_id, note, recorded_by)
  values
    (p.id, o.factory_org_id, current_email, reference, nullif(btrim(coalesce(note, '')), ''), auth.uid());

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', auth.uid(), 'admin');

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s released to you', public.format_money(p.amount_cents, p.currency)),
    format('Sent by Payoneer against %s. Payoneer payment ID %s.', o.order_number, reference)
  );

  return p;
end;
$$;

-- Retain the existing access and payment guards; change only routing.
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
       and not (public.uses_stripe_payout(o.factory_org_id) and p.stripe_payment_intent_id is not null)
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

-- Retain the existing access and payment guards; change only routing.
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
       and not (public.uses_stripe_payout(o.factory_org_id) and p.stripe_payment_intent_id is not null)
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
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email, how)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid()), 'sent_to_wise'
    from public.orgs o where o.id = a.org_id;

  return query select a.wise_recipient_type, a.wise_currency::text, a.wise_number_key,
    public.payout_number_plain(a.id), a.wise_details, a.details_changed_at;
end;
$$;

-- Retain the existing access and payment guards; change only routing.
create or replace function public.claim_provider_payout(
  target_payment uuid,
  which text,
  paid_to_changed_at timestamptz,
  cny_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  account public.factory_payout_accounts;
  live public.provider_payouts;
  attempt public.provider_payout_attempts;
  resumed boolean := false;
  paid_to text;
begin
  if not public.is_platform_admin() then
    raise exception 'paying a factory is limited to platform staff' using errcode = '42501';
  end if;

  perform 1 from public.stripe_connect_accounts where org_id=(
    select po.factory_org_id from public.order_payments op join public.production_orders po on po.id=op.order_id where op.id=target_payment
  ) for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  select * into o from public.production_orders where id = p.order_id;
  perform public.payout_staff_check(o.factory_org_id);

  if p.state = 'released' then
    raise exception 'that payout was already paid' using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' or p.release_requested_at is null then
    raise exception 'that payment is not approved for payout' using errcode = '22023', hint = 'payout_not_owed';
  end if;
  if p.stripe_payment_intent_id is not null and exists (
    select 1 from public.stripe_connect_accounts s
     where s.org_id = o.factory_org_id and public.uses_stripe_payout(o.factory_org_id)
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead' using errcode = '22023', hint = 'payout_stripe';
  end if;
  if p.release_claimed_at is not null and p.release_claimed_at > now() - interval '10 minutes' then
    raise exception 'a Stripe payout is being made for this payment' using errcode = '22023', hint = 'payout_in_progress';
  end if;

  select * into account from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and a.is_primary;
  if which = 'wise' and (account.id is null or account.method <> 'bank' or account.wise_recipient_type is null) then
    raise exception 'this factory has no bank account Wise can pay' using errcode = '22023', hint = 'wise_not_set_up';
  end if;
  if which = 'paypal' and (account.id is null or account.method <> 'paypal') then
    raise exception 'this factory has no PayPal address' using errcode = '22023', hint = 'paypal_not_set_up';
  end if;
  if which not in ('wise', 'paypal') then
    raise exception 'unknown payment provider' using errcode = '22023';
  end if;
  if paid_to_changed_at is null or account.details_changed_at is distinct from paid_to_changed_at then
    raise exception 'this factory changed where it is paid' using errcode = '22023', hint = 'payout_changed';
  end if;
  if which = 'wise' and account.wise_currency = 'CNY' and not coalesce(cny_confirmed, false) then
    raise exception 'confirm the contract and invoice statement first' using errcode = '22023', hint = 'cny_statement';
  end if;

  select * into live from public.provider_payouts x
   where x.payment_id = p.id and x.status = 'processing';
  if found then
    if live.provider <> which then
      raise exception 'another payment is under way for this' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id for update;
    if attempt.lease_until is not null and attempt.lease_until > now() then
      raise exception 'this is already being paid' using errcode = '22023', hint = 'payout_in_progress';
    end if;
    resumed := true;
  else
    paid_to := case which
      when 'wise' then format('%s ending %s', account.bank_name, account.account_number_last4)
      else account.paypal_email
    end;
    insert into public.provider_payouts
      (payment_id, factory_org_id, account_id, provider, paid_to, amount_cents, currency, requested_by)
    values (p.id, o.factory_org_id, account.id, which, paid_to, p.amount_cents, p.currency, auth.uid())
    returning * into live;
    insert into public.provider_payout_attempts (payout_id) values (live.id);
    select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id;
  end if;

  update public.provider_payout_attempts a
     set lease_until = now() + interval '90 seconds', updated_at = now(),
         cny_confirmed_by = case when coalesce(cny_confirmed, false) then auth.uid() else a.cny_confirmed_by end,
         cny_confirmed_at = case when coalesce(cny_confirmed, false) then now() else a.cny_confirmed_at end
   where a.payout_id = live.id
  returning * into attempt;

  return jsonb_build_object(
    'payout_id', live.id,
    'key', attempt.attempt_key,
    'stage', attempt.stage,
    'resumed', resumed,
    'provider_ref', live.provider_ref,
    'quote_id', attempt.quote_id,
    'amount_cents', p.amount_cents,
    'currency', p.currency,
    'order_number', o.order_number,
    'account_id', account.id,
    'paypal_email', account.paypal_email,
    'wise_recipient_id', account.wise_recipient_id
  );
end;
$$;

-- Retain the existing access and payment guards; change only routing.
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

-- Retain the existing access and payment guards; change only routing.
create or replace function public.claim_payment_release(target_payment uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed timestamptz; target_org uuid;
begin
  select o.factory_org_id into target_org from public.order_payments p
    join public.production_orders o on o.id=p.order_id where p.id=target_payment;
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  if not public.uses_stripe_payout(target_org) then return null; end if;
  if exists (select 1 from public.stripe_connect_upgrades where org_id=target_org and completed_at is null and new_account_id is not null) then
    return null;
  end if;
  if exists (select 1 from public.provider_payouts x where x.payment_id=target_payment and x.status='processing') then
    return null;
  end if;
  update public.order_payments set release_claimed_at=now(), stripe_release_started=true
    where id=target_payment and state='confirmed' and release_requested_at is not null
    and (release_claimed_at is null or release_claimed_at < now()-interval '10 minutes')
    returning release_claimed_at into claimed;
  return claimed;
end; $$;

create or replace function public.factory_has_no_payout_method(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (select 1 from public.factory_payout_accounts a where a.org_id = target_org)
     and not public.uses_stripe_payout(target_org);
$$;
