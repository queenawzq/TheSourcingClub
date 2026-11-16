-- ============================================================================
-- Every email, and the switch that stops it
-- ----------------------------------------------------------------------------
-- Settings → Notifications has three switches per company, on both sides:
--   rfq       "New quote activity" (brand) / "New RFQ matches" (factory)
--   payments  "Payment and approval requests"
--   messages  "Messages and call invites"
-- This file is the one written map of every email the platform sends to a
-- company and what decides whether it goes. The bell is never affected: every
-- notification below is written whatever the switches say.
--
-- Notification emails (notification_email_outbox, queued by the trigger on
-- notifications; the sender re-checks the switch before each send):
--
--   rfq       rfq_invited, rfq_matched, rfq_cancelled, capacity_reminder,
--             quote_accepted, quote_declined (factory);
--             quote_received, quote_withdrawn (brand)
--   payments  payment_due, payment_failed, payment_refunded, payment_confirmed,
--             payment_sent, payment_rejected, funds_released,
--             milestone_submitted, milestone_approved, milestone_dispute,
--             milestone_reminder, milestone_due_soon,
--             milestone_update: the factory's update on an open step the
--               brand approves (approval_and_payment, approval_only), to the
--               brand. That update is how a step is sent for approval now
--               (20261029000200); other updates and comments stay in the bell,
--             schedule_updated, schedule_agreed,
--             order_created, order_activated, order_completed, order_cancelled,
--             cancellation_proposed, cancellation_withdrawn, cancellation_declined
--   messages  message (at most one per conversation per person every 6 hours),
--             call_proposed, call_accepted, call_declined, call_countered,
--             call_cancelled
--   account   payout_method_changed: always sent, no switch stops it
--             (20261106300000; the anti-fraud alert)
--
-- Bell only, never emailed: payment_processing (short-lived), message_rejected
-- (the sender sees it at once), milestone_update otherwise, verification_*
-- (their own email, below), credits_granted, credits_adjusted,
-- referral_joined, referral_rewarded, team_member_joined, team_member_left,
-- team_member_removed, matching_evidence_* (matching v2 is off).
--
-- Always sent, outside this outbox, because the person must get them:
--   - the verification decision (approved / declined / needs information):
--     verification_approval_email_outbox, api/_review-decision-sender.js
--   - onboarding submitted: onboarding_submission_email_outbox,
--     api/send-onboarding-complete.js
--   - a team invitation: api/send-team-invite.js (to someone not yet a member)
--   - a company invitation: api/send-invite.js (to an outside address)
--   - password reset and its code: Supabase Auth itself
-- Staff-only, not to a company: review resubmission alerts, the operations
-- inbox forward (api/inbound-email.js), Admin → Test emails (to the admin).
--
-- Additive and safe with the live site while applied: the same signatures,
-- create or replace only.
-- ============================================================================

create or replace function public.notification_email_category(kind text)
returns text
language sql
immutable
as $$
  select case
    when kind in ('rfq_invited', 'rfq_cancelled', 'quote_received', 'quote_withdrawn',
                  'quote_accepted', 'quote_declined', 'rfq_matched', 'capacity_reminder')
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

revoke all on function public.notification_email_category(text) from public, anon;
grant execute on function public.notification_email_category(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- notification_email_category_for: the kind's switch, plus the one kind whose
-- switch depends on what it is about.
-- ---------------------------------------------------------------------------
create or replace function public.notification_email_category_for(n public.notifications)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if n.kind = 'milestone_update' then
    if n.subject_type = 'milestone' and exists (
      select 1
        from public.order_milestones m
        join public.production_orders o on o.id = m.order_id
       where m.id = n.subject_id
         and o.brand_org_id = n.org_id
         and m.kind in ('approval_and_payment', 'approval_only')
         and m.state in ('active', 'submitted')
    ) then
      return 'payments';
    end if;
    return null;
  end if;
  return public.notification_email_category(n.kind);
end;
$$;

revoke all on function public.notification_email_category_for(public.notifications) from public, anon, authenticated;
grant execute on function public.notification_email_category_for(public.notifications) to service_role;

-- ---------------------------------------------------------------------------
-- queue_notification_emails: as 20261015000100, through the function above.
-- ---------------------------------------------------------------------------
create or replace function public.queue_notification_emails()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cat text;
begin
  begin
    cat := public.notification_email_category_for(new);
    if cat is null or not public.notification_email_enabled(new.org_id, cat) then
      return new;
    end if;

    insert into public.notification_email_outbox
      (notification_id, org_id, recipient_user_id, recipient_email, category)
    select new.id, new.org_id, member.user_id, btrim(profile.email), cat
      from public.org_members member
      join public.user_profiles profile on profile.id = member.user_id
     where member.org_id = new.org_id
       and coalesce(btrim(profile.email), '') <> ''
       and not (
         new.kind = 'message'
         and exists (
           select 1
             from public.notification_email_outbox earlier
             join public.notifications n on n.id = earlier.notification_id
            where earlier.recipient_user_id = member.user_id
              and earlier.status <> 'skipped'
              and earlier.created_at > now() - interval '6 hours'
              and n.kind = 'message'
              and n.org_id = new.org_id
              and n.subject_id is not distinct from new.subject_id
         )
       )
    on conflict (notification_id, recipient_user_id) do nothing;
  exception when others then
    raise warning 'notification % was not queued for email: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.queue_notification_emails() from public, anon, authenticated;
