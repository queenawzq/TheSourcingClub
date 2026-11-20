-- 20261119300000: PayPal "where Stripe isn't available", and who may turn it on.
-- (Changing the default while a payout runs is in payout_route_test and
-- money_safety_fixes_test.)
begin;

create extension if not exists pgtap with schema extensions;

select no_plan();

-- The switches as the migrations leave them (20261117200000, 20261119300000):
-- this file's assertions start from that, whatever the shared stack was left
-- with by someone testing by hand. Rolled back with the rest.
update public.payout_provider_settings set enabled = case
    when provider = 'paypal' and region in ('china', 'elsewhere') then true
    else false end;

set local session_replication_role = replica;
insert into auth.users (id, email) values
  ('5a200000-0000-0000-0000-000000000001', 'pgtap-ns-owner@example.com'),
  ('5a200000-0000-0000-0000-000000000002', 'pgtap-ns-staff@example.com');
insert into public.platform_admins (user_id, note) values ('5a200000-0000-0000-0000-000000000002', 'pgtap-ns');
insert into public.orgs (id, type, name, slug) values
  ('5b200000-0000-0000-0000-0000000000a1', 'factory', 'NS Vietnam', 'pgtap-ns-vietnam'),
  ('5b200000-0000-0000-0000-0000000000a2', 'factory', 'NS Germany', 'pgtap-ns-germany');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('5b200000-0000-0000-0000-0000000000a1', '5a200000-0000-0000-0000-000000000001', 'owner', '{}'),
  ('5b200000-0000-0000-0000-0000000000a2', '5a200000-0000-0000-0000-000000000001', 'owner', '{}');
insert into public.factory_profiles (org_id, country_code, moq, onboarding_completed_at) values
  ('5b200000-0000-0000-0000-0000000000a1', 'VN', 100, now()),
  ('5b200000-0000-0000-0000-0000000000a2', 'DE', 100, now());
set local session_replication_role = origin;

create function pg_temp.act_as(who int) returns void language sql as $f$
  select set_config('request.jwt.claims',
    json_build_object('sub', '5a200000-0000-0000-0000-' || lpad(who::text, 12, '0'), 'role', 'authenticated')::text, true);
$f$;
grant execute on function pg_temp.act_as(int) to authenticated, anon, service_role;

select is((select enabled from public.payout_provider_settings where provider = 'paypal' and region = 'no_stripe'), false, 'ships off');
select is((select count(*)::int from public.payout_provider_settings where provider = 'wise' and region = 'no_stripe'), 0, 'Wise has no such switch');

-- The list is the app's: Stripe pays out to Germany, not to Vietnam, China or "not listed".
select ok(public.stripe_pays_out_to('de') and public.stripe_pays_out_to('US') and not public.stripe_pays_out_to('VN')
  and not public.stripe_pays_out_to('CN') and not public.stripe_pays_out_to('ZZ'), 'Stripe country list');

-- PayPal off by region everywhere, then only where Stripe can't pay.
update public.payout_provider_settings set enabled = false where provider = 'paypal';
select ok(not public.payout_provider_enabled_in('VN', 'paypal'), 'all PayPal switches off: Vietnam has no PayPal');
update public.payout_provider_settings set enabled = true where provider = 'paypal' and region = 'no_stripe';
select ok(public.payout_provider_enabled_in('VN', 'paypal'), 'where Stripe isn''t available: Vietnam gets PayPal');
select ok(public.payout_provider_enabled_in('CN', 'paypal'), 'and China');
select ok(public.payout_provider_enabled_in('ZZ', 'paypal'), 'and a country not listed');
select ok(not public.payout_provider_enabled_in('DE', 'paypal'), 'but not Germany, which Stripe pays');
select ok(not public.payout_provider_enabled_in('VN', 'wise'), 'Wise is not turned on by it');
select ok(public.payout_provider_enabled('5b200000-0000-0000-0000-0000000000a1', 'paypal')
  and not public.payout_provider_enabled('5b200000-0000-0000-0000-0000000000a2', 'paypal'), 'by company country too');
-- OR: a region switch on still turns PayPal on in a Stripe country.
update public.payout_provider_settings set enabled = true where provider = 'paypal' and region = 'elsewhere';
select ok(public.payout_provider_enabled_in('DE', 'paypal'), 'a region switch on still counts');
update public.payout_provider_settings set enabled = false where provider = 'paypal' and region = 'elsewhere';

-- The method's own country decides, and the guard refuses a new PayPal in Germany.
select pg_temp.act_as(1); set local role authenticated;
select throws_ok($$insert into public.factory_payout_accounts (org_id, method, paypal_email, payout_country, details_changed_at)
  values ('5b200000-0000-0000-0000-0000000000a2', 'paypal', 'pgtap-ns-de@example.com', 'DE', now())$$,
  '22023', null, 'a new PayPal method for Germany is refused');
select lives_ok($$insert into public.factory_payout_accounts (org_id, method, paypal_email, payout_country, details_changed_at)
  values ('5b200000-0000-0000-0000-0000000000a1', 'paypal', 'pgtap-ns-vn@example.com', 'VN', now())$$,
  'a new PayPal method for Vietnam is saved');
select is((public.payout_providers_for('5b200000-0000-0000-0000-0000000000a1') ->> 'paypalWhereNoStripe')::boolean, true, 'the chooser reads the switch');
select ok(public.payout_providers_for('5b200000-0000-0000-0000-0000000000a1') -> 'stripeCountries' ? 'GB', 'and the country list');

-- Only staff turn it on or off; Wise has no such switch to turn.
select throws_ok($$select public.set_payout_provider('paypal', 'no_stripe', false)$$, '42501', null, 'a factory owner cannot switch it');
reset role;
set local role anon;
select throws_ok($$select public.set_payout_provider('paypal', 'no_stripe', false)$$, '42501', null, 'signed out cannot switch it');
reset role;
select pg_temp.act_as(2); set local role authenticated;
select lives_ok($$select public.set_payout_provider('paypal', 'no_stripe', false)$$, 'staff switch it off');
select throws_ok($$select public.set_payout_provider('wise', 'no_stripe', true)$$, '22023', null, 'Wise where Stripe isn''t available does not exist');
reset role;
select is((select enabled from public.payout_provider_settings where provider = 'paypal' and region = 'no_stripe'), false, 'and it is off');

select * from finish();
rollback;
