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
 *
 * A factory buys credits by card (buyCredits): api/stripe-credits.js prices
 * the pack in the database and Stripe charges it; the credits are written
 * only once Stripe says the card was charged.
 */
import { fetchApi, SIGN_IN_ENDED, supabase, unwrap } from "../supabase.js";
import { formatMoney } from "../money.js";
import { dateFrom } from "../dates.js";

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
    const dead = code.revoked_at || (code.expires_at && dateFrom(code.expires_at).getTime() < now);
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

const sentence = (text) => text ? text.charAt(0).toUpperCase() + text.slice(1).replace(/([^.])$/, "$1.") : text;

/**
 * Invite another company of the same kind, by email (api/send-invite). The
 * database refuses the company's own email domain, an address that already
 * has an account, a repeat and more than 20 a day. Whoever signs up with the
 * address is linked to the invite; a factory that invited a factory earns
 * 500 credits when TSC verifies it. A brand invite earns nothing yet.
 * @returns {{ id, emailed: boolean, reason: "reserved_address"|"email_not_set_up"|"email_failed"|null }}
 */
export async function sendInvite(orgId, email, message = null) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!address.includes("@")) throw new Error("Enter their email address.");
  // fetchApi hands a 401 to the auth layer, which signs out a session that
  // has ended elsewhere; until it does, the screen says so in words.
  const response = await fetchApi("/api/send-invite", { orgId, email: address, message });
  if (response.status === 401) throw new Error(SIGN_IN_ENDED);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(sentence(result.error) || "The invite could not be sent.");
  return result;
}

/**
 * The live wording for the designed invite copy, which promises more than the
 * product gives. A brand invite earns nothing yet (the brand discount is
 * still to be decided), so the brand's modal and the message it sends
 * promise no discount. A factory earns 500 when a factory it invited, new to
 * TSC, is verified; the invited factory gets the 500 every verified factory
 * gets, not a bonus.
 *
 * What is sent is an email (api/send-invite) whose one link is the ordinary
 * sign-up page. No link is personal: an invite counts when the company signs
 * up with the address it was sent to, so the intro says that.
 */
export const BRAND_INVITE_INTRO = "We'll email this brand an invitation to join The Sourcing Club, with a link to sign up.";
export const BRAND_INVITE_MESSAGE = "I thought The Sourcing Club could be useful for your next production order.";
export const FACTORY_INVITE_INTRO = "We'll email this factory an invitation to join, with a link to sign up. You earn 500 credits when it joins with this address and TSC verifies it; it gets the 500 credits every verified factory gets.";
export const FACTORY_CREDIT_NOTE = "500 credits = $50 value. Invite a factory: you earn 500 credits when TSC verifies it.";

/**
 * What the inviter is told once the invite is in: sent, or saved without the
 * email and why (`reason` from api/send-invite). Each reason says what is
 * true of it: a reserved test address cannot receive mail (the site could
 * have sent it); a site with no email set up sends nothing; and a failure
 * means the site tried. Only a factory's invite earns anything, so only it
 * says so. The address is left out where the caller does not have it (a
 * notice carried through a link).
 */
export const INVITE_NOT_EMAILED = ["reserved_address", "email_not_set_up", "email_failed"];

export function inviteNotice({ emailed, reason = null }, { email = null, kind = "factory" } = {}) {
  const earns = kind === "factory" ? " You earn 500 credits when TSC verifies them." : "";
  if (emailed) return `Invite sent${email ? ` to ${email}` : ""}.${earns}`;
  const saved = `Invite saved${email ? ` for ${email}` : ""}`;
  const counts = kind === "factory" ? " If they sign up with that address, it still counts." : "";
  switch (reason) {
    case "reserved_address":
      return `${saved}. No email was sent: it is a test address that cannot receive mail.${counts}`;
    case "email_not_set_up":
      return `${saved}. This site does not send email, so let them know yourself.${counts}`;
    case "email_failed":
      return `${saved}, but the email did not go out. Let them know yourself.${counts}`;
    default:
      return `${saved}, but no email was sent. Let them know yourself.${counts}`;
  }
}

/** Invite another brand: what the brand dashboard's designed modal calls. */
export async function inviteBrand(orgId, email, message = null) {
  return sendInvite(orgId, email, message);
}

const CREDIT_REASON = {
  onboarding_grant: "Verified onboarding bonus",
  referral_grant: "Referral bonus",
  purchase: "Credit purchase",
  admin_adjustment: "Account adjustment",
  quote_submission: "Quote submitted",
  refund: "Credit refund",
};

