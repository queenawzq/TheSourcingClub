/**
 * Platform administration.
 *
 * Deliberately thin. Everything privileged happens in review_document(),
 * which is security definer and already gated on is_platform_admin() — this
 * module only finds the queue and calls it.
 */
import { supabase, unwrap } from "../supabase.js";
import { getColourSplits, getRfq } from "./rfq.js";
import { listQuotesForRfq } from "./quote.js";
import { listLinks, listTermsByKind } from "./taxonomy.js";
import { permissionLabel } from "./org.js";

/** True when the signed-in user is on the platform_admins table. */
export async function isPlatformAdmin() {
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return Boolean(data);
}

/**
 * Documents waiting on a decision.
 *
 * Only registrations and certificates are ever reviewed; everything else in
 * the documents table stays `unverified` and nobody looks at it.
 */
export async function pendingReviews() {
  return unwrap(
    await supabase
      .from("documents")
      .select("id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status, created_at, orgs (name, type, slug)")
      .in("kind", ["business_registration", "certificate"])
      .in("status", ["pending", "unverified"])
      .order("created_at", { ascending: true }),
    "load the review queue",
  );
}

export async function recentlyReviewed(limit = 20) {
  return unwrap(
    await supabase
      .from("documents")
      .select("id, org_id, kind, file_name, status, reviewed_at, review_note, orgs (name, type)")
      .in("status", ["verified", "rejected"])
      .order("reviewed_at", { ascending: false })
      .limit(limit),
    "load recent decisions",
  );
}

/**
 * Approve or reject. Verifying a business registration verifies the org, which
 * is what lets a factory quote — so this one call is the gate for the entire
 * marketplace.
 */
export async function reviewDocument(documentId, decision, note = null) {
  return unwrap(
    await supabase.rpc("review_document", {
      document_id: documentId,
      decision,
      note,
    }),
    `record the ${decision} decision`,
  );
}

/**
 * ===========================================================================
 * Org-level review — the verification queue the admin design actually works in
 * ===========================================================================
 * review_document() above decides one file. These decide one *company*, which
 * is the unit a reviewer thinks in and the thing a factory is waiting on.
 * Both write the same verification_status column, so they cannot disagree.
 */

/**
 * Every company waiting on, or already carrying, a decision.
 *
 * `verificationChecks` and `verificationScore` arrive on the row rather than
 * from a second call. The designed screen loads this queue once and hands the
 * review screen a member of the array — there is no detail fetch to hang them
 * off — and the queue is staff-sized.
 *
 * Nothing here is computed in JavaScript. The score is a weighted mean of the
 * checks and both come from SQL, because the same arithmetic in two places
 * drifts; see the capacity note in CLAUDE.md. This layer reshapes, it does not
 * calculate.
 */
export async function verificationQueue() {
  const rows = await unwrap(
    await supabase.rpc("admin_verification_queue"),
    "load the verification queue",
  );

  return (rows ?? []).map((row) => ({
    orgId: row.org_id,
    name: row.org_name,
    type: row.org_type,
    slug: row.org_slug,
    location: row.location,
    legalName: row.legal_name,
    websiteUrl: row.website_url,
    intro: row.intro,
    submittedAt: row.submitted_at,
    state: row.state,
    risk: row.risk,
    note: row.note,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    verificationStatus: row.verification_status,
    evidenceReceived: row.evidence_received,
    evidenceExpected: row.evidence_expected,
    vendorKind: row.vendor_kind,
    profileCompletion: row.profile_completion,
    verificationScore: row.verification_score,
    verificationChecks: row.verification_checks ?? [],
    capabilities: row.capabilities ?? [],
    decidedAt: row.decided_at,
  }));
}

/**
 * Everything a company submitted during onboarding.
 *
 * Whole rows rather than a picked list of columns: the review modal used a
 * curated six-entry list and looked up eight keys that were never in it, so
 * year founded, team size, MOQ, lead time and the rest all rendered as an em
 * dash. A field added to onboarding tomorrow arrives here on its own.
 */
