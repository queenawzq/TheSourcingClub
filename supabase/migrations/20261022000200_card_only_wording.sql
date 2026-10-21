-- ============================================================================
-- Card-only wording
-- ----------------------------------------------------------------------------
-- Brands now fund payments by card only, so
-- nothing the brand or the factory reads may still offer a bank account or
-- say a payment takes four business days to clear. Wording only:
--
--   record_payment_processing  the factory's "on its way" notification no
--                              longer calls it a bank payment
--   record_payment_failed      nor does the factory's "did not go through"
--   advance_order_chain        the brand's "is due" notification says to fund
--                              it by card
--
-- Each is the definition from 20261013000200_stripe_payments.sql with only
-- those strings changed: same signature, return type, security and body, and
-- create or replace keeps the grants and revokes made there.
--
-- Privacy policy, version 3: section 7 no longer says a brand may pay by US
-- bank account or that bank accounts are verified through Financial
-- Connections. Everything else is version 2 word for word. A new row rather
-- than an update, as every legal change is (057): rows are never edited.
-- Notifications already sent keep their wording.
-- ============================================================================

-- The brand's payment is on its way; it has not been confirmed.
create or replace function public.record_payment_processing(
  target_payment uuid,
  method_type text,
  method_label text
)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state not in ('due', 'failed') then
    return p;
  end if;
  was := p.state;

  update public.order_payments
     set state = 'processing', processing_at = now(),
         payment_method_type = coalesce(method_type, payment_method_type),
         payment_method_label = coalesce(method_label, payment_method_label),
         failure_reason = null
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  values (p.id, was, 'processing', 'system');

  select * into m from public.order_milestones where id = p.milestone_id;

  -- Told carefully, like "sent" always was: on its way is not arrived.
  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.factory_org_id, 'payment_processing', 'payment', p.id, o.id,
    format('A payment for "%s" is on its way', m.title),
    format('%s on %s. Stripe is still confirming it. We will tell you when TSC holds it; please do not start this work yet.',
           public.format_money(p.amount_cents, p.currency), o.order_number)
  );

  return p;
end;
$$;

-- The payment did not go through. The brand can pay again.
create or replace function public.record_payment_failed(target_payment uuid, reason text)
returns public.order_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.order_payments;
  o public.production_orders;
  m public.order_milestones;
  was public.payment_state;
  why text := coalesce(nullif(btrim(coalesce(reason, '')), ''), 'The payment did not go through.');
begin
  select * into o from public.production_orders
   where id = (select order_id from public.order_payments where id = target_payment)
   for update;
  select * into p from public.order_payments where id = target_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;

  if p.state not in ('due', 'processing') then
    return p;
  end if;
  was := p.state;

  update public.order_payments
     set state = 'failed', failed_at = now(), failure_reason = why
   where id = p.id
  returning * into p;

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind, note)
  values (p.id, was, 'failed', 'system', why);

  select * into m from public.order_milestones where id = p.milestone_id;

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  values (
    o.brand_org_id, 'payment_failed', 'payment', p.id, o.id,
    format('Your payment for "%s" did not go through', m.title),
    format('%s Pay again from the step''s payment page on %s.', why, o.order_number)
  );

  -- The factory was told a payment was on its way; tell it that it is not.
  if was = 'processing' then
    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    values (
      o.factory_org_id, 'payment_failed', 'payment', p.id, o.id,
      format('The payment for "%s" did not go through', m.title),
      format('Nothing is held for this step on %s yet. The brand has been asked to pay again.', o.order_number)
    );
  end if;

  return p;
end;
$$;

