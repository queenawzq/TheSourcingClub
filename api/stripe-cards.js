import { callerClient, jsonBody, reply, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";

/**
 * A company's saved cards: every brand payment saves the card it was paid
 * with (setup_future_usage in stripe-checkout.js), and Settings saves one on
 * its own (stripe-billing-setup.js), both to the company's one Stripe
 * customer. This lists them, and removes one.
 *
 *   list    any member of the company: [{ id, brand, last4, expMonth, expYear }]
 *   remove  Settings access only, and only a card saved to this company's customer
 *
 * Who may ask is decided by the database as the CALLER (is_org_member,
 * has_org_permission). Listing never creates a customer: a company that has never
 * paid or saved a card simply has none.
 */
export default async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });
  let stripe;
  try { stripe = stripeFrom(); } catch (failure) { return reply(response, 503, { error: failure.message }); }
  const db = serviceClient();
  const caller = callerClient(request);
  if (!stripe || !db) return reply(response, 503, { error: "payments are not set up on this site yet" });
  if (!caller) return reply(response, 401, { error: "sign in is required" });

  const { orgId, action, paymentMethodId } = jsonBody(request);
  if (action !== "list" && action !== "remove") return reply(response, 400, { error: "unknown action" });
  if (action === "remove" && (typeof paymentMethodId !== "string" || !paymentMethodId)) {
    return reply(response, 400, { error: "which card to remove is missing" });
  }

  const [member, owner] = await Promise.all([
    caller.rpc("is_org_member", { target_org: orgId }),
    caller.rpc("has_org_permission", { target_org: orgId, perm: "settingsAccess" }),
  ]);
  if (tokenRefused(member) || tokenRefused(owner)) return reply(response, 401, { error: "sign in is required" });
  if (!member.data) return reply(response, 403, { error: "only a member of this company can see its saved cards" });
  if (action === "remove" && !owner.data) return reply(response, 403, { error: "only someone with Settings access at the company can remove a saved card" });

  try {
    const { data: saved } = await db.from("stripe_customers").select("stripe_customer_id").eq("org_id", orgId).maybeSingle();
    const customer = saved?.stripe_customer_id ?? null;

    if (action === "list") {
      if (!customer) return reply(response, 200, { cards: [] });
      const methods = await stripe.paymentMethods.list({ customer, type: "card", limit: 100 });
      return reply(response, 200, { cards: methods.data.map(cardOf) });
    }

    // Only a card on this company's own customer: a payment method id from
    // anywhere else (another company, another app on TSC's account) is
    // answered exactly as one that does not exist.
    const method = customer
      ? await stripe.paymentMethods.retrieve(paymentMethodId).catch((failure) => {
          if (failure?.code === "resource_missing") return null;
          throw failure;
        })
      : null;
    const methodCustomer = typeof method?.customer === "string" ? method.customer : method?.customer?.id ?? null;
    if (!method || !customer || methodCustomer !== customer) {
      return reply(response, 404, { error: "that card is not saved to this company" });
    }
    await stripe.paymentMethods.detach(method.id);
    return reply(response, 200, { removed: method.id });
  } catch (failure) {
    return reply(response, 502, { error: failure.message });
  }
}

/** "Visa", "American Express": the same shape stripe-checkout.js gives the Fund screen. */
function cardOf(method) {
  return {
    id: method.id,
    brand: (method.card?.display_brand ?? method.card?.brand ?? "Card")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    last4: method.card?.last4 ?? "",
    expMonth: method.card?.exp_month ?? null,
    expYear: method.card?.exp_year ?? null,
  };
}