export async function orgSubmission(orgId) {
  const [submissionResult, tierResult, teamResult] = await Promise.all([
    supabase.rpc("admin_verification_detail", { target_org: orgId }),
    supabase.rpc("admin_factory_tier_eligibility", { target_org: orgId }),
    // Read-only for staff: what each person may do (org_members_read lets
    // staff read memberships; nothing lets them change one).
    supabase.from("org_members").select("role, permissions, title, user_profiles (email), orgs (type)").eq("org_id", orgId),
  ]);
  const submission = unwrap(submissionResult, "load the submitted profile");
  const team = new Map((teamResult.data ?? []).map((row) => [row.user_profiles?.email, row]));
  const members = (submission?.members ?? []).map((member) => {
    const row = team.get(member.email);
    if (!row) return member;
    const kind = row.orgs?.type === "factory" ? "factory" : "brand";
    const held = row.role === "owner" ? ["Everything (owner)"] : (row.permissions ?? []).map((key) => permissionLabel(key, kind));
    return { ...member, title: row.title, permissionsText: held.length ? held.join(", ") : "No permissions" };
  });
  return { ...submission, members, trustEligibility: tierResult.error ? null : tierResult.data };
}

/**
 * The files a company uploaded about itself.
 *
 * Scoped by the RPC to what belongs to the company rather than to a deal, so
 * order, quote and message attachments stay out. Reading the rows and minting
 * a signed URL both work through ordinary RLS: `documents_own` and the
 * org-private storage read policy each end in `or is_platform_admin()`.
 */
export async function orgDocuments(orgId) {
  return unwrap(
    await supabase.rpc("admin_org_documents", { target_org: orgId }),
    "load the submitted documents",
  );
}

/** Take a review, or hand it to another admin. */
export async function claimReview(orgId, assignTo = null) {
  return unwrap(
    await supabase.rpc("admin_claim_review", { target_org: orgId, assign_to: assignTo }),
    "claim the review",
  );
}

/**
 * The three states the company hears about. 'in_review' and
 * 'ready_for_review' are internal movements and deliberately send nothing —
 * telling a factory "someone opened your file" is noise.
 */
const NOTIFIES_COMPANY = new Set(["approved", "needs_information", "declined"]);

/**
 * Approve, decline, or send it back.
 *
 * `needs_information` requires a note and the database enforces that — a
 * factory told only "Needs information" has nothing to act on. The note
 * reaches them as a notification written in the same transaction, and as an
 * email: a company that never opens the app would otherwise never learn its
 * review moved, which defeats the one decision that asks them to act.
 */
export async function decideReview(orgId, decision, note = null, risk = null, tier = null) {
  const review = unwrap(
    await supabase.rpc("admin_review_decision_with_tier", {
      target_org: orgId,
      decision,
      note,
      risk,
      tier,
    }),
    `record the ${decision.replace(/_/g, " ")} decision`,
  );

  if (!NOTIFIES_COMPANY.has(decision)) return review;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/send-review-decision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ orgId }),
    });
    const result = await response.json();
    return { ...review, decisionEmail: result };
  } catch (error) {
    return { ...review, decisionEmail: { sent: 0, error: error.message } };
  }
}

/**
 * Draft the note for a needs-information decision. The model only suggests
 * copy: the reviewer can edit it, and decideReview is still the only action
 * that records or sends anything. Without the model the note is built from
 * the incomplete checks, and `notice` says so and why.
 */
export async function suggestReviewRequest({ orgId, companyName, entityType, gaps }) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/suggest-review-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ orgId, companyName, entityType, gaps }),
    });
    const result = await response.json();
    return {
      message: typeof result.message === "string" ? result.message.trim() : "",
      error: result.error ?? (response.ok ? null : "The suggestion could not be generated."),
      notice: result.notice ?? null,
    };
  } catch (error) {
    return { message: "", error: error.message };
  }
}

/**
 * ===========================================================================
 * Marketplace oversight
 * ===========================================================================
 * The rfq and quote policies already let staff read both tables. What they
 * could not do is read them across every org at once with the counts
 * attached, which is what the admin RFQ and quote tables show.
 */

export async function rfqQueue(limit = 200) {
  const rows = await unwrap(
    await supabase.rpc("admin_rfq_queue", { row_limit: limit }),
    "load marketplace requests",
  );

  return (rows ?? []).map((row) => ({
    id: row.rfq_id,
    title: row.title,
    brandOrgId: row.brand_org_id,
    brandName: row.brand_name,
    status: row.status,
    visibility: row.visibility,
    quantityTotal: row.quantity_total,
    currency: row.currency,
    invitedCount: row.invited_count,
    quoteCount: row.quote_count,
    latestQuoteAt: row.latest_quote_at,
    quoteDeadline: row.quote_deadline,
    publishedAt: row.published_at,
    awardedAt: row.awarded_at,
    createdAt: row.created_at,
  }));
}

