import { payoutBankOptions } from "./_payout-bank-options.js";
import { logStripeFailure, sentenceFor, withoutKeys } from "./_stripe-errors.js";
import { payoutDisplayRates } from "./_payout-display-rates.js";
import { connectUpgrade, beginConnectUpgrade, finishConnectUpgrade, upgradeReadiness } from "./_stripe-connect-upgrade.js";
import { PAYOUT_COUNTRIES, appOrigin, callerClient, jsonBody, reply, saveConnectAccount, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";
import { balanceFigures } from "./_balance-figures.js";
import {
  MANAGED_CONTROLLER, PayoutMethodRefusal, addPayoutMethod, holdPayouts, listPayoutMethods, makeDefaultPayoutMethod,
  managedByTsc, payoutMethodRow, payoutSession, payoutsOnTheirWay, removePayoutMethod,
} from "./_stripe-payouts.js";
import { payoutAllocationFor } from "./_payout-allocation.js";
import { returnFeesOnFailedPayouts, settleAbandoned, withdrawWithFee } from "./_stripe-withdrawals.js";

/**
 * A factory's payouts through Stripe: an Express account, onboarded and
 * managed in Stripe's embedded forms on TSC's own page (identity, business
 * and bank details, and Stripe's Connected Account Agreement).
 *
 *   session    create the account once, then a session for the embedded
 *              onboarding and account management forms. The session can edit
 *              the company's identity and bank details, hence owners only
 *   onboard    the same, as a link to Stripe's hosted onboarding (older flow)
 *   restart    a setup left halfway, chosen again for another country: Stripe
 *              cannot change an account's country, so an account that was
 *              never used (see neverUsed) is deleted, and the next session
 *              creates one in the country chosen
 *   refresh    read the account back after onboarding and save its status;
 *              moves nothing: owed money waits in the balance until the
 *              factory withdraws
 *   dashboard  a one-time link to the factory's Express dashboard
 *   balance    the factory's live balances and recent bank payouts, and
 *              `figures`: the one balance (factory_balance()) with the money
 *              already in its Stripe account added (api/_balance-figures.js)
 *   withdraw, withdraw_previous
 *              a payout to the bank, Stripe's payout fee taken first
 *              (api/_stripe-withdrawals.js)
 *   add_method, default_method, remove_method
 *              the factory's payout accounts, changed by TSC on an account
 *              TSC manages (see managedByTsc); each tells the company
 *
 * Owners only: where a company's money goes is the highest-value thing in
 * this system (the same rule as factory_payout_accounts).
 */
/**
 * Whether a company's Stripe account was never used, so deleting it loses
 * nothing: transfers never turned on, no upgrade under way, no withdrawal
 * asked for, no transfer ever made to it, and nothing in its balance. Any
 * read that fails counts as used.
 */
async function neverUsed({ stripe, db, orgId, existing, upgrade }) {
  if (existing.transfers_active || upgrade) return false;
  const accountId = existing.stripe_account_id;
  const [account, transfers, balance, withdrawals] = await Promise.all([
    stripe.accounts.retrieve(accountId),
    stripe.transfers.list({ destination: accountId, limit: 1 }),
    stripe.balance.retrieve({}, { stripeAccount: accountId }),
    db.from("stripe_withdrawals").select("id").eq("org_id", orgId).limit(1),
  ]);
  if (withdrawals.error || withdrawals.data?.length) return false;
  if (account.capabilities?.transfers === "active") return false;
  if (transfers.data?.length) return false;
  const held = [...(balance.available ?? []), ...(balance.pending ?? []), ...(balance.instant_available ?? [])];
  return held.every((row) => row.amount === 0);
}

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

  const { orgId, action, country, amount, currency, requestId, destination, token, makeDefault, methodId, promoteId, replaceId } = jsonBody(request);
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

    const upgrade = existing ? await connectUpgrade(db, orgId) : null;
    if (action === "upgrade") {
      if (!existing) return reply(response, 404, { error: "No payout account to upgrade." });
      const current = await stripe.accounts.retrieve(existing.stripe_account_id);
      await beginConnectUpgrade({ stripe, db, org, current, email: auth?.user?.email });
      return reply(response, 200, { started: true });
    }

    if (action === "restart") {
      const code = String(country ?? "").toUpperCase();
      if (!PAYOUT_COUNTRIES.has(code)) {
        return reply(response, 422, { error: "Choose another withdrawal method for this country." });
      }
      // Nothing started, or started for this country: the same account carries on.
      if (!existing || String(existing.country ?? "").toUpperCase() === code) return reply(response, 200, { restarted: false });
      let unused = false;
      try {
        unused = await neverUsed({ stripe, db, orgId, existing, upgrade });
      } catch (failure) {
        logStripeFailure("stripe-connect restart check", failure);
        unused = false;
      }
      if (!unused) return reply(response, 409, { error: "Choose another withdrawal method for this country." });
      await stripe.accounts.del(existing.stripe_account_id);
      const { error: forgetError } = await db.from("stripe_connect_accounts").delete()
        .eq("org_id", orgId).eq("stripe_account_id", existing.stripe_account_id);
      if (forgetError) throw new Error(forgetError.message);
      return reply(response, 200, { restarted: true });
    }

    if (action === "onboard" || action === "session") {
      let accountId = existing?.stripe_account_id;
      if (!accountId) {
        const code = String(country ?? "").toUpperCase();
        if (!PAYOUT_COUNTRIES.has(code)) {
          return reply(response, 422, {
            error: "Choose another withdrawal method for this country.",
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
      if (jsonBody(request).upgrade === true) {
        if (!upgrade?.new_account_id || upgrade.completed_at) return reply(response, 409, { error: "Start or resume the payout upgrade first." });
        accountId = upgrade.new_account_id;
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

    if (!existing) return reply(response, 404, { error: "Withdrawals are not set up yet." });

    if (action === "bank_options") {
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      return reply(response, 200, await payoutBankOptions(stripe, account.country));
    }

    if (action === "withdraw_previous") {
      if (!upgrade?.completed_at) return reply(response, 409, { error: "No previous payout account is available." });
      const previous = await stripe.accounts.retrieve(upgrade.old_account_id);
      if (!previous.payouts_enabled) return reply(response, 422, { error: "Contact TSC operations to recover funds from your previous payout account." });
      // The factory pays Stripe's payout fee once, taken back before the payout (api/_stripe-withdrawals.js).
      const payout = await withdrawWithFee({ stripe, db, orgId, accountId: upgrade.old_account_id, country: previous.country ?? "",
        amount, currency, requestId, userId: auth?.user?.id ?? null });
      return reply(response, 200, { payout });
    }

    if (action === "withdraw") {
      if (!existing.payouts_enabled) return reply(response, 422, { error: "Finish payout verification before withdrawing." });
      const payout = await withdrawWithFee({ stripe, db, orgId, accountId: existing.stripe_account_id, country: existing.country ?? "",
        amount, currency, requestId, destination: destination ?? null, userId: auth?.user?.id ?? null });
      return reply(response, 200, { payout });
    }

    // Also applies to accounts created before manual withdrawals were added.
    // Refuse the operation if Stripe cannot disable automatic bank payouts.
    await holdPayouts(stripe, existing.stripe_account_id);

    if (action === "refresh") {
      if (upgrade && !upgrade.completed_at) {
        await finishConnectUpgrade({ stripe, db, orgId, upgrade });
        const active = await db.from("stripe_connect_accounts").select("stripe_account_id").eq("org_id", orgId).single();
        if (active.error) throw new Error(active.error.message);
        existing.stripe_account_id = active.data.stripe_account_id;
      }
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      const saved = await saveConnectAccount(db, orgId, account);
      // Nothing is paid out here: approved money stays in the balance until
      // the factory withdraws. `released` stays in the answer for pages that read it.
      return reply(response, 200, { account: saved, released: [] });
    }

    if (action === "balance") {
      // A withdrawal left half-way (its call died) is finished or its fee given back first.
      await settleAbandoned({ stripe, db, accountId: existing.stripe_account_id })
        .catch((failure) => logStripeFailure("stripe-connect settle", failure, { orgId }));
      // A payout that failed or was cancelled gives its fee back even if its webhook never came.
      await returnFeesOnFailedPayouts({ stripe, db, accountId: existing.stripe_account_id });
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      const [balance, allocation, methods, onTheirWay, displayFx, tscBalance] = await Promise.all([
        stripe.balance.retrieve({}, { stripeAccount: existing.stripe_account_id }),
        payoutAllocationFor(stripe, db, orgId, existing.stripe_account_id),
        listPayoutMethods(stripe, existing.stripe_account_id, account.default_currency),
        payoutsOnTheirWay(stripe, existing.stripe_account_id),
        payoutDisplayRates(),
        // As the owner: the database checks who is asking.
        caller.rpc("factory_balance", { target_org: orgId }),
      ]);
      if (tscBalance.error) throw new Error(tscBalance.error.message);
      const migration = await upgradeReadiness(stripe, upgrade);
      let recovery = null;
      if (upgrade?.completed_at) {
        const previous = await stripe.accounts.retrieve(upgrade.old_account_id);
        const funds = await stripe.balance.retrieve({}, { stripeAccount: upgrade.old_account_id });
        recovery = { available: funds.available, pending: funds.pending, defaultCurrency: previous.default_currency, payoutsEnabled: previous.payouts_enabled };
        const historical = await payoutAllocationFor(stripe, db, orgId, upgrade.old_account_id);
        allocation.payouts.push(...historical.payouts);
        allocation.pending.push(...historical.pending);
      }
      const figures = { ...balanceFigures(tscBalance.data, {
        available: [...balance.available, ...(recovery?.available ?? [])],
        pending: [...balance.pending, ...(recovery?.pending ?? [])],
        onTheirWay,
        payouts: allocation.payouts,
      }, displayFx), stripe_unavailable: false };
      return reply(response, 200, {
        displayFx, recovery, figures,
        upgrade: migration ? { started: true, creationFailed: upgrade.creation_failed, verified: migration.verified, unsettled: migration.unsettled } : null,
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
        return reply(response, 409, { error: "Your withdrawal methods are changed in the form on this page." });
      }
      const accountId = existing.stripe_account_id;
      // Before Stripe is asked: its webhook for this change may beat our reply.
      await db.from("stripe_connect_accounts").update({ methods_changed_by_tsc_at: new Date().toISOString() }).eq("org_id", orgId);
      let notice;
      try {
        if (action === "add_method") {
          // Replace is one request: the new account goes in as the default,
          // then the old one comes out. Two calls from the browser left the
          // old one behind when the page closed between them.
          if (replaceId) {
            const target = await stripe.accounts.retrieveExternalAccount(accountId, replaceId);
            const details = await stripe.tokens.retrieve(token);
            if (!details.bank_account || details.bank_account.currency !== target.currency) {
              throw new PayoutMethodRefusal(`A replacement must use ${target.currency.toUpperCase()}. Add a separate withdrawal method to use another currency.`);
            }
          }
          const added = payoutMethodRow(await addPayoutMethod(stripe, accountId, { token, makeDefault: makeDefault || Boolean(replaceId) }), account.default_currency);
          notice = `${describe(added)} was added as a withdrawal method${added.default ? " and is now the default" : ""}.`;
          if (replaceId) {
            const removed = payoutMethodRow(await removePayoutMethod(stripe, accountId, { methodId: replaceId, promoteId: added.id }), account.default_currency);
            notice += ` ${describe(removed)} was removed.`;
          }
        } else if (action === "default_method") {
          const chosen = payoutMethodRow(await makeDefaultPayoutMethod(stripe, accountId, methodId), account.default_currency);
          notice = `Withdrawals now go to ${describe(chosen).toLowerCase()}.`;
        } else {
          const removed = payoutMethodRow(await removePayoutMethod(stripe, accountId, { methodId, promoteId }), account.default_currency);
          notice = `${describe(removed)} was removed from your withdrawal methods.`;
        }
      } catch (failure) {
        if (failure instanceof PayoutMethodRefusal) return reply(response, 422, { error: failure.message });
        // Stripe's own words on a bad account number are written for the person.
        if (failure?.type === "StripeCardError" || failure?.type === "StripeInvalidRequestError") {
          return reply(response, 422, { error: withoutKeys(failure.message) });
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
    if (failure instanceof PayoutMethodRefusal) return reply(response, 422, { error: failure.message });
    logStripeFailure("stripe-connect", failure, { action });
    // Stripe unreachable: the balance still answers with what TSC holds for
    // the factory (factory_balance()), its Stripe part marked unavailable,
    // never with nothing.
    const figures = action === "balance" ? await databaseFigures(caller, orgId) : undefined;
    return reply(response, 502, {
      error: sentenceFor(failure, "That didn't go through, so nothing changed. Try again in a few minutes."),
      ...(figures ? { figures } : {}),
    });
  }
}

/** The one balance from the database alone, for when Stripe cannot be read; null if that fails too. */
async function databaseFigures(caller, orgId) {
  try {
    const { data, error } = await caller.rpc("factory_balance", { target_org: orgId });
    if (error || !data) return null;
    return { ...balanceFigures(data, null, null), stripe_unavailable: true };
  } catch {
    return null;
  }
}
