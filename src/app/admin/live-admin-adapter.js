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
 */
import {
  claimReview,
  decideReview,
  orgDocuments,
  orgSubmission,
  overviewMetrics,
  quoteQueue,
  rfqQueue,
  setUserDisabled,
  userDirectory,
  verificationQueue,
} from "../../lib/domain/admin.js";
import { LEGAL_KINDS, listCurrentLegalDocuments, publishLegalDocument } from "../../lib/domain/legal.js";
import { urlFor } from "../../lib/domain/documents.js";
import { formatMoney } from "../../lib/money.js";

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
export function toReviewProfile(row) {
  const [status, tone] = REVIEW_LABEL[row.state] ?? ["Ready for review", "info"];
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
      ["Profile status", row.verificationStatus],
      ["Last note", row.note ?? "—"],
      ["Decided", row.decidedAt ? shortDate(row.decidedAt) : "Not yet"],
    ],
    capabilities: row.capabilities ?? [],
    confidence: row.verificationScore ?? null,
    completion: row.profileCompletion ?? null,
    // The designed panel renders [label, result, value, detail] tuples.
    checks: (row.verificationChecks ?? []).map(
      (check) => [check.label, check.result, check.value, check.detail],
    ),
  };
}

export function toRfqRow(rfq) {
  const [label, tone] = RFQ_LABEL[rfq.status] ?? ["Open", "info"];
  // "Quotes received" is a real distinction the design's tabs filter on, and
  // it is the count that decides it, not a separate status column.
  const status = rfq.status === "open" && rfq.quoteCount > 0 ? "Quotes received" : label;
  return [
    ref("RFQ", rfq.id),
    rfq.title || "Untitled request",
    rfq.brandName,
    shortDate(rfq.publishedAt ?? rfq.createdAt),
    `${rfq.invitedCount} vendors`,
    status,
    status === "Quotes received" ? "success" : tone,
  ];
}

export function toQuoteRow(quote) {
  const [status, tone] = QUOTE_LABEL[quote.status] ?? ["Submitted", "info"];
  return [
    ref("Q", quote.id),
    quote.factoryName,
    quote.brandName,
    ref("RFQ", quote.rfqId),
    quote.totalCents == null ? "—" : formatMoney(quote.totalCents, quote.currency),
    shortDate(quote.submittedAt),
    status,
    tone,
  ];
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

/**
 * The settings editor's shape: one entry per tab, named as the design names
 * them. The database kind rides along so a save knows where to go.
 */
function toLegalTabs(byKind) {
  return Object.fromEntries(
    Object.entries(LEGAL_KINDS)
      .filter(([kind]) => byKind[kind])
      .map(([kind, tab]) => {
        const doc = byKind[kind];
        return [tab, {
          kind,
          version: doc.version,
          onboarding: doc.onboarding_en,
          onboardingZh: doc.onboarding_zh ?? "",
          full: doc.full_en,
          fullZh: doc.full_zh ?? "",
          updated: new Date(doc.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        }];
      }),
  );
}

export function createAdminAdapter({ user }) {
  return {
    viewer: { isAdmin: true, org: null, user },

    verificationQueue: () => verificationQueue().then((rows) => rows.map(toReviewProfile)),
    adminRfqs: () => rfqQueue().then((rows) => rows.map(toRfqRow)),
    adminQuotes: () => quoteQueue().then((rows) => rows.map(toQuoteRow)),
    adminMetrics: () => overviewMetrics(),
    adminUsers: () => userDirectory().then((rows) => rows.map(toAdminUser)),
    legalDocuments: () => listCurrentLegalDocuments().then(toLegalTabs),

    actions: {
      claimReview,
      /**
       * The screen speaks in the design's three labels; the database speaks in
       * five states. Translating here rather than in the screen keeps the
       * decision buttons unchanged through the next merge.
       */
      decideReview: (orgId, status, note) => {
        const decision = DECISION_STATE[status];
        if (!decision) throw new Error(`unknown review decision "${status}"`);
        return decideReview(orgId, decision, note ?? null);
      },
      toggleUserAccess: (userId, disabled) => setUserDisabled(userId, disabled),
      // Every save publishes a new version; nothing already signed changes.
      saveLegalDocument: (tab, draft) => {
        const kind = Object.keys(LEGAL_KINDS).find((key) => LEGAL_KINDS[key] === tab);
        if (!kind) throw new Error(`unknown legal document "${tab}"`);
        return publishLegalDocument(kind, {
          onboardingEn: draft.onboarding,
          onboardingZh: draft.onboardingZh,
          fullEn: draft.full,
          fullZh: draft.fullZh,
        });
      },

      /**
       * What the company submitted, and a way to open the files.
       *
       * Actions rather than hooks because the review screen asks for them
       * when a company is selected, not on every queue render. The link is
       * minted per click: a private file's signed URL lives five minutes, so
       * one handed out at render time is usually dead before it is used.
       */
      orgDocuments: (orgId) => orgDocuments(orgId),
      orgSubmission: (orgId) => orgSubmission(orgId),
      documentUrl: (document) => urlFor(document),
    },
  };
}
