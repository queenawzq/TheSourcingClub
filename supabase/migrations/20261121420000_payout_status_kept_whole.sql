-- ============================================================================
-- An older read of a payout changes nothing
-- ----------------------------------------------------------------------------
-- keep_payout_status_forward kept a Stripe payout's recorded status from
-- going back (pending → in_transit → paid → failed / canceled) but let the
-- same stale answer write its arrival day. The server also kept its own copy
-- of the ranks to skip such an answer before writing (refreshPayouts); that
-- copy is gone, so the trigger keeps the arrival with the status: an answer
-- ranked below what is recorded changes neither.
-- Grants unchanged (a trigger function). Safe with the live site while
-- applied: the live server never writes a lower-ranked answer either.
-- ============================================================================

create or replace function public.keep_payout_status_forward()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.payout_status_rank(new.payout_status) < public.payout_status_rank(old.payout_status) then
    new.payout_status := old.payout_status;
    new.payout_arrives_on := old.payout_arrives_on;
    new.payout_arrives_at := old.payout_arrives_at;
  end if;
  return new;
end;
$$;
