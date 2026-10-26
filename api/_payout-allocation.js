/**
 * Replay the connected account's complete ledger. A withdrawal consumes the
 * oldest available earnings first, including funds we cannot attribute to an
 * order. Never assign those legacy funds to a guessed client. Amounts stay in
 * the bank/settlement currency; USD contracts must not be added to EUR payouts.
 * Stripe's ledger is the durable record, so retries and page refreshes produce
 * the same allocation without a second, independently writable money ledger.
 */
const sourceId = (source) => typeof source === "string" ? source : source?.id;

export function allocatePayouts(transactions, payments) {
  const byTransfer = new Map(payments.filter((p) => p.stripe_transfer_id).map((p) => [p.stripe_transfer_id, p]));
  const pools = new Map();
  const debts = new Map();
  const withdrawals = new Map();
  const pending = new Map();
  const events = [];

  for (const tx of transactions) {
    const source = typeof tx.source === "object" ? tx.source : null;
    const payment = byTransfer.get(sourceId(source?.source_transfer));
    if (payment && tx.net > 0) {
      if (tx.status === "pending") pending.set(payment.id, { paymentId: payment.id, available_on: tx.available_on });
    }
    // Pending credits cannot finance a withdrawal, even if an estimated
    // availability date has passed. Stripe's actual status is authoritative.
    if (tx.net > 0 && tx.status === "pending") continue;
    events.push({ tx, payment, at: tx.net > 0 ? Math.max(tx.created, tx.available_on) : tx.created });
  }
  events.sort((a, b) => a.at - b.at || (b.tx.net > 0) - (a.tx.net > 0)
    || a.tx.created - b.tx.created || a.tx.id.localeCompare(b.tx.id));

  function add(currency, lot) {
    const debt = debts.get(currency) || 0;
    const repaid = Math.min(debt, lot.amount);
    debts.set(currency, debt - repaid);
    lot.amount -= repaid;
    if (lot.amount <= 0) return;
    const pool = pools.get(currency) || [];
    pool.push(lot);
    pool.sort((a, b) => a.earnedAt - b.earnedAt || (a.created || 0) - (b.created || 0) || a.id.localeCompare(b.id));
    pools.set(currency, pool);
  }

  function consume(currency, amount, preferredSource) {
    const pool = pools.get(currency) || [];
    // A refund/reversal removes its own earning first. Other account debits
    // consume FIFO too, but are never counted as a bank withdrawal.
    const ordered = preferredSource
      ? [...pool.filter((lot) => lot.source === preferredSource), ...pool.filter((lot) => lot.source !== preferredSource)]
      : pool;
    const parts = [];
    for (const lot of ordered) {
      const taken = Math.min(lot.amount, amount);
      if (taken > 0) parts.push({ ...lot, amount: taken });
      lot.amount -= taken;
      amount -= taken;
      if (amount === 0) break;
    }
    pools.set(currency, pool.filter((lot) => lot.amount > 0));
    if (amount > 0) {
      debts.set(currency, (debts.get(currency) || 0) + amount);
      parts.push({ id: "unattributed", amount, earnedAt: 0 });
    }
    return parts;
  }

  for (const { tx, payment, at } of events) {
    const source = typeof tx.source === "object" ? tx.source : null;
    const currency = tx.currency.toUpperCase();
    if (tx.type === "payout" && tx.net < 0) {
      const amount = source?.amount ?? Math.abs(tx.amount);
      const parts = consume(currency, amount);
      // Payout fees reduce the balance but are not money paid to the bank.
      if (Math.abs(tx.net) > amount) consume(currency, Math.abs(tx.net) - amount);
      withdrawals.set(sourceId(tx.source), { id: sourceId(tx.source), amount, currency,
        status: source?.status, created: tx.created, arrival_date: source?.arrival_date,
        parts, returned: false });
    } else if (["payout_failure", "payout_cancel"].includes(tx.type) && tx.net > 0) {
      const withdrawal = withdrawals.get(sourceId(tx.source));
      if (withdrawal && !withdrawal.returned) {
        let restored = tx.net;
        for (const part of withdrawal.parts) {
          const amount = Math.min(restored, part.amount);
          if (amount > 0) add(currency, { ...part, amount });
          restored -= amount;
        }
        withdrawal.returned = true;
        if (restored > 0) add(currency, { id: tx.id, earnedAt: at, amount: restored });
      } else add(currency, { id: tx.id, earnedAt: at, amount: tx.net });
    } else if (tx.net > 0) {
      add(currency, { id: tx.id, source: sourceId(tx.source), earnedAt: at, created: tx.created, amount: tx.net, paymentId: payment?.id });
    } else if (tx.net < 0) {
      consume(currency, -tx.net, sourceId(source?.charge));
    }
  }

  return {
    pending: [...pending.values()].sort((a, b) => a.paymentId.localeCompare(b.paymentId)),
    payouts: [...withdrawals.values()].map(({ parts, returned, ...payout }) => ({
      ...payout,
      allocations: parts.filter((part) => part.paymentId).map((part) => ({ paymentId: part.paymentId, amount: part.amount })),
      // A failure can arrive after a "paid" status. Never count returned funds.
      paid: payout.status === "paid" && !returned,
    })),
  };
}

/** Fully paginate: a client's lifetime total must not stop at 25 withdrawals. */
export async function payoutAllocationFor(stripe, db, orgId, accountId) {
  const transactions = [];
  for await (const transaction of stripe.balanceTransactions.list({ limit: 100, expand: ["data.source"] }, { stripeAccount: accountId })) {
    transactions.push(transaction);
  }
  // Read every linked payment, including refunded orders, to preserve its
  // historical withdrawal attribution. Scope on the server to this factory.
  const payments = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("order_payments")
      .select("id, stripe_transfer_id, production_orders!inner(factory_org_id)")
      .eq("production_orders.factory_org_id", orgId).order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    payments.push(...data);
    if (data.length < 1000) break;
  }
  return allocatePayouts(transactions, payments);
}
