-- ============================================================================
-- Refunds are emailed
-- ----------------------------------------------------------------------------
-- payment_refunded (20261022000500) tells the brand its money came back and
-- that the step must be paid again, and tells the factory the step is unfunded.
-- It was written after notification_email_category and fell through to "bell
-- only". It belongs under "Payment and approval requests", like
-- payment_failed.
--
-- Safe in either order: mapping a kind no row has yet changes nothing until
-- one is written.
-- ============================================================================

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
    else null
  end
$$;

revoke all on function public.notification_email_category(text) from public, anon;
grant execute on function public.notification_email_category(text) to authenticated, service_role;
