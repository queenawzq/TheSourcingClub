-- Telling a company when its bank accounts change, in the two places it wasn't.

-- Set just before TSC's own page changes a bank at Stripe, whose webhook then
-- needs no second bell. A bank changed in Stripe's embedded form leaves it alone.
alter table public.stripe_connect_accounts add column methods_changed_by_tsc_at timestamptz;

-- notify_default_bank_change, as of 20261108710000, with one branch added: a
-- PayPal or Payoneer row turned into a bank while it is not the default said nothing.
create or replace function public.notify_default_bank_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := coalesce(new.org_id, old.org_id);
  what text;
  named text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return null;
  end if;
  if not exists (select 1 from public.orgs where id = org) then
    return null;
  end if;

  if tg_op <> 'DELETE' and new.method = 'bank' and new.is_primary
     and (tg_op = 'INSERT' or not old.is_primary or old.method <> 'bank') then
    -- It may have lost the default again before the transaction ended.
    if not exists (
      select 1 from public.factory_payout_accounts where id = new.id and is_primary
    ) then
      return null;
    end if;
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    if exists (
      select 1 from public.notifications n
       where n.org_id = org and n.kind = 'payout_method_changed' and n.created_at = now()
         and starts_with(n.body, format('TSC now pays your bank account at %s, instead of Payoneer account', named))
    ) then
      return null;
    end if;
    -- New: while Stripe pays, this bank is only saved. (The route is read at
    -- commit, so choose_payout_method's own change counts.)
    what := case when public.uses_stripe_payout(org)
      then format('Your bank account at %s was saved.', named)
      else format('TSC now pays your bank account at %s.', named) end;

  elsif tg_op = 'UPDATE' and new.method = 'bank' and new.is_primary and old.is_primary and old.method = 'bank'
        and (new.bank_name, new.account_name, new.account_number_last4, new.swift, new.branch,
             new.bank_country, new.instructions, new.number_changed_at,
             new.wise_details, new.wise_number_key, new.wise_currency, new.wise_recipient_type)
            is distinct from
            (old.bank_name, old.account_name, old.account_number_last4, old.swift, old.branch,
             old.bank_country, old.instructions, old.number_changed_at,
             old.wise_details, old.wise_number_key, old.wise_currency, old.wise_recipient_type) then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format(case when public.uses_stripe_payout(org)
      then 'Your saved bank account changed: it is now %s, in the name of %s.'
      else 'The bank account TSC pays changed: it is now %s, in the name of %s.' end, named, new.account_name);

  -- New: a row that was another method and is now a bank, default or not.
  elsif tg_op = 'UPDATE' and new.method = 'bank' and old.method <> 'bank' then
    named := new.bank_name || case when new.account_number_last4 is not null
      then format(' ending %s', new.account_number_last4) else '' end;
    what := format('Your bank account at %s replaced a withdrawal method.', named);

  elsif old.method = 'bank' and old.is_primary
        and (tg_op = 'DELETE' or not new.is_primary or new.method <> 'bank')
        and not exists (select 1 from public.factory_payout_accounts where org_id = org and is_primary) then
    named := old.bank_name || case when old.account_number_last4 is not null
      then format(' ending %s', old.account_number_last4) else '' end;
    what := case when public.uses_stripe_payout(org)
      then format('Your bank account at %s was removed.', named)
      else format('TSC no longer pays your bank account at %s, and you have no default payout method.', named) end;
  end if;

  if what is not null then
    insert into public.notifications (org_id, kind, title, body)
    values (org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
  return null;
end;
$$;
