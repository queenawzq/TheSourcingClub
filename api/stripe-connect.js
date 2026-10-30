import { PAYOUT_COUNTRIES, appOrigin, callerClient, jsonBody, releaseOwedTo, reply, saveConnectAccount, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";
import { holdPayouts, payoutSession, withdrawBalance } from "./_stripe-payouts.js";
import { payoutAllocationFor } from "./_payout-allocation.js";

/**
 * A factory's payouts through Stripe: an Express account, onboarded and
 * managed in Stripe's embedded forms on TSC's own page (identity, business
 * and bank details, and Stripe's Connected Account Agreement).
 *
 *   session    create the account once, then a session for the embedded
 *              onboarding and account management forms. The session can edit
 *              the company's identity and bank details, hence owners only
 *   onboard    the same, as a link to Stripe's hosted onboarding (older flow)
 *   refresh    read the account back after onboarding and save its status;
 *              pays out anything already owed once transfers are on
 *   dashboard  a one-time link to the factory's Express dashboard
 *   balance    the factory's live balances and recent bank payouts
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

  const { orgId, action, country, amount, currency, requestId } = jsonBody(request);
  const [owner, orgRead, { data: auth }] = await Promise.all([
    caller.rpc("is_org_owner", { target_org: orgId }),
    caller.from("orgs").select("id, name, type").eq("id", orgId).maybeSingle(),
    caller.auth.getUser(),
  ]);
  if (tokenRefused(owner) || tokenRefused(orgRead)) return reply(response, 401, { error: "sign in is required" });
  const { data: isOwner } = owner;
  const { data: org } = orgRead;
  if (!isOwner || !org || org.type === "brand") {
    return reply(response, 403, { error: "only an owner of a factory or trading company can set up its payouts" });
  }

  try {
    const { data: existing } = await db.from("stripe_connect_accounts").select("*").eq("org_id", orgId).maybeSingle();

    if (action === "onboard" || action === "session") {
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
          settings: { payouts: { schedule: { interval: "manual" } } },
        });
        await saveConnectAccount(db, orgId, account);
        accountId = account.id;
      }
      if (action === "session") return reply(response, 200, { clientSecret: await payoutSession(stripe, accountId) });
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

    if (action === "withdraw") {
      if (!existing.payouts_enabled) return reply(response, 422, { error: "Finish payout verification before withdrawing." });
      const payout = await withdrawBalance(stripe, existing.stripe_account_id, { amount, currency, requestId });
      return reply(response, 200, { payout: { id: payout.id, amount: payout.amount, currency: payout.currency, status: payout.status } });
    }

    // Also applies to accounts created before manual withdrawals were added.
    // Refuse the operation if Stripe cannot disable automatic bank payouts.
    await holdPayouts(stripe, existing.stripe_account_id);

    if (action === "refresh") {
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      const saved = await saveConnectAccount(db, orgId, account);
      const released = saved.transfers_active ? await releaseOwedTo({ stripe, db, factoryOrgId: orgId }) : [];
      return reply(response, 200, { account: saved, released });
    }

    if (action === "balance") {
      const [balance, allocation, externalAccounts, account, recentPayouts] = await Promise.all([
        stripe.balance.retrieve({}, { stripeAccount: existing.stripe_account_id }),
        payoutAllocationFor(stripe, db, orgId, existing.stripe_account_id),
        stripe.accounts.listExternalAccounts(existing.stripe_account_id, { limit: 10 }),
        stripe.accounts.retrieve(existing.stripe_account_id),
        stripe.payouts.list({ limit: 20 }, { stripeAccount: existing.stripe_account_id }),
      ]);
      return reply(response, 200, {
        defaultCurrency: account.default_currency,
        available: balance.available.map(({ amount, currency }) => ({ amount, currency })),
        pending: balance.pending.map(({ amount, currency }) => ({ amount, currency })),
        payouts: allocation.payouts,
        pendingEarnings: allocation.pending,
        // Withdrawals not yet at the bank, and which account each is going to:
        // that account cannot be removed until its money arrives.
        payoutsOnTheirWay: recentPayouts.data
          .filter((payout) => payout.status === "pending" || payout.status === "in_transit")
          .map((payout) => ({
            id: payout.id,
            amount: payout.amount,
            currency: payout.currency,
            arrival_date: payout.arrival_date,
            destination: typeof payout.destination === "string" ? payout.destination : payout.destination?.id ?? null,
          })),
        methods: externalAccounts.data.map((method) => ({
          id: method.id,
          type: method.object === "card" ? "card" : "bank_account",
          name: method.object === "card" ? method.brand : method.bank_name,
          last4: method.last4,
          currency: method.currency,
          country: method.country,
          // default_for_currency is true for one account per currency, so a
          // EUR account and a USD one are both "default". The default is the
          // one in the account's own currency; the other only takes payouts
          // in its currency.
          default: Boolean(method.default_for_currency) && method.currency === account.default_currency,
          payoutsFor: method.default_for_currency && method.currency !== account.default_currency ? method.currency : null,
        // The default first, as Stripe lists it (Payments and Settings both read this order).
        })).sort((a, b) => Number(b.default) - Number(a.default)),
      });
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
