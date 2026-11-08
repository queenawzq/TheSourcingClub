/**
 * One real $1.00 payment through the PayPal SANDBOX to PAYPAL_TEST_RECEIVER, by
 * the same module the board uses, read back until PayPal says where it ended.
 * Test script only: refuses any address without "sandbox" in it.
 *
 *   node scripts/paypal-sandbox-check.mjs
 *
 * Reads PAYPAL_API_BASE, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and
 * PAYPAL_TEST_RECEIVER from the environment or .env.local. Prints no key.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { paypalFrom } from "../api/_paypal.js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^(PAYPAL_[A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
const receiver = process.env.PAYPAL_TEST_RECEIVER;
if (!/sandbox/i.test(process.env.PAYPAL_API_BASE ?? "")) throw new Error("this only runs against a PayPal sandbox");
if (!receiver) throw new Error("set PAYPAL_TEST_RECEIVER to a sandbox personal account's email");

const paypal = paypalFrom();
const key = randomUUID();
const { batchId } = await paypal.pay({ key, email: receiver, amountCents: 100, currency: "USD", reference: "TSC sandbox check" });
console.log("batch", batchId);
const again = await paypal.pay({ key, email: receiver, amountCents: 100, currency: "USD", reference: "TSC sandbox check" });
console.log(again.batchId === batchId ? "same key: same batch, paid once" : `DOUBLE: ${again.batchId}`);
for (let tries = 0; tries < 12; tries += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const status = await paypal.status(batchId);
  console.log(status.raw, "→", status.state);
  if (status.state === "paid" || status.state === "failed" || status.raw === "UNCLAIMED") {
    console.log(status.state === "paid" ? "PayPal paid: the board will read this as paid" : "NOT paid: this receiver is not a sandbox account that can take it");
    process.exit(status.state === "paid" ? 0 : 1);
  }
}
console.log("still not finished after 2 minutes");
process.exit(1);
