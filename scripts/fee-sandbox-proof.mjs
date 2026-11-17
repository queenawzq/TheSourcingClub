/**
 * Proof that the factory pays each provider's payout fee and TSC none, with
 * sandbox money, through the same modules the server uses: the fee from
 * src/shared/withdrawal-fees.mjs, then Wise's / PayPal's / Stripe's own
 * answers, and TSC's balance read before and after.
 *
 *   node scripts/fee-sandbox-proof.mjs wise   [amount cents]   (Wise sandbox, EUR recipient)
 *   node scripts/fee-sandbox-proof.mjs paypal [amount cents]   (PayPal sandbox, PAYPAL_TEST_RECEIVER)
 *   node scripts/fee-sandbox-proof.mjs stripe [amount cents] [connected account id]   (Stripe test mode)
 *   node scripts/fee-sandbox-proof.mjs tiny                    (a payment smaller than its fee: refused, nothing sent)
 *   node scripts/fee-sandbox-proof.mjs stripe-withdraw [US account] [non-US account]
 *       (Stripe test mode, 2026-11-17 design: two steps transferred in full, one
 *       smaller than its fee; one withdrawal through api/_stripe-withdrawals.js:
 *       reversal = fee, payout = X - fee, TSC's balance up by the fee to the
 *       cent; a withdrawal at or under the fee refused with nothing sent)
 *
 * Test script only: refuses any Wise/PayPal address without "sandbox" and any
 * Stripe key that is not sk_test_. Reads .env.local; prints no key.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import Stripe from "stripe";
import { wiseFrom } from "../api/_wise.js";
import { paypalFrom } from "../api/_paypal.js";
import { withdrawalFee, providerCharge } from "../src/shared/withdrawal-fees.mjs";
import { withdrawWithFee } from "../api/_stripe-withdrawals.js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^((?:WISE|PAYPAL|STRIPE)_[A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

const [which, amountArg, accountArg] = process.argv.slice(2);
const usd = (cents) => `US$${(cents / 100).toFixed(2)}`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const row = (r) => console.log(`| ${r.provider} | ${usd(r.amount)} | ${usd(r.fee)} | ${r.receives} | ${usd(r.left)} | ${r.left === r.amount ? "yes" : `NO (${usd(r.left - r.amount)})`} | ${r.ref} |`);

async function wise(amount = 10000) {
  if (!/sandbox/i.test(process.env.WISE_API_BASE ?? "")) throw new Error("Wise sandbox only");
  const client = wiseFrom();
  const before = (await client.balance("USD")).cents;
  if (before < amount) throw new Error(`top up the Wise sandbox first: USD ${before / 100}`);
  const recipientId = await client.createRecipient({
    type: "iban", currency: "EUR", accountHolderName: "Fee Proof Textiles GmbH",
    details: { legalType: "BUSINESS", IBAN: "DE89370400440532013000" },
  });
  const quote = await client.quote({ sourceCurrency: "USD", targetCurrency: "EUR", amountCents: amount, recipientId });
  const fee = withdrawalFee({ provider: "wise", amountCents: amount, currency: "USD", quotedFeeCents: quote.feeCents });
  if (fee.refused) throw new Error(fee.refused);
  console.log("quote", { fee: quote.feeCents, total: quote.totalCents, arrives: `${quote.arrivesCurrency} ${quote.arrivesCents / 100}`, rate: quote.rate });
  const transfer = await client.createTransfer({ recipientId, quoteId: quote.id, key: randomUUID(), reference: "TSC fee proof" });
  const funding = await client.fund(transfer.id);
  if (!funding.funded) throw new Error(`not funded: ${funding.why}`);
  await wait(2000);
  const after = (await client.balance("USD")).cents;
  const status = await client.status(transfer.id);
  row({
    provider: "Wise (USD→EUR)", amount, fee: fee.feeCents,
    receives: `${usd(fee.receivesCents)} → EUR ${(status.arrivesCents ?? quote.arrivesCents) / 100}`,
    left: before - after, ref: `transfer ${transfer.id} (${status.raw})`,
  });
}

async function paypalBalance(base) {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  const auth = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }).then((r) => r.json());
  const get = (path) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${auth.access_token}` } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  return { get };
}

async function paypal(amount = 10000) {
  const base = process.env.PAYPAL_API_BASE ?? "";
  if (!/sandbox/i.test(base)) throw new Error("PayPal sandbox only");
  const receiver = process.env.PAYPAL_TEST_RECEIVER || "sb-fjqui30004955@personal.example.com";
  const api = await paypalBalance(base);
  const readBalance = async () => {
    const answer = await api.get("/v1/reporting/balances?currency_code=USD");
    const usdRow = (answer.body?.balances ?? []).find((b) => b.currency === "USD");
    return usdRow ? Math.round(Number(usdRow.total_balance.value) * 100) : null;
  };
  const client = paypalFrom();
  const before = await readBalance();
  // The factory's country decides PayPal's cap; this receiver is a US sandbox account.
  const fee = withdrawalFee({ provider: "paypal", amountCents: amount, currency: "USD", country: "US" });
  if (fee.refused) throw new Error(fee.refused);
  const { batchId } = await client.pay({ key: randomUUID(), email: receiver, amountCents: fee.receivesCents, currency: "USD", reference: "TSC fee proof" });
  let batch;
  for (let tries = 0; tries < 12; tries += 1) {
    await wait(5000);
    batch = await api.get(`/v1/payments/payouts/${batchId}`);
    const item = batch.body?.items?.[0];
    if (item && item.transaction_status !== "PENDING") break;
  }
  const item = batch.body.items[0];
  const paypalFee = Math.round(Number(item.payout_item_fee?.value ?? 0) * 100);
  const after = await readBalance();
  console.log("paypal", { sent: fee.receivesCents, paypalChargedTsc: paypalFee, ourFormulaSaid: providerCharge("paypal", "US")(fee.receivesCents), status: item.transaction_status, balanceRead: before != null && after != null });
  const left = before != null && after != null ? before - after : fee.receivesCents + paypalFee;
  row({
    provider: `PayPal${before == null ? " (left = sent + PayPal's item fee)" : ""}`, amount, fee: fee.feeCents,
    receives: usd(Math.round(Number(item.payout_item.amount.value) * 100)), left, ref: `batch ${batchId} (${item.transaction_status})`,
  });
}

async function stripe(amount = 10000, accountId = null) {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) throw new Error("Stripe test mode only");
  const client = new Stripe(key);
  let account;
  if (accountId) account = await client.accounts.retrieve(accountId);
  else {
    for await (const each of client.accounts.list({ limit: 100 })) {
      if (each.capabilities?.transfers === "active" && each.payouts_enabled) { account = each; break; }
    }
  }
  if (!account) throw new Error("no test connected account with transfers active");
  const fee = withdrawalFee({ provider: "stripe", amountCents: amount, currency: "USD", country: account.country });
  if (fee.refused) throw new Error(fee.refused);
  // A brand's card payment, available at once in test mode.
  const intent = await client.paymentIntents.create({
    amount, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" }, metadata: { purpose: "TSC fee proof" },
  });
  const charge = intent.latest_charge;
  const transfer = await client.transfers.create({
    amount: fee.receivesCents, currency: "usd", destination: account.id, source_transaction: charge,
    description: "TSC fee proof", metadata: { payout_fee_cents: String(fee.feeCents) },
  });
  // What left TSC's balance for the transfer, by Stripe's own ledger line.
  const ledger = await client.balanceTransactions.retrieve(transfer.balance_transaction);
  const transferOut = -ledger.net;
  const landedPayment = await client.charges.retrieve(transfer.destination_payment, { expand: ["balance_transaction"] }, { stripeAccount: account.id });
  const landed = landedPayment.balance_transaction;
  // The factory withdraws what it received, in its account's currency; Stripe
  // bills TSC its payout fee on that payout (monthly, so it is computed here).
  let payout;
  try {
    const own = await client.balance.retrieve({}, { stripeAccount: account.id });
    const available = own.available.find((b) => b.currency === landed?.currency)?.amount ?? 0;
    payout = available >= (landed?.net ?? Infinity)
      ? (await client.payouts.create({ amount: landed.net, currency: landed.currency }, { stripeAccount: account.id })).id
      : `not yet: ${landed?.currency} ${(landed?.net ?? 0) / 100} pending in the factory's balance`;
  } catch (failure) {
    payout = `not made: ${failure.message}`;
  }
  const stripeBill = providerCharge("stripe", account.country)(fee.receivesCents);
  console.log("stripe", { account: account.id, country: account.country, transferOut, landed: landed ? `${landed.currency} ${landed.net / 100}` : null, stripePayoutFeeBilledToTsc: stripeBill, tscKeepsForIt: fee.feeCents, payout });
  row({
    provider: `Stripe (${account.country})`, amount, fee: fee.feeCents,
    receives: `${usd(transfer.amount)}${landed && landed.currency !== "usd" ? ` → ${landed.currency.toUpperCase()} ${landed.net / 100}` : ""}`,
    left: transferOut + stripeBill, ref: `transfer ${transfer.id}, payout ${payout}`,
  });
}

/** The stripe_withdrawals table, in memory: the proof runs without a database. */
function memoryDb() {
  const rows = [];
  const q = (filters = [], patch = null) => {
    const matches = () => rows.filter((row) => filters.every((f) => f(row)));
    const self = {
      select: () => self,
      update: (fields) => q(filters, fields),
      eq: (column, value) => { filters.push((row) => row[column] === value); if (patch) for (const row of matches()) Object.assign(row, structuredClone(patch)); return self; },
      in: (column, values) => { filters.push((row) => values.includes(row[column])); return self; },
      maybeSingle: async () => ({ data: structuredClone(matches()[0] ?? null), error: null }),
      then: (resolve, reject) => Promise.resolve({ data: structuredClone(matches()), error: null }).then(resolve, reject),
    };
    return self;
  };
  return {
    rows,
    from: () => q(),
    async rpc(name, args) {
      if (name === "claim_abandoned_stripe_withdrawal") return { data: null, error: null };
      let row = rows.find((r) => r.request_key === args.key);
      if (!row) {
        row = { id: randomUUID(), org_id: args.target_org, stripe_account_id: args.account, request_key: args.key, request_id: args.request,
          amount_minor: args.amount, currency: args.in_currency.toUpperCase(), destination: null, fee_cents: null, fee_local_minor: null,
          reversals: [], payout_id: null, payout_minor: null, state: "claimed", reason: null, lease_until: new Date(Date.now() + 120_000).toISOString() };
        rows.push(row);
        return { data: { claimed: true, row: structuredClone(row) }, error: null };
      }
      return { data: { claimed: false, row: structuredClone(row) }, error: null };
    },
  };
}

