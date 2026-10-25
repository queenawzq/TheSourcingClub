-- Allow owners to buy an exact number of credits while keeping the preset
-- packs as convenient shortcuts. Pricing remains server-owned: every credit
-- costs 10 cents, and Stripe is never given a client-calculated amount.
create or replace function public.create_credit_purchase(
  target_org   uuid,
  pack_credits integer,
  buyer        uuid
)
returns public.credit_purchases
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p     public.credit_purchases;
  kind  public.org_type;
  price bigint;
  cur   char(3) := 'USD';
begin
  if buyer is null or not exists (
    select 1 from public.org_members
    where org_id = target_org and user_id = buyer and role = 'owner'
  ) then
    raise exception 'only an owner of the company can buy credits' using errcode = '42501';
  end if;

  select type into kind from public.orgs where id = target_org;
  if kind is distinct from 'factory' then
    raise exception 'credits are for vendors sending quotes' using errcode = '22023';
  end if;

  if pack_credits is null or pack_credits < 50 then
    raise exception 'the minimum credit purchase is 50 credits' using errcode = '22023';
  end if;

  price := pack_credits::bigint * 10;

  insert into public.credit_purchases (org_id, credits, amount_cents, currency, created_by)
  values (target_org, pack_credits, price, cur, buyer)
  returning * into p;
  return p;
end;
$$;

revoke all on function public.create_credit_purchase(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.create_credit_purchase(uuid, integer, uuid) to service_role;
