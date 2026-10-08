-- ============================================================================
-- A factory profile's files: names, descriptions and walkthrough videos
-- ----------------------------------------------------------------------------
-- Fifteenth suite, `pgtap15-` prefixed, every assertion scoped to its fixtures.
--
-- The new `title` and `caption` on documents ride on the existing policies:
-- the owning company writes them, anyone who may read the row reads them.
-- What matters is that nobody else can write them, and that the public
-- bucket now admits the walkthrough videos the profile shows.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email) values
  ('c1500000-0000-0000-0000-000000000001', 'p15-factory@example.com'),
  ('c1500000-0000-0000-0000-000000000002', 'p15-other@example.com'),
  ('c1500000-0000-0000-0000-000000000003', 'p15-brand@example.com');

insert into public.orgs (id, type, name, slug) values
  ('d1500000-0000-0000-0000-0000000000f1', 'factory', 'P15 Factory', 'pgtap15-factory'),
  ('d1500000-0000-0000-0000-0000000000f2', 'factory', 'P15 Other',   'pgtap15-other'),
  ('d1500000-0000-0000-0000-00000000000b', 'brand',   'P15 Brand',   'pgtap15-brand');

insert into public.org_members (org_id, user_id, role) values
  ('d1500000-0000-0000-0000-0000000000f1', 'c1500000-0000-0000-0000-000000000001', 'owner'),
  ('d1500000-0000-0000-0000-0000000000f2', 'c1500000-0000-0000-0000-000000000002', 'owner'),
  ('d1500000-0000-0000-0000-00000000000b', 'c1500000-0000-0000-0000-000000000003', 'owner');

-- Published, so brands may see its public images.
insert into public.factory_profiles (org_id, country_code, moq, published_at) values
  ('d1500000-0000-0000-0000-0000000000f1', 'PT', 100, now());

insert into public.documents (id, org_id, kind, bucket, storage_path, file_name) values
  ('a1500000-0000-0000-0000-000000000001', 'd1500000-0000-0000-0000-0000000000f1', 'product_image', 'org-public',
   'd1500000-0000-0000-0000-0000000000f1/product_image/p15-shirt.jpg', 'p15-shirt.jpg');

-- ---------------------------------------------------------------------------
-- The owner names its own image
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"c1500000-0000-0000-0000-000000000001","email":"p15-factory@example.com","role":"authenticated"}';
set local role authenticated;

with renamed as (
  update public.documents set title = 'Poplin fit sample', caption = 'Wovens · fit sample'
   where id = 'a1500000-0000-0000-0000-000000000001'
  returning id
)
select is((select count(*)::int from renamed), 1, 'the factory names and describes its own image');

select throws_ok(
  $$ update public.documents set title = repeat('x', 121) where id = 'a1500000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a name longer than 120 characters is refused'
);

select throws_ok(
  $$ update public.documents set caption = repeat('x', 241) where id = 'a1500000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a description longer than 240 characters is refused'
);

-- ---------------------------------------------------------------------------
-- Another factory cannot rename it
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c1500000-0000-0000-0000-000000000002","email":"p15-other@example.com","role":"authenticated"}';
set local role authenticated;

with renamed as (
  update public.documents set title = 'Planted', caption = 'Planted'
   where id = 'a1500000-0000-0000-0000-000000000001'
  returning id
)
select is((select count(*)::int from renamed), 0, 'another factory cannot rename it');

-- ---------------------------------------------------------------------------
-- A brand reads what the factory wrote
-- ---------------------------------------------------------------------------

reset role;
set local request.jwt.claims = '{"sub":"c1500000-0000-0000-0000-000000000003","email":"p15-brand@example.com","role":"authenticated"}';
set local role authenticated;

select is(
  (select title from public.documents where id = 'a1500000-0000-0000-0000-000000000001'),
  'Poplin fit sample',
  'a brand reads the name the factory gave it'
);
select is(
  (select caption from public.documents where id = 'a1500000-0000-0000-0000-000000000001'),
  'Wovens · fit sample',
  'and its description, not the other factory''s'
);

with renamed as (
  update public.documents set title = 'Brand edit'
   where id = 'a1500000-0000-0000-0000-000000000001'
  returning id
)
select is((select count(*)::int from renamed), 0, 'a brand cannot rename it either');

-- ---------------------------------------------------------------------------
-- The public bucket takes walkthrough videos
-- ---------------------------------------------------------------------------

reset role;

select ok(
  (select allowed_mime_types @> array['video/mp4', 'video/quicktime', 'image/jpeg', 'image/png']
     from storage.buckets where id = 'org-public'),
  'the public bucket admits MP4 and QuickTime videos, and still its images'
);
select ok(
  (select file_size_limit >= 52428800 from storage.buckets where id = 'org-public'),
  'and files up to 50 MB'
);

select * from finish();
rollback;
