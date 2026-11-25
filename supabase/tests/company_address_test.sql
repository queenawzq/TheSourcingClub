-- One address per vendor (20261124400000): the full address and its parts are
-- the company's and staff's; a brand reads only factory_profiles.location; only
-- the server writes the parts; a changed address clears them; the backfill.
-- Fixtures prefixed pgtap-addr-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('c4400000-0000-0000-0000-000000000001', 'paddr-admin@example.com'),
  ('c4400000-0000-0000-0000-000000000002', 'paddr-factory@example.com'),
  ('c4400000-0000-0000-0000-000000000003', 'paddr-brand@example.com'),
  ('c4400000-0000-0000-0000-000000000004', 'paddr-other@example.com');
insert into public.platform_admins (user_id) values ('c4400000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d4400000-0000-0000-0000-0000000000f1', 'factory', 'PAddr Knit', 'pgtap-addr-knit'),
  ('d4400000-0000-0000-0000-0000000000b1', 'brand', 'PAddr Brand', 'pgtap-addr-brand'),
  ('d4400000-0000-0000-0000-0000000000f2', 'factory', 'PAddr Other', 'pgtap-addr-other');
insert into public.org_members (org_id, user_id, role) values
  ('d4400000-0000-0000-0000-0000000000f1', 'c4400000-0000-0000-0000-000000000002', 'owner'),
  ('d4400000-0000-0000-0000-0000000000b1', 'c4400000-0000-0000-0000-000000000003', 'owner'),
  ('d4400000-0000-0000-0000-0000000000f2', 'c4400000-0000-0000-0000-000000000004', 'owner');
-- Published and verified, so a brand can read the profile row itself.
insert into public.factory_profiles (org_id, legal_name, country_code, location, published_at, onboarding_completed_at) values
  ('d4400000-0000-0000-0000-0000000000f1', '东莞虎门服装有限公司', 'CN', 'Dongguan, China', now(), now()),
  ('d4400000-0000-0000-0000-0000000000f2', 'PAddr Other', 'PT', 'Porto, Portugal', now(), now());

-- The company saves its address ---------------------------------------------------
set local request.jwt.claims = '{"sub":"c4400000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$update public.factory_profiles set production_address = '中国广东省东莞市虎门镇工业路8号', location = 'China'
  where org_id = 'd4400000-0000-0000-0000-0000000000f1'$$, 'a member saves its one address');
select is((select address from public.factory_production_addresses where org_id = 'd4400000-0000-0000-0000-0000000000f1'),
  '中国广东省东莞市虎门镇工业路8号', 'and reads it back');
select throws_ok($$select public.save_company_address_parts('d4400000-0000-0000-0000-0000000000f1', '中国广东省东莞市虎门镇工业路8号',
  '{"city":"东莞市","city_en":"Shanghai","country_code":"CN"}'::jsonb, 'Shanghai, China', 'model')$$,
  '42501', null, 'a member cannot write the parts or what brands read through the server''s function');
select throws_ok($$update public.factory_production_addresses set city_en = 'Shanghai' where org_id = 'd4400000-0000-0000-0000-0000000000f1'$$,
  '42501', null, 'nor write the parts directly');
reset role;

-- The server records the parts ----------------------------------------------------
select is(public.save_company_address_parts('d4400000-0000-0000-0000-0000000000f1', 'an older address',
  '{"city":"Elsewhere","country_code":"PT"}'::jsonb, 'Elsewhere, Portugal', 'model'), false,
  'parts of an address no longer saved are not recorded');
select is((select location from public.factory_profiles where org_id = 'd4400000-0000-0000-0000-0000000000f1'), 'China',
  'and brands still read what they read');
select is(public.save_company_address_parts('d4400000-0000-0000-0000-0000000000f1', '中国广东省东莞市虎门镇工业路8号',
  '{"street":"虎门镇工业路8号","city":"东莞市","city_en":"Dongguan","region":"广东省","country_code":"cn","country_inferred":false}'::jsonb,
  'Dongguan, China', 'model'), true, 'the server records the parts of the address saved');
select is((select city || '|' || city_en || '|' || region || '|' || country_code || '|' || parts_source
  from public.factory_production_addresses where org_id = 'd4400000-0000-0000-0000-0000000000f1'),
  '东莞市|Dongguan|广东省|CN|model', 'parts kept as typed, with the English city name and the code in capitals');
select is((select location from public.factory_profiles where org_id = 'd4400000-0000-0000-0000-0000000000f1'), 'Dongguan, China',
  'brands read the city and country');
select throws_ok($$select public.save_company_address_parts('d4400000-0000-0000-0000-0000000000f1', '中国广东省东莞市虎门镇工业路8号', '{}'::jsonb, null, 'guess')$$,
  '22023', null, 'an unknown source is refused');

