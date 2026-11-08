/** Available provider funds, less amounts already committed by other approvals. */
export async function withdrawalFunding({ db, withdrawal, stripe, paypal, wise, feeAllowanceCents }) {
  const w = withdrawal;
  const fee = w.provider === 'paypal' ? feeAllowanceCents : 0;
  if (!Number.isSafeInteger(fee) || fee < 0) throw new Error('Enter a total PayPal fee allowance before checking funding.');
  let balance;
  if (w.provider === 'paypal') {
    if (!paypal) throw new Error('PayPal is not configured. Approval stays disabled.');
    balance = await paypal.balance(w.currency);
  } else if (w.provider === 'wise') {
    if (!wise) throw new Error('Wise is not configured. Approval stays disabled.');
    const b = await wise.balance(w.currency);
    balance = { cents: b.cents, currency: b.currency, asOf: new Date().toISOString() };
  } else {
    if (!stripe) throw new Error('Stripe is not configured. Approval stays disabled.');
    const b = await stripe.balance.retrieve();
    balance = { cents: b.available.find(row => row.currency === w.currency.toLowerCase())?.amount ?? 0,
      currency: w.currency, asOf: new Date().toISOString() };
  }
  if (!Number.isSafeInteger(balance.cents) || balance.cents < 0 || balance.currency !== w.currency) throw new Error('Could not verify the selected provider balance. Approval stays disabled.');
  const reserved = await db.rpc('withdrawal_funding_reserved', { which: w.provider, in_currency: w.currency, balance_as_of: balance.asOf, except_request: w.id });
  if (reserved.error || reserved.data == null || !Number.isSafeInteger(Number(reserved.data))) throw new Error('Could not check funding reserved for other withdrawals. Approval stays disabled.');
  const required = Number(w.amount_cents) + fee;
  if (!Number.isSafeInteger(required) || required <= 0) throw new Error("Could not verify the total funding required.");
  const committed = Number(reserved.data);
  return { ready: balance.cents - committed >= required, availableCents: balance.cents,
    reservedCents: committed, requiredCents: required, feeAllowanceCents: fee,
    shortByCents: Math.max(0, required + committed - balance.cents),
    currency: w.currency, balanceAsOf: balance.asOf, checkedAt: new Date().toISOString() };
}
