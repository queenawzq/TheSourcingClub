// Local stack only. After `npm run seed:demo`, puts the demo into the state the
// Nov 16 walkthrough expects:
//   - Hangzhou Test Knit (China) and Kowloon Sourcing Partners (Hong Kong) get a
//     complete Tazapay bank account as their default, saved by each owner
//     through the same calls as the form;
//   - Kowloon posts an update on its open fit sample and Demo Brand approves it,
//     so that step is owed per step (Pay with Tazapay on the staff board).
// Lakeside Mills (PayPal) and Ningbo Loomworks (Wise) already have a $65
// balance to withdraw from the seed.
//
//   PAYPAL_TEST_RECEIVER=sb-fjqui30004955@personal.example.com npm run seed:demo
//   node scripts/demo-nov16.mjs
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(execSync("npx supabase status -o json", { stdio: ["ignore", "pipe", "ignore"] }).toString());
if (!/127\.0\.0\.1|localhost/.test(status.API_URL)) throw new Error("This script only runs against a local stack.");
const PASSWORD = "demo password 8";
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };

async function as(email) {
  const client = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false } });
  must(await client.auth.signInWithPassword({ email, password: PASSWORD }), `sign in ${email}`);
  const { data: member } = await client.from("org_members").select("org_id").eq("role", "owner").limit(1).single();
  return { client, org: member?.org_id };
}

const china = await as("demo-factory-china@example.com");
const cn = must(await china.client.rpc("save_tazapay_payout_account", {
  target_org: china.org, bank_country: "CN", bank_name: "Bank of China",
  account_name: "Hangzhou Test Knit Co Ltd", holder_name_local: "杭州测试针织有限公司",
  address_line1: "18 Jiangdong 3rd Road, Xiaoshan", address_city: "Hangzhou",
  account_number: "00000000621785001", account_number_again: "00000000621785001",
}), "China account");
must(await china.client.rpc("choose_payout_method", { target_org: china.org, target_account: cn.id }), "China default");

const hk = await as("demo-trading@example.com");
const hkAccount = must(await hk.client.rpc("save_tazapay_payout_account", {
  target_org: hk.org, bank_country: "HK", bank_name: "HSBC Hong Kong",
  account_name: "Kowloon Sourcing Partners Ltd", bank_code: "004", swift: "HSBCHKHH",
  address_line1: "Unit 1201, 88 Nathan Road, Tsim Sha Tsui", address_state: "Kowloon",
  account_number: "004123456001", account_number_again: "004123456001",
}), "Hong Kong account");
must(await hk.client.rpc("choose_payout_method", { target_org: hk.org, target_account: hkAccount.id }), "Hong Kong default");

// Kowloon's funded fit sample that is not yet approved.
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: orders } = await admin.from("production_orders").select("id, order_number").eq("factory_org_id", hk.org);
let approved = null;
for (const order of orders ?? []) {
  const { data: payments } = await admin.from("order_payments").select("milestone_id, state, release_requested_at").eq("order_id", order.id);
  const open = (payments ?? []).find((p) => p.state === "confirmed" && !p.release_requested_at);
  if (!open) continue;
  must(await hk.client.rpc("post_milestone_update", { target_milestone: open.milestone_id, body: "Fit sample ready: photos and measurements in the conversation.", document_ids: [] }), "Kowloon update");
  const brand = await as("demo-brand@example.com");
  must(await brand.client.rpc("approve_milestone", { target_milestone: open.milestone_id, note: null }), "brand approval");
  approved = order.order_number;
  break;
}
console.log(`Tazapay accounts saved (China, Hong Kong). Kowloon step to pay with Tazapay: ${approved ?? "none found"}.`);
