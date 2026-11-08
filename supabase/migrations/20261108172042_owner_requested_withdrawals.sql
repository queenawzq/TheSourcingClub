-- Approving a milestone makes money withdrawable; only its owner chooses
-- the payout rail. Brand funding and Stripe's platform settlement stay unchanged.
alter table public.order_payments add column withdrawal_required boolean not null default true;
-- Already-started releases must still reconcile on their original rail.
update public.order_payments p set withdrawal_required=false where stripe_release_started
  or state='released' or exists(select 1 from public.provider_payouts x where x.payment_id=p.id and x.status='processing');

create table public.factory_withdrawals (
  id uuid primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  provider text not null check(provider in ('stripe','wise','paypal')),
  account_id uuid,
  stripe_method_id text,
  details_changed_at timestamptz,
  cny_confirmed boolean not null default false,
  amount_cents bigint not null check(amount_cents>0),
  currency text not null default 'USD' check(currency='USD'),
  status text not null default 'requested' check(status in ('requested','processing','paid')),
  stripe_payout_id text,
  created_at timestamptz not null default now(),
  check((provider='stripe' and account_id is null and stripe_method_id ~ '^ba_[A-Za-z0-9]+$')
    or (provider in ('wise','paypal') and account_id is not null and stripe_method_id is null))
);
create table public.factory_withdrawal_items (
  payment_id uuid primary key references public.order_payments(id) on delete cascade,
  withdrawal_id uuid not null references public.factory_withdrawals(id) on delete cascade
);
create index factory_withdrawal_items_request on public.factory_withdrawal_items(withdrawal_id);
create index factory_withdrawals_company on public.factory_withdrawals(org_id,created_at);
alter table public.factory_withdrawals enable row level security;
alter table public.factory_withdrawal_items enable row level security;
revoke all on public.factory_withdrawals, public.factory_withdrawal_items from public,anon,authenticated;
grant select on public.factory_withdrawals, public.factory_withdrawal_items to authenticated;
grant all on public.factory_withdrawals, public.factory_withdrawal_items to service_role;
create policy withdrawal_read on public.factory_withdrawals for select to authenticated
  using(public.is_org_member(org_id) or public.is_platform_admin());
create policy withdrawal_item_read on public.factory_withdrawal_items for select to authenticated
  using(exists(select 1 from public.factory_withdrawals w where w.id=withdrawal_id));

create function public.request_factory_withdrawal(target_org uuid, request_id uuid,
  which text, target_account uuid default null, stripe_method text default null, confirm_cny boolean default false, expected_amount bigint default null)
returns public.factory_withdrawals language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.factory_withdrawals; a public.factory_payout_accounts; ids uuid[]; total bigint;
begin
  if not public.is_org_owner(target_org) then raise exception 'Only a company owner can withdraw.' using errcode='42501'; end if;
  -- All requests for a company serialize, including companies without Stripe.
  perform 1 from public.orgs where id=target_org for update;
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  select * into w from public.factory_withdrawals where id=request_id;
  if found then
    if w.org_id<>target_org or w.provider<>which or w.account_id is distinct from target_account
      or w.stripe_method_id is distinct from stripe_method then
      raise exception 'This withdrawal already has a different destination.' using errcode='22023';
    end if;
    return w;
  end if;
  if which='stripe' then
    if stripe_method is null or stripe_method !~ '^ba_[A-Za-z0-9]+$' or target_account is not null
      or not exists(select 1 from public.stripe_connect_accounts where org_id=target_org and transfers_active and payouts_enabled) then
      raise exception 'Choose a verified linked bank account.' using errcode='22023';
    end if;
  elsif which in ('wise','paypal') then
    select * into a from public.factory_payout_accounts where id=target_account and org_id=target_org for update;
    if not found or stripe_method is not null or (which='paypal' and a.method<>'paypal')
      or (which='wise' and (a.method<>'bank' or a.wise_recipient_type is null or a.number_changed_at is null)) then
      raise exception 'Choose a linked PayPal or Wise account for this company.' using errcode='22023';
    end if;
    if which='wise' and a.wise_currency='CNY' and not coalesce(confirm_cny,false) then
      raise exception 'Confirm the contract and invoice are denominated in CNY.' using errcode='22023';
    end if;
  else raise exception 'Choose a withdrawal destination.' using errcode='22023'; end if;
  -- Lock the actual earnings. Client amounts and payment ids are never trusted.
  select array_agg(q.id),sum(q.amount_cents) into ids,total from (
    select p.id,p.amount_cents from public.order_payments p join public.production_orders o on o.id=p.order_id
    where o.factory_org_id=target_org and p.state='confirmed' and p.release_requested_at is not null
      and p.currency='USD' and not p.stripe_release_started and p.release_claimed_at is null
      and not exists(select 1 from public.factory_withdrawal_items i where i.payment_id=p.id)
      and not exists(select 1 from public.provider_payouts x where x.payment_id=p.id and x.status in ('processing','paid'))
    order by p.id for update of p
  ) q;
  if total is null or total<=0 then raise exception 'No approved earnings are available to withdraw.' using errcode='22023'; end if;
  if expected_amount is null or expected_amount<>total then raise exception 'Your available earnings changed. Refresh and confirm the amount again.' using errcode='22023'; end if;
  insert into public.factory_withdrawals(id,org_id,requested_by,provider,account_id,stripe_method_id,details_changed_at,cny_confirmed,amount_cents)
    values(request_id,target_org,auth.uid(),which,target_account,stripe_method,a.details_changed_at,coalesce(confirm_cny,false),total) returning * into w;
  insert into public.factory_withdrawal_items(payment_id,withdrawal_id) select unnest(ids),request_id;
  return w;
