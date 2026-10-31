/** Keep earnings in the connected balance until its owner withdraws them. */
export async function holdPayouts(stripe, accountId) {
  await stripe.accounts.update(accountId, {
    settings: { payouts: { schedule: { interval: "manual" } } },
  });
}

/** Stripe enforces the available balance; retries use the same request key. */
export async function withdrawBalance(stripe, accountId, { amount, currency, requestId }) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !/^[a-z]{3}$/.test(currency ?? "")
    || !/^[0-9a-f-]{36}$/i.test(requestId ?? "")) {
    throw new Error("Choose a valid available balance to withdraw.");
  }
  await holdPayouts(stripe, accountId);
  return stripe.payouts.create({ amount, currency }, {
    stripeAccount: accountId,
    idempotencyKey: `withdraw-${accountId}-${requestId}`,
  });
}

/**
 * A short-lived session for Stripe's embedded payout forms, so a factory sets
 * up and changes its payout account without leaving TSC. On an Express
 * account Stripe asks the person to confirm who they are in a Stripe pop-up
 * (an SMS code) first, and that cannot be turned off. On an account TSC
 * manages, TSC is the one answerable for who changes it, so Stripe lets TSC
 * turn its sign-in off: the TSC sign-in (an owner's) is the check.
 */
export async function payoutSession(stripe, accountId) {
  await holdPayouts(stripe, accountId);
  const account = await stripe.accounts.retrieve(accountId);
  const payoutForm = {
    enabled: true,
    features: {
      external_account_collection: true,
      ...(managedByTsc(account) ? { disable_stripe_user_authentication: true } : {}),
    },
  };
  const session = await stripe.accountSessions.create({
    account: accountId,
    components: { account_onboarding: payoutForm, account_management: payoutForm },
  });
  return session.client_secret;
}

/**
 * Whether TSC may add, remove and choose a factory's payout accounts itself.
 * Stripe allows that only on an account with no Stripe dashboard, where TSC
 * collects its details and carries its losses (accepted in Stripe's platform
 * profile, 2026-10-30). Accounts created before that are Express: their
 * payout accounts change only in Stripe's own form.
 */
export function managedByTsc(account) {
  const controller = account?.controller ?? {};
  return controller.stripe_dashboard?.type === "none"
    && controller.losses?.payments === "application"
    && controller.requirement_collection === "application";
}

/** How a new factory's Stripe account is created: one TSC can manage. */
export const MANAGED_CONTROLLER = {
  stripe_dashboard: { type: "none" },
  losses: { payments: "application" },
  fees: { payer: "application" },
  requirement_collection: "application",
};

/** A payout account as the factory's list shows it. Never more than the last four. */
export function payoutMethodRow(method, defaultCurrency) {
  return {
    id: method.id,
    type: method.object === "card" ? "card" : "bank_account",
    name: method.object === "card" ? method.brand : method.bank_name,
    last4: method.last4,
    currency: method.currency,
    country: method.country,
    // default_for_currency is true for one account per currency, so a EUR
    // account and a USD one are both "default". The default is the one in
    // the account's own currency; the other only takes payouts in its own.
    default: Boolean(method.default_for_currency) && method.currency === defaultCurrency,
    payoutsFor: method.default_for_currency && method.currency !== defaultCurrency ? method.currency : null,
    instant: (method.available_payout_methods ?? []).includes("instant"),
    standard: (method.available_payout_methods ?? ["standard"]).includes("standard"),
  };
}

/** Every payout account, the default first, as Payments and Settings read them. */
export async function listPayoutMethods(stripe, accountId, defaultCurrency) {
  const { data } = await stripe.accounts.listExternalAccounts(accountId, { limit: 20 });
  return data.map((method) => payoutMethodRow(method, defaultCurrency))
    .sort((a, b) => Number(b.default) - Number(a.default));
}

/** A refusal said in the factory's words: a 422 the screen shows as it is. */
export class PayoutMethodRefusal extends Error {}

/**
 * Add a bank account or debit card from a token Stripe.js made in the
 * browser: TSC's server never sees the numbers. A token is single-use, so
 * keying on it can never replay an old failure for a new attempt.
 */
export async function addPayoutMethod(stripe, accountId, { token, makeDefault }) {
  if (!/^(btok|tok)_[A-Za-z0-9]+$/.test(token ?? "")) throw new PayoutMethodRefusal("Enter the account details again.");
  // Withdraw sends a standard payout to the default, which a card that only
  // takes instant payouts cannot receive: a card is never made the default here.
  const isCard = token.startsWith("tok_");
  return stripe.accounts.createExternalAccount(accountId, {
    external_account: token,
    ...(makeDefault && !isCard ? { default_for_currency: true } : {}),
  }, { idempotencyKey: `add-method-${accountId}-${token}` });
}

/** Withdrawals not yet at the bank: their account cannot go until they arrive. */
export async function payoutsOnTheirWay(stripe, accountId) {
  const recent = await stripe.payouts.list({ limit: 20 }, { stripeAccount: accountId });
  return recent.data
    .filter((payout) => payout.status === "pending" || payout.status === "in_transit")
    .map((payout) => ({
      id: payout.id,
      amount: payout.amount,
      currency: payout.currency,
      arrival_date: payout.arrival_date,
      destination: typeof payout.destination === "string" ? payout.destination : payout.destination?.id ?? null,
    }));
}

/**
 * Remove a payout account. Stripe will not delete the default for a
 * currency, so another account in that currency (the one chosen, else the
 * first listed) becomes the default first. The last one cannot go: Stripe
 * keeps one on file, and the factory replaces it instead.
 */
export async function removePayoutMethod(stripe, accountId, { methodId, promoteId }) {
  const { data } = await stripe.accounts.listExternalAccounts(accountId, { limit: 20 });
  const target = data.find((method) => method.id === methodId);
  if (!target) throw new PayoutMethodRefusal("That payout method is no longer listed. It may have been removed already.");
  const onItsWay = (await payoutsOnTheirWay(stripe, accountId)).find((payout) => payout.destination === methodId);
  if (onItsWay) throw new PayoutMethodRefusal("A withdrawal is on its way to this account. You can remove it once it arrives.");
  if (target.default_for_currency) {
    const sameCurrency = data.filter((method) => method.id !== methodId && method.currency === target.currency);
    const next = sameCurrency.find((method) => method.id === promoteId) ?? sameCurrency[0];
    if (!next) {
      throw new PayoutMethodRefusal(data.length <= 1
        ? "Stripe keeps one payout method on file. Add the new one first, then remove this one."
        : `This is your only ${target.currency.toUpperCase()} payout method. Add another ${target.currency.toUpperCase()} one first, then remove this one.`);
    }
    await stripe.accounts.updateExternalAccount(accountId, next.id, { default_for_currency: true });
  }
  await stripe.accounts.deleteExternalAccount(accountId, methodId);
  return target;
}

/** Make one payout account the default for its currency. */
export async function makeDefaultPayoutMethod(stripe, accountId, methodId) {
  const method = await stripe.accounts.retrieveExternalAccount(accountId, methodId);
  if (!(method.available_payout_methods ?? ["standard"]).includes("standard")) {
    throw new PayoutMethodRefusal("This card takes instant payouts only, so withdrawals cannot go to it by default. Keep a bank account as your default.");
  }
  return stripe.accounts.updateExternalAccount(accountId, methodId, { default_for_currency: true });
}