/** "Aug 10, 2026", the design's date. */
const dateLabel = (value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** One ledger line in words, the shape the designed Credits tab draws. */
export function creditRow(line) {
  const credits = `${line.delta > 0 ? "+" : "-"}${Math.abs(line.delta).toLocaleString()} credits`;
  const detail = line.note || CREDIT_REASON[line.reason] || "Credits";
  // A quote's line names its request; everything else came from TSC.
  const meta = line.reason === "quote_submission"
    ? `${detail} - ${dateLabel(line.created_at)}`
    : `The Sourcing Club - ${detail} - ${dateLabel(line.created_at)}`;
  return {
    id: line.id,
    title: CREDIT_REASON[line.reason] || "Credits",
    meta,
    // Bought and refunded credits were paid for, not earned or spent.
    status: line.reason === "purchase" ? "Bought"
      : line.reason === "refund" ? "Refunded"
        : line.delta > 0 ? "Earned" : line.reason === "admin_adjustment" ? "Removed" : "Used",
    amount: credits,
    delta: line.delta,
  };
}

/**
 * The factory's credits: the balance, every ledger line newest first, and its
 * invites still waiting to pay out (Pending, as the design draws the
 * referral bonus).
 */
export async function creditHistory(orgId) {
  const [lines, invites] = await Promise.all([
    unwrap(
      await supabase
        .from("credit_ledger")
        .select("id, delta, reason, note, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
      "load your credits",
    ),
    unwrap(
      await supabase
        .from("referrals")
        .select("id, email, accepted_at, rewarded_at, created_at")
        .eq("referrer_org_id", orgId)
        .is("rewarded_at", null)
        // An address that already had an account was never invited.
        .is("refused_at", null)
        .order("created_at", { ascending: false }),
      "load your invites",
    ),
  ]);
  const pending = (invites ?? []).map((invite) => ({
    id: `invite-${invite.id}`,
    title: "Referral bonus pending",
    meta: invite.accepted_at
      ? `${invite.email} - Joined, earns when TSC verifies them - ${dateLabel(invite.accepted_at)}`
      : `${invite.email} - Invited, not joined yet - ${dateLabel(invite.created_at)}`,
    status: "Pending",
    amount: "+500 credits",
    delta: 0,
  }));
  return {
    balance: (lines ?? []).reduce((sum, line) => sum + line.delta, 0),
    rows: [...pending, ...(lines ?? []).map(creditRow)],
  };
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
    // Nothing redeems a code at payment yet, and inviting a brand earns
    // nothing yet, so the card says what the brand holds and promises neither.
    note: unused.length
      ? `${unused.length} unused discount code${unused.length === 1 ? "" : "s"}. Codes can't be applied to a payment yet.`
      : `${credits} credits. They can't be applied to a payment yet.`,
    codes,
  };
}

/** What sending one quote costs, from the database rather than the screen. */
export async function quoteCreditCost() {
  return Number(unwrap(await supabase.rpc("quote_credit_cost"), "load the quote price")) || 0;
}

/**
 * The packs on sale, priced by the database (credit_packs()). The server
 * charges what these say whatever the page sends, so this is for display.
 */
export async function creditPacks() {
  const rows = unwrap(await supabase.rpc("credit_packs"), "load the credit packs") ?? [];
  return rows.map((row) => ({
    credits: Number(row.credits),
    amountCents: Number(row.amount_cents),
    currency: row.currency,
  }));
}

async function creditsRoute(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/stripe-credits", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify(body),
  });
  let result = {};
  try {
    result = await response.json();
  } catch {
    // An empty or HTML answer (the route is missing) reads as its status.
  }
  if (!response.ok) {
    const failure = new Error(result.error || `Payments are not available right now (${response.status}).`);
    failure.status = response.status;
    throw failure;
  }
  return result;
}

/**
 * Start buying a credit amount: an owner only. Returns { purchaseId, clientSecret,
 * credits, amountCents, currency, savedCards } for confirming the card.
 */
export const buyCredits = (orgId, credits) => creditsRoute({ action: "start", orgId, credits });

/**
 * Read the purchase back from Stripe now and record it. Returns
 * { id, state: "pending" | "failed" | "succeeded", credits, failure_reason, … }.
 */
export const syncCreditPurchase = (purchaseId) => creditsRoute({ action: "sync", purchaseId });