end; $$;
revoke all on function public.request_factory_withdrawal(uuid,uuid,text,uuid,text,boolean,bigint) from public,anon;
grant execute on function public.request_factory_withdrawal(uuid,uuid,text,uuid,text,boolean,bigint) to authenticated;

create function public.payment_uses_stripe_payout(target_payment uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.order_payments p where p.id=target_payment and (
    (not p.withdrawal_required and exists(select 1 from public.production_orders o where o.id=p.order_id and public.uses_stripe_payout(o.factory_org_id)))
    or exists(select 1 from public.factory_withdrawal_items i join public.factory_withdrawals w on w.id=i.withdrawal_id
      where i.payment_id=p.id and w.provider='stripe')));
$$;
revoke all on function public.payment_uses_stripe_payout(uuid) from public,anon,authenticated;
grant execute on function public.payment_uses_stripe_payout(uuid) to service_role;

-- Don't remove or edit a selected destination while its request can still send.
create function public.guard_withdrawal_destination() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.factory_withdrawals where account_id=old.id and status<>'paid') then
    raise exception 'Finish this account’s withdrawal before changing or removing it.' using errcode='22023';
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function public.guard_withdrawal_destination() from public,anon,authenticated;
create trigger withdrawal_destination_delete before delete on public.factory_payout_accounts
  for each row execute function public.guard_withdrawal_destination();
-- is_primary and cached Wise recipient changes don't change where money goes.
create trigger withdrawal_destination_edit before update of paypal_email,bank_name,account_name,wise_details,wise_currency,wise_recipient_type,number_changed_at
  on public.factory_payout_accounts for each row execute function public.guard_withdrawal_destination();

