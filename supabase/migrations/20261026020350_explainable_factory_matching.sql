-- Additive matching v2. Default off; company verification and credits are untouched.
create table public.matching_settings (id boolean primary key default true check(id), enabled boolean not null default false);
insert into public.matching_settings values(true,false);
alter table public.matching_settings enable row level security;
grant select on public.matching_settings to authenticated;
grant all on public.matching_settings to service_role;
create policy matching_settings_read on public.matching_settings for select to authenticated using(true);

insert into public.taxonomy_kinds(kind,label_en,label_zh) values
 ('fabric','Fabrics','面料'),('technique','Techniques','工艺'),('development_service','Development support','开发支持') on conflict do nothing;
insert into public.taxonomy_terms(kind,slug,label_en,label_zh) values
 ('fabric','woven','Woven','梭织'),('fabric','knit','Knit','针织'),('fabric','denim','Denim','牛仔'),
 ('technique','embroidery','Embroidery','刺绣'),('technique','printing','Printing','印花'),('technique','seam-sealing','Seam sealing','压胶'),
 ('development_service','tech-pack','Tech-pack development','技术包开发'),('development_service','patternmaking','Patternmaking','制版'),
 ('development_service','fabric-sourcing','Fabric sourcing','面料采购'),('development_service','sampling','Sampling','打样'),
 ('development_service','full-package','Full-package production','全包生产') on conflict do nothing;

create table public.factory_matching_facts (
 org_id uuid primary key references public.factory_profiles(org_id) on delete cascade,
 moq_per_colour integer check(moq_per_colour>=0), usual_order_min integer check(usual_order_min>0), usual_order_max integer check(usual_order_max>0),
 updated_at timestamptz not null default now(),
 check(usual_order_min is null or usual_order_max is null or usual_order_min<=usual_order_max)
);
alter table public.factory_matching_facts enable row level security;
grant select,insert,update on public.factory_matching_facts to authenticated;
grant all on public.factory_matching_facts to service_role;
create policy matching_facts_read on public.factory_matching_facts for select to authenticated using
 (public.is_org_member(org_id) or public.is_platform_admin() or exists(select 1 from public.factory_profiles f where f.org_id=factory_matching_facts.org_id and f.published_at is not null));
create policy matching_facts_insert on public.factory_matching_facts for insert to authenticated with check(public.is_org_member(org_id));
create policy matching_facts_update on public.factory_matching_facts for update to authenticated using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
create trigger matching_facts_touch before update on public.factory_matching_facts for each row execute function public.touch_updated_at();

-- Taxonomy selections remain in taxonomy_links. This record stores intent, not labels.
create table public.matching_requirements (
 subject_type public.taxonomy_subject not null check(subject_type in ('brand_profile','rfq')),
 subject_id uuid not null, org_id uuid not null references public.orgs(id) on delete cascade,
 required_term_ids uuid[] not null default '{}', preferred_countries text[] not null default '{}', accepted_countries text[] not null default '{}',
 location_required boolean not null default false, quantity integer check(quantity>0), colour_quantities integer[] not null default '{}',
 sample_deadline date, bulk_deadline date, bulk_deadline_type text check(bulk_deadline_type in ('ready_to_ship','delivered')),
 shipping_days integer check(shipping_days>=0), requires_sample boolean not null default false,
 updated_at timestamptz not null default now(), primary key(subject_type,subject_id),
 check(bulk_deadline is null or bulk_deadline_type is not null)
);
alter table public.matching_requirements enable row level security;
grant select,insert,update on public.matching_requirements to authenticated;
grant all on public.matching_requirements to service_role;
create policy matching_requirements_read on public.matching_requirements for select to authenticated using
 (public.is_org_member(org_id) or public.is_platform_admin() or (subject_type='rfq' and public.can_see_rfq(subject_id)));
create policy matching_requirements_insert on public.matching_requirements for insert to authenticated with check(public.is_org_member(org_id));
create policy matching_requirements_update on public.matching_requirements for update to authenticated using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
create function public.validate_matching_requirements() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.brand_profiles b where b.org_id=new.org_id) or
   (new.subject_type='brand_profile' and new.subject_id<>new.org_id) or
   (new.subject_type='rfq' and not exists(select 1 from public.rfqs r where r.id=new.subject_id and r.brand_org_id=new.org_id)) then
   raise exception 'matching subject does not belong to this brand' using errcode='42501'; end if;
 if cardinality(new.required_term_ids)>200 or cardinality(new.colour_quantities)>100 or cardinality(new.preferred_countries)>250 or cardinality(new.accepted_countries)>250 then raise exception 'too many matching requirements' using errcode='22023'; end if;
 if exists(select 1 from unnest(new.colour_quantities) q where q<=0 or q is null) or
   (cardinality(new.colour_quantities)>0 and (new.quantity is null or (select sum(q) from unnest(new.colour_quantities) q)<>new.quantity)) then
   raise exception 'colour quantities must be positive and sum to the style quantity' using errcode='22023'; end if;
 if exists(select 1 from unnest(new.required_term_ids) id where not exists(select 1 from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id
   where l.subject_type=new.subject_type and l.subject_id=new.subject_id and l.term_id=id and t.kind in ('fabric','technique','certification'))) then
   raise exception 'mandatory terms must be selected requirements' using errcode='22023'; end if;
 if exists(select 1 from unnest(new.preferred_countries||new.accepted_countries) code where code !~ '^[A-Z]{2}$') then
   raise exception 'choose ISO country codes' using errcode='22023'; end if;
 new.updated_at:=now(); return new;
