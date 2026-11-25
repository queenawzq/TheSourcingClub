import { payoutBankOptions } from "./_payout-bank-options.js";
import { logStripeFailure, sentenceFor, withoutKeys } from "./_stripe-errors.js";
import { payoutDisplayRates } from "./_payout-display-rates.js";
import { connectUpgrade, beginConnectUpgrade, finishConnectUpgrade, upgradeReadiness } from "./_stripe-connect-upgrade.js";
import { PAYOUT_COUNTRIES, appOrigin, callerClient, checkChargesFor, claimStripeRead, ensureFundsAvailableFor, jsonBody, reply, saveConnectAccount, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";
import { balanceFigures } from "./_balance-figures.js";
import {
  MANAGED_CONTROLLER, PayoutMethodRefusal, addPayoutMethod, holdPayouts, listPayoutMethods, makeDefaultPayoutMethod,
  managedByTsc, payoutMethodRow, payoutSession, payoutsOnTheirWay, removePayoutMethod,
} from "./_stripe-payouts.js";
import { payoutAllocationFor } from "./_payout-allocation.js";
import { consistentMoneyRead, heldByOpenWithdrawals, refreshPayouts, settleAbandoned, stripeMoneyUsd, withdrawWithFee } from "./_stripe-withdrawals.js";

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
 *   figures    the factory's balance, for any member (readBalance); `balance`
 *              is the same read, for owners only
 *   withdraw, withdraw_previous
 *              a payout to the bank, Stripe's payout fee taken first
 *              (api/_stripe-withdrawals.js)
 *   add_method, default_method, remove_method
 *              the factory's payout accounts, changed by TSC on an account
 *              TSC manages (see managedByTsc); each tells the company
 *
 * Owners only, but `figures`: where a company's money goes is the highest-value thing in
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

/** A withdrawal may make several Stripe calls in a row (claim, transfers, fee, payout): room for all of them. */
export const config = { maxDuration: 60 };

/**
 * The signed-in person's id from the caller's token, when the auth server did
 * not answer for it (getUser): the database has just accepted the same token
 * for is_org_owner, so its subject is who is asking. Only ever recorded as
 * "who asked", never used to decide anything.
 */
function tokenSubject(request) {
  try {
    const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
    return /^[0-9a-f-]{36}$/i.test(sub ?? "") ? sub : null;
  } catch {
    return null;
  }
}

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

  const { orgId, action, country, amount, currency, requestId, destination, token, makeDefault, methodId, promoteId, replaceId, load } = jsonBody(request);
  const [owner, orgRead, { data: auth }] = await Promise.all([
    caller.rpc("is_org_owner", { target_org: orgId }),
    caller.from("orgs").select("id, name, type").eq("id", orgId).maybeSingle(),
    caller.auth.getUser(),
  ]);
  if (tokenRefused(owner) || tokenRefused(orgRead)) return reply(response, 401, { error: "sign in is required" });
  const { data: isOwner } = owner;
  const { data: org } = orgRead;
  // The balance: one read for every member of a factory (readBalance); an
  // owner's answer also carries what only an owner manages. `balance` is the
  // same read, for owners only.
  if (action === "figures" || (action === "balance" && isOwner)) {
    if (!org || org.type === "brand") return reply(response, 403, { error: "that company is not available to you" });
    return readBalance({ stripe, db, caller, orgId, owner: Boolean(isOwner), load: action === "balance" || Boolean(load), response });
  }
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
        const base = {
          controller: MANAGED_CONTROLLER,
          country: code,
          email: auth?.user?.email ?? undefined,
          capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
          business_profile: { name: org.name },
          metadata: { org_id: orgId },
          settings: { payouts: { schedule: { interval: "manual" } } },
        };
        // What the company already told TSC (its website), so Stripe's form
        // does not ask for it again (TSC collects the requirements here).
        const known = await knownCompanyDetails(db, orgId);
        // A detail Stripe will not take (a website it refuses, say) must never
        // stop the setup: it is left out, and the form asks for it as before.
        const tries = [...(known.businessProfile.url ? [{ ...base, business_profile: { ...base.business_profile, ...known.businessProfile } }] : []), base];
        let account;
        for (const [index, params] of tries.entries()) {
          try {
            account = await stripe.accounts.create(params);
            break;
          } catch (failure) {
            // Only a refusal of the prefilled detail is retried without it.
            if (failure?.type !== "StripeInvalidRequestError" || !String(failure?.param ?? "").startsWith("business_profile") || index === tries.length - 1) throw failure;
            logStripeFailure("stripe-connect prefill", failure, { orgId });
          }
        }
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
        amount, currency, requestId, userId: auth?.user?.id ?? tokenSubject(request) });
      return reply(response, 200, { payout });
    }

    if (action === "withdraw") {
      if (!existing.payouts_enabled) return reply(response, 422, { error: "Finish payout verification before withdrawing." });
      // The one balance, in US$ (Stripe money first, then owed steps), paid
      // out in the account's own currency. Nothing else: an amount in another
      // currency would skip the "owes TSC" rule (gatherOwed).
      if (String(currency ?? "").toLowerCase() !== "usd") return reply(response, 422, { error: "Choose a valid available balance to withdraw." });
      const account = await stripe.accounts.retrieve(existing.stripe_account_id);
      const payout = await withdrawWithFee({ stripe, db, orgId, accountId: existing.stripe_account_id, country: existing.country ?? "",
        amount, currency: "usd", requestId, destination: destination ?? null, userId: auth?.user?.id ?? tokenSubject(request),
        oneBalance: true, payoutCurrency: account?.default_currency ?? "usd", transfersActive: Boolean(existing.transfers_active) });
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
    return reply(response, 502, {
      error: sentenceFor(failure, "That didn't go through, so nothing changed. Try again in a few minutes."),
    });
  }
}

