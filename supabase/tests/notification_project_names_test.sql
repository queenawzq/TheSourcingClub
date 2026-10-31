begin;
create extension if not exists pgtap with schema extensions;
select plan(6);
insert into public.orgs(id,type,name,slug) values
 ('ef310000-0000-0000-0000-000000000001','brand','Project name brand','pgtap-project-name-brand'),
 ('ef310000-0000-0000-0000-000000000002','factory','Project name factory','pgtap-project-name-factory');
insert into public.rfqs(id,brand_org_id,title,status,visibility,quantity_total) values
 ('ef310000-0000-0000-0000-000000000003','ef310000-0000-0000-0000-000000000001','Linen overshirt, SS27','open','open_to_all',100);
insert into public.quotes(id,rfq_id,factory_org_id,status,version) values
 ('ef310000-0000-0000-0000-000000000004','ef310000-0000-0000-0000-000000000003','ef310000-0000-0000-0000-000000000002','submitted',1);
insert into public.production_orders(id,rfq_id,quote_id,brand_org_id,factory_org_id,order_number,
 unit_price_cents,production_quantity,bulk_subtotal_cents,sample_subtotal_cents,order_total_cents,deposit_pct,balance_pct) values
 ('ef310000-0000-0000-0000-000000000005','ef310000-0000-0000-0000-000000000003','ef310000-0000-0000-0000-000000000004',
 'ef310000-0000-0000-0000-000000000001','ef310000-0000-0000-0000-000000000002','TSC-PROJECT-NAME-TEST',100,1,100,0,100,50,50);
insert into public.notifications(id,org_id,order_id,kind,title,body) values
 ('ef310000-0000-0000-0000-000000000006','ef310000-0000-0000-0000-000000000001','ef310000-0000-0000-0000-000000000005',
 'call_invited','Factory invited you to a call about TSC-PROJECT-NAME-TEST','Review TSC-PROJECT-NAME-TEST.'),
 ('ef310000-0000-0000-0000-000000000007','ef310000-0000-0000-0000-000000000001',null,
 'call_invited','Factory invited you to a call about Linen overshirt, SS27',null);
select is((select title from notifications where id='ef310000-0000-0000-0000-000000000006'),
 'Factory invited you to a call about Linen overshirt, SS27 (TSC-PROJECT-NAME-TEST)','call titles name the project before the number');
select is((select body from notifications where id='ef310000-0000-0000-0000-000000000006'),
 'Review TSC-PROJECT-NAME-TEST.','notification body text is preserved');
select is((select title from notifications where id='ef310000-0000-0000-0000-000000000007'),
 'Factory invited you to a call about Linen overshirt, SS27','request-only notifications keep their existing name');
select is((select body from notifications where id='ef310000-0000-0000-0000-000000000007'),null::text,'null bodies remain null');
select ok(not has_function_privilege('authenticated','public.notification_project_name()','execute'),'the trigger function is not a browser RPC');
select ok(not has_function_privilege('anon','public.notification_project_name()','execute'),'signed-out users cannot invoke the helper');
select * from finish();
rollback;