end $$;
create trigger matching_requirements_validate before insert or update on public.matching_requirements for each row execute function public.validate_matching_requirements();

alter table public.factory_certifications add column non_expiring boolean not null default false,
 add column facility_country text check(facility_country ~ '^[A-Z]{2}$'), add column facility_name text, add column scope_term_ids uuid[] not null default '{}',
 add column scope_all_products boolean not null default false;

create table public.factory_capability_evidence (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.factory_profiles(org_id) on delete cascade,
 term_id uuid not null references public.taxonomy_terms(id), document_id uuid not null references public.documents(id),
 status public.verification_status not null default 'pending', reviewed_by uuid references auth.users(id), reviewed_at timestamptz,
 review_note text, created_at timestamptz not null default now(), unique(org_id,term_id)
);
create table public.matching_evidence_history (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id) on delete cascade,
 evidence_id uuid not null, evidence_type text not null, decision text not null, reviewer uuid references auth.users(id),
 note text, created_at timestamptz not null default now()
);
alter table public.factory_capability_evidence enable row level security;
alter table public.matching_evidence_history enable row level security;
grant select,insert,update,delete on public.factory_capability_evidence to authenticated;
grant select on public.matching_evidence_history to authenticated;
grant all on public.factory_capability_evidence, public.matching_evidence_history to service_role;
create policy matching_evidence_read on public.factory_capability_evidence for select to authenticated using
 (public.is_org_member(org_id) or public.is_platform_admin() or exists(select 1 from public.factory_profiles f where f.org_id=factory_capability_evidence.org_id and f.published_at is not null));
create policy matching_evidence_insert on public.factory_capability_evidence for insert to authenticated with check(public.is_org_member(org_id));
create policy matching_evidence_update on public.factory_capability_evidence for update to authenticated using(public.is_org_member(org_id)) with check(public.is_org_member(org_id));
create policy matching_evidence_delete on public.factory_capability_evidence for delete to authenticated using(public.is_org_member(org_id));
create policy matching_history_read on public.matching_evidence_history for select to authenticated using(public.is_platform_admin());

-- Claims and evidence cannot approve themselves. A metadata edit invalidates just that claim.
create function public.guard_matching_evidence() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare changed boolean; doc public.documents;
begin
 if tg_table_name='factory_capability_evidence' then
   if pg_trigger_depth()>1 and current_user='postgres' then return new; end if;
   if not exists(select 1 from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id where l.subject_type='factory_profile' and l.subject_id=new.org_id and l.term_id=new.term_id and t.kind in ('product_category','fabric','technique','development_service')) then
     raise exception 'evidence must refer to an offered capability' using errcode='22023'; end if;
   select * into doc from public.documents where id=new.document_id;
   if doc.org_id is distinct from new.org_id or doc.bucket<>'org-private' then raise exception 'evidence must be a private document owned by this factory' using errcode='42501'; end if;
   changed:=tg_op='INSERT';
   if tg_op='UPDATE' then
     if new.org_id<>old.org_id or new.id<>old.id then raise exception 'cannot reassign evidence' using errcode='42501'; end if;
     changed:=row(new.document_id,new.term_id) is distinct from row(old.document_id,old.term_id);
   end if;
   if not public.is_platform_admin() and coalesce(auth.role(),'')<>'service_role' then
     new.status:=case when changed then 'pending'::public.verification_status else old.status end;
     new.reviewed_by:=case when changed then null else old.reviewed_by end;
     new.reviewed_at:=case when changed then null else old.reviewed_at end;
     new.review_note:=case when changed then null else old.review_note end;
   elsif changed then new.status:='pending'; new.reviewed_by:=null; new.reviewed_at:=null; new.review_note:=null;
   end if;
 else
   if new.document_id is not null and not exists(select 1 from public.documents d where d.id=new.document_id and d.org_id=new.org_id and d.bucket='org-private' and d.kind='certificate') then
     raise exception 'certificate must belong to this factory' using errcode='42501'; end if;
   if new.non_expiring and new.expires_at is not null then raise exception 'choose an expiry date or non-expiring' using errcode='22023'; end if;
   if exists(select 1 from unnest(new.scope_term_ids) id where not exists(select 1 from public.taxonomy_terms t where t.id=id and t.kind in ('product_category','fabric','technique'))) then raise exception 'invalid certificate scope' using errcode='22023'; end if;
   changed:=tg_op='INSERT';
   if tg_op='UPDATE' then
     if new.org_id<>old.org_id or new.id<>old.id then raise exception 'cannot reassign certificate' using errcode='42501'; end if;
     changed:=row(new.document_id,new.term_id,new.expires_at,new.non_expiring,new.facility_country,new.facility_name,new.scope_term_ids,new.scope_all_products)
       is distinct from row(old.document_id,old.term_id,old.expires_at,old.non_expiring,old.facility_country,old.facility_name,old.scope_term_ids,old.scope_all_products);
   end if;
   if changed then
     if tg_op='INSERT' and (coalesce(auth.role(),'')='service_role' or (auth.uid() is null and current_user='postgres')) then null;
     else new.status:='pending'; end if;
   elsif not public.is_platform_admin() and coalesce(auth.role(),'')<>'service_role' and current_user<>'postgres' then new.status:=old.status; end if;
 end if;
 return new;
