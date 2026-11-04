-- ---------------------------------------------------------------------------
-- Removing the bank account TSC pays, in one step (John, 2026-10-30).
--
-- A bank-paid factory was refused ("choose another account for TSC to pay
-- first") when it removed the account TSC pays while it had others. Now the
-- factory removes it and another becomes the one TSC pays, in the same
-- transaction, so there is never none while others exist and never two.
-- The last one may go too: TSC then holds the factory's released earnings
-- until it adds a payout method (the screen says so before asking).
--
-- The delete guard (20261029000300) stays as it is. Its `payout_primary`
-- refusal still stops a direct delete of the primary, which this function
-- never makes (the mark has moved first). Its `payout_owed` refusal still
-- stands for the last account: money staff are sending now has nowhere else
-- to go. With another account, that money goes to the new one, so moving
-- the mark first (which the guard then lets through) is right.
--
-- Runs as the caller, so RLS decides: only an owner may update or delete
-- these rows.
-- ---------------------------------------------------------------------------
create or replace function public.remove_payout_account(target uuid, promote uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  owner_org uuid;
  was_primary boolean;
  next_primary uuid;
begin
  select org_id, is_primary into owner_org, was_primary
    from public.factory_payout_accounts where id = target;
  if owner_org is null then
    raise exception 'that bank account does not exist' using errcode = 'P0002';
  end if;
  if not public.is_org_owner(owner_org) then
    raise exception 'only an owner removes a payout account' using errcode = '42501';
  end if;

  if was_primary then
    -- The one chosen, else the most recently added of the others.
    select a.id into next_primary
      from public.factory_payout_accounts a
     where a.org_id = owner_org and a.id <> target
     order by (a.id = promote) desc, a.created_at desc
     limit 1;
    if next_primary is not null then
      update public.factory_payout_accounts set is_primary = false where id = target;
      update public.factory_payout_accounts set is_primary = true where id = next_primary;
    end if;
  end if;

  delete from public.factory_payout_accounts where id = target;
  return next_primary;
end;
$$;

revoke all on function public.remove_payout_account(uuid, uuid) from public, anon;
grant execute on function public.remove_payout_account(uuid, uuid) to authenticated;