create or replace function public.claim_payment_release(target_payment uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed timestamptz; target_org uuid;
begin
  select o.factory_org_id into target_org from public.order_payments p
    join public.production_orders o on o.id=p.order_id where p.id=target_payment;
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  if not public.payment_uses_stripe_payout(target_payment) then return null; end if;
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
  chosen public.factory_withdrawals;
  server_request boolean := false;
begin
  if not public.is_platform_admin() and coalesce(auth.role(),'')<>'service_role' then
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
  select w.* into chosen from public.factory_withdrawal_items i join public.factory_withdrawals w on w.id=i.withdrawal_id where i.payment_id=p.id;
  server_request := coalesce(auth.role(),'')='service_role' and chosen.id is not null and chosen.provider=which;
  if not public.is_platform_admin() and not server_request then raise exception 'Owner withdrawal required.' using errcode='42501'; end if;
  if not server_request then perform public.payout_staff_check(o.factory_org_id); end if;
  if p.withdrawal_required and chosen.id is null then raise exception 'The factory must request a withdrawal first.' using errcode='22023'; end if;
  if chosen.id is not null and chosen.provider<>which then raise exception 'Use the requested withdrawal provider.' using errcode='22023'; end if;

  if p.state = 'released' then
    raise exception 'that payout was already paid' using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' or p.release_requested_at is null then
    raise exception 'that payment is not approved for payout' using errcode = '22023', hint = 'payout_not_owed';
  end if;
  if p.stripe_payment_intent_id is not null and exists (
    select 1 from public.stripe_connect_accounts s
     where s.org_id = o.factory_org_id and public.payment_uses_stripe_payout(p.id)
  ) then
    raise exception 'Stripe pays this factory: retry the payout instead' using errcode = '22023', hint = 'payout_stripe';
  end if;
  if p.release_claimed_at is not null and p.release_claimed_at > now() - interval '10 minutes' then
    raise exception 'a Stripe payout is being made for this payment' using errcode = '22023', hint = 'payout_in_progress';
  end if;

  select * into account from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and ((chosen.id is not null and a.id=chosen.account_id) or (chosen.id is null and a.is_primary));
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
    values (p.id, o.factory_org_id, account.id, which, paid_to, p.amount_cents, p.currency, coalesce(auth.uid(),chosen.requested_by))
    returning * into live;
    insert into public.provider_payout_attempts (payout_id) values (live.id);
    select * into attempt from public.provider_payout_attempts a where a.payout_id = live.id;
  end if;

  update public.provider_payout_attempts a
     set lease_until = now() + interval '90 seconds', updated_at = now(),
         cny_confirmed_by = case when coalesce(cny_confirmed, false) then coalesce(auth.uid(),chosen.requested_by) else a.cny_confirmed_by end,
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
grant execute on function public.claim_provider_payout(uuid,text,timestamptz,boolean) to service_role;

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
  owner_request public.factory_withdrawals;
begin
  if not public.is_platform_admin() and coalesce(auth.role(),'')<>'service_role' then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;

  select * into a from public.factory_payout_accounts x where x.id = target_account;
  if not found then
    raise exception 'that account does not exist' using errcode = 'P0002';
  end if;

  select * into owner_request from public.factory_withdrawals w where w.account_id=a.id and w.provider='wise' and w.status<>'paid' order by w.created_at limit 1;
  if coalesce(auth.role(),'')='service_role' and owner_request.id is null then raise exception 'Owner withdrawal required.' using errcode='42501'; end if;
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
  if owner_request.id is null and (not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      left join public.stripe_connect_accounts s on s.org_id = o.factory_org_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       and not (public.payment_uses_stripe_payout(p.id) and p.stripe_payment_intent_id is not null)
  )) then
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
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, coalesce(auth.uid(),owner_request.requested_by),
         (select u.email from auth.users u where u.id = auth.uid()), 'sent_to_wise'
    from public.orgs o where o.id = a.org_id;

  return query select a.wise_recipient_type, a.wise_currency::text, a.wise_number_key,
    public.payout_number_plain(a.id), a.wise_details, a.details_changed_at;
end;
$$;
grant execute on function public.payout_wise_recipient(uuid) to service_role;

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
    (p.stripe_transfer_id is not null or (p.state <> 'released' and public.payment_uses_stripe_payout(p.id))),
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
  left join public.factory_withdrawal_items wi on wi.payment_id=p.id
  left join public.factory_withdrawals wr on wr.id=wi.withdrawal_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and ((wr.id is not null and a.id=wr.account_id) or (wr.id is null and a.is_primary))
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

-- Staff's legacy mark-paid paths cannot bypass the owner's request for new earnings.
create function public.guard_owner_withdrawal_release() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.withdrawal_required and old.state<>'released' and new.state='released' then
    if not exists(select 1 from public.factory_withdrawal_items i join public.factory_withdrawals w on w.id=i.withdrawal_id where i.payment_id=old.id) then
      raise exception 'The factory must choose a withdrawal destination first.' using errcode='22023';
    end if;
    if new.stripe_transfer_id is not null and not public.payment_uses_stripe_payout(old.id) then
      raise exception 'This withdrawal selected a different provider.' using errcode='22023';
    end if;
    if not public.payment_uses_stripe_payout(old.id) and not exists(
      select 1 from public.provider_payouts x join public.factory_withdrawal_items i on i.payment_id=x.payment_id
      join public.factory_withdrawals w on w.id=i.withdrawal_id
      where x.payment_id=old.id and x.status='paid' and x.provider=w.provider and x.account_id=w.account_id
    ) then raise exception 'The selected provider must confirm the payout first.' using errcode='22023'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_owner_withdrawal_release() from public,anon,authenticated;
create trigger owner_withdrawal_release before update of state on public.order_payments
  for each row execute function public.guard_owner_withdrawal_release();

-- A later provider return reopens the same chosen request, never another rail.
create function public.reopen_returned_withdrawal() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.status='paid' and new.status='failed' then
    update public.factory_withdrawals set status='requested' where provider=new.provider and id in (
      select withdrawal_id from public.factory_withdrawal_items where payment_id=new.payment_id
    );
  end if;
  return new;
end; $$;
revoke all on function public.reopen_returned_withdrawal() from public,anon,authenticated;
create trigger returned_withdrawal after update of status on public.provider_payouts for each row execute function public.reopen_returned_withdrawal();
