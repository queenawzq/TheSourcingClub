-- ============================================================================
-- 057  Legal documents: the terms people sign, and the privacy policy
-- ----------------------------------------------------------------------------
-- The signup screen's Terms and Privacy links pointed at nothing, and a
-- signature recorded only a TERMS_VERSION string bumped by hand, with the
-- text it referred to living in JavaScript that changes every deploy.
--
-- One table now holds the text. Rows are never updated: terms_acceptances
-- points at the exact row a company signed, and a signature is only evidence
-- if the text it refers to cannot change underneath it. New wording is a new
-- row with the next version, added by a later migration. There is no editor:
-- the admin design dropped it, so nothing but a migration writes here.
--
-- Text format: blocks separated by a blank line, the first line of each block
-- its heading. The first block of a full document is its title.
--
-- Version 1 of each terms document is the copy the designs show today: the
-- onboarding summaries from the onboarding cards, and the full agreements from
-- the Terms dialog (src/shared/TermsDialog.jsx). NOTE: the onboarding summaries
-- promise "Escrow payments … we hold the funds", which contradicts the
-- track-only payments decision. They are seeded verbatim; correcting legal
-- wording is not this migration's call, and a v2 is how it gets fixed.
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

  published_at   timestamptz not null default now(),

  unique (kind, version),
  check (kind = 'privacy' or length(btrim(coalesce(onboarding_en, ''))) > 0)
);

alter table public.legal_documents enable row level security;

-- Staff can read the history. Everyone else reads only the current version,
-- through current_legal_documents() below. No write grant to anyone: nothing
-- may edit a published version.
create policy legal_documents_admin_read on public.legal_documents
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.legal_documents to authenticated;

