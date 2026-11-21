-- One balance, fix round 27 (re-test 2 and money review r26).
--
-- * The last withdrawal method going hands payouts back to Stripe and now
--   says so, in the approved words ("Your connected payout account is now
--   your default withdrawal method.").
-- * A default bank that only stopped being the default (the row kept) is
--   no longer said to be removed.
-- * A declined withdrawal keeps what came back (back_cents), like a failed
--   or cancelled one.
--
-- Full latest bodies plus the change; grants re-applied exactly; no overloads.

comment on column public.factory_withdrawals.back_cents is
  'What came back to the balance when it failed, was cancelled or was declined (the rest went back to the brand). Null before 20261121300000 (declined: before 20261121310000).';

create or replace function public.guard_payout_account_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owed_cents bigint;
  owed_currency text;
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    return old;
  end if;

  -- Money being sent to this account now: a PayPal / Wise / bank withdrawal
  -- to it that is waiting or being paid, or a payout per step to it under
  -- way. Removing it would leave that payment with nowhere to go. (Owed money
  -- in the factory's balance is not on its way anywhere until it withdraws.)
  select sum(x.amount), min(x.currency)
    into owed_cents, owed_currency
    from (select w.amount_cents as amount, w.currency::text as currency from public.factory_withdrawals w
           where w.account_id = old.id and w.status in ('requested', 'paying')
          union all
          select x.amount_cents, x.currency::text from public.provider_payouts x
           where x.account_id = old.id and x.status = 'processing') x;
  if coalesce(owed_cents, 0) > 0 then
    raise exception 'TSC is about to pay this account, so it cannot be removed until that payment is sent'
      using errcode = 'P0001',
            hint = 'payout_owed',
            detail = owed_cents::text || ' ' || owed_currency;
  end if;

  if exists (select 1 from public.factory_payout_accounts a
              where a.org_id = old.org_id and a.id <> old.id) then
    if old.is_primary then
      raise exception 'this is the account TSC pays: choose another account for TSC to pay before removing it'
        using errcode = 'P0001', hint = 'payout_primary';
    end if;
    return old;
  end if;

  -- The last method is going, the default or not (with only switched-off
  -- methods left none is the default: 20261121290000): tidied the same way
  -- (20261121300000).

  if exists (select 1 from public.stripe_connect_accounts s
              where s.org_id = old.org_id and public.uses_stripe_payout(old.org_id)) then
    return old;
  end if;

  -- The last manual account is going, so "manual" would mean nobody pays.
  delete from public.factory_payout_preferences where org_id = old.org_id and route = 'manual';
  -- Stripe pays again: said in the approved words, as when it is chosen
  -- (20261121310000).
  if found and public.uses_stripe_payout(old.org_id) then
    insert into public.notifications (org_id, kind, title, body)
    values (old.org_id, 'payout_method_changed', 'Your payout methods changed',
      'Your connected payout account is now your default withdrawal method. If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;

  return old;
end;
$$;
revoke all on function public.guard_payout_account_delete() from public, anon, authenticated;

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
      else format('Your bank account at %s is now your default withdrawal method.', named) end;

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
    what := case when public.uses_stripe_payout(org)
      then format('Your saved bank account changed: it is now %s, in the name of %s.', named, new.account_name)
      else format('Your bank account at %s is now your default withdrawal method.', named) end;

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
    -- Removed only when the row is gone at commit; a bank that only stopped
    -- being the default is still saved (20261121310000).
    what := case when tg_op = 'UPDATE' and new.method = 'bank'
                   and exists (select 1 from public.factory_payout_accounts where id = old.id)
      then format('Your bank account at %s is no longer your default withdrawal method.', named)
      else format('Your bank account at %s was removed.', named) end;
  end if;

  if what is not null then
    insert into public.notifications (org_id, kind, title, body)
    values (org, 'payout_method_changed', 'Your payout methods changed',
      what || ' If nobody at your company made this change, email operations@contact.sourcing-club.com now.');
  end if;
  return null;
end;
$$;
revoke all on function public.notify_default_bank_change() from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.decline_withdrawal(target_withdrawal uuid, why text)
 RETURNS factory_withdrawals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  w public.factory_withdrawals;
  said text := nullif(btrim(coalesce(why, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'deciding a withdrawal is limited to platform staff' using errcode = '42501';
  end if;
  select * into w from public.factory_withdrawals where id = target_withdrawal for update;
  if not found then
    raise exception 'withdrawal not found' using errcode = 'P0002';
  end if;
  perform public.payout_staff_check(w.org_id);
  if w.status <> 'requested' then
    raise exception 'only a waiting withdrawal can be declined' using errcode = '22023', hint = 'withdrawal_not_waiting';
  end if;
  if said is null or length(said) < 3 or length(said) > 300 then
    raise exception 'say why, in a sentence the factory will read' using errcode = '22023', hint = 'withdrawal_reason';
  end if;
  update public.factory_withdrawals
     set status = 'declined', reason = said, decided_by = auth.uid(), decided_at = now(), updated_at = now(),
         -- What came back, kept as it was at this moment, like a failed or
         -- cancelled one (20261121310000).
         back_cents = public.withdrawal_back_cents(w)
   where id = w.id returning * into w;
  perform public.withdrawal_notice(w,
    format('Withdrawal of %s declined', public.format_money(w.amount_cents, w.currency)),
    format('%s TSC''s reason: %s', public.withdrawal_back_sentence(w), said));
  return w;
end;
$function$;
revoke all on function public.decline_withdrawal(uuid, text) from public, anon;
grant execute on function public.decline_withdrawal(uuid, text) to authenticated, service_role;
