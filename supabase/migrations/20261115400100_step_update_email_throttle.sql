-- ============================================================================
-- A factory's updates on one step: at most one email per person every 6 hours
-- ----------------------------------------------------------------------------
-- 20261115400000 emails the brand the factory's update on a step it approves
-- (milestone_update under "Payment and approval requests"). A factory posting
-- several photos or notes on the same step in a row sent one email each, to
-- every member. This applies the message throttle to it: per person, per step
-- (the notification's subject), 6 hours. The bell still gets every update.
-- Only queue_notification_emails changes; everything else is as 20261115400000.
-- ============================================================================

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
       -- A message per conversation, an update per step: one email per
       -- person every 6 hours.
       and not (
         new.kind in ('message', 'milestone_update')
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
