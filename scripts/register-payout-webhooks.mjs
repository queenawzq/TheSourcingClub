/**
 * Point Wise's and PayPal's payout webhooks at a site, through their APIs.
 *
 *   node scripts/register-payout-webhooks.mjs https://<site>          register both
 *   node scripts/register-payout-webhooks.mjs --list                  list what is registered
 *
 * Reads WISE_API_BASE, WISE_API_TOKEN, WISE_PROFILE_ID, PAYPAL_API_BASE,
 * PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET from the environment or .env.local,
 * so it registers on whichever account those are (sandbox or live). Prints ids
 * and addresses, never a key.
 *
 * The site must be public HTTPS on 443 with no query string: Wise and PayPal
 * can't reach a Vercel preview behind its sign-in, nor localhost. PayPal's
 * answer includes the webhook id: set it as PAYPAL_WEBHOOK_ID on that site.
 */
import { existsSync, readFileSync } from "node:fs";

const NAMES = ["WISE_API_BASE", "WISE_API_TOKEN", "WISE_PROFILE_ID", "PAYPAL_API_BASE", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"];
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && NAMES.includes(match[1]) && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
const env = process.env;
const [arg] = process.argv.slice(2);
const listOnly = arg === "--list";
const site = listOnly ? null : String(arg ?? "").replace(/\/+$/, "");
if (!listOnly && !/^https:\/\/[a-z0-9.-]+$/i.test(site)) {
  throw new Error("usage: register-payout-webhooks.mjs https://<public site, no path, no port> | --list");
}

const PAYPAL_EVENTS = ["SUCCEEDED", "FAILED", "RETURNED", "UNCLAIMED", "BLOCKED", "REFUNDED", "HELD", "CANCELED"]
  .map((s) => `PAYMENT.PAYOUTS-ITEM.${s}`).concat(["PAYMENT.PAYOUTSBATCH.DENIED", "PAYMENT.PAYOUTSBATCH.SUCCESS"]);

async function wise() {
  const base = String(env.WISE_API_BASE ?? "").replace(/\/+$/, "");
  if (!base || !env.WISE_API_TOKEN || !env.WISE_PROFILE_ID) return console.log("Wise: not set up here, skipped");
  const headers = { Authorization: `Bearer ${env.WISE_API_TOKEN}`, "Content-Type": "application/json" };
  const path = `${base}/v3/profiles/${env.WISE_PROFILE_ID}/subscriptions`;
  const listed = await fetch(path, { headers });
  const existing = listed.ok ? await listed.json() : [];
  if (!listed.ok) console.log(`Wise: listing answered ${listed.status}`);
  for (const s of existing) console.log(`Wise: ${s.id} ${s.trigger_on} -> ${s.delivery?.url}`);
  if (listOnly) return;
  const url = `${site}/api/wise-webhook`;
  if (existing.some((s) => s.trigger_on === "transfers#state-change" && s.delivery?.url === url)) return console.log("Wise: already registered");
  const made = await fetch(path, {
    method: "POST", headers,
    body: JSON.stringify({ name: "TSC payouts", trigger_on: "transfers#state-change", delivery: { version: "4.0.0", url } }),
  });
  const body = await made.json().catch(() => ({}));
  console.log(made.ok ? `Wise: registered ${body.id} -> ${url}` : `Wise: refused (${made.status}) ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
}

async function paypal() {
  const base = String(env.PAYPAL_API_BASE ?? "").replace(/\/+$/, "");
  if (!base || !env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) return console.log("PayPal: not set up here, skipped");
  const auth = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST", body: "grant_type=client_credentials",
    headers: { Authorization: `Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const token = (await auth.json()).access_token;
  if (!token) return console.log(`PayPal: sign-in refused (${auth.status})`);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const listed = await (await fetch(`${base}/v1/notifications/webhooks`, { headers })).json();
  for (const w of listed.webhooks ?? []) console.log(`PayPal: ${w.id} -> ${w.url} (${(w.event_types ?? []).length} events)`);
  if (listOnly) return;
  const url = `${site}/api/paypal-webhook`;
  const same = (listed.webhooks ?? []).find((w) => w.url === url);
  if (same) return console.log(`PayPal: already registered. Set PAYPAL_WEBHOOK_ID=${same.id}`);
  const made = await fetch(`${base}/v1/notifications/webhooks`, {
    method: "POST", headers, body: JSON.stringify({ url, event_types: PAYPAL_EVENTS.map((name) => ({ name })) }),
  });
  const body = await made.json().catch(() => ({}));
  console.log(made.ok ? `PayPal: registered. Set PAYPAL_WEBHOOK_ID=${body.id}` : `PayPal: refused (${made.status}) ${JSON.stringify(body.details ?? body).slice(0, 300)}`);
}

await wise();
await paypal();
