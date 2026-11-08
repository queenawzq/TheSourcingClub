-- Separate optional operational email from mandatory account/payout alerts.
-- Preserve existing choices when splitting the old broad switches.
alter table public.notification_preferences
  add column order_emails boolean not null default true,
  add column call_emails boolean not null default true,
  add column capacity_emails boolean not null default true;
update public.notification_preferences set order_emails = payment_emails,
  call_emails = message_emails, capacity_emails = rfq_emails;
alter table public.notification_email_outbox
  drop constraint notification_email_outbox_category_check,
  add constraint notification_email_outbox_category_check
  check (category in ('rfq','payments','orders','messages','calls','capacity','account'));

create or replace function public.notification_email_category(kind text)
returns text language sql immutable as $$
  select case
    when kind in ('rfq_invited','rfq_cancelled','quote_received','quote_withdrawn','quote_accepted','rfq_matched') then 'rfq'
    when kind = 'capacity_reminder' then 'capacity'
    when kind in ('payment_due','payment_sent','payment_confirmed','payment_rejected','payment_failed','payment_refunded','funds_released') then 'payments'
    when kind in ('milestone_submitted','milestone_approved','milestone_dispute','milestone_reminder','milestone_due_soon',
      'schedule_updated','schedule_agreed','order_created','order_activated','order_completed','order_cancelled',
      'cancellation_proposed','cancellation_withdrawn','cancellation_declined') then 'orders'
    when kind = 'message' then 'messages'
    when kind in ('call_proposed','call_accepted','call_declined','call_countered','call_cancelled','call_reminder') then 'calls'
    when kind in ('payout_method_changed','payout_failed','payout_action_required') then 'account'
    else null end
$$;

-- Already queued emails must use their newly separated switch, too.
update public.notification_email_outbox o set category = public.notification_email_category(n.kind)
from public.notifications n where n.id = o.notification_id and o.status in ('pending','sending')
  and public.notification_email_category(n.kind) is not null;