export async function quoteQueue(limit = 200) {
  const rows = await unwrap(
    await supabase.rpc("admin_quote_queue", { row_limit: limit }),
    "load marketplace quotes",
  );

  return (rows ?? []).map((row) => ({
    id: row.quote_id,
    rfqId: row.rfq_id,
    rfqTitle: row.rfq_title,
    brandOrgId: row.brand_org_id,
    brandName: row.brand_name,
    factoryOrgId: row.factory_org_id,
    factoryName: row.factory_name,
    status: row.status,
    version: row.version,
    // Already production + samples, summed in SQL. JavaScript never adds money.
    totalCents: row.total_cents,
    currency: row.currency,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
  }));
}

/**
 * One request as staff open it: the brief, and every quote on it that the
 * quote list shows (everything but drafts, revisions and withdrawals
 * included). Read through the same readers the brand's screens use, so staff
 * see the brand's figures; the rfqs and quotes read policies already end in
 * `or is_platform_admin()`.
 */
export async function rfqDetail(rfqId) {
  const [rfq, termIds, terms, colourSplits, quotes] = await Promise.all([
    getRfq(rfqId),
    listLinks("rfq", rfqId),
    listTermsByKind(["product_category", "incoterm"]),
    getColourSplits(rfqId),
    listQuotesForRfq(rfqId, { statuses: ["submitted", "accepted", "declined", "superseded", "withdrawn"] }),
  ]);
  const linked = new Set(termIds);
  return {
    rfq,
    categories: (terms.product_category ?? []).filter((term) => linked.has(term.id)),
    incoterms: terms.incoterm ?? [],
    colourSplits,
    quotes,
  };
}

/**
 * The four numbers on the overview.
 *
 * `paymentsAwaitingConfirmation` stands where the design puts "low-confidence
 * checks". It is a real figure and a more urgent one: platform staff have no
 * org and so cannot be notified of anything. It counts the payments only a
 * person can move: bank-wire claims from the old site, payouts Stripe did not
 * make (a factory it cannot pay, paid by bank), and money held on a cancelled
 * order. This count is the only prompt there is.
 */
export async function overviewMetrics() {
  const rows = await unwrap(
    await supabase.rpc("admin_overview_metrics"),
    "load the marketplace overview",
  );
  const row = rows?.[0] ?? {};

  return {
    profilesAwaitingReview: row.profiles_awaiting_review ?? 0,
    profilesSubmittedToday: row.profiles_submitted_today ?? 0,
    rfqsSubmittedToday: row.rfqs_submitted_today ?? 0,
    quotesSubmittedToday: row.quotes_submitted_today ?? 0,
    paymentsAwaitingConfirmation: row.payments_awaiting_confirmation ?? 0,
    // The payments board is the app's, not the console's.
    paymentsHref: "/app.html/admin/payments",
  };
}

async function adminUserRequest(options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/admin-users", {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "the user directory could not be loaded");
  return result;
}

async function directUserDirectory() {
  const [{ data: auth }, profiles, members, admins, factories] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("user_profiles").select("id, email, full_name, created_at"),
    supabase.from("org_members").select("user_id, org_id, orgs (name, type)"),
    supabase.from("platform_admins").select("user_id"),
    supabase.from("factory_profiles").select("org_id, vendor_kind"),
  ]);
  for (const result of [profiles, members, admins, factories]) {
    if (result.error) throw result.error;
  }

  const memberships = new Map();
  for (const membership of members.data ?? []) {
    if (!memberships.has(membership.user_id)) memberships.set(membership.user_id, membership);
  }
  const adminIds = new Set((admins.data ?? []).map((admin) => admin.user_id));
  const vendorKinds = new Map((factories.data ?? []).map((profile) => [profile.org_id, profile.vendor_kind]));

  return (profiles.data ?? []).map((profile) => {
    const membership = memberships.get(profile.id);
    const org = Array.isArray(membership?.orgs) ? membership.orgs[0] : membership?.orgs;
    const isAdmin = adminIds.has(profile.id);
    return {
      id: profile.id,
      email: profile.email || "",
      name: profile.full_name || profile.email?.split("@")[0] || "Unnamed user",
      company: isAdmin ? "The Sourcing Club" : org?.name || "No company",
      orgType: isAdmin ? "admin" : org?.type || null,
      vendorKind: membership?.org_id ? vendorKinds.get(membership.org_id) ?? null : null,
      createdAt: profile.created_at,
      lastActiveAt: null,
      disabled: false,
      protected: profile.id === auth?.user?.id,
    };
  });
}

