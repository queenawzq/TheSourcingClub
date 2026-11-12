/**
 * The live half of the admin seam.
 *
 * Maps the marketplace onto the shapes the designed admin screens expect.
 * Like toProjectCard in ../live-adapter.js this is not glue — it is where two
 * vocabularies are reconciled, and it belongs in one file rather than smeared
 * across screens.
 *
 * The RFQ and quote tables read positional tuples, which is how the design
 * wrote them:
 *
 *   rfq    [ref, title, brand, submitted, "N vendors", status, tone]
 *   quote  [ref, factory, brand, rfqRef, total, submitted, status, tone]
 *
 * Keeping that shape is deliberate. Changing it would mean rewriting
 * DataTable, RfqActivityCards and every filter predicate in QueuePage — a
 * large diff through Queena's file for no gain, and the next merge would pay
 * for it.
 *
 * Each tuple also carries the record's full id as a named property
 * (`row.id`). The design slices the tuple by position, so a named property is
 * invisible to it, and the detail screens need the id to read the request:
 * the shortened ref on screen is not unique enough to look anything up by.
 */
import { adminLevelInputs, adminRegistryStates, registryApprovalBlock } from "../../lib/domain/registration.js";
import { LEVEL_WORDS, computeLevels } from "../../shared/verification-levels.mjs";
import { loadVerificationScore, scoreAvailable, verificationActions, verificationFileUrl } from "./live-verification.js";
import { scoreOverall } from "../../admin-prototype/verification-scoring.js";
import { registrySourceLabel } from "../../shared/registration-number.mjs";
import {
  adjustCredits,
  claimReview,
  companyCredits,
  decideReview,
  resendReviewEmails,
  reviewEmailStatus,
  latestReviewAssists,
  orgDocuments,
  orgSubmission,
  overviewMetrics,
  purgeTestData,
  quoteQueue,
  reviewAssist,
  reviewAssistInput,
  rfqDetail,
  rfqQueue,
  runDailyJobs,
  sendTestEmail,
  setUserDisabled,
  suggestReviewRequest,
  testDataPreview,
  userDirectory,
  verificationQueue,
  deleteFactory,
  deleteBrand,
} from "../../lib/domain/admin.js";
import { createElement } from "react";
import { urlFor } from "../../lib/domain/documents.js";
import { profileCompletion } from "./profile-completion.js";
import { formatMoney, formatRange } from "../../lib/money.js";
import { termLabel } from "../../lib/domain/taxonomy.js";
import { describeQuote } from "../quote/quote-view.js";
import { monthLine, quantityLine } from "../rfq/resume-fields.js";
import { productionCategories } from "./production-categories.mjs";

const MONTH_DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

const shortDate = (value) => (value ? MONTH_DAY.format(new Date(value)) : "—");

/**
 * A reference a human can say out loud.
 *
 * The design shows "RFQ-1048". There is no sequence column behind that, and
 * adding one to a populated table to satisfy a label would be the wrong order
 * of operations — so this shortens the uuid instead. It is stable, unique in
 * practice within a page of results, and honest about being an id.
 */
const ref = (prefix, id) => `${prefix}-${String(id).slice(0, 8)}`;

/** What the queue's five states are called on screen, and how they are coloured. */
const REVIEW_LABEL = {
  ready_for_review: ["Ready for review", "info"],
  in_review: ["In review", "info"],
  needs_information: ["Needs information", "warning"],
  approved: ["Approved", "success"],
  declined: ["Declined", "neutral"],
};

/** And the reverse, for the three decisions the detail screen can send. */
const DECISION_STATE = {
  Approved: "approved",
  Declined: "declined",
  "Needs information": "needs_information",
};

/** The company's profile status, in words rather than the enum. */
const VERIFICATION_LABEL = {
  unverified: "Not verified",
  pending: "Pending",
  verified: "Verified",
  rejected: "Not verified (declined)",
};

const RFQ_LABEL = {
  open: ["Open", "info"],
  awarded: ["Closed", "neutral"],
  cancelled: ["Closed", "neutral"],
};

