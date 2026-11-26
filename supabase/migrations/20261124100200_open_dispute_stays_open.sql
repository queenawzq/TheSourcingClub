-- Payment reviews: a review whose dispute the bank hasn't decided stays open
-- (20261124100100 follow-up). Staff can't be notified, so once both sides
-- are decided (Pay factory, Unpause brand) the row must stay on the list,
-- and in every count, with its respond-by date, until Stripe says the
-- dispute is won or lost. Only then does it move to Decided.

create or replace function public.payment_review_needs_staff(v public.payment_reviews)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select v.decided_at is null
      or (v.cause = 'dispute' and v.brand_unpaused_at is null)
      or (v.cause = 'dispute' and coalesce(v.dispute_status, '') not in ('won', 'lost', 'warning_closed'));
$$;