end $$;
create trigger matching_capability_guard before insert or update on public.factory_capability_evidence for each row execute function public.guard_matching_evidence();
create trigger matching_certificate_guard before insert or update on public.factory_certifications for each row execute function public.guard_matching_evidence();

create function public.review_matching_evidence(evidence_type text,evidence_id uuid,decision public.verification_status,note text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare target_org uuid;
begin
 if not public.is_platform_admin() then raise exception 'only staff may review evidence' using errcode='42501'; end if;
 if decision not in ('verified','rejected','pending') then raise exception 'invalid review decision' using errcode='22023'; end if;
 if evidence_type='capability' then
   update public.factory_capability_evidence e set status=decision,reviewed_by=auth.uid(),reviewed_at=now(),review_note=note where e.id=evidence_id returning org_id into target_org;
 elsif evidence_type='certificate' then
   if decision='verified' and not exists(select 1 from public.factory_certifications c join public.documents d on d.id=c.document_id
     where c.id=evidence_id and (c.non_expiring or c.expires_at>=current_date) and c.facility_country is not null and nullif(btrim(c.facility_name),'') is not null
       and (c.scope_all_products or cardinality(c.scope_term_ids)>0)) then raise exception 'complete certificate validity, facility and scope before approval' using errcode='22023'; end if;
   update public.factory_certifications c set status=decision where c.id=evidence_id returning org_id into target_org;
 else raise exception 'invalid evidence type' using errcode='22023'; end if;
 if target_org is null then raise exception 'evidence not found' using errcode='P0002'; end if;
 insert into public.matching_evidence_history(org_id,evidence_id,evidence_type,decision,reviewer,note) values(target_org,evidence_id,evidence_type,decision::text,auth.uid(),note);
end $$;
revoke all on function public.review_matching_evidence(text,uuid,public.verification_status,text) from public,anon;
grant execute on function public.review_matching_evidence(text,uuid,public.verification_status,text) to authenticated;

-- Removing a capability invalidates its evidence; adding it back does not restore approval.
create function public.invalidate_capability_evidence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.subject_type='factory_profile' then
   update public.factory_capability_evidence set status='pending',reviewed_at=null,reviewed_by=null,review_note=null where org_id=old.subject_id and term_id=old.term_id;
 end if; if tg_op='UPDATE' then return new; else return old; end if;
end $$;
revoke all on function public.invalidate_capability_evidence() from public,anon,authenticated;
create trigger matching_claim_removed before delete or update of subject_type,subject_id,term_id on public.taxonomy_links for each row execute function public.invalidate_capability_evidence();

create function public.factory_match_v2(subject_type public.taxonomy_subject,subject_id uuid,factory_org uuid)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
 f public.factory_profiles; facts public.factory_matching_facts; req public.matching_requirements; r public.rfqs;
 required_ids uuid[]; offered_ids uuid[]; group_ids uuid[]; wanted uuid; cert public.factory_certifications;
 factors jsonb:='[]'; checks jsonb:='[]'; missing jsonb:='[]'; failed jsonb:='[]'; evidence jsonb:='[]';
 v_kind text; key text; n integer; matched integer; known integer; groups integer:=0;
 product numeric:=0; product_known numeric:=0; order_share numeric:=0; order_known numeric:=0;
 development numeric:=0; development_known numeric:=0; region_share numeric:=0; region_known numeric:=0; cert_share numeric:=0; cert_known numeric:=0;
 timeline numeric:=0; timeline_known numeric:=0; weights integer[]; shares numeric[]; covers numeric[]; applies boolean[];
 qty integer; colours integer[]; country text; sample_date date; bulk_date date; deadline date; end_date date;
 has_deadline boolean; requires_sample boolean; moq_ok boolean; usual numeric; relevant boolean; good boolean;
 lead integer; sample_lead integer; capacity public.capacity_level; available_min integer; available_max integer;
 timeline_missing_before integer;
 factor_names text[]:=array['product','order_size','development','timeline','region','certifications'];
 total numeric:=0; points numeric:=0; coverage numeric:=0; w numeric; i integer; status text;
begin
 if subject_type='rfq' then
   select * into r from public.rfqs x where x.id=subject_id;
   if not found then return null; end if;
 elsif subject_type='brand_profile' then
   -- Browse preferences belong to the brand, not to every other marketplace user.
   if not public.is_org_member(subject_id) and not public.is_platform_admin() and coalesce(auth.role(),'')<>'service_role' then return null; end if;
   if not exists(select 1 from public.brand_profiles b where b.org_id=subject_id) then return null; end if;
 else return null; end if;
 select * into f from public.factory_profiles x where x.org_id=factory_org;
 if not found then return null; end if;
 select * into facts from public.factory_matching_facts x where x.org_id=factory_org;
 select * into req from public.matching_requirements x where x.subject_type=factory_match_v2.subject_type and x.subject_id=factory_match_v2.subject_id;
 qty:=case when subject_type='rfq' then r.quantity_total else req.quantity end;
 colours:=req.colour_quantities;
 if subject_type='rfq' then select array_agg(c.quantity) into colours from public.rfq_colour_splits c where c.rfq_id=subject_id; end if;
 sample_date:=req.sample_deadline; bulk_date:=req.bulk_deadline;
 -- Legacy delivery months remain approximate; no invented day-level confirmation.
 has_deadline:=sample_date is not null or bulk_date is not null or r.target_delivery_month is not null;
 requires_sample:=coalesce(req.requires_sample,false) or coalesce(r.requires_sample,false) or sample_date is not null;
 deadline:=bulk_date;
 if req.bulk_deadline_type='delivered' then
   if req.shipping_days is null then missing:=missing||jsonb_build_array('Confirm shipping allowance for the delivered deadline'); deadline:=null;
   else deadline:=bulk_date-req.shipping_days; end if;
 end if;
 end_date:=coalesce(bulk_date,sample_date,current_date);
 required_ids:=coalesce(req.required_term_ids,'{}');
 if exists(select 1 from unnest(required_ids) id where not exists(select 1 from public.taxonomy_links l where l.subject_type=factory_match_v2.subject_type and l.subject_id=factory_match_v2.subject_id and l.term_id=id)) then missing:=missing||jsonb_build_array('Review mandatory requirements after editing the request'); end if;

 foreach v_kind in array array['product_category','fabric','technique'] loop
   select coalesce(array_agg(l.term_id),'{}') into group_ids from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id
     where l.subject_type=factory_match_v2.subject_type and l.subject_id=factory_match_v2.subject_id and t.kind=v_kind;
   select coalesce(array_agg(l.term_id),'{}') into offered_ids from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id
     where l.subject_type='factory_profile' and l.subject_id=factory_org and t.kind=v_kind;
   n:=cardinality(group_ids);
   if n=0 then
     if v_kind='product_category' then missing:=missing||jsonb_build_array('Choose a product category'); groups:=groups+1; end if;
     continue;
   end if;
   groups:=groups+1; matched:=0;
   foreach wanted in array group_ids loop
     if wanted=any(offered_ids) then
       matched:=matched+1;
       evidence:=evidence||jsonb_build_array(jsonb_build_object('term_id',wanted,'status',case when exists(select 1 from public.factory_capability_evidence e where e.org_id=factory_org and e.term_id=wanted and e.status='verified') then 'reviewed' else 'self_reported' end));
     elsif cardinality(offered_ids)=0 then missing:=missing||jsonb_build_array('Confirm factory '||v_kind||' capability');
     elsif v_kind='product_category' or wanted=any(required_ids) then failed:=failed||jsonb_build_array('Required '||v_kind||' is not offered');
     end if;
   end loop;
   product:=product+matched::numeric/n;
   if cardinality(offered_ids)>0 then product_known:=product_known+1; end if;
 end loop;
 if groups>0 then product:=product/groups; product_known:=product_known/groups; end if;

 if qty is null then missing:=missing||jsonb_build_array('Confirm units per style and colour to assess MOQ'); end if;
 if qty is not null then
   moq_ok:=true;
   if f.moq is null then moq_ok:=false; missing:=missing||jsonb_build_array('Confirm MOQ per style');
   elsif qty<f.moq then moq_ok:=false; failed:=failed||jsonb_build_array('Quantity is below MOQ per style'); end if;
   if facts.moq_per_colour is null or coalesce(cardinality(colours),0)=0 or (select sum(c) from unnest(colours) c)<>qty then
     moq_ok:=false; missing:=missing||jsonb_build_array('Confirm per-colour MOQ and complete colour quantities');
   elsif exists(select 1 from unnest(colours) c where c<facts.moq_per_colour) then moq_ok:=false; failed:=failed||jsonb_build_array('A colour quantity is below MOQ per colour'); end if;
   if moq_ok then order_share:=0.5; order_known:=0.5;
   elsif f.moq is not null and facts.moq_per_colour is not null and coalesce(cardinality(colours),0)>0 then order_known:=0.5; end if;
   if facts.usual_order_min is null or facts.usual_order_max is null then missing:=missing||jsonb_build_array('Confirm usual order-size range');
   else
     usual:=case when qty<facts.usual_order_min then qty::numeric/facts.usual_order_min when qty>facts.usual_order_max then facts.usual_order_max::numeric/qty else 1 end;
     order_share:=order_share+0.5*usual; order_known:=order_known+0.5;
   end if;
 end if;

 select coalesce(array_agg(l.term_id),'{}') into group_ids from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id
   where l.subject_type=factory_match_v2.subject_type and l.subject_id=factory_match_v2.subject_id and t.kind='development_service';
 n:=cardinality(group_ids); applies:=array[true,qty is not null,n>0,has_deadline,false,false];
 if n>0 then
   select coalesce(array_agg(l.term_id),'{}') into offered_ids from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id where l.subject_type='factory_profile' and l.subject_id=factory_org and t.kind='development_service';
   select count(*) into matched from unnest(group_ids) x where x=any(offered_ids);
   development:=matched::numeric/n;
   if cardinality(offered_ids)>0 then development_known:=1; else missing:=missing||jsonb_build_array('Confirm development services'); end if;
 end if;

 if has_deadline then
   timeline_missing_before:=jsonb_array_length(missing);
   lead:=f.typical_lead_days; sample_lead:=case when requires_sample then f.sample_lead_days else 0 end;
   if sample_date is not null and sample_lead is not null and current_date+sample_lead>sample_date then failed:=failed||jsonb_build_array('Sample lead time misses the sample deadline'); end if;
   if deadline is not null and lead is not null and sample_lead is not null and current_date+lead+sample_lead>deadline then failed:=failed||jsonb_build_array('Sampling and bulk lead times miss the ready-to-ship deadline'); end if;
   if deadline is not null and sample_date is not null and lead is not null and sample_date+lead>deadline then failed:=failed||jsonb_build_array('Bulk lead time after sample deadline does not fit'); end if;
   if (sample_date is not null and sample_lead is null) or (bulk_date is not null and (lead is null or sample_lead is null)) then missing:=missing||jsonb_build_array('Confirm sample and bulk lead times'); end if;
   select m.level into capacity from public.factory_capacity_months m where m.org_id=factory_org and m.month=date_trunc('month',coalesce(deadline,sample_date,r.target_delivery_month))::date;
   if sample_date is not null and bulk_date is not null and date_trunc('month',sample_date)<>date_trunc('month',coalesce(deadline,bulk_date)) then
     if exists(select 1 from public.factory_capacity_months m where m.org_id=factory_org and m.month=date_trunc('month',sample_date)::date and m.level='full') then failed:=failed||jsonb_build_array('Factory is full in the sample month');
     elsif not exists(select 1 from public.factory_capacity_months m where m.org_id=factory_org and m.month=date_trunc('month',sample_date)::date) then missing:=missing||jsonb_build_array('Confirm sample-month availability'); end if;
   end if;
   if capacity='full' then failed:=failed||jsonb_build_array('Factory is full in the required production month');
   elsif capacity is null then missing:=missing||jsonb_build_array('Confirm production-month availability'); end if;
   if bulk_date is null and sample_date is null then missing:=missing||jsonb_build_array('Confirm precise deadlines; legacy delivery month is an estimate');
   elsif qty is null then missing:=missing||jsonb_build_array('Confirm quantity to assess available capacity');
   else
     select min_pieces,max_pieces into available_min,available_max from public.capacity_available_range(factory_org,date_trunc('month',coalesce(deadline,sample_date))::date);
     if available_max is not null and qty>available_max then failed:=failed||jsonb_build_array('Order exceeds estimated available monthly capacity');
     elsif available_min is null or qty>available_min then missing:=missing||jsonb_build_array('Confirm sufficient monthly capacity');
     elsif capacity is not null and capacity<>'full' and (sample_date is null or sample_lead is not null) and (bulk_date is null or (deadline is not null and lead is not null and sample_lead is not null)) then timeline:=1; timeline_known:=1;
     end if;
   end if;
 end if;

 if has_deadline and jsonb_array_length(missing)>timeline_missing_before then timeline:=0; timeline_known:=0; end if;
 -- Explicit countries take precedence; legacy region terms remain usable as preferences.
 select coalesce(array_agg(l.term_id),'{}') into group_ids from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id
   where l.subject_type=factory_match_v2.subject_type and l.subject_id=factory_match_v2.subject_id and t.kind='region';
 if cardinality(coalesce(req.preferred_countries,'{}')||coalesce(req.accepted_countries,'{}'))>0 or cardinality(group_ids)>0 or coalesce(req.location_required,false) then
   applies[5]:=true;
   if f.country_code is null then missing:=missing||jsonb_build_array('Confirm manufacturing country');
   else
     region_known:=1;
     if f.country_code=any(coalesce(req.preferred_countries,'{}')) then region_share:=1;
     elsif f.country_code=any(coalesce(req.accepted_countries,'{}')) then region_share:=0.5;
     elsif cardinality(coalesce(req.preferred_countries,'{}')||coalesce(req.accepted_countries,'{}'))=0 and exists(select 1 from public.taxonomy_terms t where t.id=any(group_ids) and (t.extra->'countries') ? f.country_code) then region_share:=1;
     end if;
     if coalesce(req.location_required,false) and region_share=0 then failed:=failed||jsonb_build_array('Manufacturing country is outside the required locations'); end if;
   end if;
 end if;
 select coalesce(array_agg(l.term_id),'{}') into group_ids from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id
   where l.subject_type=factory_match_v2.subject_type and l.subject_id=factory_match_v2.subject_id and t.kind='certification';
 n:=cardinality(group_ids); applies[6]:=n>0; matched:=0; known:=0;
 foreach wanted in array group_ids loop
   select * into cert from public.factory_certifications c where c.org_id=factory_org and c.term_id=wanted;
   if not found then
     missing:=missing||jsonb_build_array('Confirm requested certification');
   elsif cert.status='rejected' or (cert.expires_at is not null and cert.expires_at<end_date) or
     (cert.facility_country is not null and cert.facility_country<>f.country_code) or
     (nullif(btrim(cert.facility_name),'') is not null and lower(btrim(cert.facility_name))<>lower(btrim(coalesce(f.legal_name,(select o.name from public.orgs o where o.id=factory_org))))) or
     (not cert.scope_all_products and cardinality(cert.scope_term_ids)>0 and exists(select 1 from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id where l.subject_type=factory_match_v2.subject_type and l.subject_id=factory_match_v2.subject_id and t.kind in ('product_category','fabric') and not l.term_id=any(cert.scope_term_ids))) then
     known:=known+1;
     if wanted=any(required_ids) then failed:=failed||jsonb_build_array('Mandatory certificate is rejected, expired or for another facility'); end if;
   elsif cert.status='verified' and cert.document_id is not null and (cert.non_expiring or cert.expires_at>=end_date) and cert.facility_country=f.country_code and nullif(btrim(cert.facility_name),'') is not null and
     (cert.scope_all_products or not exists(select 1 from public.taxonomy_links l join public.taxonomy_terms t on t.id=l.term_id
       where l.subject_type=factory_match_v2.subject_type and l.subject_id=factory_match_v2.subject_id and t.kind in ('product_category','fabric') and not l.term_id=any(cert.scope_term_ids))) and
     (cert.scope_all_products or cardinality(cert.scope_term_ids)>0) then matched:=matched+1; known:=known+1;
   else missing:=missing||jsonb_build_array('Confirm certificate validity, review and applicable scope');
   end if;
 end loop;
 if n>0 then cert_share:=matched::numeric/n; cert_known:=known::numeric/n; end if;
 weights:=case when has_deadline then array[30,25,15,15,10,5] else array[35,30,20,0,10,5] end;
 shares:=array[product,order_share,development,timeline,region_share,cert_share];
 covers:=array[product_known,order_known,development_known,timeline_known,region_known,cert_known];
 for i in 1..6 loop if applies[i] then total:=total+weights[i]; end if; end loop;
 for i in 1..6 loop
   if applies[i] then
     w:=weights[i]*100.0/nullif(total,0); points:=points+w*shares[i]; coverage:=coverage+w*covers[i];
     factors:=factors||jsonb_build_array(jsonb_build_object('key',factor_names[i],'weight',round(w,2),'share',round(shares[i],4),'points',round(w*shares[i],2),'coverage',round(covers[i]*100,2)));
   end if;
 end loop;
 select coalesce(jsonb_agg(distinct x),'[]') into missing from jsonb_array_elements(missing) x;
 select coalesce(jsonb_agg(distinct x),'[]') into failed from jsonb_array_elements(failed) x;
 status:=case when jsonb_array_length(failed)>0 then 'excluded' when jsonb_array_length(missing)>0 then 'needs_confirmation' else 'qualified' end;
 return jsonb_build_object('version',2,'status',status,'score',round(points,2),'coverage',round(coverage,2),'factors',factors,'missing',missing,'failed',failed,'evidence',evidence,'timeline_estimated',has_deadline,'vendor_kind',f.vendor_kind);
end $$;
revoke all on function public.factory_match_v2(public.taxonomy_subject,uuid,uuid) from public,anon;
grant execute on function public.factory_match_v2(public.taxonomy_subject,uuid,uuid) to authenticated,service_role;

create function public.factory_matches_v2(subject_type public.taxonomy_subject,subject_id uuid,factory_orgs uuid[])
returns table(factory_org_id uuid,assessment jsonb) language plpgsql stable security invoker set search_path=public,pg_temp as $$
begin
 if coalesce(cardinality(factory_orgs),0)>100 then raise exception 'at most 100 factories per batch' using errcode='22023'; end if;
 return query select id,public.factory_match_v2(subject_type,subject_id,id) from (select distinct unnest(factory_orgs) id) ids;
end $$;
revoke all on function public.factory_matches_v2(public.taxonomy_subject,uuid,uuid[]) from public,anon;
grant execute on function public.factory_matches_v2(public.taxonomy_subject,uuid,uuid[]) to authenticated,service_role;

alter function public.match_score_rfq(uuid,uuid) rename to match_score_rfq_legacy;
alter function public.match_score(uuid,uuid,integer,date) rename to match_score_legacy;
create function public.match_score_rfq(rfq_id uuid,factory_org uuid) returns numeric language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m jsonb;
begin
 if not coalesce((select enabled from public.matching_settings where id),false) then return public.match_score_rfq_legacy(rfq_id,factory_org); end if;
 m:=public.factory_match_v2('rfq',rfq_id,factory_org);
 if m->>'status'='excluded' then return null; end if; return (m->>'score')::numeric/100;
end $$;
create function public.match_score(brand_org uuid,factory_org uuid,quantity integer default null,target_month date default null)
returns numeric language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare m jsonb;
begin
 if not coalesce((select enabled from public.matching_settings where id),false) then return public.match_score_legacy(brand_org,factory_org,quantity,target_month); end if;
 m:=public.factory_match_v2('brand_profile',brand_org,factory_org);
 if m->>'status'='excluded' then return null; end if; return (m->>'score')::numeric/100;
end $$;
revoke all on function public.match_score_rfq(uuid,uuid),public.match_score(uuid,uuid,integer,date) from public,anon;
grant execute on function public.match_score_rfq(uuid,uuid),public.match_score(uuid,uuid,integer,date) to authenticated,service_role;

-- Server-enforced acknowledgements survive direct API calls. Fresh assessment on insert.
alter table public.rfq_invitations add column matching_acknowledged boolean not null default false;
create function public.guard_matching_invitation() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare m jsonb;
begin
 if not coalesce((select enabled from public.matching_settings where id),false) then return new; end if;
 m:=public.factory_match_v2('rfq',new.rfq_id,new.factory_org_id);
 if m is null or m->>'status'='excluded' then raise exception 'factory does not qualify for this request' using errcode='22023'; end if;
 if m->>'status'='needs_confirmation' and not new.matching_acknowledged then raise exception 'acknowledge unresolved matching requirements before inviting' using errcode='22023'; end if;
 return new;
end $$;
revoke all on function public.guard_matching_invitation() from public,anon,authenticated;
create trigger matching_invitation_guard before insert or update of rfq_id,factory_org_id,matching_acknowledged on public.rfq_invitations for each row execute function public.guard_matching_invitation();

-- Explicit least-privilege grants, including projects with permissive defaults.
revoke all on public.matching_settings,public.factory_matching_facts,public.matching_requirements,public.factory_capability_evidence,public.matching_evidence_history from anon;
revoke truncate,references,trigger on public.matching_settings,public.factory_matching_facts,public.matching_requirements,public.factory_capability_evidence,public.matching_evidence_history from authenticated;
revoke insert,update,delete on public.matching_settings,public.matching_evidence_history from authenticated;
revoke delete on public.factory_matching_facts,public.matching_requirements from authenticated;
alter type public.document_kind add value if not exists 'capability_evidence';

-- Save one matching section atomically; unrelated taxonomy groups are untouched.
create function public.save_matching_profile(subject_type public.taxonomy_subject,subject_id uuid,selections uuid[],details jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare owner_org uuid; p public.matching_requirements; facts public.factory_matching_facts;
begin
 if subject_type='rfq' then select r.brand_org_id into owner_org from public.rfqs r where r.id=subject_id;
 else owner_org:=subject_id; end if;
 if owner_org is null or not public.is_org_member(owner_org) then raise exception 'only the owning company can edit matching information' using errcode='42501'; end if;
 if cardinality(selections)>200 or exists(select 1 from unnest(selections) id where not exists(select 1 from public.taxonomy_terms t where t.id=id and t.kind in ('product_category','fabric','technique','development_service','certification') and (t.org_id is null or t.org_id=owner_org))) then
   raise exception 'choose valid matching terms' using errcode='22023'; end if;
 if subject_type='factory_profile' and not exists(select 1 from public.factory_profiles f where f.org_id=owner_org) then raise exception 'factory profile required' using errcode='22023'; end if;
 delete from public.taxonomy_links l using public.taxonomy_terms t where l.term_id=t.id and l.subject_type=save_matching_profile.subject_type and l.subject_id=save_matching_profile.subject_id
   and t.kind in ('product_category','fabric','technique','development_service') and not l.term_id=any(coalesce(selections,'{}'));
 insert into public.taxonomy_links(subject_type,subject_id,org_id,term_id)
   select subject_type,subject_id,owner_org,id from (select distinct unnest(selections) id) ids
   where subject_type<>'factory_profile' or exists(select 1 from public.taxonomy_terms t where t.id=ids.id and t.kind<>'certification') on conflict do nothing;
 if subject_type='factory_profile' then
   facts:=jsonb_populate_record(null::public.factory_matching_facts,details);
   insert into public.factory_matching_facts(org_id,moq_per_colour,usual_order_min,usual_order_max) values(owner_org,facts.moq_per_colour,facts.usual_order_min,facts.usual_order_max)
     on conflict(org_id) do update set moq_per_colour=excluded.moq_per_colour,usual_order_min=excluded.usual_order_min,usual_order_max=excluded.usual_order_max;
 else
   -- Certificates are an editable requirement group on the requesting side.
   delete from public.taxonomy_links l using public.taxonomy_terms t where l.term_id=t.id and t.kind='certification' and l.subject_type=save_matching_profile.subject_type and l.subject_id=save_matching_profile.subject_id and not l.term_id=any(coalesce(selections,'{}'));
   p:=jsonb_populate_record(null::public.matching_requirements,details);
   insert into public.matching_requirements(subject_type,subject_id,org_id,required_term_ids,preferred_countries,accepted_countries,location_required,quantity,colour_quantities,sample_deadline,bulk_deadline,bulk_deadline_type,shipping_days,requires_sample)
   values(subject_type,subject_id,owner_org,coalesce(p.required_term_ids,'{}'),coalesce(p.preferred_countries,'{}'),coalesce(p.accepted_countries,'{}'),coalesce(p.location_required,false),p.quantity,coalesce(p.colour_quantities,'{}'),p.sample_deadline,p.bulk_deadline,p.bulk_deadline_type,p.shipping_days,coalesce(p.requires_sample,false))
   on conflict on constraint matching_requirements_pkey do update set required_term_ids=excluded.required_term_ids,preferred_countries=excluded.preferred_countries,accepted_countries=excluded.accepted_countries,location_required=excluded.location_required,quantity=excluded.quantity,colour_quantities=excluded.colour_quantities,sample_deadline=excluded.sample_deadline,bulk_deadline=excluded.bulk_deadline,bulk_deadline_type=excluded.bulk_deadline_type,shipping_days=excluded.shipping_days,requires_sample=excluded.requires_sample;
 end if;
end $$;
revoke all on function public.save_matching_profile(public.taxonomy_subject,uuid,uuid[],jsonb) from public,anon;
grant execute on function public.save_matching_profile(public.taxonomy_subject,uuid,uuid[],jsonb) to authenticated;

create or replace function public.notify_rfq_matches(target_rfq uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          public.rfqs;
  brand_name text;
  told       integer;
begin
  select * into r from public.rfqs where id = target_rfq;
  if not found or r.status <> 'open' or r.visibility <> 'open_to_all' then
    return 0;
  end if;
  select name into brand_name from public.orgs where id = r.brand_org_id;

  with candidates as (
    select f.org_id, public.match_score_rfq(r.id, f.org_id) as score
      from public.factory_profiles f
     where f.verification_status = 'verified'
       and f.published_at is not null
       and f.org_id <> r.brand_org_id
       and public.taxonomy_overlap_share('rfq', r.id, 'factory_profile', f.org_id, 'product_category') > 0
       and not exists (
         select 1 from public.rfq_invitations i
          where i.rfq_id = r.id and i.factory_org_id = f.org_id
       )
  ), best as (
    select org_id from candidates
     where score >= 0.7
       and (not (select enabled from public.matching_settings where id) or public.factory_match_v2('rfq',r.id,org_id)->>'status'='qualified')
     order by score desc, org_id
     limit 20
  ), claimed as (
    insert into public.notification_reminders (kind, subject_id, due_key, org_id)
    select 'rfq_matched', r.id, best.org_id::text, best.org_id from best
    on conflict do nothing
    returning org_id
  )
  insert into public.notifications (org_id, kind, subject_type, subject_id, title, body, data)
  select claimed.org_id, 'rfq_matched', 'rfq', r.id,
         format('New request that matches you: "%s"', coalesce(nullif(btrim(r.title), ''), 'a request')),
         case when r.quote_deadline is not null
              then format('%s is looking for a factory. Quotes close %s.',
                          coalesce(brand_name, 'A brand'), to_char(r.quote_deadline, 'FMMon FMDD'))
              else format('%s is looking for a factory. Open the request to read the brief and send a quote.',
                          coalesce(brand_name, 'A brand'))
         end,
         case when r.quote_deadline is not null
              then jsonb_build_object('quote_deadline', r.quote_deadline)
              else '{}'::jsonb
         end
    from claimed;

  get diagnostics told = row_count;
  return told;
end;
$$;
-- Public match explanations never expose staff notes or reviewer identities.
revoke select on public.factory_capability_evidence from authenticated;
grant select(id,org_id,term_id,document_id,status,reviewed_at,created_at) on public.factory_capability_evidence to authenticated;
create function public.audit_matching_evidence() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' or to_jsonb(new) is distinct from to_jsonb(old) then
   insert into public.matching_evidence_history(org_id,evidence_id,evidence_type,decision,reviewer,note)
   values(new.org_id,new.id,case when tg_table_name='factory_certifications' then 'certificate' else 'capability' end,new.status::text,auth.uid(),case when public.is_platform_admin() then 'Staff evidence update' else 'Claim submitted or updated; affected approval invalidated' end);
 end if;return new;
end $$;
revoke all on function public.audit_matching_evidence() from public,anon,authenticated;
create trigger matching_certificate_audit after insert or update on public.factory_certifications for each row execute function public.audit_matching_evidence();
create trigger matching_capability_audit after insert or update on public.factory_capability_evidence for each row execute function public.audit_matching_evidence();

-- Storage replacement can happen without changing document_id. Invalidate the
-- affected evidence on object writes/deletion, including direct Storage API use.
create function public.invalidate_matching_file() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare file_bucket text; file_path text;
begin
 if tg_table_schema='storage' then file_bucket:=old.bucket_id; file_path:=old.name;
 else file_bucket:=old.bucket; file_path:=old.storage_path; end if;
 if file_bucket='org-private' then
   update public.factory_capability_evidence set status='pending',reviewed_by=null,reviewed_at=null,review_note=null
     where document_id in(select d.id from public.documents d where d.bucket=file_bucket and d.storage_path=file_path);
   update public.factory_certifications set status='pending'
     where document_id in(select d.id from public.documents d where d.bucket=file_bucket and d.storage_path=file_path);
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.invalidate_matching_file() from public,anon,authenticated;
create trigger matching_storage_changed before update or delete on storage.objects for each row execute function public.invalidate_matching_file();
create trigger matching_document_file_changed before update of bucket,storage_path on public.documents for each row
 when(old.bucket is distinct from new.bucket or old.storage_path is distinct from new.storage_path) execute function public.invalidate_matching_file();
