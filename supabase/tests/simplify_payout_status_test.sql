-- An older read of a payout changes nothing (20261121400000): the database
-- keeps a Stripe payout's status and arrival day from going back, so the
-- server's payout read (refreshPayouts) keeps no copy of the ranks.

begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

set local session_replication_role = replica;
insert into public.orgs (id, type, name, slug) values ('c3a0b000-0000-0000-0000-0000000000f1', 'factory', 'S3 Factory', 'pgtap-s3-f');
insert into public.stripe_withdrawals (id, org_id, stripe_account_id, request_key, request_id, amount_minor, currency, state, payout_id, payout_status, payout_arrives_on)
values ('c3a0c000-0000-0000-0000-000000000001', 'c3a0b000-0000-0000-0000-0000000000f1', 'acct_pgtap_s3', 'pgtap-s3', gen_random_uuid(), 1000, 'USD',
        'paid_out', 'po_pgtap_s3', 'pending', '2026-11-20');
set local session_replication_role = origin;

create function pg_temp.row() returns text language sql as $f$
  select payout_status || ' ' || coalesce(payout_arrives_on::text, '-') from public.stripe_withdrawals where id = 'c3a0c000-0000-0000-0000-000000000001';
$f$;

update public.stripe_withdrawals set payout_status = 'in_transit', payout_arrives_on = '2026-11-22' where id = 'c3a0c000-0000-0000-0000-000000000001';
select is(pg_temp.row(), 'in_transit 2026-11-22', 'a newer answer is recorded, day and all');
update public.stripe_withdrawals set payout_status = 'pending', payout_arrives_on = '2026-11-20', payout_arrives_at = '2026-11-20' where id = 'c3a0c000-0000-0000-0000-000000000001';
select is(pg_temp.row(), 'in_transit 2026-11-22', 'an older answer changes neither the status nor the day');
update public.stripe_withdrawals set payout_status = 'paid', payout_arrives_on = '2026-11-23' where id = 'c3a0c000-0000-0000-0000-000000000001';
select is(pg_temp.row(), 'paid 2026-11-23', 'forward again: recorded');
update public.stripe_withdrawals set payout_status = 'failed', payout_arrives_on = '2026-11-23' where id = 'c3a0c000-0000-0000-0000-000000000001';
select is(pg_temp.row(), 'failed 2026-11-23', 'a payout that failed after it was paid: recorded');

select * from finish();
rollback;