-- ---------------------------------------------------------------------------
-- The current version of each document — readable while signed out
-- ---------------------------------------------------------------------------
-- The one deliberate exception to migration 009. The signup screen links to
-- the terms a visitor is agreeing to, before they have an account, so the text
-- must be readable by anon. It goes through this function rather than a table
-- grant so that the table itself stays unreadable (and the version history
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
-- Factory and trading companies read the same vendor agreement, as the Terms
-- dialog shows them; they remain separate kinds so either can change alone.
insert into public.legal_documents
  (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
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
   $legal$The Sourcing Club Brand Agreement
Effective September 18, 2026

1. Acceptance of Terms
These Terms and Conditions govern your access to and use of The Sourcing Club marketplace. By creating an account, signing electronically, or continuing to use the platform, you agree to these terms and confirm that you are authorized to act for the company connected to your account.

2. Account Eligibility and Authority
You must provide complete and accurate registration information, maintain a valid business identity, and ensure that every person using the account has appropriate authority. You are responsible for account credentials and all activity completed through your account.

3. Platform Usage
Use The Sourcing Club to create accurate sourcing briefs, discover and communicate with vendors, compare quotes, manage approvals, and coordinate legitimate sourcing opportunities.

4. Profile and Verification Information
You must keep company, contact, verification, and operational information current. The Sourcing Club may request supporting evidence, review submitted information, and identify whether verification is complete, pending, or requires additional review.

5. Data Privacy and Confidentiality
Only upload documents and media you are authorized to share. Vendor profiles, quotes, private messages, samples, technical files, pricing, and project details must be kept confidential unless the relevant parties agree otherwise.

6. Brand Responsibilities
Provide accurate product specifications, quantities, target dates, approval feedback, and payment information. Awards, approvals, and production commitments must reflect decisions your company is authorized and prepared to honour.

7. Marketplace Communications and Transactions
Users must communicate professionally and provide commercially accurate information. Requests, quotes, specifications, samples, production orders, approvals, and other marketplace records may form part of agreements between participating businesses. Each party is responsible for reviewing and accepting its own commercial obligations.

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
   $legal$The Sourcing Club Vendor Agreement
Effective September 18, 2026

1. Acceptance of Terms
These Terms and Conditions govern your access to and use of The Sourcing Club marketplace. By creating an account, signing electronically, or continuing to use the platform, you agree to these terms and confirm that you are authorized to act for the company connected to your account.

2. Account Eligibility and Authority
You must provide complete and accurate registration information, maintain a valid business identity, and ensure that every person using the account has appropriate authority. You are responsible for account credentials and all activity completed through your account.

3. Platform Usage
Use The Sourcing Club to share accurate factory or trading-company information, respond to brand enquiries professionally, submit quotes, and communicate about legitimate sourcing opportunities.

4. Profile and Verification Information
You must keep company, contact, verification, and operational information current. The Sourcing Club may request supporting evidence, review submitted information, and identify whether verification is complete, pending, or requires additional review.

5. Data Privacy and Confidentiality
Only upload documents and media you are authorized to share. Brand enquiries, tech packs, product designs, pricing, private messages, and project details must be kept confidential unless the relevant parties agree otherwise.

6. Vendor Responsibilities
Keep your profile, capacity, certifications, contacts, quotes, lead times, quality requirements, and production commitments accurate and current. Only accept work your business can realistically deliver.

7. Marketplace Communications and Transactions
Users must communicate professionally and provide commercially accurate information. Requests, quotes, specifications, samples, production orders, approvals, and other marketplace records may form part of agreements between participating businesses. Each party is responsible for reviewing and accepting its own commercial obligations.

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
   $legal$The Sourcing Club 供应商协议
生效日期：2026 年 9 月 18 日

1. 接受条款
本条款与条件适用于您访问及使用 The Sourcing Club 平台。创建账户、进行电子签名或继续使用平台，即表示您同意本条款，并确认您有权代表与账户关联的公司行事。

2. 账户资格与授权
您必须提供完整、准确的注册信息，维持有效的企业身份，并确保每位账户使用者均获得适当授权。您须对账户凭证及通过账户完成的所有活动负责。

3. 平台使用
请使用 The Sourcing Club 准确展示工厂或贸易公司的信息，专业回复品牌询盘、提交报价，并就真实的采购机会进行沟通。

4. 资料与验证信息
您必须及时更新公司、联系人、验证及运营信息。The Sourcing Club 可要求提供证明材料、审核已提交的信息，并标明验证状态为已完成、处理中或需要进一步审核。

5. 数据隐私与保密
仅上传您获准分享的文件和媒体。除非相关各方另有约定，品牌询盘、技术包、产品设计、定价、私人消息及项目详情均须保密。

6. 供应商责任
请确保您的资料、产能、认证、联系人、报价、交期、质量要求及生产承诺准确且最新。仅接受您的企业能够切实交付的工作。

7. 平台沟通与交易
用户须进行专业沟通并提供准确的商业信息。需求、报价、规格、样品、生产订单、审批及其他平台记录可能构成参与企业之间协议的一部分。各方须自行审阅并接受其商业义务。

8. 费用、额度与付款
适用的平台费用、报价额度、付款计划、定金及交易费用会在确认前显示。用户须对已授权费用、准确的账单信息以及适用的税费或关税负责。

9. 禁止行为
您不得提交虚假或误导性信息、滥用保密材料、侵犯知识产权、规避平台保障措施、干扰平台运行，或将服务用于违法、滥用或欺诈活动。

10. 暂停与终止
如违反本条款、未完成必要验证、平台活动造成重大风险，或继续访问可能损害用户或平台，The Sourcing Club 可限制、暂停或终止访问。在适当情况下，用户可能会收到通知并有机会纠正问题。

11. 平台角色与免责声明
The Sourcing Club 提供撮合、沟通、验证支持及工作流程工具。除非明确说明，平台并非用户之间制造、采购、供货、运输或付款协议的当事方，也不保证商业履约或产品结果。

12. 责任限制
在适用法律允许的最大范围内，The Sourcing Club 不对因平台交易、第三方行为、生产延误或依赖用户提交信息而产生的间接、附带、特殊或后果性损失承担责任。

13. 条款变更
The Sourcing Club 可为反映法律、运营或产品变化而更新本条款。发布修订版本时将更新生效日期，重大变更可能要求您重新确认同意。

14. 联系我们
如对本条款有疑问，请通过账户中提供的支持渠道联系 The Sourcing Club 运营团队。$legal$),
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
   $legal$The Sourcing Club Vendor Agreement
Effective September 18, 2026

1. Acceptance of Terms
These Terms and Conditions govern your access to and use of The Sourcing Club marketplace. By creating an account, signing electronically, or continuing to use the platform, you agree to these terms and confirm that you are authorized to act for the company connected to your account.

2. Account Eligibility and Authority
You must provide complete and accurate registration information, maintain a valid business identity, and ensure that every person using the account has appropriate authority. You are responsible for account credentials and all activity completed through your account.

3. Platform Usage
Use The Sourcing Club to share accurate factory or trading-company information, respond to brand enquiries professionally, submit quotes, and communicate about legitimate sourcing opportunities.

4. Profile and Verification Information
You must keep company, contact, verification, and operational information current. The Sourcing Club may request supporting evidence, review submitted information, and identify whether verification is complete, pending, or requires additional review.

5. Data Privacy and Confidentiality
Only upload documents and media you are authorized to share. Brand enquiries, tech packs, product designs, pricing, private messages, and project details must be kept confidential unless the relevant parties agree otherwise.

6. Vendor Responsibilities
Keep your profile, capacity, certifications, contacts, quotes, lead times, quality requirements, and production commitments accurate and current. Only accept work your business can realistically deliver.

7. Marketplace Communications and Transactions
Users must communicate professionally and provide commercially accurate information. Requests, quotes, specifications, samples, production orders, approvals, and other marketplace records may form part of agreements between participating businesses. Each party is responsible for reviewing and accepting its own commercial obligations.

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
   $legal$The Sourcing Club 供应商协议
生效日期：2026 年 9 月 18 日

1. 接受条款
本条款与条件适用于您访问及使用 The Sourcing Club 平台。创建账户、进行电子签名或继续使用平台，即表示您同意本条款，并确认您有权代表与账户关联的公司行事。

2. 账户资格与授权
您必须提供完整、准确的注册信息，维持有效的企业身份，并确保每位账户使用者均获得适当授权。您须对账户凭证及通过账户完成的所有活动负责。

3. 平台使用
请使用 The Sourcing Club 准确展示工厂或贸易公司的信息，专业回复品牌询盘、提交报价，并就真实的采购机会进行沟通。

4. 资料与验证信息
您必须及时更新公司、联系人、验证及运营信息。The Sourcing Club 可要求提供证明材料、审核已提交的信息，并标明验证状态为已完成、处理中或需要进一步审核。

5. 数据隐私与保密
仅上传您获准分享的文件和媒体。除非相关各方另有约定，品牌询盘、技术包、产品设计、定价、私人消息及项目详情均须保密。

6. 供应商责任
请确保您的资料、产能、认证、联系人、报价、交期、质量要求及生产承诺准确且最新。仅接受您的企业能够切实交付的工作。

7. 平台沟通与交易
用户须进行专业沟通并提供准确的商业信息。需求、报价、规格、样品、生产订单、审批及其他平台记录可能构成参与企业之间协议的一部分。各方须自行审阅并接受其商业义务。

8. 费用、额度与付款
适用的平台费用、报价额度、付款计划、定金及交易费用会在确认前显示。用户须对已授权费用、准确的账单信息以及适用的税费或关税负责。

9. 禁止行为
您不得提交虚假或误导性信息、滥用保密材料、侵犯知识产权、规避平台保障措施、干扰平台运行，或将服务用于违法、滥用或欺诈活动。

10. 暂停与终止
如违反本条款、未完成必要验证、平台活动造成重大风险，或继续访问可能损害用户或平台，The Sourcing Club 可限制、暂停或终止访问。在适当情况下，用户可能会收到通知并有机会纠正问题。

11. 平台角色与免责声明
The Sourcing Club 提供撮合、沟通、验证支持及工作流程工具。除非明确说明，平台并非用户之间制造、采购、供货、运输或付款协议的当事方，也不保证商业履约或产品结果。

12. 责任限制
在适用法律允许的最大范围内，The Sourcing Club 不对因平台交易、第三方行为、生产延误或依赖用户提交信息而产生的间接、附带、特殊或后果性损失承担责任。

13. 条款变更
The Sourcing Club 可为反映法律、运营或产品变化而更新本条款。发布修订版本时将更新生效日期，重大变更可能要求您重新确认同意。

14. 联系我们
如对本条款有疑问，请通过账户中提供的支持渠道联系 The Sourcing Club 运营团队。$legal$),
  ('privacy', 1,
   null,
   null,
   $legal$The Sourcing Club Privacy Policy
Effective September 21, 2026

1. Who we are
The Sourcing Club operates a marketplace that connects brands with factories and trading companies. This policy explains what information we collect when you use the platform, why we collect it, who processes it on our behalf, and the choices you have.

2. Information you give us
When you create an account we collect your name, work email address, password (stored only in hashed form by our authentication provider) and your company's name. During onboarding and while using the platform you may also provide company details, locations, capacity, certifications, product categories, sourcing requests, quotes, pricing, production schedules, messages, and files such as logos, product images, business registrations, certificates, walkthrough videos and milestone photos. Your electronic signature on our terms is recorded with the date, the signer and the exact version of the terms signed.

3. Information collected automatically
We keep you signed in using storage in your browser, and remember preferences such as your display language there. We record technical error reports from the app so that we can fix problems. We do not use advertising or analytics trackers.

4. How we use information
We use your information to provide the marketplace: to create and secure your account, verify your company, show your profile and requests to the parties you work with, match brands with suitable vendors, deliver messages, keep a record of quotes, orders, milestones and payments, and send you service emails such as password resets, onboarding confirmations and verification decisions. Our staff review submitted verification documents by hand.

5. Who can see your information
Your published company profile is visible to other signed-in members of the marketplace. Requests, quotes, orders, messages and their attachments are visible only to the companies taking part in them, and to The Sourcing Club staff who operate and support the platform. Business registrations and certificates are stored privately and are opened only by our staff during verification, through short-lived links.

6. Translation and drafting features
Messages may be automatically translated between English and Chinese, and a sourcing brief may be drafted from your description. To do this, the relevant text is sent to an AI model provider through OpenRouter. The original message is always kept, and a translation is provided for convenience only.

7. Service providers
We use service providers to run the platform: Supabase for our database, authentication and file storage (hosted in the United States); Vercel for hosting the application; Resend for sending email; OpenRouter for translation and drafting; and, on our marketing website, Google Sheets and Netlify Forms to receive sign-up and survey submissions. They process information only to provide their services to us.

8. International transfers
Our platform is hosted in the United States. If you use The Sourcing Club from another country, including China, your information will be transferred to and processed in the United States.

9. Retention
We keep your information for as long as your account is active and as long as needed to provide the service. Records of agreements, signatures, quotes, orders, payments and messages may be kept after an account closes where they are needed as a record between the parties or to meet legal obligations.

10. Your choices and rights
You can review and update your profile information in your account at any time. You may ask us to access, correct or delete your personal information; some records described above may need to be retained. Depending on where you live, you may have additional rights under local law.

11. Security
Access to data is enforced by the database itself, private files are served only through expiring links, and passwords are never stored in readable form. No system is perfectly secure, and we cannot guarantee absolute security.

12. Changes to this policy
We may update this policy as the platform changes. The effective date above will change when a new version is published, and we will tell you about material changes.

13. Contact
Questions or requests about this policy may be directed to The Sourcing Club operations team through the support channels provided in your account.$legal$,
   null);
