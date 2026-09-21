-- ============================================================================
-- 056  Legal documents: the terms people sign, and the privacy policy
-- ----------------------------------------------------------------------------
-- Until now the terms lived in three places that did not know about each
-- other: the admin console's editor (browser state, gone on refresh), the
-- onboarding screens (hardcoded copy), and a TERMS_VERSION constant bumped by
-- hand. What an admin edited and what a company signed were unrelated, and
-- the signup screen's Terms and Privacy links pointed at nothing.
--
-- One table now holds the text, and every save is a new version. Rows are
-- never updated: terms_acceptances points at the exact row a company signed,
-- and a signature is only evidence if the text it refers to cannot change
-- underneath it.
--
-- Text format is the one the admin editor already parses: blocks separated by
-- a blank line, the first line of each block its heading. The first block of
-- a full document is its title.
--
-- Version 1 is seeded from the copy onboarding showed before this migration,
-- so nothing changes for anyone on the day it ships. NOTE: that copy promises
-- "Escrow payments … we hold the funds", which contradicts the track-only
-- payments decision. It is seeded verbatim and needs correcting through the
-- admin editor; it is not this migration's place to rewrite legal wording.
-- ============================================================================

create table public.legal_documents (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null
                 check (kind in ('terms_brand', 'terms_factory', 'terms_trading', 'privacy')),
  version        integer not null check (version > 0),

  -- The short sections shown on the onboarding terms step. A privacy policy
  -- is never signed, so it has none.
  onboarding_en  text,
  onboarding_zh  text,

  -- The standalone document behind the public link. Chinese is optional and
  -- hand-written; a reader falls back to English when it is blank.
  full_en        text not null check (length(btrim(full_en)) > 0),
  full_zh        text,

  published_by   uuid references auth.users (id) on delete set null,
  published_at   timestamptz not null default now(),

  unique (kind, version),
  check (kind = 'privacy' or length(btrim(coalesce(onboarding_en, ''))) > 0)
);

alter table public.legal_documents enable row level security;

-- Staff can read the history. Everyone else reads only the current version,
-- through current_legal_documents() below. No write grant: publishing is a
-- function, and nothing may edit a published version.
create policy legal_documents_admin_read on public.legal_documents
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.legal_documents to authenticated;

-- ---------------------------------------------------------------------------
-- Publish a new version
-- ---------------------------------------------------------------------------
create or replace function public.publish_legal_document(
  p_kind          text,
  p_onboarding_en text,
  p_onboarding_zh text,
  p_full_en       text,
  p_full_zh       text
)
returns public.legal_documents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  published public.legal_documents;
begin
  -- First, before any select: checking later leaks existence through error
  -- codes, and there is no policy behind a definer function.
  if not public.is_platform_admin() then
    raise exception 'only platform staff can publish legal documents' using errcode = '42501';
  end if;

  if p_kind is null or p_kind not in ('terms_brand', 'terms_factory', 'terms_trading', 'privacy') then
    raise exception 'unknown legal document %', p_kind using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_full_en, ''))) = 0 then
    raise exception 'the full English document is required' using errcode = '23514';
  end if;
  if p_kind <> 'privacy' and length(btrim(coalesce(p_onboarding_en, ''))) = 0 then
    raise exception 'the English onboarding version is required' using errcode = '23514';
  end if;

  -- Two admins saving at once must not both claim the same version number.
  perform pg_advisory_xact_lock(hashtext('legal_documents:' || p_kind));

  insert into public.legal_documents
    (kind, version, onboarding_en, onboarding_zh, full_en, full_zh, published_by)
  select p_kind,
         coalesce(max(version), 0) + 1,
         case when p_kind = 'privacy' then null else p_onboarding_en end,
         case when p_kind = 'privacy' then null else nullif(btrim(coalesce(p_onboarding_zh, '')), '') end,
         p_full_en,
         nullif(btrim(coalesce(p_full_zh, '')), ''),
         auth.uid()
    from public.legal_documents
   where kind = p_kind
  returning * into published;

  return published;
