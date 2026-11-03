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

/**
 * Whether Stripe's answer changes this factory's figures: only once TSC has
 * paid one of its earnings through Stripe. A bank-paid factory, or one paid
 * nothing through Stripe yet, never waits for it.
 */
export const stripeRelevant = (earnings) => Boolean(earnings?.some((row) => row.state === "released" && row.stripe_transfer_id));

/**
 * The four figures over the Transactions list. Each is a list of amounts by
 * currency when known, undefined while a source it needs has not answered
 * (the page draws a placeholder), and null when it cannot be known (Stripe
 * failed, or only an owner may read the balance). Never a partial figure:
 * Pending and Paid out computed before Stripe answered showed one amount,
 * then jumped to another.
 */
export function earningsSummaryFor(earnings, balance, client) {
  if (!earnings) return { total: undefined, approval: undefined, pending: undefined, paid: undefined };
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
  // Whether Stripe matters is the account's question, whichever client is selected.
  const stripeFigure = (figure) => (!stripeRelevant(earnings) || balance ? figure() : balance);
  return {
    total: amounts(funded),
    approval: amounts(funded.filter((row) => row.state === "confirmed" && !row.release_requested_at)),
    pending: stripeFigure(() => amounts(funded.filter((row) => row.state === "confirmed" && row.release_requested_at || pendingIds.has(row.id)))),
    paid: stripeFigure(() => currencyTotals([
      ...paidAmounts, ...bankPaid.map((row) => ({ amount: factoryAmount(row), currency: row.currency })),
    ])),
  };
}

/**
 * Where one earning stands, in the factory's words. Released through Stripe
 * is in the balance only once Stripe has processed it; released by bank went
 * to the factory's bank, never to a balance.
 *
 * `balance` is Stripe's answer: undefined while it is still being read (the
 * list draws before it arrives, and said "Credited to balance" for two
 * seconds before "Pending"), null when it cannot be read (not an owner,
 * Stripe unreachable), when only "sent to Stripe" is known to be true.
 */
export function earningStatus(row, balance) {
  if (row.state !== "released") return row.release_requested_at ? "Pending" : "Awaiting approval";
  if (!row.stripe_transfer_id) return "Paid by bank transfer";
  if (balance === undefined) return "Checking…";
  if (balance === null) return "Sent to your Stripe account";
  return balance.pendingEarnings?.some((pending) => pending.paymentId === row.id) ? "Pending" : "Credited to balance";
}

/** When Stripe makes an earning still pending withdrawable: its day, read as a day. */
export function availableOn(row, balance) {
  const day = balance?.pendingEarnings?.find((pending) => pending.paymentId === row.id)?.available_on;
  return day ? new Date(day * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
}
