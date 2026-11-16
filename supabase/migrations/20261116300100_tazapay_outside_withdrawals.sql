-- ============================================================================
-- A factory Tazapay pays stays on the per-step path
-- ----------------------------------------------------------------------------
-- Withdrawals (20261116200000) put an approved step into the factory's balance
-- when its default is a method saved with TSC, and a bank account there counts
-- as one. But a bank account in mainland China or Hong Kong with no Wise
-- recipient is the one Tazapay pays (20261115600100; the board's rule in
-- src/app/admin/AdminPayments.jsx, the route in src/shared/tazapay-payout.mjs),
-- and withdrawals have no Tazapay adapter yet. Pooled, its step could only be
-- paid by hand, and "Pay with Tazapay" on the step was refused.
--
-- Until a Tazapay adapter exists, a factory whose default is such an account is
-- paid step by step, as before withdrawals:
--   1. tazapay_pays_account(): the one SQL rule for "Tazapay pays this account".
--   2. withdraws_from_balance(): false for such a factory, so its approved steps
--      do not join the balance (join_withdrawal_pool, join_owed_to_pool).
--   3. Steps already pooled for such a factory, with no withdrawal ever asked,
--      leave the pool: nothing has been withdrawn against them.
-- A step that joined the balance while the factory was paid another way stays
-- in it (it may already be part of a withdrawal), and withdrawal_provider_for()
-- is unchanged: such money is still withdrawn, and a withdrawal to the Tazapay
-- account is sent by staff by bank.
--
-- Safe with the live site while applied: replaces two functions' bodies and
-- un-pools only steps no withdrawal can have counted.
-- ============================================================================

create or replace function public.tazapay_pays_account(a public.factory_payout_accounts)
returns boolean
language sql
immutable
as $$
  select a.method = 'bank' and a.wise_recipient_type is null
     and upper(btrim(coalesce(a.bank_country, ''))) in ('CN', 'HK');
$$;
revoke all on function public.tazapay_pays_account(public.factory_payout_accounts) from public, anon, authenticated;

create or replace function public.withdraws_from_balance(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not public.uses_stripe_payout(target_org)
     and (exists (select 1 from public.factory_payout_preferences r where r.org_id = target_org and r.route = 'manual')
          or (not exists (select 1 from public.stripe_connect_accounts s where s.org_id = target_org and s.transfers_active)
              and exists (select 1 from public.factory_payout_accounts a
                           where a.org_id = target_org and a.is_primary and a.method in ('bank', 'paypal'))))
     -- Tazapay pays it step by step until withdrawals have a Tazapay adapter.
     and not exists (select 1 from public.factory_payout_accounts a
                      where a.org_id = target_org and a.is_primary and public.tazapay_pays_account(a));
$$;
revoke all on function public.withdraws_from_balance(uuid) from public, anon, authenticated;

-- Steps pooled for a factory Tazapay pays, where no withdrawal was ever asked:
-- nothing counted them, so they go back to being paid one by one.
alter table public.order_payments disable trigger order_payments_guard_withdrawal_pool;
update public.order_payments p set withdrawal_pool = false
  from public.production_orders o
 where o.id = p.order_id and p.withdrawal_pool and p.state = 'confirmed'
   and not public.withdraws_from_balance(o.factory_org_id)
   and exists (select 1 from public.factory_payout_accounts a
                where a.org_id = o.factory_org_id and a.is_primary and public.tazapay_pays_account(a))
   and not exists (select 1 from public.factory_withdrawals w where w.org_id = o.factory_org_id);
alter table public.order_payments enable trigger order_payments_guard_withdrawal_pool;
