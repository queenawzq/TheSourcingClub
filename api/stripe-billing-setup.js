import { callerClient, jsonBody, reply, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";

/** Save a card for future company billing. */
export default async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });
  let stripe;
  try { stripe = stripeFrom(); } catch (failure) { return reply(response, 503, { error: failure.message }); }
  const db = serviceClient();
  const caller = callerClient(request);
  if (!stripe || !db) return reply(response, 503, { error: "payments are not set up on this site yet" });
  if (!caller) return reply(response, 401, { error: "sign in is required" });

  const { orgId } = jsonBody(request);
  const [owner, orgRead, { data: auth }] = await Promise.all([
    caller.rpc("has_org_permission", { target_org: orgId, perm: "settingsAccess" }),
    caller.from("orgs").select("id, name").eq("id", orgId).maybeSingle(),
    caller.auth.getUser(),
  ]);
  if (tokenRefused(owner) || tokenRefused(orgRead)) return reply(response, 401, { error: "sign in is required" });
  const { data: isOwner } = owner;
  const { data: org } = orgRead;
  if (!isOwner || !org) return reply(response, 403, { error: "only someone with Settings access at the company can manage billing methods" });

  try {
    let { data: saved } = await db.from("stripe_customers").select("stripe_customer_id").eq("org_id", orgId).maybeSingle();
    if (!saved) {
      const customer = await stripe.customers.create({ name: org.name ?? undefined, email: auth?.user?.email ?? undefined, metadata: { org_id: orgId } });
      await db.from("stripe_customers").upsert({ org_id: orgId, stripe_customer_id: customer.id }, { onConflict: "org_id", ignoreDuplicates: true });
      ({ data: saved } = await db.from("stripe_customers").select("stripe_customer_id").eq("org_id", orgId).single());
    }
    const setup = await stripe.setupIntents.create({
      customer: saved.stripe_customer_id,
      usage: "on_session",
      payment_method_types: ["card"],
      metadata: { org_id: orgId },
    });
    return reply(response, 200, { clientSecret: setup.client_secret });
  } catch (failure) {
    return reply(response, 502, { error: failure.message });
  }
}
