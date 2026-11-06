-- ============================================================================
-- Two things a factory must not miss
-- ----------------------------------------------------------------------------
-- 1. Staff's note on a bank payout reaches the factory. A factory waiting on a
--    transfer needs something to find it by in its bank; the Payoneer path
--    already says the payment ID. Same function, signature and grants as
--    20261104300100; only the notification's body changed.
--
-- 2. payout_method_changed is emailed, no switch stops it, and it now covers
--    every change of the default (see the end of this file). It is the
--    anti-fraud alert: a bell only helps someone already signed in, and a
--    company's switches are the first thing someone changing its bank account
--    would turn off. So it gets a category of its own, 'account', which
--    set_notification_preference refuses by name (it accepts three) and
--    notification_email_enabled always answers true for.
--
-- Safe with the live site while applied: nothing it calls changes signature,
-- and a sender not yet deployed still sends the row, with a plainer footer.
-- ============================================================================

alter table public.notification_email_outbox
  drop constraint notification_email_outbox_category_check,
  add constraint notification_email_outbox_category_check
    check (category in ('rfq', 'payments', 'messages', 'account'));

create or replace function public.notification_email_category(kind text)
returns text
language sql
immutable
as $$
  select case
    when kind in ('rfq_invited', 'rfq_cancelled', 'quote_received', 'quote_withdrawn',
                  'quote_accepted', 'rfq_matched', 'capacity_reminder')
      then 'rfq'
    when kind in ('payment_due', 'payment_sent', 'payment_confirmed', 'payment_rejected',
                  'payment_failed', 'payment_refunded', 'funds_released',
                  'milestone_submitted', 'milestone_approved', 'milestone_dispute',
                  'milestone_reminder', 'milestone_due_soon',
                  'schedule_updated', 'schedule_agreed',
                  'order_created', 'order_activated', 'order_completed', 'order_cancelled',
                  'cancellation_proposed', 'cancellation_withdrawn', 'cancellation_declined')
      then 'payments'
    when kind in ('message', 'call_proposed', 'call_accepted', 'call_declined',
                  'call_countered', 'call_cancelled')
      then 'messages'
    when kind = 'payout_method_changed'
      then 'account'
    else null
  end
$$;

create or replace function public.notification_email_enabled(target_org uuid, category text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select category = 'account' or coalesce(
    (select case category
              when 'rfq'      then p.rfq_emails
              when 'payments' then p.payment_emails
              when 'messages' then p.message_emails
            end
       from public.notification_preferences p
      where p.org_id = target_org),
    category in ('rfq', 'payments', 'messages')
  )
$$;

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
  said text := nullif(btrim(coalesce(note, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'releasing funds is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
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

  select * into o from public.production_orders where id = p.order_id;

  if said is null and exists (
    select 1 from public.factory_payout_accounts a
     where a.org_id = o.factory_org_id and a.is_primary and a.method = 'payoneer'
  ) then
    raise exception 'this factory is paid by Payoneer: record the payment ID, or say why it was paid by bank'
      using errcode = '22023', hint = 'payoneer_default';
  end if;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now(),
         released_note = said
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
    format('Sent by bank transfer against %s.', o.order_number)
      || case when said is null then '' else format(' TSC''s note: %s', said) end
  );

  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- Any change of the default payout method is said to the whole company, and
-- so emailed. Payoneer changes already were (notify_payoneer_change,
-- notify_left_payoneer); this adds a bank account becoming the default, a
-- default bank account's details being edited, and the last default bank
-- account going. Replacing the bank a company is paid at is the swap this
-- alert exists for, and editing the row in place is the same swap.
--
-- Deferred like notify_left_payoneer, and for its reason: only at the end of
-- the transaction is it known who holds the default. Moving from Payoneer to a
-- bank account has already been said by that trigger, with both names, so it
-- is not said twice. It runs first: the old default is cleared before the new
-- one is set, and the events fire in that order.
--
-- A bank account is named by its bank and last four digits, never in full.
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
        and (new.bank_name, new.account_name, new.account_number_last4, new.swift, new.iban, new.instructions)
            is distinct from (old.bank_name, old.account_name, old.account_number_last4, old.swift, old.iban, old.instructions) then
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

create constraint trigger factory_payout_accounts_default_bank_notice
  after insert or update or delete on public.factory_payout_accounts
  deferrable initially deferred
  for each row
  execute function public.notify_default_bank_change();
