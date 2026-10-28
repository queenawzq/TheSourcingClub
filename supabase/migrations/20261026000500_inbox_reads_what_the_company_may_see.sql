-- A company's inbox shows what the company may see, whoever is reading it.
--
-- `messages_read` ends in `or is_platform_admin()`, so a staff member who also
-- belongs to a company read the other side's held and rejected messages in
-- that company's conversations: the thread list's last line, its message
-- count and the order's activity all read `messages` and relied on the policy
-- to mean "what my company may see". It says what staff may read. Each read
-- here now says for itself: delivered, or written by the reader's company.
--
-- Staff tooling is unaffected: the held queue, release and reject are definer
-- functions. The view keeps its columns in the same order and stays
-- security_invoker; order_activity keeps its signature. Additive and safe with
-- the old site live.
--
-- Also: platform staff do not create companies. CLAUDE.md: a synthetic or
-- accidental staff org leaks into current_org_ids() and every
-- `or is_platform_admin()` branch. create_org refuses staff; app.html sends
-- them to the console.

create or replace view public.message_thread_summary
with (security_invoker = true) as
select
  t.*,
  b.name as brand_name,
  f.name as factory_name,
  coalesce(r.title, o.order_number)              as subject_title,
  case when t.order_id is not null then 'order' else 'rfq' end as subject_kind,
  last.body        as last_body,
  last.sender_org_id as last_sender_org_id,
  (
    select count(*)
    from public.messages m
    where m.thread_id = t.id
      and m.delivery = 'delivered'
      and m.sender_user_id is distinct from auth.uid()
      and not public.is_org_member(m.sender_org_id)
      and m.delivered_at > coalesce(
        (select mr.last_read_at from public.message_reads mr
          where mr.thread_id = t.id and mr.user_id = auth.uid()),
        '-infinity'::timestamptz
      )
  )::integer as unread_count,
  (
    select count(*)
    from public.messages m
    where m.thread_id = t.id
      and (m.delivery = 'delivered' or public.is_org_member(m.sender_org_id))
  )::integer as message_count,
  last.body_translated      as last_body_translated,
  last.body_translated_lang as last_body_translated_lang
from public.message_threads t
join public.orgs b on b.id = t.brand_org_id
join public.orgs f on f.id = t.factory_org_id
left join public.rfqs r              on r.id = t.rfq_id
left join public.production_orders o on o.id = t.order_id
left join lateral (
  select body, sender_org_id, body_translated, body_translated_lang
  from public.messages
  where thread_id = t.id
    and (delivery = 'delivered' or public.is_org_member(sender_org_id))
  order by coalesce(delivered_at, created_at) desc
  limit 1
) last on true;

grant select on public.message_thread_summary to authenticated;

