-- ============================================================================
-- Payoneer as a manual payout method
-- ----------------------------------------------------------------------------
-- Where Stripe cannot pay out (mainland China, Hong Kong…), staff pay a
-- factory by hand. A factory may now give the email of its Payoneer account
-- instead of a bank account. Nothing here calls Payoneer: staff send the
-- payment from TSC's Payoneer business account, then record its payment ID.
--
-- Removing a method, the "payout owed" guard and choosing the default need no
-- change: remove_payout_account, guard_payout_account_delete and
-- set_primary_payout_account work on is_primary and org_id, whatever the method.
--
-- What was paid lives in payoneer_payouts, not on order_payments, because
-- order_payments_read admits the brand: an email or payment ID on that row, in
-- released_note or a new column, would reach it. It is also a snapshot, so a
-- factory changing its email later does not rewrite where a payout went.
--
-- Safe with the current site live: its inserts send no method and read as
-- 'bank', and admin_payment_board only gains columns.
-- ============================================================================

alter table public.factory_payout_accounts
  add column method text not null default 'bank' check (method in ('bank', 'payoneer')),
  add column payoneer_email text;

-- Per method, replacing the bank-name check of 20261023000200. `not valid` as
-- that one was: rows already saved blank are left alone, every edit is checked.
-- bank_country stays allowed on a Payoneer row: the card reopens on it.
alter table public.factory_payout_accounts
  drop constraint factory_payout_bank_name_present,
  add constraint factory_payout_method_details check (
    case method
      when 'bank' then bank_name is not null and btrim(bank_name) <> '' and payoneer_email is null
      when 'payoneer' then
        payoneer_email is not null
        and payoneer_email = lower(btrim(payoneer_email))
        and length(payoneer_email) <= 254
        and payoneer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and bank_name is null and account_number_last4 is null and swift is null and iban is null
    end
  ) not valid;

create unique index factory_payout_one_payoneer_email
  on public.factory_payout_accounts (org_id, payoneer_email) where method = 'payoneer';

-- ---------------------------------------------------------------------------
-- What staff paid by Payoneer. Read by the factory and staff, never the brand;
-- written only by release_payment_by_payoneer.
-- ---------------------------------------------------------------------------
create table public.payoneer_payouts (
  payment_id uuid primary key references public.order_payments (id) on delete cascade,
  factory_org_id uuid not null references public.orgs (id) on delete cascade,
  paid_to_email text not null,
  payoneer_payment_id text not null,
  note text,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now()
);

create index payoneer_payouts_payment_id_idx on public.payoneer_payouts (lower(payoneer_payment_id));

alter table public.payoneer_payouts enable row level security;

create policy payoneer_payouts_read on public.payoneer_payouts
  for select to authenticated
  using (public.is_org_member(factory_org_id) or public.is_platform_admin());

revoke all on public.payoneer_payouts from public, anon, authenticated;
grant select on public.payoneer_payouts to authenticated;

-- ---------------------------------------------------------------------------
-- Staff record a payout they sent by Payoneer.
--
-- `paid_to` is the email the staff member was looking at: if the factory has
-- changed where it is paid since the board loaded, this refuses rather than
-- recording a payment to an address nobody paid.
--
-- One Payoneer payment may cover several steps of one factory, so an ID may
-- repeat within a factory, never across two.
-- ---------------------------------------------------------------------------
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
     where s.org_id = o.factory_org_id and s.transfers_active
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

revoke all on function public.release_payment_by_payoneer(uuid, text, text, text) from public, anon;
grant execute on function public.release_payment_by_payoneer(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- release_payment_to_factory (from 20261022000300), same signature and grants.
-- Changed: a factory paid by Payoneer is not marked paid by bank without a
-- note saying why, which also catches a tab still showing the old bank details.
-- ---------------------------------------------------------------------------
create or replace function public.release_payment_to_factory(
  target_payment uuid,
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
begin
  if not public.is_platform_admin() then
    raise exception 'releasing funds is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if p.state <> 'confirmed' then
    raise exception 'that payment is %; only a confirmed one can be released', p.state
      using errcode = '22023';
  end if;
  if p.stripe_charge_id is not null and p.release_requested_at is null then
    raise exception 'the brand has not approved this step yet: money paid through Stripe is paid out once the brand approves it'
      using errcode = '22023';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  if nullif(btrim(coalesce(note, '')), '') is null and exists (
    select 1 from public.factory_payout_accounts a
     where a.org_id = o.factory_org_id and a.is_primary and a.method = 'payoneer'
  ) then
    raise exception 'this factory is paid by Payoneer: record the payment ID, or say why it was paid by bank'
      using errcode = '22023', hint = 'payoneer_default';
  end if;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now(),
         released_note = nullif(btrim(coalesce(note, '')), '')
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', auth.uid(), 'admin');

  -- Deliberately no milestone or chain effect. The work already opened when
  -- the payment was confirmed.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s released to you', public.format_money(p.amount_cents, p.currency)),
    format('Paid out against %s.', o.order_number)
  );

  return p;
end;
$$;

revoke all on function public.release_payment_to_factory(uuid, text) from public;
grant execute on function public.release_payment_to_factory(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Where earnings go is the highest-value thing a company has here, and a typo
-- or a takeover here pays a stranger: every Payoneer change is said to the
-- whole company, in the words of the Stripe path (api/stripe-connect.js).
-- Only a signed-in person's change; a company being deleted hears nothing.
-- ---------------------------------------------------------------------------
create or replace function public.notify_payoneer_change()
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

  if tg_op = 'INSERT' and new.method = 'payoneer' then
    what := format('Payoneer account %s was added.', new.payoneer_email);
  elsif tg_op = 'DELETE' and old.method = 'payoneer' then
    what := format('Payoneer account %s was removed.', old.payoneer_email);
  elsif tg_op = 'UPDATE' and new.method = 'payoneer' then
    if new.payoneer_email is distinct from old.payoneer_email then
      what := format('The Payoneer account changed from %s to %s.', coalesce(old.payoneer_email, 'none'), new.payoneer_email);
    elsif new.is_primary and not old.is_primary then
      what := format('TSC now pays Payoneer account %s.', new.payoneer_email);
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

revoke all on function public.notify_payoneer_change() from public, anon, authenticated;

create trigger factory_payout_accounts_payoneer_notice
  after insert or update or delete on public.factory_payout_accounts
  for each row execute function public.notify_payoneer_change();

-- ---------------------------------------------------------------------------
-- The staff payments board (from 20261023000400). The return type gains
-- columns, so it is dropped and recreated in this one transaction. Changed:
-- payout_summary names the Payoneer account; payout_method, payoneer_email
-- (the factory's current default) and payoneer_payment_id (what was recorded,
-- for "Refunded after payout", where staff must recover the money).
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
  payoneer_payment_id      text
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
      'SWIFT ' || nullif(btrim(a.swift), ''),
      'IBAN ' || nullif(btrim(a.iban), '')
    ), ''), 'no bank details on file') end,
    a.method, a.payoneer_email, sent.payoneer_payment_id
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.stripe_connect_accounts sca on sca.org_id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  left join public.payoneer_payouts sent on sent.payment_id = p.id
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
