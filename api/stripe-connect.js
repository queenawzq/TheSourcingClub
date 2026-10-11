import { PAYOUT_COUNTRIES, appOrigin, callerClient, jsonBody, releaseOwedTo, reply, saveConnectAccount, serviceClient, stripeFrom } from "./_stripe.js";

/**
 * A factory's payouts through Stripe: an Express account, onboarded on
 * Stripe's own pages (identity, business and bank details, and Stripe's
 * Connected Account Agreement), with its own Express dashboard.
 *
 *   onboard    create the account once, then a link to Stripe's onboarding
 *   refresh    read the account back after onboarding and save its status;
 *              pays out anything already owed once transfers are on
 *   dashboard  a one-time link to the factory's Express dashboard
 *
 * Owners only: where a company's money goes is the highest-value thing in
 * this system (the same rule as factory_payout_accounts).
 */
export default async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });

  let stripe;
  try {
    stripe = stripeFrom();
  } catch (failure) {
    return reply(response, 503, { error: failure.message });
  }
  const db = serviceClient();
  if (!stripe || !db) return reply(response, 503, { error: "payments are not set up on this site yet" });

  const caller = callerClient(request);
  if (!caller) return reply(response, 401, { error: "sign in is required" });

  const { orgId, action, country } = jsonBody(request);
  const [{ data: isOwner }, { data: org }, { data: auth }] = await Promise.all([
    caller.rpc("is_org_owner", { target_org: orgId }),
    caller.from("orgs").select("id, name, type").eq("id", orgId).maybeSingle(),
    caller.auth.getUser(),
  ]);
  if (!isOwner || !org || org.type === "brand") {
    return reply(response, 403, { error: "only an owner of a factory or trading company can set up its payouts" });
  }

  try {
    const { data: existing } = await db.from("stripe_connect_accounts").select("*").eq("org_id", orgId).maybeSingle();

    if (action === "onboard") {
      let accountId = existing?.stripe_account_id;
      if (!accountId) {
        const code = String(country ?? "").toUpperCase();
        if (!PAYOUT_COUNTRIES.has(code)) {
          return reply(response, 422, {
            error: "Stripe can't pay out to companies in that country yet. Add your bank details instead, and TSC pays you by bank transfer.",
          });
        }
        // card_payments as well as transfers: outside the US, Stripe accepts
        // `transfers` alone only under the recipient agreement, which cannot
        // take a cross-border transfer. The factory never charges anyone; TSC
        // charges the brand and transfers to it.
        // No idempotency key: Stripe would replay a first failure (Connect
        // not yet enabled, say) for 24 hours. The row saved below is what
        // makes this happen once per company.
        const account = await stripe.accounts.create({
          type: "express",
          country: code,
          email: auth?.user?.email ?? undefined,
          capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
          business_profile: { name: org.name },
          metadata: { org_id: orgId },
        });
        await saveConnectAccount(db, orgId, account);
        accountId = account.id;
      }
      const origin = appOrigin(request);
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        refresh_url: `${origin}/app.html/payout?stripe=refresh`,
        return_url: `${origin}/app.html/payout?stripe=return`,
      });
      return reply(response, 200, { url: link.url });
    }

    if (!existing) return reply(response, 404, { error: "payouts through Stripe are not set up yet" });

    if (action === "refresh") {
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      const saved = await saveConnectAccount(db, orgId, account);
      const released = saved.transfers_active ? await releaseOwedTo({ stripe, db, factoryOrgId: orgId }) : [];
      return reply(response, 200, { account: saved, released });
    }

    if (action === "dashboard") {
      const login = await stripe.accounts.createLoginLink(existing.stripe_account_id);
      return reply(response, 200, { url: login.url });
    }

    return reply(response, 400, { error: `unknown action "${action}"` });
  } catch (failure) {
    return reply(response, 502, { error: failure.message });
  }
}
