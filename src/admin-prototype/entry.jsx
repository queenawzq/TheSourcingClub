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
  actions: {
    decideReview: (id, status) => {
      const tone = status === "Approved" ? "success" : status === "Declined" ? "neutral" : "danger";
      profiles = profiles.map((profile) => (profile.id === id ? { ...profile, status, tone } : profile));
    },
    toggleUserAccess: (userId, disabled) => {
      users = users.map((user) => user.id === userId
        ? { ...user, status: disabled ? "Disabled" : "Active" }
        : user);
    },
  },
};

createRoot(document.getElementById("root")).render(
  <DataProvider adapter={mockAdapter}>
    <App />
  </DataProvider>,
);
