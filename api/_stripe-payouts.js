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