end;
$$;

revoke all on function public.publish_legal_document(text, text, text, text, text) from public;
grant execute on function public.publish_legal_document(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The current version of each document — readable while signed out
-- ---------------------------------------------------------------------------
-- The one deliberate exception to migration 009. The signup screen links to
-- the terms a visitor is agreeing to, before they have an account, so the text
-- must be readable by anon. It goes through this function rather than a table
-- grant so that the table itself stays unreadable (and who published what
-- stays with staff). Legal text is public by definition; nothing else is.
create or replace function public.current_legal_documents()
returns table (
  id            uuid,
  kind          text,
  version       integer,
  onboarding_en text,
  onboarding_zh text,
  full_en       text,
  full_zh       text,
  published_at  timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct on (d.kind)
         d.id, d.kind, d.version, d.onboarding_en, d.onboarding_zh,
         d.full_en, d.full_zh, d.published_at
    from public.legal_documents d
   order by d.kind, d.version desc;
$$;

revoke all on function public.current_legal_documents() from public;
-- Written out explicitly: 009's default privileges revoke every new function
-- from anon, which is exactly why this grant has to be a visible decision.
grant execute on function public.current_legal_documents() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- A signature points at the exact text signed
-- ---------------------------------------------------------------------------
-- Null for rows signed before this migration, whose terms_version string is
-- all the record there is. terms_version keeps being written ("terms_brand
-- v1") because the admin review screen displays it.
alter table public.terms_acceptances
  add column legal_document_id uuid references public.legal_documents (id) on delete restrict;

create or replace function public.is_signable_legal_document(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.legal_documents where id = target and kind <> 'privacy'
  );
$$;

revoke all on function public.is_signable_legal_document(uuid) from public;
grant execute on function public.is_signable_legal_document(uuid) to authenticated;

drop policy terms_acceptances_insert on public.terms_acceptances;

create policy terms_acceptances_insert on public.terms_acceptances
  for insert to authenticated
  with check (
    public.is_org_member(org_id)
    and accepted_by = auth.uid()
    -- A privacy policy is not something anyone signs. The lookup is a definer
    -- function because the table is unreadable to the signer.
    and (legal_document_id is null or public.is_signable_legal_document(legal_document_id))
  );

-- ---------------------------------------------------------------------------
-- Seed: version 1 of every document
-- ---------------------------------------------------------------------------
insert into public.legal_documents
  (kind, version, onboarding_en, onboarding_zh, full_en, published_by)
values
  ('terms_brand', 1,
   $legal$Accurate information
Provide accurate, current brand, project, and contact information. Any registration or resale documents you submit must be genuine; accounts that cannot be verified may be paused.

Confidentiality
Only share content you are authorized to use. Keep vendor quotes, pricing, messages, and private project details confidential.

Escrow payments
Orders are agreements between you and the vendor. You fund agreed milestones through The Sourcing Club escrow; we hold the funds until the milestone is approved or a dispute is resolved, then release them to the vendor. We do not manufacture goods or guarantee quality or timing.

Messages and translation
Platform conversations are stored as a shared record and may be machine-translated. Translations are provided for convenience; the original message remains the authoritative version.

Your account
You are responsible for activity under your account and for invited team members. We may restrict accounts used for misleading, unlawful, or abusive activity, and material updates to these terms may require you to accept them again.$legal$,
   null,
   $legal$The Sourcing Club Brand Terms and Conditions
Effective August 12, 2026

1. Acceptance of Terms
These Terms and Conditions govern your access to and use of The Sourcing Club marketplace. By creating an account, signing electronically, or continuing to use the platform, you agree to these terms and confirm that you are authorized to act for the company connected to your account.

2. Account Eligibility and Authority
You must provide complete and accurate registration information, maintain a valid business identity, and ensure that every person using the account has appropriate authority. You are responsible for account credentials and all activity completed through your account.

3. Platform Usage
Use The Sourcing Club to share accurate brand information, submit real sourcing needs, and communicate with vendors in good faith.

4. Profile and Verification Information
You must keep company, contact, verification, and operational information current. The Sourcing Club may request supporting evidence, review submitted information, and identify whether verification is complete, pending, or requires additional review.

5. Data Privacy and Confidentiality
Only upload assets, product references, and company documents you are allowed to share. Vendor quotes, pricing, and private project details should remain confidential.

6. Brand Responsibilities
Keep your profile, project briefs, payment status, and decision-maker details accurate so vendors can quote and plan production confidently.

7. Marketplace Communications and Transactions
Users must communicate professionally and provide commercially accurate information. Quotes, requests, specifications, samples, production orders, approvals, and other marketplace records may form part of agreements between participating businesses. Each party is responsible for reviewing and accepting its own commercial obligations.

8. Fees, Credits, and Payments
Applicable platform fees, quotation credits, payment schedules, deposits, and transaction charges will be shown before confirmation. Users are responsible for authorized charges, accurate billing information, and any taxes or duties that apply to their activity.

9. Prohibited Conduct
You may not submit false or misleading information, misuse confidential materials, infringe intellectual property rights, circumvent platform safeguards, interfere with marketplace operation, or use the service for unlawful, abusive, or fraudulent activity.

10. Suspension and Termination
The Sourcing Club may restrict, suspend, or terminate access when these terms are breached, required verification is not completed, marketplace activity creates material risk, or continued access could harm users or the platform. Where appropriate, users may be given notice and an opportunity to correct the issue.

11. Platform Role and Disclaimers
The Sourcing Club provides marketplace, communication, verification-support, and workflow tools. Unless expressly stated otherwise, it is not a party to manufacturing, sourcing, supply, shipping, or payment agreements between users and does not guarantee commercial performance or product outcomes.

12. Limitation of Liability
To the fullest extent permitted by applicable law, The Sourcing Club will not be liable for indirect, incidental, special, or consequential losses arising from marketplace transactions, third-party conduct, production delays, or reliance on user-submitted information.

13. Changes to These Terms
The Sourcing Club may update these terms to reflect legal, operational, or product changes. The effective date will be updated when a revised version is published, and material changes may require renewed acceptance.

14. Contact
Questions about these terms may be directed to The Sourcing Club operations team through the support channels provided in your account.$legal$,
   null),
  ('terms_factory', 1,
   $legal$Accurate information
Keep your factory profile, capacity, certifications, and contact details accurate and current. Verification documents must be genuine; accounts that cannot be verified may be paused.

Confidentiality
Only share content you are authorized to use. Keep brand enquiries, tech packs, pricing, messages, and private project details confidential.

Production commitments
Quotes, lead times, quality requirements, and production commitments must reflect what your factory can realistically deliver. An awarded quote becomes a production order between you and the brand.

Escrow payments
The brand funds agreed milestones through The Sourcing Club escrow. We hold the funds until a milestone is approved or a dispute is resolved, then release them to you.

Your account
You are responsible for activity under your account and for invited team members. Platform messages are stored as a shared record and may be machine-translated; the original message remains authoritative.$legal$,
   $legal$准确信息
请保持工厂资料、产能、认证和联系方式真实且最新。验证文件必须真实有效；无法通过验证的账户可能被暂停。

保密
只分享你有权使用的内容。对品牌询盘、技术包、价格、消息和私密项目资料保密。

生产承诺
报价、交期、质量要求和生产承诺必须符合工厂的实际交付能力。获选的报价将成为你与品牌之间的生产订单。

托管付款
品牌通过 The Sourcing Club 托管为约定的里程碑提供资金。我们持有资金，直至里程碑获得批准或争议解决，然后将资金释放给你。

你的账户
你需对账户活动和受邀团队成员负责。平台消息会作为双方共享记录保存，并可能进行机器翻译；以原文为准。$legal$,
   $legal$The Sourcing Club Factory Terms and Conditions
Effective August 12, 2026

1. Acceptance of Terms
These Terms and Conditions govern your access to and use of The Sourcing Club marketplace. By creating an account, signing electronically, or continuing to use the platform, you agree to these terms and confirm that you are authorized to act for the company connected to your account.

2. Account Eligibility and Authority
You must provide complete and accurate registration information, maintain a valid business identity, and ensure that every person using the account has appropriate authority. You are responsible for account credentials and all activity completed through your account.

3. Platform Usage
Use The Sourcing Club to share accurate factory information, respond to brand enquiries professionally, and keep communication related to sourcing opportunities.

4. Profile and Verification Information
You must keep company, contact, verification, and operational information current. The Sourcing Club may request supporting evidence, review submitted information, and identify whether verification is complete, pending, or requires additional review.

5. Data Privacy and Confidentiality
Only upload documents and media you are allowed to share. Brand enquiries, tech packs, pricing, and project details should be kept confidential unless both sides agree otherwise.

6. Factory Responsibilities
Keep your profile, capacity, certifications, and contact details up to date. Quotes, lead times, and production commitments should reflect what your factory can realistically deliver.

7. Marketplace Communications and Transactions
Users must communicate professionally and provide commercially accurate information. Quotes, requests, specifications, samples, production orders, approvals, and other marketplace records may form part of agreements between participating businesses. Each party is responsible for reviewing and accepting its own commercial obligations.

8. Fees, Credits, and Payments
Applicable platform fees, quotation credits, payment schedules, deposits, and transaction charges will be shown before confirmation. Users are responsible for authorized charges, accurate billing information, and any taxes or duties that apply to their activity.

9. Prohibited Conduct
You may not submit false or misleading information, misuse confidential materials, infringe intellectual property rights, circumvent platform safeguards, interfere with marketplace operation, or use the service for unlawful, abusive, or fraudulent activity.

10. Suspension and Termination
The Sourcing Club may restrict, suspend, or terminate access when these terms are breached, required verification is not completed, marketplace activity creates material risk, or continued access could harm users or the platform. Where appropriate, users may be given notice and an opportunity to correct the issue.

11. Platform Role and Disclaimers
The Sourcing Club provides marketplace, communication, verification-support, and workflow tools. Unless expressly stated otherwise, it is not a party to manufacturing, sourcing, supply, shipping, or payment agreements between users and does not guarantee commercial performance or product outcomes.

12. Limitation of Liability
To the fullest extent permitted by applicable law, The Sourcing Club will not be liable for indirect, incidental, special, or consequential losses arising from marketplace transactions, third-party conduct, production delays, or reliance on user-submitted information.

13. Changes to These Terms
The Sourcing Club may update these terms to reflect legal, operational, or product changes. The effective date will be updated when a revised version is published, and material changes may require renewed acceptance.

14. Contact
Questions about these terms may be directed to The Sourcing Club operations team through the support channels provided in your account.$legal$,
   null),
  ('terms_trading', 1,
   $legal$Accurate information
Clearly identify your role and keep your company, supplier-network, certifications, and contact information accurate. Verification documents must be genuine; accounts that cannot be verified may be paused.

Confidentiality
Only share content you are authorized to use. Keep brand enquiries, tech packs, pricing, supplier details, messages, and private project information confidential.

Production commitments
Quotes, lead times, quality requirements, and production commitments must reflect what your partner network can realistically deliver. An awarded quote becomes a production order between you and the brand.

Escrow payments
The brand funds agreed milestones through The Sourcing Club escrow. We hold the funds until a milestone is approved or a dispute is resolved, then release them to you.

Your account
You are responsible for activity under your account and for invited team members. Platform messages are stored as a shared record and may be machine-translated; the original message remains authoritative.$legal$,
   $legal$准确信息
请清楚说明你的角色，并保持公司、供应商网络、认证和联系信息真实且最新。验证文件必须真实有效；无法通过验证的账户可能被暂停。

保密
只分享你有权使用的内容。对品牌询盘、技术包、价格、供应商资料、消息和私密项目信息保密。

生产承诺
报价、交期、质量要求和生产承诺必须符合合作供应商网络的实际交付能力。获选的报价将成为你与品牌之间的生产订单。

托管付款
品牌通过 The Sourcing Club 托管为约定的里程碑提供资金。我们持有资金，直至里程碑获得批准或争议解决，然后将资金释放给你。

你的账户
你需对账户活动和受邀团队成员负责。平台消息会作为双方共享记录保存，并可能进行机器翻译；以原文为准。$legal$,
   $legal$The Sourcing Club Trading Company Terms and Conditions
Effective August 12, 2026

1. Acceptance of Terms
These Terms and Conditions govern your access to and use of The Sourcing Club marketplace. By creating an account, signing electronically, or continuing to use the platform, you agree to these terms and confirm that you are authorized to act for the company connected to your account.

2. Account Eligibility and Authority
You must provide complete and accurate registration information, maintain a valid business identity, and ensure that every person using the account has appropriate authority. You are responsible for account credentials and all activity completed through your account.

3. Platform Usage
Share accurate company, sourcing-network, and production information, and communicate with brands in good faith.

4. Profile and Verification Information
You must keep company, contact, verification, and operational information current. The Sourcing Club may request supporting evidence, review submitted information, and identify whether verification is complete, pending, or requires additional review.

5. Data Privacy and Confidentiality
Only upload documents and media you are allowed to share. Keep brand enquiries, tech packs, pricing, and supplier details confidential.

6. Trading Company Responsibilities
Disclose your role clearly, keep partner-factory information current, and ensure quotes and production commitments reflect what your network can deliver.

7. Marketplace Communications and Transactions
Users must communicate professionally and provide commercially accurate information. Quotes, requests, specifications, samples, production orders, approvals, and other marketplace records may form part of agreements between participating businesses. Each party is responsible for reviewing and accepting its own commercial obligations.

8. Fees, Credits, and Payments
Applicable platform fees, quotation credits, payment schedules, deposits, and transaction charges will be shown before confirmation. Users are responsible for authorized charges, accurate billing information, and any taxes or duties that apply to their activity.

9. Prohibited Conduct
You may not submit false or misleading information, misuse confidential materials, infringe intellectual property rights, circumvent platform safeguards, interfere with marketplace operation, or use the service for unlawful, abusive, or fraudulent activity.

10. Suspension and Termination
The Sourcing Club may restrict, suspend, or terminate access when these terms are breached, required verification is not completed, marketplace activity creates material risk, or continued access could harm users or the platform. Where appropriate, users may be given notice and an opportunity to correct the issue.

11. Platform Role and Disclaimers
The Sourcing Club provides marketplace, communication, verification-support, and workflow tools. Unless expressly stated otherwise, it is not a party to manufacturing, sourcing, supply, shipping, or payment agreements between users and does not guarantee commercial performance or product outcomes.

12. Limitation of Liability
To the fullest extent permitted by applicable law, The Sourcing Club will not be liable for indirect, incidental, special, or consequential losses arising from marketplace transactions, third-party conduct, production delays, or reliance on user-submitted information.

13. Changes to These Terms
The Sourcing Club may update these terms to reflect legal, operational, or product changes. The effective date will be updated when a revised version is published, and material changes may require renewed acceptance.

14. Contact
Questions about these terms may be directed to The Sourcing Club operations team through the support channels provided in your account.$legal$,
   null),
  ('privacy', 1,
   null,
   null,
   $legal$The Sourcing Club Privacy Policy
Placeholder — not yet published

This policy has not been published yet
The Sourcing Club has not yet published its Privacy Policy. This placeholder will be replaced by the published policy. Until then, questions about how your information is handled may be directed to The Sourcing Club operations team through the support channels provided in your account.$legal$,
   null);
