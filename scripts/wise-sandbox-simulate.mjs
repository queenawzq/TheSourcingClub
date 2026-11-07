/**
 * Moves a Wise SANDBOX transfer along, as Wise would in real life, so a walk of
 * the board can reach "paid". Test script only: the app never calls simulation,
 * and this refuses any address without "sandbox" in it.
 *
 *   node scripts/wise-sandbox-simulate.mjs <transfer id> [paid | bounced]
 *
 * Reads WISE_API_BASE and WISE_API_TOKEN from the environment or .env.local.
 * The transfer id is the one in the board's "Open in Wise" link.
 */
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^(WISE_API_BASE|WISE_API_TOKEN)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
const base = process.env.WISE_API_BASE ?? "";
const token = process.env.WISE_API_TOKEN ?? "";
const [id, ending = "paid"] = process.argv.slice(2);
if (!/sandbox/i.test(base)) throw new Error("this only runs against a Wise sandbox");
if (!token || !/^\d+$/.test(id ?? "")) throw new Error("usage: wise-sandbox-simulate.mjs <transfer id> [paid | bounced]");

const steps = { paid: ["processing", "funds_converted", "outgoing_payment_sent"], bounced: ["processing", "funds_converted", "outgoing_payment_sent", "bounced_back"] }[ending];
if (!steps) throw new Error("the ending is paid or bounced");
for (const step of steps) {
  const answer = await fetch(`${base}/v1/simulation/transfers/${id}/${step}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await answer.json().catch(() => ({}));
  console.log(step, answer.status, body.status ?? "");
  if (!answer.ok) process.exit(1);
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
