begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- Tests control the runtime flag within this rollback-only transaction.
update public.matching_settings set enabled=false where id;
insert into auth.users(id,email) values
 ('a9900000-0000-0000-0000-000000000001','pgtap99-brand@example.com'),
 ('a9900000-0000-0000-0000-000000000002','pgtap99-factory@example.com'),
 ('a9900000-0000-0000-0000-000000000003','pgtap99-other@example.com'),
 ('a9900000-0000-0000-0000-000000000004','pgtap99-admin@example.com');
insert into public.platform_admins(user_id) values('a9900000-0000-0000-0000-000000000004');
insert into public.orgs(id,type,name,slug) values
 ('b9900000-0000-0000-0000-000000000001','brand','P99 Brand','pgtap99-brand'),
 ('b9900000-0000-0000-0000-000000000002','factory','P99 Factory','pgtap99-factory'),
 ('b9900000-0000-0000-0000-000000000003','brand','P99 Other','pgtap99-other');
insert into public.org_members(org_id,user_id,role) values
 ('b9900000-0000-0000-0000-000000000001','a9900000-0000-0000-0000-000000000001','owner'),
 ('b9900000-0000-0000-0000-000000000002','a9900000-0000-0000-0000-000000000002','owner'),
 ('b9900000-0000-0000-0000-000000000003','a9900000-0000-0000-0000-000000000003','owner');
insert into public.brand_profiles(org_id) values('b9900000-0000-0000-0000-000000000001'),('b9900000-0000-0000-0000-000000000003');
insert into public.factory_profiles(org_id,country_code,moq,typical_lead_days,sample_lead_days,published_at) values('b9900000-0000-0000-0000-000000000002','PT',100,10,5,now());
insert into public.factory_matching_facts(org_id,moq_per_colour,usual_order_min,usual_order_max) values('b9900000-0000-0000-0000-000000000002',50,200,500);
insert into public.taxonomy_terms(id,kind,slug,label_en) values
 ('c9900000-0000-0000-0000-000000000001','product_category','pgtap99-shirts','P99 Shirts'),
 ('c9900000-0000-0000-0000-000000000002','product_category','pgtap99-jackets','P99 Jackets'),
 ('c9900000-0000-0000-0000-000000000003','certification','pgtap99-gots','P99 GOTS');