/** Real Supabase Auth users, visible only to platform staff. */
export async function userDirectory() {
  try {
    const result = await adminUserRequest();
    return result.users ?? [];
  } catch {
    // Vite serves the app locally without Vercel's api/ functions. The same
    // signed-in admin can still read the real directory through RLS; only
    // Auth-only fields such as last sign-in and ban state are unavailable.
    return directUserDirectory();
  }
}

/** Disable or restore a real Supabase Auth account. */
export async function setUserDisabled(userId, disabled) {
  return adminUserRequest({
    method: "PATCH",
    body: JSON.stringify({ userId, disabled }),
  });
}

/**
 * Send one of the product's emails, with sample data, to the signed-in
 * admin's own address. The server builds it with the same code as the real
 * send and refuses anyone who is not staff.
 */
export async function sendTestEmail(template, locale = "en") {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/send-test-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: JSON.stringify({ template, locale }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.sent) throw new Error(result.error || "the test email could not be sent");
  return result;
}

/**
 * Run the daily job now: capacity reminders, steps due soon, then every
 * queued email. Test sites have no crons, so staff run it from here; running
 * it twice sends nothing twice.
 */
export async function runDailyJobs() {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/cron-daily", {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || "the daily jobs could not run");
  return result;
}

/** POST/GET to one of our own staff routes with the session, and say why it failed. */
async function staffRoute(path, { method = "POST", body, failure }) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session?.access_token ?? ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) throw new Error(result.error || failure);
  return result;
}

/**
 * Ask the AI for review suggestions ("check") or a draft "needs more
 * information" note ("draft"). Suggestions are text a person reads, never a
 * score; a draft only fills the text box, and staff send it.
 */
export async function reviewAssist(action, orgId, { topics = [], hint = "" } = {}) {
  return staffRoute("/api/admin-review-assist", {
    body: { action, orgId, topics, hint },
    failure: action === "draft" ? "the note could not be drafted" : "the suggestions could not be loaded",
  });
}

/** The last suggestions staff were shown for this company, if any. */
export async function latestReviewAssists(orgId) {
  return unwrap(
    await supabase.rpc("admin_review_assists", { target_org: orgId }),
    "load the last suggestions",
  );
}

/** Exactly what the AI reads about a company: shown under the suggestions. */
export async function reviewAssistInput(orgId) {
  return unwrap(
    await supabase.rpc("admin_review_assist_input", { target_org: orgId }),
    "load what the AI reads",
  );
}

/** What a test-data cleanup would delete. Test sites only; never production. */
export async function testDataPreview() {
  return staffRoute("/api/admin-test-data", { method: "GET", failure: "the test data could not be listed" });
}

/** Delete the confirmed test companies and users; the database re-checks each. */
export async function purgeTestData(orgIds, userIds) {
  return staffRoute("/api/admin-test-data", {
    body: { orgIds, userIds },
    failure: "the test data could not be deleted",
  });
}

/** A factory's credit balance and its latest ledger lines, for the review page. */
export async function companyCredits(orgId, limit = 5) {
  const [balance, lines] = await Promise.all([
    unwrap(await supabase.rpc("credit_balance", { org: orgId }), "load the credit balance"),
    unwrap(
      await supabase
        .from("credit_ledger")
        .select("id, delta, reason, note, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(limit),
      "load the credit history",
    ),
  ]);
  return { balance: Number(balance) || 0, lines: lines ?? [] };
}

/** Add (positive) or remove (negative) credits, with a reason the company sees. */
export async function adjustCredits(orgId, amount, reason) {
  return unwrap(
    await supabase.rpc("admin_adjust_credits", { target_org: orgId, amount, reason }),
    "adjust the credits",
  );
}