create or replace function public.notification_email_enabled(target_org uuid, category text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select category = 'account' or coalesce((select case category
    when 'rfq' then p.rfq_emails when 'payments' then p.payment_emails
    when 'orders' then p.order_emails when 'messages' then p.message_emails
    when 'calls' then p.call_emails when 'capacity' then p.capacity_emails end
    from public.notification_preferences p where p.org_id = target_org),
    category in ('rfq','payments','orders','messages','calls','capacity'))
$$;

create or replace function public.set_notification_preference(
  target_org uuid,
  category   text,
  enabled    boolean
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result public.notification_preferences;
begin
  perform public.require_org_permission(target_org, 'settingsAccess');
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'only a member of this company can change its email settings'
      using errcode = '42501';
  end if;
  if category is null or category not in ('rfq', 'payments', 'orders', 'messages', 'calls', 'capacity') or enabled is null then
    raise exception 'unknown email setting' using errcode = '22023';
  end if;

  insert into public.notification_preferences as p
    (org_id, rfq_emails, payment_emails, message_emails, order_emails, call_emails, capacity_emails, updated_by, updated_at)
  values (
    target_org,
    case when category = 'rfq'      then enabled else true end,
    case when category = 'payments' then enabled else true end,
    case when category = 'messages' then enabled else true end,
    case when category = 'orders' then enabled else true end,
    case when category = 'calls' then enabled else true end,
    case when category = 'capacity' then enabled else true end,
    auth.uid(), now()
  )
  on conflict (org_id) do update set
    rfq_emails     = case when category = 'rfq'      then enabled else p.rfq_emails end,
    payment_emails = case when category = 'payments' then enabled else p.payment_emails end,
    message_emails = case when category = 'messages' then enabled else p.message_emails end,
    order_emails = case when category = 'orders' then enabled else p.order_emails end,
    call_emails = case when category = 'calls' then enabled else p.call_emails end,
    capacity_emails = case when category = 'capacity' then enabled else p.capacity_emails end,
    updated_by     = auth.uid(),
    updated_at     = now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.record_provider_attempt(
  target_payout uuid,
  new_stage text default null,
  new_ref text default null,
  new_quote text default null,
  new_fee bigint default null,
  new_item text default null,
  new_status text default null,
  sentence text default null,
  received bigint default null,
  received_in text default null,
  keep_lease boolean default false,
  tell_factory text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  live public.provider_payouts;
  told timestamptz;
begin
  select * into live from public.provider_payouts where id = target_payout for update;
  if not found or live.status <> 'processing' then
    return;
  end if;

  update public.provider_payouts x
     set provider_ref = coalesce(new_ref, x.provider_ref),
         received_minor = coalesce(received, x.received_minor),
         received_currency = coalesce(received_in, x.received_currency),
         money_left_at = case when new_stage = 'sent' then coalesce(x.money_left_at, now()) else x.money_left_at end,
         updated_at = now()
   where x.id = target_payout;

  update public.provider_payout_attempts a
     set stage = coalesce(new_stage, a.stage),
         quote_id = coalesce(new_quote, a.quote_id),
         fee_minor = coalesce(new_fee, a.fee_minor),
         provider_item_id = coalesce(new_item, a.provider_item_id),
         provider_status = coalesce(new_status, a.provider_status),
         staff_sentence = sentence,
         lease_until = case when keep_lease then a.lease_until end,
         updated_at = now()
   where a.payout_id = target_payout
  returning a.factory_told_at into told;

  if tell_factory is not null and told is null then
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
    select live.factory_org_id, 'payout_action_required', 'payment', live.payment_id, p.order_id, tell_factory,
           format('Your payment of %s is waiting. %s.', public.format_money(live.amount_cents, live.currency), tell_factory)
      from public.order_payments p where p.id = live.payment_id;
    update public.provider_payout_attempts a set factory_told_at = now() where a.payout_id = target_payout;
    update public.provider_payouts x set details_asked_at = now(), asked_to_check = tell_factory where x.id = target_payout;
  end if;
end;
$$;

create or replace function public.finish_provider_payout(
  target_payout uuid,
  outcome text,
  failure text default null,
  raw_status text default null,
  sentence text default null,
  received bigint default null,
  received_in text default null,
  tell_factory text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  live public.provider_payouts;
  p public.order_payments;
  o public.production_orders;
begin
  select * into live from public.provider_payouts where id = target_payout;
  if not found then
    return;
  end if;
  select * into p from public.order_payments where id = live.payment_id for update;
  select * into live from public.provider_payouts where id = target_payout for update;
  select * into o from public.production_orders where id = p.order_id;

  if outcome = 'paid' then
    if live.status <> 'processing' then
      return;
    end if;
    update public.provider_payouts x
       set status = 'paid', paid_at = now(), updated_at = now(),
           received_minor = coalesce(received, x.received_minor),
           received_currency = coalesce(received_in, x.received_currency)
     where x.id = live.id;

    if p.state = 'confirmed' then
      update public.order_payments
         set state = 'released', released_by = live.requested_by, released_at = now(), released_note = null
       where id = p.id;
      insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
      values (p.id, 'confirmed', 'released', live.requested_by, 'admin');
      insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
      values (o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
        format('%s released to you', public.format_money(p.amount_cents, p.currency)),
        format('Sent to %s against %s.', live.paid_to, o.order_number));
    end if;

  elsif outcome = 'failed' then
    if failure not in ('details_rejected', 'other') then
      raise exception 'a failure needs a code' using errcode = '22023';
    end if;
    if live.status = 'failed' then
      return;
    end if;
    update public.provider_payouts x
       set status = 'failed', failure_code = failure, paid_at = null, asked_to_check = tell_factory, updated_at = now()
     where x.id = live.id;

    if live.status = 'paid' and p.state = 'released' then
      update public.order_payments
         set state = 'confirmed', released_by = null, released_at = null
       where id = p.id;
      insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind, note)
      values (p.id, 'released', 'confirmed', null, 'system', 'The transfer was returned after it was sent');
    end if;

    -- Every confirmed failure reaches the factory, even without a details fix.
    insert into public.notifications (org_id, kind, subject_type, subject_id, order_id, title, body)
      values (o.factory_org_id, 'payout_failed', 'payment', p.id, o.id, 'Payout failed',
        format('The payout of %s for %s did not go through. %s', public.format_money(live.amount_cents, live.currency), o.order_number,
          case when tell_factory is not null then tell_factory || '. Open Payments to check your payout details.'
          else 'Your payment is still owed. Contact operations for help arranging another payout.' end));
  elsif outcome = 'cancelled' then
    if live.status <> 'processing' then
      return;
    end if;
    update public.provider_payouts x set status = 'cancelled', updated_at = now() where x.id = live.id;
  else
    raise exception 'unknown outcome' using errcode = '22023';
  end if;

  update public.provider_payout_attempts a
     set stage = 'done',
         provider_status = coalesce(raw_status, a.provider_status),
         staff_sentence = sentence,
         lease_until = null,
         updated_at = now()
   where a.payout_id = target_payout;
end;
$$;

-- Stripe failures identify the connected account and payout, never raw bank details.
create unique index notifications_stripe_payout_failure_once
  on public.notifications (org_id, (data->>'stripe_payout_id'))
  where kind = 'payout_failed' and data ? 'stripe_payout_id';
create function public.notify_stripe_payout_failed(account_id text, payout_id text, amount bigint, currency_code text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.notifications (org_id, kind, title, body, data)
  select a.org_id, 'payout_failed', 'Withdrawal failed',
    format('Your withdrawal of %s did not go through. Open Payments to check your withdrawal account, or contact operations for help.',
      public.format_money(amount, currency_code)), jsonb_build_object('stripe_payout_id', payout_id)
  from public.stripe_connect_accounts a where a.stripe_account_id = account_id
  on conflict do nothing;
end;
$$;
revoke all on function public.notify_stripe_payout_failed(text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.notify_stripe_payout_failed(text,text,bigint,text) to service_role;

-- Called every five minutes by the authenticated server scheduler. Each party
-- receives one reminder per accepted call/time, including late acceptances.
create function public.queue_upcoming_call_reminders()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare c record; party uuid; written integer := 0;
begin
  for c in select calls.*, t.brand_org_id, t.factory_org_id
    from public.calls join public.message_threads t on t.id = calls.thread_id
    where calls.status = 'accepted' and calls.starts_at > now()
      and calls.starts_at <= now() + interval '1 hour'
    for update of calls skip locked
  loop
    foreach party in array array[c.brand_org_id,c.factory_org_id] loop
      insert into public.notification_reminders (kind,subject_id,due_key,org_id)
      values ('call_reminder',c.id,c.starts_at::text || ':' || party::text,party)
      on conflict do nothing;
      if found then
        insert into public.notifications (org_id,kind,subject_type,subject_id,title,body,data)
        values (party,'call_reminder','thread',c.thread_id,'Upcoming call: ' || c.title,
          'Your accepted call starts soon. Open the conversation to view the call and join when it is time.',
          jsonb_build_object('call_id',c.id,'starts_at',c.starts_at));
        written := written + 1;
      end if;
    end loop;
  end loop;
  return written;
end;
$$;
revoke all on function public.queue_upcoming_call_reminders() from public, anon, authenticated;
grant execute on function public.queue_upcoming_call_reminders() to service_role;

create or replace function public.claim_notification_emails(max_rows integer default 25)
returns table (
  id               uuid,
  attempts         integer,
  recipient_email  text,
  recipient_name   text,
  locale           text,
  time_zone        text,
  category         text,
  org_id           uuid,
  org_name         text,
  org_type         text,
  kind             text,
  subject_type     text,
  subject_id       uuid,
  order_id         uuid,
  title            text,
  body             text,
  data             jsonb,
  created_at       timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  update public.notification_email_outbox o set status = 'skipped', last_error = 'call no longer upcoming'
  from public.notifications n
  where n.id = o.notification_id and n.kind = 'call_reminder'
    and o.status in ('pending','sending') and not exists (
      select 1 from public.calls c where c.id::text = n.data->>'call_id'
        and c.status = 'accepted' and c.starts_at > now()
        and c.starts_at = (n.data->>'starts_at')::timestamptz);
  update public.notification_email_outbox o
     set status = 'skipped', last_error = 'switched off in Settings'
   where o.status = 'pending'
     and o.next_attempt_at <= now()
     and not public.notification_email_enabled(o.org_id, o.category);

  return query
  with due as (
    select o.id
      from public.notification_email_outbox o
     where (o.status = 'pending' and o.next_attempt_at <= now())
        or (o.status = 'sending' and o.claimed_at < now() - interval '10 minutes')
     order by o.next_attempt_at
     limit greatest(1, least(coalesce(max_rows, 25), 100))
     for update skip locked
  ), claimed as (
    update public.notification_email_outbox o
       set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
      from due
     where o.id = due.id
    returning o.*
  )
  select c.id, c.attempts, c.recipient_email, profile.full_name, profile.locale,
         profile.time_zone, c.category, c.org_id, org.name, org.type::text,
         n.kind, n.subject_type, n.subject_id, n.order_id, n.title, n.body, n.data, n.created_at
    from claimed c
    join public.notifications n on n.id = c.notification_id
    join public.orgs org on org.id = c.org_id
    left join public.user_profiles profile on profile.id = c.recipient_user_id;
end;
$$;