insert into public.taxonomy_links(subject_type,subject_id,org_id,term_id)
select s.typ::public.taxonomy_subject,s.id,s.id,t.id from (values('brand_profile','b9900000-0000-0000-0000-000000000001'::uuid),('factory_profile','b9900000-0000-0000-0000-000000000002'::uuid)) s(typ,id)
cross join public.taxonomy_terms t where t.id='c9900000-0000-0000-0000-000000000001' or (t.kind in ('fabric','technique','development_service') and t.org_id is null);
insert into public.matching_requirements(subject_type,subject_id,org_id,quantity,colour_quantities,preferred_countries)
values('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000001',300,array[150,150],array['PT']);
insert into public.factory_capacity(org_id,input_mode,monthly_units) values('b9900000-0000-0000-0000-000000000002','units',10000);
insert into public.factory_capacity_months(org_id,month,level) select 'b9900000-0000-0000-0000-000000000002',target_month,'open' from (select distinct date_trunc('month',d)::date as target_month from unnest(array[current_date+30,current_date+60]) d) x;
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'score')::numeric,100.00,'complete no-deadline match earns 100');
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','qualified','self-reported capabilities qualify');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->0->>'weight')::numeric,36.84,'unspecified certificate factor omitted: 35/95');
select throws_ok($$select public.review_matching_evidence('capability',gen_random_uuid(),'verified')$$,'42501',null,'brand cannot approve evidence');
select throws_ok($$update public.matching_settings set enabled=true$$,'42501',null,'brand cannot enable production flag');
select throws_ok($$insert into public.factory_matching_facts(org_id) values('b9900000-0000-0000-0000-000000000002')$$,'42501',null,'brand cannot write another factory facts');
select throws_ok($$insert into public.matching_requirements(subject_type,subject_id,org_id) values('brand_profile','b9900000-0000-0000-0000-000000000003','b9900000-0000-0000-0000-000000000001')$$,'42501',null,'cannot spoof matching subject ownership');
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000003','b9900000-0000-0000-0000-000000000002'),null::jsonb,'other brand preferences not exposed');
reset role;
update public.factory_matching_facts set usual_order_min=null where org_id='b9900000-0000-0000-0000-000000000002';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','needs_confirmation','missing usual range is provisional');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'score')::numeric,84.21,'missing factory data earns zero instead of renormalisation');
update public.factory_matching_facts set usual_order_min=600,usual_order_max=1000 where org_id='b9900000-0000-0000-0000-000000000002';
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->1->>'share')::numeric,0.7500,'order below usual range uses quantity/minimum ratio');
update public.factory_matching_facts set usual_order_min=100,usual_order_max=150,moq_per_colour=160 where org_id='b9900000-0000-0000-0000-000000000002';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','excluded','colour MOQ failure excludes even though style total fits');
update public.factory_matching_facts set usual_order_min=200,usual_order_max=500,moq_per_colour=50 where org_id='b9900000-0000-0000-0000-000000000002';
update public.matching_requirements set preferred_countries=array['CN'],accepted_countries=array['PT'] where subject_id='b9900000-0000-0000-0000-000000000001';
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->3->>'share')::numeric,0.5000,'explicitly accepted alternative gets half region points');
update public.matching_requirements set accepted_countries='{}',location_required=true where subject_id='b9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','excluded','mandatory location mismatch excludes');
update public.matching_requirements set preferred_countries=array['PT'],location_required=false,bulk_deadline=current_date+60,bulk_deadline_type='ready_to_ship' where subject_id='b9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','qualified','precise feasible deadline and capacity qualify');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->0->>'weight')::numeric,31.58,'deadline weights use 30/95 product');
update public.matching_requirements set bulk_deadline_type='delivered' where subject_id='b9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','needs_confirmation','delivered date without shipping allowance is unknown');
update public.matching_requirements set shipping_days=2, sample_deadline=current_date+2,requires_sample=true where subject_id='b9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','excluded','sample lead time cannot meet sample date');
update public.matching_requirements set bulk_deadline=null,sample_deadline=null,requires_sample=false where subject_id='b9900000-0000-0000-0000-000000000001';
-- Direct file/status manipulation must not self-verify capability evidence.
insert into public.documents(id,org_id,kind,bucket,storage_path,file_name) values
 ('d9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002','capability_evidence','org-private','b9900000-0000-0000-0000-000000000002/capability_evidence/p99.pdf','p99.pdf'),
 ('d9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002','certificate','org-private','b9900000-0000-0000-0000-000000000002/certificate/p99.pdf','p99.pdf');
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
insert into public.factory_capability_evidence(id,org_id,term_id,document_id,status) values('e9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002','c9900000-0000-0000-0000-000000000001','d9900000-0000-0000-0000-000000000001','verified');
select is((select status::text from public.factory_capability_evidence where id='e9900000-0000-0000-0000-000000000001'),'pending','factory cannot self-approve evidence');
select throws_ok($$select public.review_matching_evidence('capability','e9900000-0000-0000-0000-000000000001','verified')$$,'42501',null,'factory cannot invoke staff approval');
reset role;
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.review_matching_evidence('capability','e9900000-0000-0000-0000-000000000001','verified','Evidence confirms shirts')$$,'staff can approve capability evidence');
select is((select status::text from public.factory_capability_evidence where id='e9900000-0000-0000-0000-000000000001'),'verified','approval is persisted');
reset role;
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
update public.factory_capability_evidence set status='rejected' where id='e9900000-0000-0000-0000-000000000001';
select is((select status::text from public.factory_capability_evidence where id='e9900000-0000-0000-0000-000000000001'),'verified','factory cannot overwrite a staff decision');
select throws_ok($$select review_note from public.factory_capability_evidence$$,'42501',null,'staff notes not exposed through published evidence');
delete from public.taxonomy_links where subject_type='factory_profile' and subject_id='b9900000-0000-0000-0000-000000000002' and term_id='c9900000-0000-0000-0000-000000000001';
select is((select status::text from public.factory_capability_evidence where id='e9900000-0000-0000-0000-000000000001'),'pending','removing a claim invalidates only its evidence approval');
reset role;
select ok(not(select enabled from public.matching_settings where id),'flag defaults off');
select is((select verification_status::text from public.factory_profiles where org_id='b9900000-0000-0000-0000-000000000002'),'unverified','evidence review does not change company verification');
select is((select count(*)::integer from public.credit_ledger where org_id='b9900000-0000-0000-0000-000000000002'),0,'evidence review does not issue verification credits');
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
-- Restore capability, then exercise certificate metadata and both exact weight sets.
insert into public.taxonomy_links(subject_type,subject_id,org_id,term_id) values('factory_profile','b9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002','c9900000-0000-0000-0000-000000000001');
insert into public.taxonomy_links(subject_type,subject_id,org_id,term_id) values('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000001','c9900000-0000-0000-0000-000000000003');
update public.matching_requirements set required_term_ids=array['c9900000-0000-0000-0000-000000000003'::uuid] where subject_id='b9900000-0000-0000-0000-000000000001';
insert into public.factory_certifications(id,org_id,term_id,document_id,expires_at,facility_country,facility_name,scope_all_products)
values('f9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002','c9900000-0000-0000-0000-000000000003','d9900000-0000-0000-0000-000000000002',current_date+120,'PT','P99 Factory',true);
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','needs_confirmation','unreviewed certificate is not treated as verified');
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.review_matching_evidence('certificate','f9900000-0000-0000-0000-000000000001','verified')$$,'staff can approve complete certificate metadata');
select lives_ok($$select public.review_document('d9900000-0000-0000-0000-000000000002','verified')$$,'legacy certificate document review remains functional');
reset role;
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->0->>'weight')::numeric,35.00,'all specified no-deadline factors use 35% product');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->1->>'weight')::numeric,30.00,'no-deadline order weight is 30%');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->2->>'weight')::numeric,20.00,'no-deadline support weight is 20%');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'score')::numeric,100.00,'relevant current certificate restores complete match');
update public.matching_requirements set bulk_deadline=current_date+60,bulk_deadline_type='ready_to_ship',sample_deadline=current_date+30 where subject_id='b9900000-0000-0000-0000-000000000001';
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->0->>'weight')::numeric,30.00,'deadline product weight is 30%');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->1->>'weight')::numeric,25.00,'deadline order weight is 25%');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->2->>'weight')::numeric,15.00,'deadline support weight is 15%');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->3->>'weight')::numeric,15.00,'timeline weight is 15%');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->4->>'weight')::numeric,10.00,'region weight is 10%');
select is((public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors'->5->>'weight')::numeric,5.00,'certificate weight is 5%');
delete from public.factory_capacity_months where org_id='b9900000-0000-0000-0000-000000000002' and month=date_trunc('month',current_date+30)::date;
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','needs_confirmation','missing sample-month capacity is provisional');
select is((select (x->>'share')::numeric from jsonb_array_elements(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->'factors') x where x->>'key'='timeline'),0.0000,'unknown sample availability earns zero timeline points');
insert into public.factory_capacity_months(org_id,month,level) values('b9900000-0000-0000-0000-000000000002',date_trunc('month',current_date+30)::date,'open');
update public.factory_capacity_months set level='full' where org_id='b9900000-0000-0000-0000-000000000002';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','excluded','full production-month capacity excludes');
update public.factory_capacity_months set level='open' where org_id='b9900000-0000-0000-0000-000000000002';
update public.factory_certifications set expires_at=current_date+1 where id='f9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','excluded','certificate must remain valid through delivery');
update public.factory_certifications set expires_at=current_date+120,scope_all_products=false,scope_term_ids=array['c9900000-0000-0000-0000-000000000002'::uuid] where id='f9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','excluded','known certificate scope mismatch fails mandatory requirement');
update public.factory_certifications set scope_all_products=true,scope_term_ids='{}',facility_country='CN' where id='f9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','excluded','certificate for another facility cannot qualify');
update public.factory_certifications set facility_country='PT',facility_name='Another Facility' where id='f9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','excluded','certificate facility name must match the production company');
update public.factory_certifications set facility_name='P99 Factory',facility_country=null,expires_at=null where id='f9900000-0000-0000-0000-000000000001';
select is(public.factory_match_v2('brand_profile','b9900000-0000-0000-0000-000000000001','b9900000-0000-0000-0000-000000000002')->>'status','needs_confirmation','legacy certificate without validity and facility is unknown');
-- Request scoring and API enforcement use the identical engine.
insert into public.rfqs(id,brand_org_id,title,status,visibility,quantity_total) values('f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000001','P99 request','open','invited_only',300);
insert into public.rfq_colour_splits(rfq_id,colour,quantity,sort) values('f9900000-0000-0000-0000-000000000002','Navy',150,0),('f9900000-0000-0000-0000-000000000002','White',150,1);
insert into public.taxonomy_links(subject_type,subject_id,org_id,term_id) select 'rfq','f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000001',term_id from public.taxonomy_links where subject_type='brand_profile' and subject_id='b9900000-0000-0000-0000-000000000001';
insert into public.matching_requirements(subject_type,subject_id,org_id,quantity,colour_quantities,required_term_ids) values('rfq','f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000001',300,array[150,150],array['c9900000-0000-0000-0000-000000000003'::uuid]);
update public.matching_settings set enabled=true where id;
set local role authenticated;
select throws_ok($$insert into public.rfq_invitations(rfq_id,factory_org_id) values('f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002')$$,'22023',null,'provisional invitation requires explicit acknowledgement');
select lives_ok($$insert into public.rfq_invitations(rfq_id,factory_org_id,matching_acknowledged) values('f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002',true)$$,'acknowledged provisional invitation allowed');
update public.rfq_invitations set matching_acknowledged=false where rfq_id='f9900000-0000-0000-0000-000000000002';
select ok((select matching_acknowledged from public.rfq_invitations where rfq_id='f9900000-0000-0000-0000-000000000002'),'brand RLS prevents editing an invitation acknowledgement');
select is((select count(*)::integer from public.factory_matches_v2('rfq','f9900000-0000-0000-0000-000000000002',array['b9900000-0000-0000-0000-000000000002'::uuid])),1,'batch API returns request assessment');
select is((select count(*)::integer from public.documents where id='d9900000-0000-0000-0000-000000000001'),0,'brand cannot read private capability evidence file');
reset role;
update public.factory_matching_facts set moq_per_colour=160 where org_id='b9900000-0000-0000-0000-000000000002';
set local role authenticated;
select is(public.match_score_rfq('f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002'),null::numeric,'legacy scalar signature returns null for v2 exclusion');
delete from public.rfq_invitations where rfq_id='f9900000-0000-0000-0000-000000000002';
select throws_ok($$insert into public.rfq_invitations(rfq_id,factory_org_id,matching_acknowledged) values('f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002',true)$$,'22023',null,'acknowledgement cannot override a confirmed exclusion');
select throws_ok($$select public.factory_matches_v2('rfq','f9900000-0000-0000-0000-000000000002',array_fill(gen_random_uuid(),array[101]))$$,'22023',null,'batch requests have a bounded size');
reset role;
update public.matching_settings set enabled=false where id;
set local role authenticated;
select is(public.match_score_rfq('f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002'),public.match_score_rfq_legacy('f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002'),'disabled flag preserves legacy score');
reset role;
set local role anon;
select throws_ok($$select * from public.factory_matching_facts$$,'42501',null,'signed-out users cannot read matching facts');
select throws_ok($$select public.factory_match_v2('rfq','f9900000-0000-0000-0000-000000000002','b9900000-0000-0000-0000-000000000002')$$,'42501',null,'signed-out users cannot call matching APIs');
reset role;

