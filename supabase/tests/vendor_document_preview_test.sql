begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
insert into auth.users(id,email) values ('dd000000-0000-0000-0000-000000000001','preview-brand@example.com'),('dd000000-0000-0000-0000-000000000002','preview-outsider@example.com');
insert into public.orgs(id,type,name,slug) values ('dd000000-0000-0000-0000-000000000010','brand','Preview Brand','pgtap-preview-brand'),('dd000000-0000-0000-0000-000000000020','factory','Preview Factory','pgtap-preview-factory');
insert into public.org_members(org_id,user_id,role) values ('dd000000-0000-0000-0000-000000000010','dd000000-0000-0000-0000-000000000001','owner');
insert into public.factory_profiles(org_id,published_at) values ('dd000000-0000-0000-0000-000000000020',now());
insert into public.documents(id,org_id,kind,bucket,storage_path,file_name) values
('dd000000-0000-0000-0000-000000000030','dd000000-0000-0000-0000-000000000020','business_registration','org-private','dd000000-0000-0000-0000-000000000020/license.pdf','license.pdf'),
('dd000000-0000-0000-0000-000000000031','dd000000-0000-0000-0000-000000000020','certificate','org-private','dd000000-0000-0000-0000-000000000020/certificate.pdf','certificate.pdf'),
('dd000000-0000-0000-0000-000000000032','dd000000-0000-0000-0000-000000000020','contract','org-private','dd000000-0000-0000-0000-000000000020/contract.pdf','contract.pdf');
set local role authenticated;
set local request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(not public.can_preview_vendor_document('dd000000-0000-0000-0000-000000000030'),'A brand cannot open a factory''s registration document (20261108600000)');
select is((select count(*)::int from public.documents where id = 'dd000000-0000-0000-0000-000000000030'), 0, 'nor read its row');
select is((select count(*)::int from storage.objects where bucket_id = 'org-private' and name = 'dd000000-0000-0000-0000-000000000020/license.pdf'), 0, 'nor its file');
select ok(public.can_preview_vendor_document('dd000000-0000-0000-0000-000000000031'),'Brand can preview unverified certificate');
select ok(not public.can_preview_vendor_document('dd000000-0000-0000-0000-000000000032'),'Contracts stay private');
set local request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(not public.can_preview_vendor_document('dd000000-0000-0000-0000-000000000030'),'Nonbrand cannot preview');
reset role;
update public.factory_profiles set published_at = null where org_id = 'dd000000-0000-0000-0000-000000000020';
set local role authenticated;
set local request.jwt.claims = '{"sub":"dd000000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(not public.can_preview_vendor_document('dd000000-0000-0000-0000-000000000030'),'Unpublished vendor documents stay private');
select * from finish();
rollback;
