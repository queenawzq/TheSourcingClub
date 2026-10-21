-- ============================================================================
-- Privacy policy, version 3: Zoom
-- ----------------------------------------------------------------------------
-- Video calls are hosted by Zoom, which receives each person's name and
-- company as shown in the call and carries its audio and video. The privacy
-- policy names every service that processes personal data, so this is a new
-- version (a new row; version 2 stays as it was).
-- Changed from v2: section 2 adds call details and the browser's time zone;
-- a new section 8, Video calls; Zoom in the service providers; later sections
-- renumbered; brands pay by card only, so the bank-account sentence in
-- the Stripe section is gone. English only, like v1 and v2. Nobody signs
-- anything new.
-- ============================================================================

insert into public.legal_documents (kind, version, onboarding_en, onboarding_zh, full_en, full_zh)
values ('privacy', 3, null, null, $legal$The Sourcing Club Privacy Policy
Effective October 2026

1. Who we are
The Sourcing Club operates a marketplace that connects brands with factories and trading companies. This policy explains what information we collect when you use the platform, why we collect it, who processes it on our behalf, and the choices you have.

2. Information you give us
When you create an account we collect your name, work email address, password (stored only in hashed form by our authentication provider) and your company's name. During onboarding and while using the platform you may also provide company details, locations, capacity, certifications, product categories, sourcing requests, quotes, pricing, production schedules, messages, and files such as logos, product images, business registrations, certificates, walkthrough videos and milestone photos. When you schedule a video call, we keep its title, description and time, and the time zone of your browser so the other side can see the call in your local time. When you pay for an order or set up payouts, you also provide payment details (see section 7). Your electronic signature on our terms is recorded with the date, the signer and the exact version of the terms signed.

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

8. Video calls
Video calls between brands and vendors are hosted by Zoom. When you join a call, Zoom receives your name and company name as they appear in the call, and processes the audio and video of the call to deliver it. Meetings are created in The Sourcing Club's Zoom account; we do not record calls, and we keep only the meeting's reference and passcode with the call. Zoom processes this information under its own privacy policy, as well as for us.

9. Service providers
We use service providers to run the platform: Supabase for our database, authentication and file storage (hosted in the United States); Vercel for hosting the application; Resend for sending email; OpenRouter for translation and drafting; Stripe for payments; Zoom for video calls; and, on our marketing website, Google Sheets and Netlify Forms to receive sign-up and survey submissions. They process information only to provide their services to us.

10. International transfers
Our platform is hosted in the United States. If you use The Sourcing Club from another country, including China, your information will be transferred to and processed in the United States.

11. Retention
We keep your information for as long as your account is active and as long as needed to provide the service. Records of agreements, signatures, quotes, orders, payments and messages may be kept after an account closes where they are needed as a record between the parties or to meet legal obligations.

12. Your choices and rights
You can review and update your profile information in your account at any time. You may ask us to access, correct or delete your personal information; some records described above may need to be retained. Depending on where you live, you may have additional rights under local law.

13. Security
Access to data is enforced by the database itself, private files are served only through expiring links, and passwords are never stored in readable form. No system is perfectly secure, and we cannot guarantee absolute security.

14. Changes to this policy
We may update this policy as the platform changes. The effective date above will change when a new version is published, and we will tell you about material changes.

15. Contact
Questions or requests about this policy may be directed to The Sourcing Club operations team through the support channels provided in your account.$legal$, null);
