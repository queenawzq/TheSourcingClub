/**
 * Mounts the admin workspace with the MOCK adapter.
 *
 * This is what admin-prototype.html loads, and it is the same promise the
 * other two prototypes make: open the page, see a fully populated operations
 * console, no database, no session, no network. The constants it serves are
 * the ones that have always been in main.jsx — nothing was moved or copied.
 *
 * admin.html mounts the same App against the marketplace instead.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import App, { initialProfiles, initialUsers, quotes, rfqs } from "./main.jsx";
import { DataProvider } from "../lib/data/DataProvider.jsx";
import { countryIn } from "../shared/company-address.mjs";

/**
 * Synchronous on purpose. The provider treats a non-promise as already
 * resolved, so the prototype never flashes a loading state and looks exactly
 * as it did before.
 *
 * `profiles` is held in a module-level array rather than React state because
 * the live adapter has nowhere to put local state either — it re-reads the
 * queue after a decision. Both sides therefore behave the same way: decide,
 * then reload.
 */
let profiles = initialProfiles;
let users = initialUsers;

/**
 * Stand-in uploads, so the review screen's document rows are populated with
 * no database. They are obviously samples and they open nothing: the mock has
 * no storage behind it, and the adapter deliberately supplies no
 * `documentUrl`, so DocumentLink renders plain text rather than a button that
 * could only fail.
 */
const mockDocuments = [
  { id: "doc-reg", kind: "business_registration", file_name: "business-registration.pdf",
    mime_type: "application/pdf", size_bytes: 482000, status: "verified" },
  { id: "doc-cert", kind: "certificate", file_name: "gots-certificate.pdf",
    mime_type: "application/pdf", size_bytes: 318000, status: "pending" },
  { id: "doc-logo", kind: "logo", file_name: "company-logo.png",
    mime_type: "image/png", size_bytes: 24000, status: "unverified" },
  { id: "doc-line", kind: "product_image", file_name: "production-line.jpg",
    mime_type: "image/jpeg", size_bytes: 1650000, status: "unverified" },
];

/** A populated submission, so the review modal reads as designed with no database. */
const mockSubmission = {
  profile: {
    legal_name: "Atelier Minho Lda", location: "Porto, Portugal", country_code: "PT",
    founded_year: 2016, employee_count: 120, website_url: "https://ateliermlinho.pt",
    intro: "Woven and cut-and-sew factory specializing in premium small-batch shirts.",
    moq: 150, typical_lead_days: 25, sample_lead_days: 12, vendor_kind: "manufacturer",
    equipment_notes: "24 single-needle lines, 2 automated cutters",
  },
  selections: {
    "Production type": ["Cut & sew", "Wovens"],
    "Product categories": ["Shirts", "Dresses"],
    "Certifications": ["GOTS"],
  },
  capacity: { inputMode: "units", monthlyUnits: 7200, lineHours: null, category: "Woven shirt" },
  certifications: [{ label: "GOTS", status: "pending", documentId: "doc-cert", expiresAt: "2027-08-31" }],
  references: [{ id: "ref-1", title: "Capsule knitwear", counterparty: "A Brand", period: "2025", outcome: "Delivered on time" }],
  members: [{ name: "Ana Martins", email: "ana@ateliermlinho.pt", role: "owner" }],
  invitations: [],
  terms: { signature: "Ana Martins", version: "2026-09-18-v4", acceptedAt: "2026-09-12T10:00:00Z" },
  trustEligibility: {
    currentTier: "basic", hasWalkthrough: true, completedOrders: 2,
    onTimeOrders: 2, qualityHistoryOrders: 1,
    eligibleBasic: true, eligibleVerified: true, eligibleTrusted: true,
  },
};

/** Staff's edits on the review page, kept in this tab: the history starts empty, as a new company's does. */
let reviewHistory = [];
const FIELD_KIND = { companyName: "company_name", legalName: "legal_name", country: "country", website: "website" };

/** The legal name its licence reads, in the mock scores; else the shared submission's. */
function mockLegalName(profile) {
  const read = (profile.verification?.groups ?? []).flatMap((group) => group.fields ?? []).find((field) => field.key === "legalName");
  return read?.value ?? mockSubmission.profile.legal_name;
}