const QUOTE_LABEL = {
  submitted: ["Submitted", "info"],
  superseded: ["Revision requested", "danger"],
  withdrawn: ["Closed", "neutral"],
  accepted: ["Accepted", "success"],
  declined: ["Declined", "neutral"],
};

const initials = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

const USER_TYPE = {
  admin: "Admin",
  brand: "Brand",
  factory: "Factory",
  trading_company: "Trading company",
};

/** "18 min ago" in the design; derived here, so it cannot describe a stale time. */
function ago(value) {
  if (!value) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * One company in the verification queue.
 *
 * `confidence`, `completion` and `checks` were absent on purpose until
 * 20260920000300, because they had been drawn as the output of an automated
 * registry check that does not exist. They now come from SQL and measure
 * evidence completeness — how much of what we asked for has arrived — which
 * is a real thing to know and is what the screen now says. Nothing is
 * computed here; this maps the row onto the shape the design renders.
 */
/**
 * A vendor's official-registry state on its queue row and its checks
 * (migration 20261108600000). A verified factory whose check was lost (a
 * later "not found", or a changed number) shows as "Registry check lost"
 * in the active queue: staff cannot be notified, so the queue is the prompt.
 * The registration check's line says the registry state, not the old
 * "not checked against any registry".
 */
export function withRegistry(profile, state) {
  if (!state || profile.entityType === "Brand") return profile;
  const when = state.checked_at ? shortDate(state.checked_at) : "";
  const words = state.state === "found"
    ? (state.kind === "document" ? `Registration document checked ${when}.` : `Found on an official registry ${when}.`)
    : state.state === "lost" ? "Registry check lost: the latest check is not a match, or the number or name changed."
    : "No registry check recorded yet.";
  // "100% complete" read as checked when nothing had been: until a check is
  // recorded an uploaded registration is "Uploaded · not checked", with no figure.
  const uploaded = Boolean(state.registration_uploaded_at);
  const checks = profile.checks.map(([label, result, value, detail]) => (label === "Business registration"
    ? [label,
      state.state === "found" ? "Verified" : uploaded ? "Uploaded · not checked" : result,
      state.state === "found" ? 100 : uploaded ? null : value,
      `${String(detail ?? "")
        .replace(/ ?(Not yet reviewed\.|Marked verified[^.]*\.)? ?Contents are not checked against any registry\./, "")
        // The database writes the upload day in UTC; say it in the reader's
        // zone, like the check's own date.
        .replace(/^Uploaded \d{2} \w{3} \d{4}/, state.registration_uploaded_at ? `Uploaded ${shortDate(state.registration_uploaded_at)}` : "$&")} ${words}`.trim()]
    // The same duplicate the registry panel names: a shared registration
    // number, which the old card (legal name and website only) said nothing of.
    : label === "Duplicate company signal" && state.duplicates > 0
      ? [label, state.duplicate_explained ? "Explained" : "Review", null,
        `Shares its registration number with ${(state.duplicate_names ?? []).join(", ")}.${state.duplicate_explained ? " Staff recorded why." : ""} ${String(detail ?? "").replace(/^No other company[^.]*\.\s*/, "")}`.trim()]
    : [label, result, value, detail]));
  const lost = state.state === "lost" && profile.status === "Approved";
  return { ...profile, checks, ...(lost ? { status: "Registry check lost", tone: "warning" } : {}) };
}

/**
 * v3.1 (A9): a vendor's queue row shows its overall level, from the same
 * rules as the review page, instead of a "% complete". A company whose
 * inputs can't be read shows no level rather than a wrong one.
 */
export async function withLevel(profile) {
  if (profile.entityType === "Brand") return profile;
  // Nov 12: the row shows the same overall score as the review page.
  if (scoreAvailable) {
    try {
      const overall = scoreOverall((await loadVerificationScore(profile.id, { urls: false }))?.groups ?? []);
      return overall == null
        ? { ...profile, confidence: null, confidenceLabel: "Score", scoreWord: "Not checked" }
        : { ...profile, confidence: overall, confidenceLabel: "Score" };
    } catch {
      return profile;
    }
  }
  try {
    const { overall } = computeLevels({ ...(await adminLevelInputs(profile.id)), sourceLabel: registrySourceLabel });
    return { ...profile, level: LEVEL_WORDS[overall.level], levelTone: overall.level };
  } catch {
    return profile;
  }
}

export function toReviewProfile(row) {
  const [status, tone] = REVIEW_LABEL[row.state] ?? ["Ready for review", "info"];
  const savedProductionTypes = row.productionTypes ?? [];
  const description = [row.name, row.intro].filter(Boolean).join(" ");
  const inferredProductionTypes = row.type === "factory" && !savedProductionTypes.length
    ? [
      [/\b(woven|wovens|weaving)\b/i, "Wovens"],
      [/\b(jersey|jerseys|cut[ -]and[ -]sew|cut\s*&\s*sew)\b/i, "Jersey / cut & sew"],
      [/\b(knit|knits|knitwear|knitting|sweater|sweaters)\b/i, "Knitwear"],
      [/\b(denim|jeans)\b/i, "Denim"],
      [/\b(seamless|circular knitting)\b/i, "Seamless / circular knit"],
    ].filter(([pattern]) => pattern.test(description)).map(([, label]) => label)
    : [];
  return {
    id: row.orgId,
    initials: initials(row.name),
    name: row.name,
    // orgs.type has two values; the design filters on three. A trading
    // company is a factory profile carrying vendor_kind.
    entityType: row.type !== "factory"
      ? "Brand"
      : row.vendorKind === "trading_company" ? "Trading company" : "Factory",
    location: row.location ?? "Location not given",
    submitted: ago(row.submittedAt),
    status,
    tone,
    evidence: `${row.evidenceReceived} of ${row.evidenceExpected} received`,
    owner: row.ownerName ?? "",
    risk: row.risk ? row.risk[0].toUpperCase() + row.risk.slice(1) : "",
    summary: row.intro ?? "No introduction was submitted.",
    details: [
      ["Legal name", row.legalName ?? "—"],
      ["Website", row.websiteUrl ?? "—"],
      ["Location", row.location ?? "—"],
      // A company waiting on staff is 'pending' whatever staff have done, so
      // its words come from the review, as the badge's do: "Pending" beside
      // "Needs information" said two different things.
      ["Profile status", row.verificationStatus === "pending"
        ? status
        : VERIFICATION_LABEL[row.verificationStatus] ?? row.verificationStatus ?? "—"],
      ["Decided", row.decidedAt ? shortDate(row.decidedAt) : "Not yet"],
      // Last, on a row of its own (console-live.css): a request is often a
      // paragraph and a list, which stretched one third of the grid down the
      // page and pushed its neighbours to the middle of a tall row.
      ["Last note", row.note ? createElement("span", { className: "admin-review-note" }, row.note) : "—"],
    ],
    capabilities: row.capabilities ?? [],
    capabilityGroups: row.capabilityGroups ?? [],
    productionTypes: savedProductionTypes.length ? savedProductionTypes : inferredProductionTypes,
    productionTypesInferred: inferredProductionTypes.length > 0,
    productionTags: productionCategories(row),
    makes: row.makes ?? [],
    // v3.1 (A9): no completeness percentage beside the levels; the level replaces it.
    confidence: null,
    // Not the queue's own figure: completeness is the company's, read with
    // the submission (profile-completion.js), so both sides see one number.
    completion: null,
    // The designed panel renders [label, result, value, detail] tuples.
    // v3.1: a factory's photos are judged by the Photos row (workshop photos,
    // automatic); the old "Production evidence" card counted only public
    // product images and contradicted it, so factories don't get it.
    checks: (row.verificationChecks ?? [])
      .filter((check) => check.label !== "Production evidence")
      .map((check) => [check.label, check.result, check.value, check.detail]),
  };
}

export function toRfqRow(rfq) {
  const [label, tone] = RFQ_LABEL[rfq.status] ?? ["Open", "info"];
  // "Quotes received" is a real distinction the design's tabs filter on, and
  // it is the count that decides it, not a separate status column.
  const status = rfq.status === "open" && rfq.quoteCount > 0 ? "Quotes received" : label;
  const openToAll = rfq.visibility === "open_to_all";
  return Object.assign([
    ref("RFQ", rfq.id),
    rfq.title || "Untitled request",
    rfq.brandName,
    shortDate(rfq.publishedAt ?? rfq.createdAt),
    // A request open to all vendors is quoted by vendors nobody invited, so
    // "0 vendors" beside its quotes read as a miscount.
    openToAll ? "Open to all vendors" : `${rfq.invitedCount} vendors`,
    status,
    status === "Quotes received" ? "success" : tone,
  ], {
    id: rfq.id,
    // The request timeline's line; the design's says "N vendors invited".
    invitedEvent: openToAll
      ? `Published to all vendors${rfq.invitedCount ? `, ${rfq.invitedCount} invited by name` : ""}`
      : `${rfq.invitedCount} vendors invited to quote`,
  });
}

export function toQuoteRow(quote) {
  const [status, tone] = QUOTE_LABEL[quote.status] ?? ["Submitted", "info"];
  return Object.assign([
    ref("Q", quote.id),
    quote.factoryName,
    quote.brandName,
    ref("RFQ", quote.rfqId),
    quote.totalCents == null ? "—" : formatMoney(quote.totalCents, quote.currency),
    shortDate(quote.submittedAt),
    status,
    tone,
  ], { id: quote.id, rfqId: quote.rfqId });
}

/** What the detail screens print for a field with nothing behind it. */
const NOT_GIVEN = "Not given";
const given = (value) => (value == null || value === "" ? NOT_GIVEN : value);

/**
 * One request and its quotes, in the design's `rfqDetails` shape, plus one
 * entry per quote keyed by the quote's on-screen ref. Every figure is read
 * from the records through the brand screens' own mappers (describeQuote);
 * the design's per-vendor constants (28/31/26 days, $260 samples, "30%
 * deposit") have nothing behind them live, so a field with no record says
 * "Not given" rather than borrowing one.
 */
export function toRfqDetail({ rfq, categories, incoterms, colourSplits, quotes }) {
  const sampleNotes = rfq?.sample_notes?.trim();
  const brief = {
    category: given(categories.map((term) => termLabel(term)).join(", ")),
    quantity: given(quantityLine(rfq?.quantity_total, colourSplits)),
    targetPrice: given(
      rfq?.target_unit_price_min_cents == null && rfq?.target_unit_price_max_cents == null
        ? ""
        : `${formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents, rfq.currency)} / unit`,
    ),
    delivery: given(monthLine(rfq?.target_delivery_month)),
    materials: given(rfq?.material_notes?.trim()),
    samples: given(
      rfq?.requires_sample
        ? sampleNotes ? `Sample required · ${sampleNotes}` : "Sample required"
        : sampleNotes || (rfq ? "No sample" : ""),
    ),
    requirements: given([rfq?.brief?.trim(), rfq?.additional_details?.trim()].filter(Boolean).join("\n\n")),
  };

  const byRef = {};
  for (const quote of quotes) {
    const shown = describeQuote(quote, { incoterms });
    byRef[ref("Q", quote.id)] = {
      quantity: given(shown.quantity),
      unitPrice: given(shown.price),
      lead: given(shown.lead),
      samples: given(shown.samplePlan),
      sampleCost: given(shown.sampleSubtotal),
      paymentTerms: given(shown.paymentTerms),
      shipping: given(shown.shipping),
      materials: given(shown.materialCosts.map((line) => `${line.material}${line.included ? "" : " (not included)"}`).filter(Boolean).join(", ")),
      note: given(shown.notes?.trim()),
    };
  }
  return { brief, quotes: byRef };
}

export function toAdminUser(user) {
  const typeKey = user.orgType === "factory" && user.vendorKind === "trading_company"
    ? "trading_company"
    : user.orgType;
  return {
    id: user.id,
    initials: initials(user.name),
    name: user.name,
    email: user.email,
    type: USER_TYPE[typeKey] ?? "No company",
    company: user.company,
    joined: shortDate(user.createdAt),
    lastActive: user.lastActiveAt ? ago(user.lastActiveAt) : "Never",
    status: user.disabled ? "Disabled" : "Active",
    protected: user.protected,
  };
}

export function createAdminAdapter({ user, signOut }) {
  return {
    viewer: { isAdmin: true, org: null, user },

    verificationQueue: () => Promise.all([verificationQueue(), adminRegistryStates()])
      .then(([rows, states]) => Promise.all(rows.map((row) => withLevel(withRegistry(toReviewProfile(row), states.get(row.orgId)))))),
    adminRfqs: () => rfqQueue().then((rows) => rows.map(toRfqRow)),
    adminQuotes: () => quoteQueue().then((rows) => rows.map(toQuoteRow)),
    adminMetrics: async () => {
      const metrics = await overviewMetrics();
      // Like the payments card, the profiles card links to where its figure
      // is acted on: this workspace's own queue. No messages card: messages
      // are blocked or delivered at once, nothing waits on staff (Nov 7).
      return { ...metrics, profilesHref: "?screen=verification" };
    },
    adminUsers: () => userDirectory().then((rows) => rows.map(toAdminUser)),

    actions: {
      deleteFactory,
      deleteBrand,
      claimReview,
      signOut,
      sendTestEmail,
      runDailyJobs,
      /**
       * The screen speaks in the design's three labels; the database speaks in
       * five states. Translating here rather than in the screen keeps the
       * decision buttons unchanged through the next merge.
       */
      decideReview: (orgId, status, note, tier) => {
        const decision = DECISION_STATE[status];
        if (!decision) throw new Error(`unknown review decision "${status}"`);
        return decideReview(orgId, decision, note ?? null, null, tier ?? null);
      },
      suggestReviewRequest,
      resendReviewEmails,
      reviewEmailStatus,
      // The detail screens' data, read when one opens. The row is a queue
      // tuple; its named `rfqId` (a quote) or `id` (a request) says which.
      rfqDetail: (row) => rfqDetail(row.rfqId ?? row.id).then(toRfqDetail),
      toggleUserAccess: (userId, disabled) => setUserDisabled(userId, disabled),

      /**
       * What the company submitted, and a way to open the files.
       *
       * Actions rather than hooks because the review screen asks for them
       * when a company is selected, not on every queue render. The link is
       * minted per click: a private file's signed URL lives five minutes, so
       * one handed out at render time is usually dead before it is used.
       */
      orgDocuments: (orgId) => orgDocuments(orgId),
      // Completeness is loaded the way the company's own profile page loads
      // it, which needs its name and kind: those come from the submission
      // just read. They used to come from a cache of the last queue read,
      // which a re-created adapter did not have, so the row vanished.
      orgSubmission: async (orgId) => {
        const submission = await orgSubmission(orgId);
        const completion = submission?.org
          ? await profileCompletion({
            orgId,
            name: submission.org.name,
            type: submission.org.type,
            vendorKind: submission.profile?.vendor_kind,
          }).catch(() => null)
          : null;
        return { ...submission, completion };
      },
      documentUrl: (document) => urlFor(document),

      /**
       * AI help on the review page. Live only: the prototype's adapter has
       * none of these, so its screens draw none of it. Suggestions are text a
       * person reads, never a score; a draft only fills the note.
       */
      reviewAssist,
      latestReviewAssists,
      reviewAssistInput,

      /**
       * Why a vendor cannot be approved yet, or null: approving needs a
       * person's "found, matches" on its current registration number (the
       * database refuses it otherwise). Live only.
       */
      approvalBlock: registryApprovalBlock,

      /**
       * The verification score card (Nov 12 design): the score in the shape
       * of verification-mock.js, the writes behind each row's modal, and a
       * signed link for each file. Live only; the prototype's card keeps its
       * edits in its own state.
       */
      verificationScore: loadVerificationScore,
      verificationActions,
      verificationFileUrl,

      /**
       * A factory's credits on the review page, and the staff adjustment.
       * Live only: the admin design draws no credits.
       */
      companyCredits,
      adjustCredits,

      /**
       * Clearing test data, on test builds only. A production build has no
       * such action, so the panel is not drawn; the route refuses the
       * production project as well.
       */
      ...(import.meta.env.DEV || __DEMO_SIGN_IN__ ? { testData: { preview: testDataPreview, purge: purgeTestData } } : {}),
    },
  };
}
