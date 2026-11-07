-- ============================================================================
-- Who saw an account number, and what Wise said was wrong with the details
-- ----------------------------------------------------------------------------
-- The record of who looked counted Pay with Wise as a view, so a tester who
-- never pressed Show number found three rows against their name. The read is
-- real and stays on the record: it now says which it was. Rows from before
-- this are 'shown', and nothing has reached production yet.
--
-- When Wise refuses bank details it names the field. details_fields keeps those
-- keys (Wise's own, the same ones as wise_details) on the row the factory reads,
-- so its page can say which field to check. Keys only: never Wise's message,
-- whose arguments repeat the value typed.
-- ============================================================================

alter table public.payout_number_reveals
  add column how text not null default 'shown' check (how in ('shown', 'sent_to_wise'));

alter table public.provider_payouts
  add column details_fields text[];

create or replace function public.payout_wise_recipient(target_account uuid)
returns table (
  recipient_type text,
  currency text,
  number_key text,
  account_number text,
  details jsonb,
  changed_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.factory_payout_accounts;
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;

  select * into a from public.factory_payout_accounts x where x.id = target_account;
  if not found then
    raise exception 'that account does not exist' using errcode = 'P0002';
  end if;

  if public.is_org_member(a.org_id) then
    raise exception 'you belong to this company, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if exists (
    select 1 from public.production_orders o
     where o.factory_org_id = a.org_id and public.is_org_member(o.brand_org_id)
  ) then
    raise exception 'your company has an order with this factory, so someone else on the staff must pay it'
      using errcode = '42501', hint = 'reveal_brand_side';
  end if;
  if not a.is_primary or not exists (
    select 1
      from public.order_payments p
      join public.production_orders o on o.id = p.order_id
      left join public.stripe_connect_accounts s on s.org_id = o.factory_org_id
     where o.factory_org_id = a.org_id
       and p.state = 'confirmed'
       and p.release_requested_at is not null
       and not (coalesce(s.transfers_active, false) and p.stripe_payment_intent_id is not null)
  ) then
    raise exception 'TSC does not owe this company a payout by hand, so its number stays hidden'
      using errcode = '22023', hint = 'reveal_not_owed';
  end if;
  if a.wise_recipient_type is null then
    raise exception 'this bank account was not set up for Wise'
      using errcode = '22023', hint = 'wise_not_set_up';
  end if;
  if not exists (select 1 from public.payout_account_numbers n where n.account_id = a.id) then
    raise exception 'no full account number is on file'
      using errcode = '22023', hint = 'no_number';
  end if;

  insert into public.payout_number_reveals
    (account_id, org_id, org_name, bank_name, last4, staff_user_id, staff_email, how)
  select a.id, a.org_id, o.name, a.bank_name, a.account_number_last4, auth.uid(),
         (select u.email from auth.users u where u.id = auth.uid()), 'sent_to_wise'
    from public.orgs o where o.id = a.org_id;

  return query select a.wise_recipient_type, a.wise_currency::text, a.wise_number_key,
    public.payout_number_plain(a.id), a.wise_details, a.details_changed_at;
end;
$$;

revoke all on function public.payout_wise_recipient(uuid) from public, anon;
grant execute on function public.payout_wise_recipient(uuid) to authenticated;

-- The return type changes, so it is dropped first. The live site reads it by name
-- and ignores a column it doesn't know.
drop function public.payout_number_reveal_log(integer);

create function public.payout_number_reveal_log(max_rows integer default 100)
returns table (
  account_id uuid, org_name text, bank_name text, last4 text, staff_email text, revealed_at timestamptz, how text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this is limited to platform staff' using errcode = '42501';
  end if;
  return query
    select r.account_id, r.org_name, r.bank_name, r.last4, r.staff_email, r.revealed_at, r.how
      from public.payout_number_reveals r
     order by r.revealed_at desc
     limit least(greatest(coalesce(max_rows, 100), 1), 500);
end;
$$;

revoke all on function public.payout_number_reveal_log(integer) from public, anon;
grant execute on function public.payout_number_reveal_log(integer) to authenticated;
