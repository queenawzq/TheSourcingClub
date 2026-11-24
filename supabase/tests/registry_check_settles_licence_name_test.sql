-- A registry check showing the licence's name settles a name difference
-- between the licence and what the company typed (20261124360000).
-- Fixtures prefixed pgtap2436-; every count filters on its own ids.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values ('c2436000-0000-0000-0000-000000000001', 'p2436-admin@example.com');
insert into public.platform_admins (user_id) values ('c2436000-0000-0000-0000-000000000001');
insert into public.orgs (id, type, name, slug) values
  ('d2436000-0000-0000-0000-0000000000c1', 'factory', 'Humen Pearl Garments', 'pgtap2436-humen'),
  ('d2436000-0000-0000-0000-0000000000c2', 'factory', 'Riverside Knit', 'pgtap2436-river');
insert into public.factory_profiles (org_id, country_code, legal_name, vendor_kind) values
  ('d2436000-0000-0000-0000-0000000000c1', 'CN', 'Humen Pearl Garments Co., Ltd.', 'manufacturer'),
  ('d2436000-0000-0000-0000-0000000000c2', 'CN', 'Riverside Knit Co., Ltd.', 'trading_company');
insert into public.company_registrations (org_id, country_code, number) values
  ('d2436000-0000-0000-0000-0000000000c1', 'CN', '91330109MA2P24360R'),
  ('d2436000-0000-0000-0000-0000000000c2', 'CN', '91330109MA2P24361W');
insert into public.documents (id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status) values
  ('a2436000-0000-0000-0000-000000000001', 'd2436000-0000-0000-0000-0000000000c1', 'business_registration', 'org-private',
   'd2436000-0000-0000-0000-0000000000c1/business_registration/licence.png', 'licence.png', 'image/png', 10, 'pending'),
  ('a2436000-0000-0000-0000-000000000002', 'd2436000-0000-0000-0000-0000000000c2', 'business_registration', 'org-private',
   'd2436000-0000-0000-0000-0000000000c2/business_registration/licence.png', 'licence.png', 'image/png', 10, 'pending');
-- Each licence shows its Chinese legal name; each company typed an English one.
insert into public.verification_signals (org_id, kind, subject_id, automatic, result, details) values
  ('d2436000-0000-0000-0000-0000000000c1', 'document_reading', 'a2436000-0000-0000-0000-000000000001', true, 'differs',
   '{"numberAtReading":"91330109MA2P24360R","extracted":{"readable":true,"legalName":"东莞虎门明珠服饰有限公司","registrationNumber":"91330109MA2P24360R"},
     "differences":[{"field":"name","document":"东莞虎门明珠服饰有限公司","typed":"Humen Pearl Garments Co., Ltd."}]}'),
  ('d2436000-0000-0000-0000-0000000000c2', 'document_reading', 'a2436000-0000-0000-0000-000000000002', true, 'differs',
   '{"numberAtReading":"91330109MA2P24361W","extracted":{"readable":true,"legalName":"宁波河畔针织贸易有限公司","registrationNumber":"91330109MA2P24361W"},
     "differences":[{"field":"name","document":"宁波河畔针织贸易有限公司","typed":"Riverside Knit Co., Ltd."}]}');

set local request.jwt.claims = '{"sub":"c2436000-0000-0000-0000-000000000001","role":"authenticated"}';

-- The registry shows another name: the difference is still to explain.
set local role authenticated;
select public.admin_save_registry_check('d2436000-0000-0000-0000-0000000000c1', 'GSXT', 'gsxt', 'found',
  '{"name":"东莞别的服装有限公司","number":"91330109MA2P24360R"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2436000-0000-0000-0000-0000000000c1'), 'document_differs',
  'a registry name that is neither theirs nor the licence''s still needs explaining');

-- The registry shows the licence's Chinese name: settled, no explanation needed.
set local role authenticated;
select public.admin_save_registry_check('d2436000-0000-0000-0000-0000000000c1', 'GSXT', 'gsxt', 'found',
  '{"name":"东莞虎门明珠服饰有限公司","number":"91330109MA2P24360R"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2436000-0000-0000-0000-0000000000c1'), null,
  'a check showing the licence''s name settles it');
-- A check saved before the fix counts too: it is read, not re-saved.
update public.registry_checks set details = details - 'readingConfirmed'
 where org_id = 'd2436000-0000-0000-0000-0000000000c1' and not automatic;
select is(public.registry_approval_problem('d2436000-0000-0000-0000-0000000000c1'), null,
  'with no confirmation stored, the check itself still settles it');
-- Couldn't check settles nothing about the name: it is staff's judgement, decided separately.
select ok(not public.registry_check_settles_reading('d2436000-0000-0000-0000-0000000000c1',
  '{"outcome":"not_found","name":"东莞虎门明珠服饰有限公司"}'::jsonb, public.registry_reading_differs('d2436000-0000-0000-0000-0000000000c1')),
  'a Not found record settles nothing');

-- The trading-company path: the same check settles it, and its trading licence needs no reason.
set local role authenticated;
select public.admin_save_registry_check('d2436000-0000-0000-0000-0000000000c2', 'GSXT', 'gsxt', 'found',
  '{"name":"宁波河畔针织贸易有限公司","number":"91330109MA2P24361W"}'::jsonb);
reset role;
select is(public.registry_approval_problem('d2436000-0000-0000-0000-0000000000c2'), null,
  'a trading company with the licence''s name on the registry can be approved');

-- An explanation on the Typed: line also clears a real name difference.
set local role authenticated;
select public.admin_save_registry_check('d2436000-0000-0000-0000-0000000000c1', 'GSXT', 'gsxt', 'found',
  '{"name":"东莞别的服装有限公司","number":"91330109MA2P24360R"}'::jsonb);
select public.admin_record_registry_result('d2436000-0000-0000-0000-0000000000c1', 'gsxt', 'name_differs',
  null, '东莞别的服装有限公司', 'Renamed last year; the registry shows the new name');
reset role;
-- In one transaction now() is its start: stamp the explanation as the later save it is.
update public.registry_checks set checked_at = clock_timestamp()
 where org_id = 'd2436000-0000-0000-0000-0000000000c1' and details ? 'reason';
select is(public.registry_approval_problem('d2436000-0000-0000-0000-0000000000c1'), null,
  'an explanation on the Typed: line clears a real difference');

select * from finish();
rollback;
