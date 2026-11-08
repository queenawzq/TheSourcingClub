/**
 * Moves a Wise SANDBOX transfer along, as Wise would in real life, so a walk of
 * the board can reach "paid". Test script only: the app never calls simulation,
 * and this refuses any address without "sandbox" in it.
 *
 *   node scripts/wise-sandbox-simulate.mjs <transfer id> [paid | bounced | record-paid]
 *
 * Reads WISE_API_BASE and WISE_API_TOKEN from the environment or .env.local.
 * The transfer id is the one in the board's "Open in Wise" link.
 *
 * record-paid is for a demo on a sandbox that stops an unfunded transfer ("Transfer
 * processing is suspended"): it writes "paid" with the server key, as the app would
 * on reading it from Wise. That's our script speaking, not Wise. Say so. It needs
 * SUPABASE_URL and SUPABASE_SERVICE_KEY, and refuses the production project.
 */
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^(WISE_API_BASE|WISE_API_TOKEN|SUPABASE_URL|SUPABASE_SERVICE_KEY)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
const base = process.env.WISE_API_BASE ?? "";
const token = process.env.WISE_API_TOKEN ?? "";
const [id, ending = "paid"] = process.argv.slice(2);
if (!/sandbox/i.test(base)) throw new Error("this only runs against a Wise sandbox");
if (!token || !/^\d+$/.test(id ?? "")) throw new Error("usage: wise-sandbox-simulate.mjs <transfer id> [paid | bounced | record-paid]");

if (ending === "record-paid") {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? "";
  if (!url || !key) throw new Error("record-paid needs SUPABASE_URL and SUPABASE_SERVICE_KEY");
  if (url.includes("wxzliajdtwekqdvwzqfb")) throw new Error("STOP: production");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: payout, error } = await db.from("provider_payouts").select("id, status").eq("provider", "wise").eq("provider_ref", id).maybeSingle();
  if (error || !payout) throw new Error("no such transfer on this database");
  const done = await db.rpc("finish_provider_payout", { target_payout: payout.id, outcome: "paid", raw_status: "recorded_by_test_script" });
  if (done.error) throw done.error;
  console.log("recorded as paid by this script, not by Wise");
  process.exit(0);
}

const steps = { paid: ["processing", "funds_converted", "outgoing_payment_sent"], bounced: ["processing", "funds_converted", "outgoing_payment_sent", "bounced_back"] }[ending];
if (!steps) throw new Error("the ending is paid or bounced");
for (const step of steps) {
  const answer = await fetch(`${base}/v1/simulation/transfers/${id}/${step}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await answer.json().catch(() => ({}));
  console.log(step, answer.status, body.status ?? "");
  if (!answer.ok) { console.log(JSON.stringify(body).slice(0, 300)); process.exit(1); }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
