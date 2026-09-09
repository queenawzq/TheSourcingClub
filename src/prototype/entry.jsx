/**
 * Mounts the brand prototype with the MOCK adapter.
 *
 * This is what prototype.html loads, and it is deliberately the only thing
 * that changed about Queena's workflow: open the page, see fully populated
 * screens, no database, no session, no network. The constants it serves are
 * the ones that have always been in main.jsx — nothing was moved or copied.
 *
 * app.html mounts the same App with a live adapter instead.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import App, { activeProjects, activeRfqs, closedRfqs, draftRfqs } from "./main.jsx";
import { DataProvider } from "../lib/data/DataProvider.jsx";

/**
 * Synchronous on purpose. The provider treats a non-promise as already
 * resolved, so the prototype never flashes a loading state and looks exactly
 * as it did before.
 */
const mockAdapter = {
  viewer: { isFactory: false, org: { name: "Maison Rue" }, user: null },
  orders: () => activeProjects,
  rfqs: () => ({ active: activeRfqs, drafts: draftRfqs, closed: closedRfqs }),
};

createRoot(document.getElementById("root")).render(
  <DataProvider adapter={mockAdapter}>
    <App />
  </DataProvider>,
);
