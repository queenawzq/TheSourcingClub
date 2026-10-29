export const factoryAmount = (row) => row.charged_cents ? row.amount_cents : row.amount_received_cents ?? row.amount_cents;

/** Keep currencies separate: a converted bank withdrawal is not a USD total. */
export function currencyTotals(rows) {
  const totals = new Map();
  for (const { amount, currency } of rows) {
    const code = currency.toUpperCase();
    totals.set(code, (totals.get(code) || 0) + Number(amount));
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

export function earningsSummaryFor(earnings, balance, client) {
  const all = client === "All clients";
  const byId = new Map(earnings.map((row) => [row.id, row]));
  const selected = (row) => all || row?.order?.brand_org_id === client;
  const funded = earnings.filter((row) => ["confirmed", "released"].includes(row.state) && selected(row));
  const amounts = (rows) => currencyTotals(rows.map((row) => ({ amount: factoryAmount(row), currency: row.currency })));
  const pendingIds = new Set(balance?.pendingEarnings?.map((row) => row.paymentId));
  // Paid out with no Stripe transfer: TSC sent it by bank (where Stripe cannot
  // pay out), whether the brand paid by card or by an old bank wire.
  const bankPaid = earnings.filter((row) => row.state === "released" && !row.stripe_transfer_id && selected(row));
  const paid = balance?.payouts?.filter((row) => row.paid) || [];
  const paidAmounts = paid.flatMap((row) => all
    ? [{ amount: row.amount, currency: row.currency }]
    : row.allocations.filter((part) => selected(byId.get(part.paymentId)))
      .map((part) => ({ amount: part.amount, currency: row.currency })));
  return {
    total: amounts(funded),
    approval: amounts(funded.filter((row) => row.state === "confirmed" && !row.release_requested_at)),
    pending: !balance && funded.some((row) => row.state === "released" && row.stripe_transfer_id)
      ? null : amounts(funded.filter((row) => row.state === "confirmed" && row.release_requested_at || pendingIds.has(row.id))),
    paid: !balance && !bankPaid.length ? null : currencyTotals([
      ...paidAmounts, ...bankPaid.map((row) => ({ amount: factoryAmount(row), currency: row.currency })),
    ]),
  };
}

/**
 * Where one earning stands, in the factory's words. Released through Stripe
 * is in the balance only once Stripe has processed it; released by bank went
 * to the factory's bank, never to a balance.
 */
export function earningStatus(row, balance) {
  if (row.state !== "released") return row.release_requested_at ? "Pending" : "Awaiting approval";
  if (!row.stripe_transfer_id) return "Paid by bank transfer";
  return balance?.pendingEarnings?.some((pending) => pending.paymentId === row.id) ? "Pending" : "Credited to balance";
}
