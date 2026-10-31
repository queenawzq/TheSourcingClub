import { PAYOUT_COUNTRIES, appOrigin, callerClient, jsonBody, releaseOwedTo, reply, saveConnectAccount, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";
import {
  MANAGED_CONTROLLER, PayoutMethodRefusal, addPayoutMethod, holdPayouts, listPayoutMethods, makeDefaultPayoutMethod,
  managedByTsc, payoutMethodRow, payoutSession, payoutsOnTheirWay, removePayoutMethod, withdrawBalance,
} from "./_stripe-payouts.js";
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
 *   add_method, default_method, remove_method
 *              the factory's payout accounts, changed by TSC on an account
 *              TSC manages (see managedByTsc); each tells the company
 *
 * Owners only: where a company's money goes is the highest-value thing in
 * this system (the same rule as factory_payout_accounts).
 */
/** "Bank account ending in 2345", as the factory's list says it. */
const describe = (method) => `${method.type === "card" ? "Debit card" : "Bank account"}${method.last4 ? ` ending in ${method.last4}` : ""}`;

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

  const { orgId, action, country, amount, currency, requestId, token, makeDefault, methodId, promoteId } = jsonBody(request);
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
        // TSC collects the company's details (in Stripe's embedded form) and
        // carries its losses, so TSC can change its payout accounts on TSC's
        // own page; Express accounts made before 2026-10-30 cannot.
        const account = await stripe.accounts.create({
          controller: MANAGED_CONTROLLER,
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
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      const [balance, allocation, methods, onTheirWay] = await Promise.all([
        stripe.balance.retrieve({}, { stripeAccount: existing.stripe_account_id }),
        payoutAllocationFor(stripe, db, orgId, existing.stripe_account_id),
        listPayoutMethods(stripe, existing.stripe_account_id, account.default_currency),
        payoutsOnTheirWay(stripe, existing.stripe_account_id),
      ]);
      return reply(response, 200, {
        defaultCurrency: account.default_currency,
        available: balance.available.map(({ amount, currency }) => ({ amount, currency })),
        pending: balance.pending.map(({ amount, currency }) => ({ amount, currency })),
        payouts: allocation.payouts,
        pendingEarnings: allocation.pending,
        // Withdrawals not yet at the bank, and which account each is going to:
        // that account cannot be removed until its money arrives.
        payoutsOnTheirWay: onTheirWay,
        methods,
        // TSC adds and removes payout accounts itself only where Stripe lets it.
        managedByTsc: managedByTsc(account),
      });
    }

    if (action === "add_method" || action === "default_method" || action === "remove_method") {
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      if (!managedByTsc(account)) {
        return reply(response, 409, { error: "Your payout methods are changed in Stripe's form on this page." });
      }
      const accountId = existing.stripe_account_id;
      let notice;
      try {
        if (action === "add_method") {
          const added = payoutMethodRow(await addPayoutMethod(stripe, accountId, { token, makeDefault }), account.default_currency);
          notice = `${describe(added)} was added as a payout method${added.default ? " and is now the default" : ""}.`;
        } else if (action === "default_method") {
          const chosen = payoutMethodRow(await makeDefaultPayoutMethod(stripe, accountId, methodId), account.default_currency);
          notice = `Withdrawals now go to ${describe(chosen).toLowerCase()}.`;
        } else {
          const removed = payoutMethodRow(await removePayoutMethod(stripe, accountId, { methodId, promoteId }), account.default_currency);
          notice = `${describe(removed)} was removed from your payout methods.`;
        }
      } catch (failure) {
        if (failure instanceof PayoutMethodRefusal) return reply(response, 422, { error: failure.message });
        // Stripe's own words on a bad account number are written for the person.
        if (failure?.type === "StripeCardError" || failure?.type === "StripeInvalidRequestError") {
          return reply(response, 422, { error: failure.message });
        }
        throw failure;
      }
      // Where earnings go is the highest-value thing a company has here: every
      // change is said to the whole company, so one nobody made is noticed.
      await db.from("notifications").insert({
        org_id: orgId,
        kind: "payout_method_changed",
        title: "Your payout methods changed",
        body: `${notice} If nobody at your company made this change, email operations@contact.sourcing-club.com now.`,
      });
      const methods = await listPayoutMethods(stripe, accountId, account.default_currency);
      return reply(response, 200, { methods, notice });
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
