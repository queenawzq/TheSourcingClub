-- Resolve an order's project name once, before the bell and email queue see
-- the notification. The number stays useful as a parenthesized reference.
create function public.notification_project_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_title text;
  project_number text;
  project_label text;
begin
  if new.order_id is null then return new; end if;
  select nullif(btrim(r.title), ''), o.order_number
    into project_title, project_number
    from public.production_orders o
    join public.rfqs r on r.id = o.rfq_id
   where o.id = new.order_id;
  if project_title is null or project_number is null then return new; end if;
  project_label := format('%s (%s)', project_title, project_number);
  new.title := replace(new.title, project_number, project_label);
  return new;
end;
$$;
revoke all on function public.notification_project_name() from public, anon, authenticated;
create trigger notifications_project_name
  before insert on public.notifications
  for each row execute function public.notification_project_name();
