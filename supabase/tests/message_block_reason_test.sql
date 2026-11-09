-- A blocked message says why, to its sender and nobody else (20261109400000).
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email) values
  ('c9100000-0000-0000-0000-000000000001', 'n9r-brand@example.com'),
  ('c9100000-0000-0000-0000-000000000002', 'n9r-factory@example.com');
insert into public.orgs (id, type, name, slug) values
  ('c9200000-0000-0000-0000-00000000000b', 'brand',   'N9R Brand',   'pgtap-n9r-brand'),
  ('c9200000-0000-0000-0000-00000000000f', 'factory', 'N9R Factory', 'pgtap-n9r-factory');
insert into public.org_members (org_id, user_id, role) values
  ('c9200000-0000-0000-0000-00000000000b', 'c9100000-0000-0000-0000-000000000001', 'owner'),
  ('c9200000-0000-0000-0000-00000000000f', 'c9100000-0000-0000-0000-000000000002', 'owner');
insert into public.brand_profiles (org_id, hq_location) values ('c9200000-0000-0000-0000-00000000000b', 'London, UK');
insert into public.factory_profiles (org_id, country_code, moq, published_at, verification_status) values
  ('c9200000-0000-0000-0000-00000000000f', 'CN', 100, now(), 'verified');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('c9300000-0000-0000-0000-000000000001', 'c9200000-0000-0000-0000-00000000000b', 'N9R request', 'open', 'open_to_all', 100);
insert into public.message_threads (id, rfq_id, brand_org_id, factory_org_id) values
  ('c9600000-0000-0000-0000-000000000001', 'c9300000-0000-0000-0000-000000000001',
   'c9200000-0000-0000-0000-00000000000b', 'c9200000-0000-0000-0000-00000000000f');

set local request.jwt.claims = '{"sub":"c9100000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
insert into public.messages (id, thread_id, sender_org_id, sender_user_id, body, review_note)
select ('c9700000-0000-0000-0000-00000000000' || n)::uuid, 'c9600000-0000-0000-0000-000000000001',
       'c9200000-0000-0000-0000-00000000000f', 'c9100000-0000-0000-0000-000000000002', 'n9r message ' || n,
       'outside_platform'
from generate_series(1, 4) n;

select is((select count(*) from public.messages where id::text like 'c9700000-%' and review_note is not null), 0::bigint,
  'a sender CANNOT write its own reason');
select throws_ok(
  $$select public.record_message_screening('c9700000-0000-0000-0000-000000000001', 'held', 'ai', 'x', null, 'outside_platform')$$,
  '42501', null, 'a signed-in person CANNOT record a verdict');
reset role;

set local role service_role;
select public.record_message_screening('c9700000-0000-0000-0000-000000000001', 'held', 'ai', 'pay us directly', 'm', 'outside_platform');
select public.record_message_screening('c9700000-0000-0000-0000-000000000002', 'held', 'pattern', 'an email', null, 'contact_details');
select public.record_message_screening('c9700000-0000-0000-0000-000000000003', 'held', 'ai', 'flagged', 'm', null);
select public.record_message_screening('c9700000-0000-0000-0000-000000000004', 'delivered', 'pattern_only');
reset role;

select is((select delivery || ':' || review_note from public.messages where id = 'c9700000-0000-0000-0000-000000000001'),
  'blocked:outside_platform', 'paying outside the platform is blocked, and says so');
select is((select delivery || ':' || review_note from public.messages where id = 'c9700000-0000-0000-0000-000000000002'),
  'blocked:contact_details', 'contact details are blocked, and say so');
select is((select delivery || ':' || coalesce(review_note, '-') from public.messages where id = 'c9700000-0000-0000-0000-000000000003'),
  'blocked:-', 'a block the screen gave no kind for has no reason');
select is((select delivery || ':' || coalesce(review_note, '-') from public.messages where id = 'c9700000-0000-0000-0000-000000000004'),
  'delivered:-', 'a delivered message carries none');

set local request.jwt.claims = '{"sub":"c9100000-0000-0000-0000-000000000002","role":"authenticated"}';
set local role authenticated;
select is((select review_note from public.messages where id = 'c9700000-0000-0000-0000-000000000001'),
  'outside_platform', 'the sender reads it');
reset role;

set local request.jwt.claims = '{"sub":"c9100000-0000-0000-0000-000000000001","role":"authenticated"}';
set local role authenticated;
select is((select count(*) from public.messages where id in ('c9700000-0000-0000-0000-000000000001', 'c9700000-0000-0000-0000-000000000002')), 0::bigint,
  'the other side CANNOT read a blocked message or its reason');
reset role;

select * from finish();
rollback;
