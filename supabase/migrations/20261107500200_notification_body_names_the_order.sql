-- ============================================================================
-- A notification's body names the order too
-- ----------------------------------------------------------------------------
-- 20261031141931 named the order in the title and left the body with its serial
-- number, so the payment emails read "TSC holds $120.00 for this step on
-- TSC-000017". Queena's list: an email says the order's name, the number after
-- it at most. One trigger, because some thirty functions write these words and
-- all of them go through it before the bell and the email queue see the row.
-- Rows already written stay as they are: the table is immutable by design.
-- ============================================================================
create or replace function public.notification_project_name()
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
  new.body := replace(new.body, project_number, project_label);
  return new;
end;
$$;
revoke all on function public.notification_project_name() from public, anon, authenticated;
