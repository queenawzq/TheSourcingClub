-- ============================================================================
-- The update that makes a step ready for approval is always emailed
-- ----------------------------------------------------------------------------
-- 20261115400100 sends the brand at most one email per step per person every
-- 6 hours about the factory's updates. That could swallow the one that
-- matters: the factory's update saying the step is ready.
--
-- A step is approved from the factory's update on it (20261029000200: an open
-- step waits for the factory to post). Today approve_milestone accepts an open
-- step without one (20261104000400, kept in 20261104100000), so there is no
-- state to read; "ready for approval" is therefore the factory's FIRST update
-- on the step, or its first since the brand's latest dispute on it (a dispute
-- is the brand turning the work back). That update is always emailed; the
-- 6-hour limit applies only to the factory's further updates after it.
-- Only queue_notification_emails changes.
-- ============================================================================

create or replace function public.queue_notification_emails()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cat text;
  ready boolean := false;
begin
  begin
    cat := public.notification_email_category_for(new);
    if cat is null or not public.notification_email_enabled(new.org_id, cat) then
      return new;
    end if;

    -- The factory's first update on the step (this one, already written by
    -- post_milestone_update), or its first since the brand last disputed it.
    if new.kind = 'milestone_update' and new.subject_type = 'milestone' then
      select count(*) <= 1 into ready
        from public.milestone_updates u
        join public.production_orders o on o.id = u.order_id
       where u.milestone_id = new.subject_id
         and u.author_org_id = o.factory_org_id
         and u.kind = 'comment'
         and u.created_at > coalesce(
               (select max(d.created_at) from public.milestone_updates d
                 where d.milestone_id = new.subject_id and d.kind = 'dispute'),
               '-infinity'::timestamptz);
    end if;

    insert into public.notification_email_outbox
      (notification_id, org_id, recipient_user_id, recipient_email, category)
    select new.id, new.org_id, member.user_id, btrim(profile.email), cat
      from public.org_members member
      join public.user_profiles profile on profile.id = member.user_id
     where member.org_id = new.org_id
       and coalesce(btrim(profile.email), '') <> ''
       -- A message per conversation, an update per step: one email per
       -- person every 6 hours, except the update that makes a step ready.
       and not (
         new.kind in ('message', 'milestone_update')
         and not ready
         and exists (
           select 1
             from public.notification_email_outbox earlier
             join public.notifications n on n.id = earlier.notification_id
            where earlier.recipient_user_id = member.user_id
              and earlier.status <> 'skipped'
              and earlier.created_at > now() - interval '6 hours'
              and n.kind = new.kind
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