-- order_activity as 20261022000500 left it, with only the message line
-- changed: the last message the reader's company may see, at the time it was
-- delivered (a released message arrives when staff release it).
create or replace function public.order_activity(target_order uuid)
returns table (
  at              timestamptz,
  kind            text,
  actor_org_id    uuid,
  milestone_title text,
  detail          text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with o as (
    select * from public.production_orders where id = target_order
  )
  select * from (
    select o.created_at, 'order_created', null::uuid, null::text, o.order_number from o
    union all
    select o.schedule_brand_agreed_at, 'schedule_agreed', o.brand_org_id, null, null
      from o where o.schedule_brand_agreed_at is not null
    union all
    select o.schedule_factory_agreed_at, 'schedule_agreed', o.factory_org_id, null, null
      from o where o.schedule_factory_agreed_at is not null
    union all
    select o.activated_at, 'order_activated', null, null, null
      from o where o.activated_at is not null
    union all
    select o.cancel_proposed_at, 'cancellation_proposed', o.cancel_proposed_by_org, null, o.cancel_reason
      from o where o.cancel_proposed_at is not null
    union all
    select o.completed_at, 'order_completed', null, null, null
      from o where o.completed_at is not null
    union all
    select o.cancelled_at, 'order_cancelled', null, null, null
      from o where o.cancelled_at is not null

    union all
    select m.submitted_at, 'step_submitted', o.factory_org_id, m.title, null
      from public.order_milestones m join o on o.id = m.order_id
     where m.submitted_at is not null
    union all
    select m.approved_at, 'step_approved', o.brand_org_id, m.title, m.approval_note
      from public.order_milestones m join o on o.id = m.order_id
     where m.approved_at is not null
    union all
    -- A step that was approved and completed in one go already has its line.
    select m.completed_at, 'step_completed', null, m.title, null
      from public.order_milestones m join o on o.id = m.order_id
     where m.completed_at is not null
       and m.completed_at is distinct from m.approved_at

    union all
    select u.created_at, 'update_posted', u.author_org_id, m.title, left(u.body, 140)
      from public.milestone_updates u
      join public.order_milestones m on m.id = u.milestone_id
     where u.order_id = target_order

    union all
    select e.created_at,
           case
             -- Held money that went back to the brand (refunded in Stripe,
             -- or a payment that could no longer count).
             when e.from_state = 'confirmed' and e.to_state in ('failed', 'cancelled', 'not_due')
               then 'payment_refunded'
             when e.from_state = 'released' and e.to_state = 'released'
               then 'payment_refunded_after_payout'
             else 'payment_' || e.to_state::text
           end,
           case e.actor_kind when 'brand' then o.brand_org_id
                             when 'factory' then o.factory_org_id end,
           m.title, p.amount_cents::text
      from public.payment_events e
      join public.order_payments p on p.id = e.payment_id
      join public.order_milestones m on m.id = p.milestone_id
      join o on o.id = p.order_id
     where (e.from_state is distinct from e.to_state
            and e.to_state in ('due', 'sent', 'processing', 'failed', 'confirmed', 'released'))
        or (e.from_state = 'confirmed' and e.to_state in ('failed', 'cancelled', 'not_due'))
        or (e.from_state = 'released' and e.to_state = 'released')

    union all
    (select coalesce(msg.delivered_at, msg.created_at), 'message', msg.sender_org_id, null, null
       from public.messages msg
       join public.message_threads t on t.id = msg.thread_id
      where t.order_id = target_order
        and (msg.delivery = 'delivered' or public.is_org_member(msg.sender_org_id))
      order by coalesce(msg.delivered_at, msg.created_at) desc
      limit 1)
  ) activity (at, kind, actor_org_id, milestone_title, detail)
  order by at desc;
$$;

revoke all on function public.order_activity(uuid) from public;
grant execute on function public.order_activity(uuid) to authenticated;

-- create_org as 20260901000100 left it, refusing platform staff first.
create or replace function public.create_org(
  org_name text,
  org_kind public.org_type
)
returns public.orgs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  base_slug text;
  final_slug text;
  suffix int := 1;
  new_org public.orgs;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to create an organisation'
      using errcode = '42501';
  end if;

  if public.is_platform_admin() then
    raise exception 'platform staff work in the admin console and do not create companies'
      using errcode = '42501';
  end if;

  if org_name is null or length(btrim(org_name)) = 0 then
    raise exception 'organisation name is required' using errcode = '22023';
  end if;

  base_slug := regexp_replace(lower(btrim(org_name)), '[^a-z0-9]+', '-', 'g');
  base_slug := btrim(base_slug, '-');
  if base_slug = '' then
    base_slug := 'org';
  end if;

  final_slug := base_slug;
  while exists (select 1 from public.orgs where slug = final_slug) loop
    suffix := suffix + 1;
    final_slug := base_slug || '-' || suffix;
  end loop;

  insert into public.orgs (type, name, slug)
  values (org_kind, btrim(org_name), final_slug)
  returning * into new_org;

  insert into public.org_members (org_id, user_id, role)
  values (new_org.id, auth.uid(), 'owner');

  return new_org;
end;
$$;

revoke all on function public.create_org(text, public.org_type) from public;
grant execute on function public.create_org(text, public.org_type) to authenticated;