/** A company's PayPal / Wise withdrawals, as the Payments page lists them (newest 200). */
const WITHDRAWAL_COLUMNS = "id, provider, status, amount_cents, currency, paid_to, fee_cents, receives_minor, receives_currency, reason, back_cents, created_at, paid_at, updated_at";

/**
 * The company's own website for a new payout account, as saved on its TSC
 * profile, so Stripe's form does not ask for it again. Its name is sent as
 * the business name already. The address and legal name cannot be sent:
 * Stripe takes them only with the business type (company or individual),
 * which the form asks and TSC does not know. Never throws.
 */
async function knownCompanyDetails(db, orgId) {
  try {
    const { data: profile } = await db.from("factory_profiles").select("website_url").eq("org_id", orgId).maybeSingle();
    const website = String(profile?.website_url ?? "").trim();
    return { businessProfile: /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(website) ? { url: website } : {} };
  } catch {
    return { businessProfile: {} };
  }
}

/**
 * The factory's balance, read one way by every member (the Payments page's
 * one read, src/app/order/use-factory-balance.js):
 *
 *   figures      the one balance (factory_balance(), read with the caller's
 *                token, so the database decides membership) with the money
 *                already in the company's Stripe account added
 *                (api/_balance-figures.js)
 *   reach        what each road can withdraw, in US$ cents: Stripe reaches
 *                owed steps paid by card and the money in the Stripe account
 *                (an estimate when that is in another currency), less what
 *                open withdrawals hold; PayPal and Wise reach owed steps,
 *                never the Stripe account's. Net of what the company owes TSC
 *                (owed_reachable), never below zero.
 *   withdrawals  its PayPal / Wise withdrawals, and `returnable`: what
 *                cancelling each open one gives back
 *   readsStripe  whether the company has a Stripe account (this read asks Stripe)
 *
 * An owner's answer also carries what only an owner manages: Stripe's
 * balance amounts, payouts, payout methods and a payout account upgrade; and
 * an owner's read first finishes a withdrawal left half-way (its call died).
 * Only the page's load (`load`, and `balance`) also keeps Stripe's automatic
 * payouts off (holdPayouts, a write to the account): every other owner
 * action does it too, so a read made because money moved need not.
 *
 * Refunds, disputes and payouts whose webhooks never came (a failed
 * payout's fee given back) are read from Stripe first, at most once a
 * minute per company (claimStripeRead); only
 * Stripe's facts are recorded. Stripe unreachable: 502, with the database's
 * figures (Stripe part marked unavailable) and everything that needs no
 * Stripe, never with nothing.
 */
