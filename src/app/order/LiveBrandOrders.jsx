/**
 * A brand's production orders, on the designed list, with its saved tabs.
 *
 * `ProjectsScreen` reads the orders through the data seam itself; the tabs
 * come from the company's `order_tabs` and are handed in as `tabStore`, which
 * the prototype never passes.
 *
 * "Reorder style" copies the order's request into a new draft and opens it in
 * the composer, which ticks the same factory to invite (migration 069). The
 * design jumps to its contract screen instead, but a live order is always the
 * award of a quote, so a repeat starts from a request.
 */
import React, { useState } from "react";
import { ProjectsScreen } from "../../prototype/main.jsx";
import { DataProvider } from "../../lib/data/DataProvider.jsx";
import { duplicateRfqFromOrder } from "../../lib/domain/rfq.js";
import { useRouter } from "../../lib/router.jsx";
import { createLiveAdapter } from "../live-adapter.js";
import useOrderTabs from "./useOrderTabs.js";

export default function LiveBrandOrders({ org, user, goTo, onViewOrder }) {
  const tabStore = useOrderTabs(org, user);
  const { navigate } = useRouter();
  const [reordering, setReordering] = useState(false);
  const [reorderError, setReorderError] = useState(null);

  async function reorder(project) {
    if (reordering || !project?.id) return;
    setReordering(true);
    setReorderError(null);
    try {
      const draftId = await duplicateRfqFromOrder(project.id);
      navigate(`/rfqs/${draftId}/edit`);
    } catch (failure) {
      setReorderError(failure);
      setReordering(false);
    }
  }

  return (
    <main className="rfqs-page brand-projects-page">
      {reorderError && (
        <p className="projects-empty projects-error" role="alert">{reorderError.message}</p>
      )}
      <DataProvider adapter={createLiveAdapter({ org, isFactory: false, user })}>
        <ProjectsScreen goTo={goTo} onViewOrder={onViewOrder} onReorder={reorder} live tabStore={tabStore} />
      </DataProvider>
    </main>
  );
}
