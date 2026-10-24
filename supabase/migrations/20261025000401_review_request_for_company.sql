-- ============================================================================
-- A company can read what staff asked of it, and send its profile back
-- ----------------------------------------------------------------------------
-- A company that is not verified is kept on onboarding's finish card. Until
-- now that card said "awaiting verification" whatever had happened: a company
-- staff had asked for more information, or had declined, saw exactly what a
-- company nobody had opened saw. The request only reached it as an email and
-- a bell the finish card does not draw, so "a factory told only 'Needs
-- information' has nothing to act on" was true on screen.
--
-- org_reviews stays staff-only. Its note is the reviewer's, and the owner is a
-- staff name. What the company may read is what it was already sent: the body
-- of the notification admin_review_decision() wrote in the same transaction.
-- So my_review_status() returns the review's state and that notification, and
-- nothing else from the row.
--
-- resubmit_for_review() is the answer. It moves a 'needs_information' review
-- back to 'ready_for_review', which the queue sorts first, so staff can tell
-- a company that answered from one that went quiet. It is allowed from no
-- other state: approving, declining and claiming stay staff decisions.
--
-- Both are security definer because org_reviews has no policy a member could
-- pass. The membership test is the first statement in each, before any
-- select, for the same reason the admin functions test is_platform_admin()
-- first: checking afterwards leaks whether a row exists.
--
-- Additive: two new functions, nothing the live site calls is changed.
-- ============================================================================

create or replace function public.my_review_status(target_org uuid)
returns table (
  state   public.org_review_state,
  title   text,
  message text,
  sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if target_org is null or target_org not in (select public.current_org_ids()) then
    raise exception 'only a member of this company can read its review' using errcode = '42501';
  end if;

  return query
  select
    coalesce(r.state, 'ready_for_review'::public.org_review_state),
    n.title,
    n.body,
    n.created_at
  from (select 1) as one
  left join public.org_reviews r on r.org_id = target_org
  -- Only the two states that asked something of the company carry text: the
  -- notification it was sent for that decision, the latest one.
  left join lateral (
    select x.title, x.body, x.created_at
      from public.notifications x
     where x.org_id = target_org
       and x.kind = case r.state
                      when 'needs_information' then 'verification_needs_information'
                      when 'declined'          then 'verification_declined'
                    end
     order by x.created_at desc
     limit 1
  ) n on true;
end;
$$;

revoke all on function public.my_review_status(uuid) from public;
grant execute on function public.my_review_status(uuid) to authenticated;

create or replace function public.resubmit_for_review(target_org uuid)
returns public.org_review_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  moved public.org_review_state;
begin
  if target_org is null or target_org not in (select public.current_org_ids()) then
    raise exception 'only a member of this company can send its profile back' using errcode = '42501';
  end if;

  update public.org_reviews
     set state = 'ready_for_review',
         updated_at = now()
   where org_id = target_org
     and state = 'needs_information'
  returning state into moved;

  if moved is null then
    raise exception 'this profile was not returned for more information' using errcode = '22023';
  end if;

  return moved;
end;
$$;

revoke all on function public.resubmit_for_review(uuid) from public;
grant execute on function public.resubmit_for_review(uuid) to authenticated;
