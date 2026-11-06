-- ============================================================================
-- Marking a payout paid by bank needs a reference
-- ----------------------------------------------------------------------------
-- It could be marked with nothing, so the record could say paid when nothing
-- was sent. The reference reaches the factory as the note always has: its row,
-- bell and email. A reference proves nothing by itself, but it says what to
-- look for, and the record says who wrote it.
--
-- released_note is on order_payments, which the brand can read, so a number
-- pasted as the reference is refused. Which account was paid goes in
-- bank_payouts, which the brand cannot read: otherwise nobody can tell where
-- the money went once the factory changes its account.
--
-- paid_to_changed_at is when the account last changed, as the board showed it.
-- A factory that changed it since is refused, the same as Payoneer's paid_to.
-- Optional so the 2-argument call of the site still live keeps working; that
-- site's note was optional, so a mark without one is refused there too.
-- ============================================================================

create table public.bank_payouts (
  payment_id uuid primary key references public.order_payments (id) on delete cascade,
  factory_org_id uuid not null references public.orgs (id) on delete cascade,
  account_id uuid,
  paid_to_holder text,
  paid_to_bank text,
  paid_to_last4 text,
  reference text not null,
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now()
);

alter table public.bank_payouts enable row level security;

create policy bank_payouts_read on public.bank_payouts
  for select to authenticated
  using (public.is_org_member(factory_org_id) or public.is_platform_admin());

revoke all on public.bank_payouts from public, anon, authenticated;
grant select on public.bank_payouts to authenticated;

drop function public.release_payment_to_factory(uuid, text);

create function public.release_payment_to_factory(
  target_payment uuid,
  note text default null,
  paid_to_changed_at timestamptz default null
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  account public.factory_payout_accounts;
  said text := nullif(btrim(coalesce(note, '')), '');
begin
  if not public.is_platform_admin() then
    raise exception 'releasing funds is limited to platform staff' using errcode = '42501';
  end if;

  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  select * into o from public.production_orders where id = p.order_id;

  if public.is_org_member(o.factory_org_id) then
    raise exception 'you belong to this company, so someone else on the staff must record its payout'
      using errcode = '42501', hint = 'payout_own_company';
  end if;
  if p.state = 'released' then
    raise exception 'that payout was already marked as paid'
      using errcode = '22023', hint = 'payout_already_released';
  end if;
  if p.state <> 'confirmed' then
    raise exception 'that payment is %; only a confirmed one can be released', p.state
      using errcode = '22023';
  end if;
  if p.stripe_charge_id is not null and p.release_requested_at is null then
    raise exception 'the brand has not approved this step yet: money paid through Stripe is paid out once the brand approves it'
      using errcode = '22023';
  end if;

  select * into account from public.factory_payout_accounts a
   where a.org_id = o.factory_org_id and a.is_primary;

  if said is null and account.method = 'payoneer' then
    raise exception 'this factory is paid by Payoneer: record the payment ID, or say why it was paid by bank'
      using errcode = '22023', hint = 'payoneer_default';
  end if;
  if said is null or length(said) < 3 or length(said) > 200 or said !~ '[[:alnum:]]' then
    raise exception 'enter the bank''s reference for this transfer'
      using errcode = '22023', hint = 'reference_required';
  end if;
  if public.payout_text_holds_number(o.factory_org_id, said) then
    raise exception 'the factory and the brand can read this, so it cannot hold the account number'
      using errcode = '22023', hint = 'reference_holds_number';
  end if;
  if paid_to_changed_at is not null
     and account.details_changed_at is distinct from paid_to_changed_at then
    raise exception 'this factory changed where it is paid'
      using errcode = '22023', hint = 'payout_changed';
  end if;

  update public.order_payments
     set state = 'released', released_by = auth.uid(), released_at = now(),
         released_note = said
   where id = p.id
  returning * into p;

  insert into public.bank_payouts
    (payment_id, factory_org_id, account_id, paid_to_holder, paid_to_bank, paid_to_last4, reference, recorded_by)
  values
    (p.id, o.factory_org_id, account.id,
     case when account.method = 'bank' then account.account_name end,
     case when account.method = 'bank' then account.bank_name end,
     case when account.method = 'bank' then account.account_number_last4 end,
     said, auth.uid());

  insert into public.payment_events (payment_id, from_state, to_state, actor_user_id, actor_kind)
  values (p.id, 'confirmed', 'released', auth.uid(), 'admin');

  -- Deliberately no milestone or chain effect. The work already opened when
  -- the payment was confirmed.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'funds_released', 'payment', p.id, o.id,
    format('%s released to you', public.format_money(p.amount_cents, p.currency)),
    format('Sent by bank transfer against %s. TSC''s note: %s', o.order_number, said)
  );

  return p;
end;
$$;

revoke all on function public.release_payment_to_factory(uuid, text, timestamptz) from public, anon;
grant execute on function public.release_payment_to_factory(uuid, text, timestamptz) to authenticated;
