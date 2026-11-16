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
else throw new Error("usage: fee-sandbox-proof.mjs wise|paypal|stripe|tiny [amount cents]");