-- Atomic profile writes preserve unrelated fields and reject partial bad saves.
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.save_matching_profile('factory_profile','b9900000-0000-0000-0000-000000000002',array(select term_id from public.taxonomy_links where subject_type='factory_profile' and subject_id='b9900000-0000-0000-0000-000000000002'),'{"moq_per_colour":50,"usual_order_min":200,"usual_order_max":500}')$$,'factory saves matching profile through the real RPC');
select is((select usual_order_min from public.factory_matching_facts where org_id='b9900000-0000-0000-0000-000000000002'),200,'saved order size resumes from database');
select throws_ok($$select public.save_matching_profile('factory_profile','b9900000-0000-0000-0000-000000000002',array[]::uuid[],'{"usual_order_min":900,"usual_order_max":100}')$$,'23514',null,'invalid order range rolls back the complete profile save');
select ok(exists(select 1 from public.taxonomy_links where subject_type='factory_profile' and subject_id='b9900000-0000-0000-0000-000000000002' and term_id='c9900000-0000-0000-0000-000000000001'),'failed save does not erase existing capabilities');
select throws_ok($$select public.save_matching_profile('brand_profile','b9900000-0000-0000-0000-000000000001',array[]::uuid[],'{}')$$,'42501',null,'factory cannot edit a brand matching profile');
reset role;
select set_config('request.jwt.claims','{"sub":"a9900000-0000-0000-0000-000000000004","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.review_matching_evidence('capability','e9900000-0000-0000-0000-000000000001','verified')$$,'staff can review resubmitted capability');
reset role;
insert into storage.objects(bucket_id,name) values('org-private','b9900000-0000-0000-0000-000000000002/capability_evidence/p99.pdf');
update storage.objects set metadata='{"size":100}' where bucket_id='org-private' and name='b9900000-0000-0000-0000-000000000002/capability_evidence/p99.pdf';
select is((select status::text from public.factory_capability_evidence where id='e9900000-0000-0000-0000-000000000001'),'pending','direct Storage replacement invalidates capability approval');
select ok(exists(select 1 from public.matching_evidence_history where evidence_id='e9900000-0000-0000-0000-000000000001' and decision='pending'),'approval invalidation has audit history');
select is((select count(*)::integer from public.credit_ledger where org_id='b9900000-0000-0000-0000-000000000002'),0,'file replacement grants no company credits');

select * from finish();
rollback;
