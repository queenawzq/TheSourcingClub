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
import App, { initialProfiles, initialTerms, initialUsers, quotes, rfqs } from "./main.jsx";
import { DataProvider } from "../lib/data/DataProvider.jsx";

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
let legalDocuments = initialTerms;

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
};

const mockAdapter = {
  viewer: { isAdmin: true, org: null, user: null },
  verificationQueue: () => profiles,
  adminRfqs: () => rfqs,
  adminQuotes: () => quotes,
  adminMetrics: () => ({
    profilesAwaitingReview: profiles.filter((p) => !["Approved", "Declined"].includes(p.status)).length,
    profilesSubmittedToday: 2,
    rfqsSubmittedToday: 12,
    quotesSubmittedToday: 19,
    paymentsAwaitingConfirmation: 3,
  }),
  adminUsers: () => users,
  legalDocuments: () => legalDocuments,
  actions: {
    orgDocuments: () => mockDocuments,
    orgSubmission: () => mockSubmission,
    decideReview: (id, status) => {
      const tone = status === "Approved" ? "success" : status === "Declined" ? "neutral" : "danger";
      profiles = profiles.map((profile) => (profile.id === id ? { ...profile, status, tone } : profile));
    },
    toggleUserAccess: (userId, disabled) => {
      users = users.map((user) => user.id === userId
        ? { ...user, status: disabled ? "Disabled" : "Active" }
        : user);
    },
    saveLegalDocument: (tab, draft) => {
      legalDocuments = { ...legalDocuments, [tab]: { ...draft, updated: "Just now" } };
    },
  },
};

createRoot(document.getElementById("root")).render(
  <DataProvider adapter={mockAdapter}>
    <App />
  </DataProvider>,
);