async function readBalance({ stripe, db, caller, orgId, owner, load = false, response }) {
  const first = await caller.rpc("factory_balance", { target_org: orgId });
  if (tokenRefused(first)) return reply(response, 401, { error: "sign in is required" });
  if (first.error) return reply(response, first.error.code === "42501" ? 403 : 502, { error: first.error.code === "42501" ? "that company is not available to you" : "That didn't go through, so nothing changed. Try again in a few minutes." });
  const { data: existing } = await db.from("stripe_connect_accounts").select("*").eq("org_id", orgId).maybeSingle();
  const accountId = existing?.stripe_account_id ?? null;
  let tsc = first.data;
  // Only an owner's read settles what an owner's call left half-way; its
  // load also keeps automatic payouts off.
  let ownerFailure = null;
  if (owner && accountId) {
    try {
      if (load) await holdPayouts(stripe, accountId);
      // A withdrawal left half-way (its call died) is finished or its fee given back first.
      await settleAbandoned({ stripe, db, accountId }).catch((failure) => logStripeFailure("stripe-connect settle", failure, { orgId }));
    } catch (failure) {
      ownerFailure = failure;
    }
  }
  if (await claimStripeRead(db, orgId)) {
    await Promise.all([checkChargesFor({ stripe, db, orgId }), refreshPayouts({ stripe, db, orgId })]);
    const again = await caller.rpc("factory_balance", { target_org: orgId });
    if (!again.error) tsc = again.data;
  }
  const [owedReach, own, asked] = await Promise.all([
    db.rpc("owed_reachable", { target_org: orgId }),
    caller.rpc("my_withdrawal_balance", { target_org: orgId }),
    caller.from("factory_withdrawals").select(WITHDRAWAL_COLUMNS).eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
  ]);
  const poolCents = Math.max(0, Number(owedReach.data?.any_cents ?? 0));
  if (owedReach.error || own.error || asked.error) {
    // As the Stripe-down answer below: whether this read asks Stripe (a
    // member's page keeps its once-a-minute limit) and what each road
    // reaches, where that was read.
    return reply(response, 502, { error: "That didn't go through, so nothing changed. Try again in a few minutes.",
      figures: { ...balanceFigures(tsc, null, null), stripe_unavailable: Boolean(accountId) },
      reach: owedReach.error ? null : { stripe_cents: 0, pool_cents: poolCents, estimated: false },
      readsStripe: Boolean(accountId) });
  }
  const shared = { withdrawals: asked.data ?? [], returnable: own.data?.returnable ?? {}, readsStripe: Boolean(accountId) };
  if (!accountId) {
    return reply(response, 200, {
      figures: { ...balanceFigures(tsc, null, null), stripe_unavailable: false },
      reach: { stripe_cents: 0, pool_cents: poolCents, estimated: false },
      ...shared,
    });
  }
  try {
    if (ownerFailure) throw ownerFailure;
    // Funded payments Stripe gave a clearing date after they were recorded.
    await ensureFundsAvailableFor({ stripe, db, orgId });
    const upgrade = await connectUpgrade(db, orgId);
    // The currency a withdrawal pays out in (withdraw: payoutCurrency).
    const account = await stripe.accounts.retrieve(accountId);
    // Stripe's balance, the database's figures and what open withdrawals
    // hold, from one moment (consistentMoneyRead).
    const [{ balance, fresh, held: heldElsewhere, consistent }, displayFx, ownerReads] = await Promise.all([
      consistentMoneyRead(db, accountId, async () => {
        const [balanceRead, freshRead] = await Promise.all([
          stripe.balance.retrieve({}, { stripeAccount: accountId }),
          caller.rpc("factory_balance", { target_org: orgId }),
        ]);
        // What open withdrawals hold of the Stripe account (their own Stripe
        // part, and owed money they transferred for a payout not yet made):
        // on its way, not available, in the figures and in what Withdraw offers.
        const held = await heldByOpenWithdrawals(db, accountId, null, { stripe }).catch(() => ({}));
        return { balance: balanceRead, fresh: freshRead, held };
      }),
      payoutDisplayRates(),
      owner ? Promise.all([
        payoutAllocationFor(stripe, db, orgId, accountId),
        listPayoutMethods(stripe, accountId, account.default_currency),
        payoutsOnTheirWay(stripe, accountId),
      ]) : null,
    ]);
    let recovery = null;
    if (upgrade?.completed_at) {
      const funds = await stripe.balance.retrieve({}, { stripeAccount: upgrade.old_account_id });
      recovery = { available: funds.available, pending: funds.pending };
      if (owner) {
        const previous = await stripe.accounts.retrieve(upgrade.old_account_id);
        recovery = { ...recovery, defaultCurrency: previous.default_currency, payoutsEnabled: previous.payouts_enabled };
        const historical = await payoutAllocationFor(stripe, db, orgId, upgrade.old_account_id);
        ownerReads[0].payouts.push(...historical.payouts);
        ownerReads[0].pending.push(...historical.pending);
      }
    }
    const figures = checkedFigures({ ...balanceFigures(fresh.error ? tsc : fresh.data, {
      available: [...balance.available, ...(recovery?.available ?? [])],
      pending: [...balance.pending, ...(recovery?.pending ?? [])],
      held: heldRows(balance.available, heldElsewhere),
    }, displayFx), stripe_unavailable: false }, consistent, orgId);
    // As one withdrawal reckons it (stripeMoneyUsd): the payout currency's
    // money only, at the rate the withdrawal uses, so the dialog's full
    // amount is what the server allows.
    const { cents: inStripeUsd, estimated } = await stripeMoneyUsd(stripe, accountId, balance.available, heldElsewhere, account.default_currency);
    const answer = {
      figures,
      reach: { stripe_cents: Math.max(0, Number(owedReach.data?.stripe_cents ?? 0) + inStripeUsd), pool_cents: poolCents, estimated },
      ...shared,
    };
    if (!owner) return reply(response, 200, answer);
    const [allocation, methods, onTheirWay] = ownerReads;
    const migration = await upgradeReadiness(stripe, upgrade);
    // A payout a withdrawal made is listed from the company's own record
    // (factory_balance().withdrawals): Stripe's copy of it would be a second
    // row, at Stripe's converted amount. Read after Stripe's list, so a
    // payout Stripe lists has been recorded by now.
    const recorded = await db.from("stripe_withdrawals").select("payout_id").eq("org_id", orgId).not("payout_id", "is", null);
    const recordedIds = new Set((recorded.data ?? []).map((row) => row.payout_id));
    return reply(response, 200, {
      ...answer,
      displayFx, recovery,
      upgrade: migration ? { started: true, creationFailed: upgrade.creation_failed, verified: migration.verified, unsettled: migration.unsettled } : null,
      defaultCurrency: account.default_currency,
      available: balance.available.map(({ amount, currency }) => ({ amount, currency })),
      pending: balance.pending.map(({ amount, currency }) => ({ amount, currency })),
      payouts: allocation.payouts.filter((payout) => !recordedIds.has(payout.id)),
      pendingEarnings: allocation.pending,
      // Withdrawals not yet at the bank, and which account each is going to:
      // that account cannot be removed until its money arrives.
      payoutsOnTheirWay: onTheirWay,
      methods,
      // TSC adds and removes payout accounts itself only where Stripe lets it.
      managedByTsc: managedByTsc(account),
    });
  } catch (failure) {
    logStripeFailure("stripe-connect figures", failure, { orgId });
    return reply(response, 502, {
      error: sentenceFor(failure, "That didn't go through, so nothing changed. Try again in a few minutes."),
      figures: { ...balanceFigures(tsc, null, null), stripe_unavailable: true },
      reach: { stripe_cents: 0, pool_cents: poolCents, estimated: false },
      ...shared,
    });
  }
}

/**
 * Logs figures that may not be one moment's: the reads kept changing, or
 * Stripe held more than the database counts as sent and the figures had to
 * be clamped. The clamp is only what shows until the next read (a moving
 * withdrawal is heard by the page, which reads again); logged, so a clamp
 * that keeps firing is seen rather than flattened.
 */
function checkedFigures(figures, consistent, orgId) {
  if (figures.consistent === false || !consistent) console.warn("stripe-connect figures clamped", { orgId, total: figures.total_cents, consistent });
  return figures;
}

/** What open withdrawals hold, per currency, as { amount, currency } rows, never more than is available. */
function heldRows(available, held) {
  return (available ?? []).map(({ amount, currency }) => ({
    amount: Math.min(Number(amount) || 0, held[String(currency).toLowerCase()] ?? 0), currency,
  })).filter((row) => row.amount > 0);
}
