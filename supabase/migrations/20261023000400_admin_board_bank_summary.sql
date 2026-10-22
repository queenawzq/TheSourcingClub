-- ============================================================================
-- The staff payments board: the factory's whole bank details, not just a name
-- ----------------------------------------------------------------------------
-- admin_payment_board (from 20261022000300), same columns, signature and
-- grants. Changed: payout_summary. It read `bank_name || ' ····' || last4`,
-- so a row with any other detail but no bank name said "no bank details on
-- file", and one with a bank name said nothing about whose account it was.
-- Staff pay these factories by hand from what this line says, so it now lists
-- every detail on file: account name, bank, country, last 4, SWIFT, IBAN.
--
-- Safe with the current site live: a replace with the same return type.
-- ============================================================================

create or replace function public.admin_payment_board()
returns table (
  payment_id               uuid,
  state                    public.payment_state,
  amount_cents             bigint,
  fee_cents                bigint,
  charged_cents            bigint,
  currency                 char(3),
  order_id                 uuid,
  order_number             text,
  order_status             text,
  brand_name               text,
  factory_name             text,
  milestone_title          text,
  milestone_state          text,
  brand_reference          text,
  payment_method_label     text,
  failure_reason           text,
  stripe_payment_intent_id text,
  stripe_transfer_id       text,
  sent_at                  timestamptz,
  processing_at            timestamptz,
  failed_at                timestamptz,
  confirmed_at             timestamptz,
  release_requested_at     timestamptz,
  factory_stripe_ready     boolean,
  payout_summary           text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'this board is limited to platform staff' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.state, p.amount_cents, public.payment_fee_cents(p.id), p.charged_cents, p.currency,
    o.id, o.order_number, o.status::text,
    b.name, f.name,
    m.title, m.state::text,
    p.brand_reference, p.payment_method_label,
    case when p.state = 'released' then refund.note else p.failure_reason end,
    p.stripe_payment_intent_id, p.stripe_transfer_id,
    p.sent_at, p.processing_at, p.failed_at, p.confirmed_at, p.release_requested_at,
    coalesce(sca.transfers_active, false),
    coalesce(nullif(concat_ws(' · ',
      nullif(btrim(a.account_name), ''),
      nullif(btrim(a.bank_name), ''),
      nullif(btrim(a.bank_country), ''),
      '····' || nullif(btrim(a.account_number_last4), ''),
      'SWIFT ' || nullif(btrim(a.swift), ''),
      'IBAN ' || nullif(btrim(a.iban), '')
    ), ''), 'no bank details on file')
  from public.order_payments p
  join public.production_orders o on o.id = p.order_id
  join public.order_milestones m  on m.id = p.milestone_id
  join public.orgs b on b.id = o.brand_org_id
  join public.orgs f on f.id = o.factory_org_id
  left join public.stripe_connect_accounts sca on sca.org_id = o.factory_org_id
  left join public.factory_payout_accounts a
    on a.org_id = o.factory_org_id and a.is_primary
  left join lateral (
    select e.note from public.payment_events e
     where p.state = 'released'
       and e.payment_id = p.id and e.from_state = 'released' and e.to_state = 'released'
       and e.note like '%' || format(' (Stripe %s)', p.stripe_payment_intent_id)
     order by e.created_at desc
     limit 1
  ) refund on true
  where p.state in ('sent', 'processing', 'failed', 'confirmed')
     or (p.state = 'released' and refund.note is not null)
  order by
    case p.state
      when 'sent' then 0
      when 'confirmed' then case when p.release_requested_at is not null then 1 else 3 end
      when 'released' then 1
      when 'failed' then 2
      else 4
    end,
    coalesce(p.release_requested_at, p.sent_at, p.failed_at, p.processing_at, p.confirmed_at);
end;
$$;

revoke all on function public.admin_payment_board() from public;
grant execute on function public.admin_payment_board() to authenticated;