async function stripeWithdraw(usAccount = "acct_1UcSFOLbQyKIg1mL", abroadAccount = "acct_1UXTHkLeW1XOkYRe") {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key.startsWith("sk_test_")) throw new Error("Stripe test mode only");
  const client = new Stripe(key);
  const platformUsd = async () => (await client.balance.retrieve()).available.find((b) => b.currency === "usd")?.amount ?? 0;
  const ownReversals = async (accountId) => {
    let n = 0;
    for await (const transfer of client.transfers.list({ destination: accountId, limit: 20 })) {
      for await (const reversal of client.transfers.listReversals(transfer.id, { limit: 100 })) if (reversal.metadata?.stripe_withdrawal_id) n += 1;
    }
    return n;
  };
  const results = [];
  for (const accountId of [usAccount, abroadAccount]) {
    const account = await client.accounts.retrieve(accountId);
    // Two approved steps, each released in full the way api/_stripe.js does it:
    // a normal US$100.00 step, then a US$0.20 step, smaller than any payout fee.
    const steps = [];
    for (const step of [10_000, 20]) {
      const intent = await client.paymentIntents.create({
        amount: step + 1000, currency: "usd", payment_method: "pm_card_bypassPending", confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" }, metadata: { purpose: "TSC withdrawal fee proof" },
      });
      const transfer = await client.transfers.create({ amount: step, currency: "usd", destination: accountId, source_transaction: intent.latest_charge, description: "TSC withdrawal fee proof: step" });
      const landed = (await client.charges.retrieve(transfer.destination_payment, { expand: ["balance_transaction"] }, { stripeAccount: accountId })).balance_transaction;
      steps.push({ step, transfer: transfer.id, sent: transfer.amount, landed: `${landed.currency.toUpperCase()} ${landed.amount}`, rate: landed.exchange_rate, landedMinor: landed.amount, currency: landed.currency });
    }
    console.log(`\n### ${account.country} (${accountId}, balance in ${account.default_currency.toUpperCase()})`);
    for (const s of steps) console.log(`step US$${(s.step / 100).toFixed(2)} → transfer ${s.transfer}: sent ${s.sent}¢ (in full), landed ${s.landed}${s.rate ? ` at ${s.rate}` : ""}`);
    const currency = steps[0].currency;
    const db = memoryDb();
    const args = { stripe: client, db, orgId: "proof", accountId, country: account.country, currency };

    // At or under the fee: refused, nothing reversed, nothing paid out.
    const tinyAmount = currency === "usd" ? 26 : 20;
    const reversalsBefore = await ownReversals(accountId);
    const platformBeforeTiny = await platformUsd();
    let tinyRefusal = null;
    try { await withdrawWithFee({ ...args, amount: tinyAmount, requestId: randomUUID() }); } catch (failure) { tinyRefusal = failure.message; }
    const tinyClean = Boolean(tinyRefusal) && (await ownReversals(accountId)) === reversalsBefore && (await platformUsd()) === platformBeforeTiny;
    console.log(`withdraw ${currency.toUpperCase()} ${(tinyAmount / 100).toFixed(2)}: ${tinyRefusal ?? "NOT REFUSED"} → nothing reversed, TSC unchanged: ${tinyClean ? "yes" : "NO"}`);

    // The withdrawal: what the normal step landed as.
    const amount = steps[0].landedMinor;
    const before = await platformUsd();
    const payout = await withdrawWithFee({ ...args, amount, requestId: randomUUID() });
    const after = await platformUsd();
    const row = db.rows.at(-1);
    const reversed = row.reversals.reduce((sum, r) => sum + r.amount, 0);
    const checks = {
      reversalIsFee: reversed === row.fee_cents,
      payoutIsXLessFee: payout.amount === amount - row.fee_local_minor,
      tscGainsFee: after - before === row.fee_cents,
      tinyRefused: tinyClean,
    };
    console.log(`withdraw ${currency.toUpperCase()} ${(amount / 100).toFixed(2)}: fee US$${(row.fee_cents / 100).toFixed(2)} by ${row.reversals.length} reversal(s): ${row.reversals.map((r) => `${r.reversal} ${r.amount}¢ of ${r.transfer} (−${r.local} ${currency.toUpperCase()} minor)`).join(", ")}; payout ${payout.id} ${currency.toUpperCase()} ${(payout.amount / 100).toFixed(2)}; TSC's available US$ ${before} → ${after} (+${after - before}¢)`);
    console.log(`checks: ${JSON.stringify(checks)}`);
    results.push({ country: account.country, ...checks });
  }
  const ok = results.every((r) => r.reversalIsFee && r.payoutIsXLessFee && r.tscGainsFee && r.tinyRefused);
  console.log(`\n${ok ? "PROVED" : "NOT PROVED"}: ${JSON.stringify(results)}`);
  if (!ok) process.exitCode = 1;
}

function tiny() {
  for (const args of [
    { provider: "stripe", amountCents: 25, country: "US" },
    { provider: "paypal", amountCents: 1, country: "US" },
    { provider: "wise", amountCents: 300, quotedFeeCents: 412 },
  ]) console.log(args.provider, withdrawalFee(args).refused);
}

console.log("| Provider | Amount | Fee (factory pays) | Factory receives | Left TSC's balance | = amount? | Reference |");
console.log("|---|---|---|---|---|---|---|");
const amount = amountArg ? Number(amountArg) : undefined;
if (which === "wise") await wise(amount);
else if (which === "paypal") await paypal(amount);
else if (which === "stripe") await stripe(amount, accountArg);
else if (which === "tiny") tiny();
else if (which === "stripe-withdraw") await stripeWithdraw(amountArg, accountArg);
else throw new Error("usage: fee-sandbox-proof.mjs wise|paypal|stripe|stripe-withdraw|tiny [amount cents]");