-- advance_order_chain: a step involving money falls due as it opens, and the
-- brand is asked to fund it by card.
create or replace function public.advance_order_chain(target_order uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_sort integer;
  o         public.production_orders;
begin
  select * into o from public.production_orders where id = target_order;

  select min(sort) into next_sort
  from public.order_milestones
  where order_id = target_order
    and state not in ('complete', 'cancelled');

  if next_sort is null then
    update public.production_orders
       set status = 'completed', completed_at = now()
     where id = target_order and status = 'active';

    insert into public.notifications
      (org_id, kind, subject_type, subject_id, order_id, title, body)
    select org_id, 'order_completed', 'order', o.id, o.id,
           format('%s is complete', o.order_number),
           'Every step on this order is done.'
    from (select o.brand_org_id as org_id union all select o.factory_org_id) parties;
    return;
  end if;

  -- Nothing opens while an earlier step is still outstanding.
  if exists (
    select 1 from public.order_milestones
    where order_id = target_order
      and sort < next_sort
      and state not in ('complete', 'cancelled')
  ) then
    return;
  end if;

  update public.order_milestones
     set state = 'active'
   where order_id = target_order and sort = next_sort and state = 'pending';

  -- A step that involves money is funded as it opens: TSC holds the money
  -- while the work happens and pays it on when the brand approves.
  update public.order_payments p
     set state = 'due', due_at = now()
    from public.order_milestones m
   where m.id = p.milestone_id
     and m.order_id = target_order
     and m.sort = next_sort
     and m.kind in ('payment_only', 'approval_and_payment')
     and p.state = 'not_due';

  insert into public.payment_events (payment_id, from_state, to_state, actor_kind)
  select p.id, 'not_due', 'due', 'system'
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    -- Only the ones this call made due (due_at is this transaction's now()).
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();

  insert into public.notifications
    (org_id, kind, subject_type, subject_id, order_id, title, body)
  select o.brand_org_id, 'payment_due', 'payment', p.id, o.id,
         format('%s is due on %s', public.format_money(p.amount_cents, p.currency), o.order_number),
         format('"%s". Fund it by card; TSC holds it until the step is done.', m.title)
  from public.order_payments p
  join public.order_milestones m on m.id = p.milestone_id
  where m.order_id = target_order and m.sort = next_sort
    and m.kind in ('payment_only', 'approval_and_payment') and p.state = 'due'
    and p.due_at >= now();
end;
$$;

insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
values ('privacy', 3, null, null, $legal$The Sourcing Club Privacy Policy
Effective October 2026

1. Who we are
The Sourcing Club operates a marketplace that connects brands with factories and trading companies. This policy explains what information we collect when you use the platform, why we collect it, who processes it on our behalf, and the choices you have.

2. Information you give us
When you create an account we collect your name, work email address, password (stored only in hashed form by our authentication provider) and your company's name. During onboarding and while using the platform you may also provide company details, locations, capacity, certifications, product categories, sourcing requests, quotes, pricing, production schedules, messages, and files such as logos, product images, business registrations, certificates, walkthrough videos and milestone photos. When you pay for an order or set up payouts, you also provide payment details (see section 7). Your electronic signature on our terms is recorded with the date, the signer and the exact version of the terms signed.

3. Information collected automatically
We keep you signed in using storage in your browser, and remember preferences such as your display language there. We record technical error reports from the app so that we can fix problems. We do not use advertising or analytics trackers.

4. How we use information
We use your information to provide the marketplace: to create and secure your account, verify your company, show your profile and requests to the parties you work with, match brands with suitable vendors, deliver messages, keep a record of quotes, orders, milestones and payments, take brands' payments for orders, hold them until the step they pay for is approved and pay them out to the factory, and send you service emails such as password resets, onboarding confirmations and verification decisions. Our staff review submitted verification documents by hand.

5. Who can see your information
Your published company profile is visible to other signed-in members of the marketplace. Requests, quotes, orders, messages and their attachments are visible only to the companies taking part in them, and to The Sourcing Club staff who operate and support the platform. Business registrations and certificates are stored privately and are opened only by our staff during verification, through short-lived links.

6. Translation and drafting features
Messages may be automatically translated between English and Chinese, and a sourcing brief may be drafted from your description. To do this, the relevant text is sent to an AI model provider through OpenRouter. The original message is always kept, and a translation is provided for convenience only.

7. Payments
Payments are processed by Stripe. When a brand pays by card, the card details are entered into Stripe's form and sent directly to Stripe. When a factory or trading company sets up payouts, Stripe collects the identity, business and bank information it needs to verify the account and pay it, through its own onboarding. The Sourcing Club does not receive or store full card or bank account numbers: we keep only what we need to show and reconcile a payment, such as the card brand or bank name and the last four digits, the amounts, and Stripe's reference for each payment and payout. Stripe processes this information under its own privacy policy, as well as for us.

8. Service providers
We use service providers to run the platform: Supabase for our database, authentication and file storage (hosted in the United States); Vercel for hosting the application; Resend for sending email; OpenRouter for translation and drafting; Stripe for payments; and, on our marketing website, Google Sheets and Netlify Forms to receive sign-up and survey submissions. They process information only to provide their services to us.

9. International transfers
Our platform is hosted in the United States. If you use The Sourcing Club from another country, including China, your information will be transferred to and processed in the United States.

10. Retention
We keep your information for as long as your account is active and as long as needed to provide the service. Records of agreements, signatures, quotes, orders, payments and messages may be kept after an account closes where they are needed as a record between the parties or to meet legal obligations.

11. Your choices and rights
You can review and update your profile information in your account at any time. You may ask us to access, correct or delete your personal information; some records described above may need to be retained. Depending on where you live, you may have additional rights under local law.

12. Security
Access to data is enforced by the database itself, private files are served only through expiring links, and passwords are never stored in readable form. No system is perfectly secure, and we cannot guarantee absolute security.

13. Changes to this policy
We may update this policy as the platform changes. The effective date above will change when a new version is published, and we will tell you about material changes.

14. Contact
Questions or requests about this policy may be directed to The Sourcing Club operations team through the support channels provided in your account.$legal$, null);
