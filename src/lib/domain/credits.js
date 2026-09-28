/**
 * Credits, discount codes and referrals.
 *
 * Migration 005 built all three and nothing read them from the brand side, so
 * the designed Savings card showed a hardcoded "$50" to every brand whether or
 * not it had a penny of credit. These are the real figures.
 *
 * The ledger is append-only and unwritable from a client by design: a balance
 * is the sum of lines written by definer functions. Referrals are the one
 * thing a brand writes itself, which is why "Invite a brand" can be real while
 * the grant it earns cannot be claimed here.
 */
import { supabase, unwrap } from "../supabase.js";
import { formatMoney } from "../money.js";

/** Credits, in credits — 500 credits is $50 of value. */
export async function creditBalance(orgId) {
  return Number(unwrap(await supabase.rpc("credit_balance", { org: orgId }), "load your credit balance")) || 0;
}

/**
 * The org's own codes, with the ones it has already spent marked. A code is
 * live until it is revoked, expired, or used as many times as it allows.
 */
export async function listDiscountCodes(orgId) {
  const [codes, redemptions] = await Promise.all([
    unwrap(
      await supabase
        .from("discount_codes")
        .select("id, code, amount_cents, currency, max_uses, expires_at, revoked_at, created_at")
        .eq("owner_org_id", orgId)
        .order("created_at", { ascending: false }),
      "load your discount codes",
    ),
    unwrap(
      await supabase
        .from("discount_redemptions")
        .select("code_id, order_id, redeemed_at")
        .eq("org_id", orgId),
      "load your discount history",
    ),
  ]);

  const usesByCode = new Map();
  for (const row of redemptions ?? []) {
    usesByCode.set(row.code_id, [...(usesByCode.get(row.code_id) ?? []), row]);
  }

  const now = Date.now();
  return (codes ?? []).map((code) => {
    const uses = usesByCode.get(code.id) ?? [];
    const spent = uses.length >= code.max_uses;
    const dead = code.revoked_at || (code.expires_at && new Date(code.expires_at).getTime() < now);
    return {
      code: code.code,
      status: spent ? "Used" : dead ? "Expired" : "Unused",
      // The design labels where a code came from. Nothing records that yet, so
      // it says what is true of every code here rather than inventing a story.
      source: "Discount code",
      value: formatMoney(code.amount_cents, code.currency),
      usedOn: uses[0]?.redeemed_at ? new Date(uses[0].redeemed_at).toLocaleDateString("en-US", { dateStyle: "medium" }) : undefined,
    };
  });
}

/**
 * Invite another brand. The grant on both sides is applied when they sign up
 * and place an eligible order — this only records who was asked.
 */
export async function inviteBrand(orgId, email, message = null) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!address.includes("@")) throw new Error("Enter the brand's email address.");
  return unwrap(
    await supabase
      .from("referrals")
      .insert({ referrer_org_id: orgId, email: address, message })
      .select("id")
      .single(),
    "send the invite",
  );
}

/**
 * The Savings card, as the design draws it: an amount, a line of copy, and the
 * codes behind "View discount codes". Returns null when the org has neither
 * credit nor a code, so the live card is hidden rather than showing zero.
 */
export async function savingsFor(orgId) {
  const [credits, codes] = await Promise.all([creditBalance(orgId), listDiscountCodes(orgId)]);
  const unused = codes.filter((code) => code.status === "Unused");
  if (!credits && !unused.length) return null;

  return {
    // 500 credits = $50, the rate the credit card on the factory dashboard uses.
    amount: unused.length ? unused[0].value : formatMoney(credits * 10),
    note: unused.length
      ? `${unused.length} code${unused.length === 1 ? "" : "s"} ready to use at payment. Invite a brand to earn another.`
      : `${credits} credits available. Invite a brand to earn more.`,
    codes,
  };
}

/** What sending one quote costs, from the database rather than the screen. */
export async function quoteCreditCost() {
  return Number(unwrap(await supabase.rpc("quote_credit_cost"), "load the quote price")) || 0;
}
