-- ============================================================================
-- Privacy policy, next version: Payoneer
-- ----------------------------------------------------------------------------
-- Paying a factory through Payoneer shares its Payoneer email with Payoneer,
-- and the policy names every service that processes personal data, so this is
-- a new version (a new row; earlier versions stay as they were). Numbered after
-- whatever is current. English only, like every earlier version; nobody signs
-- anything new.
--
-- Its own migration because the wording may still change, and it goes if
-- Payoneer goes.
-- ============================================================================

do $$
declare
  current_version integer;
  current_text    text;
  stripe_ends constant text := $t$Stripe processes this information under its own privacy policy, as well as for us.$t$;
  payoneer constant text := $t$

Where Stripe cannot pay out to a factory or trading company, it may choose to be paid through Payoneer by giving us the email address of its Payoneer account. Our staff send those payments by hand from The Sourcing Club's Payoneer account, so Payoneer receives that email address, the amount and the payment details, and processes them under its own privacy policy. We keep the email address and Payoneer's payment ID as a record of the payout. We never receive the company's Payoneer sign-in or balance, and brands cannot see this email address.$t$;
begin
  select d.version, d.full_en into current_version, current_text
    from public.legal_documents d
   where d.kind = 'privacy'
   order by d.version desc
   limit 1;
  if current_text is null then
    raise exception 'privacy policy is missing';
  end if;
  if position(stripe_ends in current_text) = 0
     or position('Stripe for payments;' in current_text) = 0
     or position('Effective October 2026' in current_text) = 0 then
    raise exception 'privacy policy v% does not read as expected; write the next version by hand', current_version;
  end if;

  insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
  values ('privacy', current_version + 1, null, null,
    replace(replace(replace(current_text,
      stripe_ends, stripe_ends || payoneer),
      'Stripe for payments;', 'Stripe for payments; Payoneer for payouts where Stripe cannot pay out;'),
      'Effective October 2026', 'Effective November 2026'),
    null);
end;
$$;
