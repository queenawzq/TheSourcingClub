begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users(id, email) values
('ca000000-0000-0000-0000-000000000001', 'contract-brand@example.com'),
('ca000000-0000-0000-0000-000000000002', 'contract-factory@example.com');
insert into public.orgs(id, type, name, slug) values
('ca000000-0000-0000-0000-000000000010', 'brand', 'Contract Brand', 'pgtap-contract-brand'),
('ca000000-0000-0000-0000-000000000020', 'factory', 'Contract Factory', 'pgtap-contract-factory'),
('ca000000-0000-0000-0000-000000000021', 'factory', 'Other Factory', 'pgtap-contract-other');
insert into public.org_members(org_id, user_id, role) values
('ca000000-0000-0000-0000-000000000010', 'ca000000-0000-0000-0000-000000000001', 'owner'),
('ca000000-0000-0000-0000-000000000020', 'ca000000-0000-0000-0000-000000000002', 'owner');
insert into public.rfqs(id, brand_org_id, title, status, visibility) values
('ca000000-0000-0000-0000-000000000030', 'ca000000-0000-0000-0000-000000000010', 'Contract test', 'open', 'open_to_all');
insert into public.quotes(id, rfq_id, factory_org_id, status, version) values
('ca000000-0000-0000-0000-000000000040', 'ca000000-0000-0000-0000-000000000030', 'ca000000-0000-0000-0000-000000000020', 'submitted', 1),
('ca000000-0000-0000-0000-000000000041', 'ca000000-0000-0000-0000-000000000030', 'ca000000-0000-0000-0000-000000000021', 'submitted', 1);
insert into public.documents(id, org_id, kind, bucket, storage_path, file_name, rfq_id) values
('ca000000-0000-0000-0000-000000000050', 'ca000000-0000-0000-0000-000000000010', 'tech_pack', 'org-private',
 'ca000000-0000-0000-0000-000000000010/tech_pack/ca000000-0000-0000-0000-000000000030/original.pdf', 'original.pdf', 'ca000000-0000-0000-0000-000000000030'),
('ca000000-0000-0000-0000-000000000051', 'ca000000-0000-0000-0000-000000000010', 'contract', 'org-private',
 'ca000000-0000-0000-0000-000000000010/contract/ca000000-0000-0000-0000-000000000040/new.pdf', 'new.pdf', null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*) from public.get_contract_attachments('ca000000-0000-0000-0000-000000000040')), 1::bigint, 'Initially inherits RFQ files');
select lives_ok($$select public.save_contract_attachments('ca000000-0000-0000-0000-000000000040', '{}')$$, 'Remove every file from the contract');
select is((select count(*) from public.get_contract_attachments('ca000000-0000-0000-0000-000000000040')), 0::bigint, 'Empty selection persists');
select is((select count(*) from public.documents where rfq_id = 'ca000000-0000-0000-0000-000000000030'), 1::bigint, 'RFQ source remains attached');
select is((select count(*) from public.get_contract_attachments('ca000000-0000-0000-0000-000000000041')), 1::bigint, 'Other contract remains unchanged');
select throws_ok($$select public.save_contract_attachments('ca000000-0000-0000-0000-000000000041', '{ca000000-0000-0000-0000-000000000051}')$$, '22023', null, 'Cannot borrow an upload from another contract');
select lives_ok($$select public.save_contract_attachments('ca000000-0000-0000-0000-000000000040', '{ca000000-0000-0000-0000-000000000051}')$$, 'Save new contract upload');

set local request.jwt.claims = '{"sub":"ca000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.save_contract_attachments('ca000000-0000-0000-0000-000000000040', '{}')$$, '42501', null, 'Factory cannot edit the brand contract');
select throws_ok($$select * from public.get_contract_attachments('ca000000-0000-0000-0000-000000000040')$$, '42501', null, 'Factory cannot read a draft contract');

reset role;
insert into public.production_orders(id, rfq_id, quote_id, brand_org_id, factory_org_id,
 unit_price_cents, production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct)
values ('ca000000-0000-0000-0000-000000000060', 'ca000000-0000-0000-0000-000000000030', 'ca000000-0000-0000-0000-000000000040',
 'ca000000-0000-0000-0000-000000000010', 'ca000000-0000-0000-0000-000000000020', 100, 1, 100, 0, 100, 50, 50);
select is((select contract_attachment_ids from public.production_orders where id = 'ca000000-0000-0000-0000-000000000060'),
 '{ca000000-0000-0000-0000-000000000051}'::uuid[], 'Order snapshots selected files only');
set local role authenticated;
select is((select file_name from public.get_contract_attachments('ca000000-0000-0000-0000-000000000040')), 'new.pdf', 'Factory reads awarded attachment');
select ok(public.can_read_contract_file('org-private', 'ca000000-0000-0000-0000-000000000010/contract/ca000000-0000-0000-0000-000000000040/new.pdf'), 'Factory can sign a private download URL');
reset role;
select throws_ok($$update public.production_orders set contract_attachment_ids = '{}' where id = 'ca000000-0000-0000-0000-000000000060'$$,
 '42501', null, 'Awarded selection is immutable');
select * from finish();
rollback;