/** The shared submission, with the legal name, country and website of the company being reviewed. */
function submissionFor(orgId) {
  const profile = profiles.find((row) => row.id === orgId);
  if (!profile) return mockSubmission;
  const website = profile.details?.find(([label]) => label === "Website")?.[1];
  return {
    ...mockSubmission,
    profile: {
      ...mockSubmission.profile,
      legal_name: profile.legalName !== undefined ? profile.legalName || null : mockLegalName(profile),
      country_code: profile.countryCode ?? countryIn(profile.location ?? "") ?? mockSubmission.profile.country_code,
      website_url: profile.website ?? (website && website !== "—" ? website : null),
    },
  };
}

const mockAdapter = {
  viewer: {
    isAdmin: true,
    org: null,
    user: {
      email: "operations@thesourcingclub.com",
      user_metadata: { full_name: "TSC Operations" },
    },
  },
  // A company that has not finished signing up is not in the queue (Nov 26); Users still lists its people.
  verificationQueue: () => profiles.filter((profile) => profile.signupFinished !== false),
  adminRfqs: () => rfqs,
  adminQuotes: () => quotes,
  adminMetrics: () => ({
    // The queue's Active tab: not decided, and not waiting on the company (M7).
    profilesAwaitingReview: profiles.filter((p) => p.signupFinished !== false && !["Approved", "Needs information", "Declined"].includes(p.status)).length,
    profilesSubmittedToday: 2,
    rfqsSubmittedToday: 12,
    quotesSubmittedToday: 19,
    paymentsAwaitingConfirmation: 3,
  }),
  adminUsers: () => users,
  actions: {
    orgDocuments: () => mockDocuments,
    orgSubmission: (orgId) => submissionFor(orgId),
    // A promise, as the live one is: the history reads it with .then.
    reviewChanges: async (orgId) => reviewHistory.filter((change) => change.orgId === orgId),
    updateCompanyProfile: (orgId, change) => {
      const at = new Date().toISOString();
      const rows = Object.entries(change).filter(([, value]) => value != null).map(([key, to]) => (key === "vendorKind"
        ? { kind: "vendor_kind", details: { to } }
        : key === "address" ? { kind: "address", details: { to } }
        : { kind: FIELD_KIND[key], details: { to } })).map((row, index) => ({ ...row, id: `change-${Date.now()}-${index}`, orgId, at, by: "TSC Operations" }));
      reviewHistory = [...rows, ...reviewHistory];
      profiles = profiles.map((profile) => {
        if (profile.id !== orgId) return profile;
        const next = { ...profile };
        if (change.companyName) Object.assign(next, { name: change.companyName });
        if (change.legalName != null) next.legalName = change.legalName;
        if (change.country) next.countryCode = change.country;
        if (change.website) next.website = change.website;
        if (change.vendorKind) next.entityType = change.vendorKind === "trading_company" ? "Trading company" : "Factory";
        return next;
      });
      return {};
    },
    signOut: () => {},
    // No mail server behind the prototype; the panel shows where it would go.
    sendTestEmail: () => ({ sent: true, to: "operations@thesourcingclub.com" }),
    runDailyJobs: () => ({ reminders: { capacity_reminders: 2, due_soon: 1 }, emails: { sent: 3, skipped: 0, failed: 0, configured: true } }),
    suggestReviewRequest: ({ companyName }) => ({
      message: `${companyName}'s profile is nearly complete, but one item is still missing.\n\n- The missing supporting document, with its current scope and validity\n\nWe look forward to receiving it.`,
      error: null,
    }),
    decideReview: (id, status, _note, tier) => {
      const tone = status === "Approved" ? "success" : status === "Declined" ? "neutral" : "danger";
      profiles = profiles.map((profile) => (profile.id === id ? { ...profile, status, tone, trustTier: tier ?? profile.trustTier } : profile));
    },
    toggleUserAccess: (userId, disabled) => {
      users = users.map((user) => user.id === userId
        ? { ...user, status: disabled ? "Disabled" : user.signupFinished === false ? "Signup not finished" : "Active" }
        : user);
    },
  },
};

createRoot(document.getElementById("root")).render(
  <DataProvider adapter={mockAdapter}>
    <App />
  </DataProvider>,
);
