-- One balance, fix round 39.
--
-- L5  A per-step payout refused because the factory owes TSC tells staff the
--     part its other earnings do not cover (what must be covered before this
--     step is paid), not the whole debt: a debt its earnings cover is netted.
--
-- (The returned-withdrawal fixes of this round are in 20261121385000, which
-- was not yet applied anywhere.) Latest full body; CREATE OR REPLACE keeps
-- the grant; no overloads.

-- 20261121370000's body; the amount said is what the other earnings miss.
create or replace function public.per_step_payout_check(p public.order_payments, factory uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  other bigint;
begin
  -- Under the company lock its callers take, like claim_owed_steps().
  -- What the factory owes TSC must be covered by its OTHER earnings: this
  -- step is what would be sent, so it covers nothing (20261121370000).
  other := (public.owed_reachable(factory) ->> 'any_cents')::bigint
           - case when public.payment_claimable(p)
                  then greatest(public.payment_factory_cents(p) - public.payment_taken_cents(p.id), 0)
                  else 0 end;
  if public.factory_debt_cents(factory) > 0 and other < 0 then
    -- The part not covered (20261121387000).
    raise exception 'the factory owes TSC %', public.format_money(-other, 'USD')
      using errcode = '22023', hint = 'payout_owes_tsc', detail = public.format_money(-other, 'USD');
  end if;
  if p.disputed_at is not null then
    raise exception 'the brand disputed this payment' using errcode = '22023', hint = 'payout_disputed';
  end if;
  -- Part of it went back to the brand: the factory withdraws the rest from
  -- its balance (a per-step payout pays the whole step). A factory with no
  -- method it can withdraw to does so once it adds one: staff are told which.
  if p.factory_refund_cents > 0 then
    raise exception 'part of this payment was returned to the brand' using errcode = '22023',
      hint = case when public.factory_can_withdraw(factory) then 'payout_refunded' else 'payout_refunded_no_method' end;
  end if;
  if not public.payment_cleared(p) then
    raise exception 'the brand''s payment has not cleared yet' using errcode = '22023', hint = 'payout_not_cleared';
  end if;
end;
$$;
revoke all on function public.per_step_payout_check(public.order_payments, uuid) from public, anon, authenticated;