-- What a brand reads ----------------------------------------------------------------
set local request.jwt.claims = '{"sub":"c4400000-0000-0000-0000-000000000003","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.factory_production_addresses where org_id = 'd4400000-0000-0000-0000-0000000000f1'), 0,
  'a brand cannot read the address or its parts');
select is((select location from public.factory_profiles where org_id = 'd4400000-0000-0000-0000-0000000000f1'), 'Dongguan, China',
  'it reads the city and country');
select is((select production_address from public.factory_profiles where org_id = 'd4400000-0000-0000-0000-0000000000f1'), null,
  'and the profile row never holds the address');
reset role;

-- Another vendor, and staff --------------------------------------------------------
set local request.jwt.claims = '{"sub":"c4400000-0000-0000-0000-000000000004","role":"authenticated"}';
set local role authenticated;
select is((select count(*)::int from public.factory_production_addresses where org_id = 'd4400000-0000-0000-0000-0000000000f1'), 0,
  'another vendor cannot read it');
reset role;
set local request.jwt.claims = '{"sub":"c4400000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select city_en from public.factory_production_addresses where org_id = 'd4400000-0000-0000-0000-0000000000f1'), 'Dongguan',
  'staff read the address and its parts');
reset role;

-- A changed address clears its parts -------------------------------------------------
set local request.jwt.claims = '{"sub":"c4400000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select lives_ok($$update public.factory_profiles set production_address = 'Lô B2, KCN Tân Tạo, Bình Tân, Thành phố Hồ Chí Minh, Việt Nam'
  where org_id = 'd4400000-0000-0000-0000-0000000000f1'$$, 'the company moves');
select is((select coalesce(city, 'none') || '|' || coalesce(country_code, 'none') || '|' || country_inferred::text || '|' || coalesce(parts_source, 'none')
  from public.factory_production_addresses where org_id = 'd4400000-0000-0000-0000-0000000000f1'),
  'none|none|false|none', 'the old parts go with the old address');
reset role;

-- The country Browse files it under follows the address (20261124400100) ------------
select public.save_company_address_parts('d4400000-0000-0000-0000-0000000000f1',
  'Lô B2, KCN Tân Tạo, Bình Tân, Thành phố Hồ Chí Minh, Việt Nam',
  '{"city": "Thành phố Hồ Chí Minh", "city_en": "Ho Chi Minh City", "country_code": "VN"}'::jsonb, 'Ho Chi Minh City, Vietnam', 'model');
select is((select country_code || '|' || location from public.factory_profiles where org_id = 'd4400000-0000-0000-0000-0000000000f1'),
  'VN|Ho Chi Minh City, Vietnam', 'a country read from the address is the one Browse filters on');
select public.save_company_address_parts('d4400000-0000-0000-0000-0000000000f1',
  'Lô B2, KCN Tân Tạo, Bình Tân, Thành phố Hồ Chí Minh, Việt Nam', '{}'::jsonb, 'Vietnam', 'typed');
select is((select country_code from public.factory_profiles where org_id = 'd4400000-0000-0000-0000-0000000000f1'),
  'VN', 'no country read leaves the stored one');

-- Settings no longer sets a vendor's location -----------------------------------------
set local request.jwt.claims = '{"sub":"c4400000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is((public.save_account_settings('d4400000-0000-0000-0000-0000000000f1', null, '+84 28 1234 5678', null)) ->> 'location',
  'Vietnam', 'a Settings save without a location answers with the one stored');
reset role;
select is((select location from public.factory_profiles where org_id = 'd4400000-0000-0000-0000-0000000000f1'),
  'Vietnam', 'and leaves it as the address gave it');

-- The backfill ----------------------------------------------------------------------
-- The migration has run already: a vendor with a location and no address got
-- one. Run its insert again on a fresh row to see it.
delete from public.factory_production_addresses where org_id = 'd4400000-0000-0000-0000-0000000000f2';
insert into public.factory_production_addresses (org_id, address, updated_at)
select p.org_id, left(trim(public.strip_invisible(p.location)), 500), coalesce(p.updated_at, now())
  from public.factory_profiles p
 where p.org_id = 'd4400000-0000-0000-0000-0000000000f2'
   and nullif(trim(public.strip_invisible(p.location)), '') is not null
   and not exists (select 1 from public.factory_production_addresses a where a.org_id = p.org_id);
select is((select address from public.factory_production_addresses where org_id = 'd4400000-0000-0000-0000-0000000000f2'), 'Porto, Portugal',
  'an existing vendor''s location becomes its address');
select is((select location from public.factory_profiles where org_id = 'd4400000-0000-0000-0000-0000000000f2'), 'Porto, Portugal',
  'and what brands read is unchanged');

select ok(not has_function_privilege('authenticated', 'public.save_company_address_parts(uuid, text, jsonb, text, text)', 'execute'),
  'signed-in people cannot run the parts function');
select ok(has_function_privilege('service_role', 'public.save_company_address_parts(uuid, text, jsonb, text, text)', 'execute'),
  'the server can');

select * from finish();
rollback;
