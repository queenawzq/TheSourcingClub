-- A failed external creation must not freeze earnings. Keep its retry key so
-- an ambiguous network failure cannot create a second replacement account.
alter table public.stripe_connect_upgrades add column creation_failed boolean not null default true;

update public.stripe_connect_upgrades set creation_failed=true where new_account_id is null and completed_at is null;

create function public.record_connect_upgrade_creation(target_org uuid, attempt timestamptz, replacement text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  update public.stripe_connect_upgrades
    set new_account_id=coalesce(new_account_id,replacement), creation_failed=(replacement is null)
    where org_id=target_org and started_at=attempt and completed_at is null
      and (new_account_id is null or new_account_id=replacement);
end; $$;
revoke all on function public.record_connect_upgrade_creation(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_connect_upgrade_creation(uuid,timestamptz,text) to service_role;

create or replace function public.claim_payment_release(target_payment uuid)
returns timestamptz language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed timestamptz; target_org uuid;
begin
  select o.factory_org_id into target_org from public.order_payments p
    join public.production_orders o on o.id=p.order_id where p.id=target_payment;
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  if exists (select 1 from public.stripe_connect_upgrades where org_id=target_org and completed_at is null and new_account_id is not null) then
    return null;
  end if;
  update public.order_payments set release_claimed_at=now()
    where id=target_payment and state='confirmed' and release_requested_at is not null
    and (release_claimed_at is null or release_claimed_at < now()-interval '10 minutes')
    returning release_claimed_at into claimed;
  return claimed;
end; $$;

create or replace function public.begin_connect_upgrade(target_org uuid, expected_account text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.stripe_connect_accounts where org_id = target_org
    and stripe_account_id = expected_account for update;
  if not found then raise exception 'Payout account changed. Reload and try again.'; end if;
  if exists (select 1 from public.order_payments p join public.production_orders o on o.id = p.order_id
    where o.factory_org_id = target_org and p.state = 'confirmed' and p.release_claimed_at is not null) then
    raise exception 'A transfer is being reconciled. Try upgrading again once it finishes.';
  end if;
  insert into public.stripe_connect_upgrades(org_id, old_account_id) values (target_org, expected_account)
    on conflict (org_id) do update set creation_failed=(stripe_connect_upgrades.new_account_id is null);
end; $$;

create or replace function public.finish_connect_upgrade(target_org uuid, replacement text, account_country text,
  submitted boolean, can_pay boolean, can_transfer boolean, due text[])
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare old_id text;
begin
  perform 1 from public.stripe_connect_accounts where org_id=target_org for update;
  select old_account_id into old_id from public.stripe_connect_upgrades where org_id=target_org
    and new_account_id=replacement and completed_at is null for update;
  if old_id is null then return; end if;
  if exists (select 1 from public.order_payments p join public.production_orders o on o.id=p.order_id
    where o.factory_org_id=target_org and p.state='confirmed' and p.release_claimed_at is not null) then
    raise exception 'A transfer is being reconciled. Check again once it finishes.';
  end if;
  if not submitted or not can_pay or not can_transfer then raise exception 'Finish verification first.'; end if;
  update public.stripe_connect_accounts set stripe_account_id=replacement, country=account_country,
    details_submitted=submitted, payouts_enabled=can_pay, transfers_active=can_transfer, requirements_due=due
    where org_id=target_org and stripe_account_id=old_id;
  if not found then raise exception 'Payout account changed during upgrade.'; end if;
  update public.stripe_connect_upgrades set completed_at=now() where org_id=target_org;
end; $$;
