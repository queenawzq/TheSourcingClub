-- Seed data for local resets and PR preview databases.
--
-- Shared reference data is installed by the checked-in migrations, including
-- 20260901000700_taxonomy_seed.sql. This file runs after the migrations on
-- `supabase db reset` and when Supabase creates a preview branch for a PR. It
-- never runs on production: `supabase db push` does not read it.
--
-- Two demo logins, so a PR preview can be tried without signing up first:
--
--   demo-brand@example.com    / demo password 8   (brand, onboarded, verified)
--   demo-factory@example.com  / demo password 8   (factory, onboarded, verified,
--                                                   published, 500 credits)
--
-- The password is the one scripts/seed-demo.mjs already uses. These accounts
-- exist only on local stacks and preview branches.

do $$
declare
  brand_user constant uuid := '5eed0000-0000-4000-8000-00000000b001';
  factory_user constant uuid := '5eed0000-0000-4000-8000-00000000f001';
  brand_org uuid;
  factory_org uuid;
  login record;
begin
  for login in
    select * from (values
      (brand_user, 'demo-brand@example.com', 'Demo Brand'),
      (factory_user, 'demo-factory@example.com', 'Demo Factory')
    ) as l(id, email, name)
  loop
    -- The token columns must be '' rather than null, or Auth fails to load
    -- the user at sign-in.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', login.id, 'authenticated', 'authenticated',
      login.email, extensions.crypt('demo password 8', extensions.gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('name', login.name),
      now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (
      id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), login.id, login.id::text, 'email',
      jsonb_build_object('sub', login.id::text, 'email', login.email, 'email_verified', true),
      now(), now(), now()
    );
  end loop;

  -- Orgs come from create_org(), as each user, so the owner membership is
  -- made exactly the way the app makes it.
  perform set_config('request.jwt.claims', json_build_object('sub', brand_user, 'role', 'authenticated')::text, true);
  select id into brand_org from public.create_org('Demo Brand', 'brand');
  perform set_config('request.jwt.claims', json_build_object('sub', factory_user, 'role', 'authenticated')::text, true);
  select id into factory_org from public.create_org('Demo Factory', 'factory');
  perform set_config('request.jwt.claims', '', true);

  -- Onboarded and verified, so both land on the dashboard rather than the
  -- onboarding flow or the "in review" card. Same values as seed-demo.mjs.
  insert into public.brand_profiles (org_id, hq_location, onboarding_completed_at, verification_status)
  values (brand_org, 'London, UK', now(), 'verified')
  on conflict (org_id) do update set
    hq_location = excluded.hq_location,
    onboarding_completed_at = excluded.onboarding_completed_at,
    verification_status = excluded.verification_status;

  insert into public.factory_profiles (
    org_id, country_code, location, moq, typical_lead_days, intro,
    onboarding_completed_at, verification_status, published_at
  ) values (
    factory_org, 'PT', 'Porto, Portugal', 150, 28, 'Woven shirting and light outerwear, small runs.',
    now(), 'verified', now()
  )
  on conflict (org_id) do update set
    country_code = excluded.country_code,
    location = excluded.location,
    moq = excluded.moq,
    typical_lead_days = excluded.typical_lead_days,
    intro = excluded.intro,
    onboarding_completed_at = excluded.onboarding_completed_at,
    verification_status = excluded.verification_status,
    published_at = excluded.published_at;

  -- Sending a quote costs credits, so the factory starts with the grant a
  -- verified vendor gets.
  insert into public.credit_ledger (org_id, delta, reason, note)
  values (factory_org, 500, 'onboarding_grant', 'demo seed');
end;
$$;
