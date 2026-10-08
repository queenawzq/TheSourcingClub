/**
 * A brand's production orders, on the designed list, with its saved tabs.
 *
 * `ProjectsScreen` reads the orders through the data seam itself; the tabs
 * come from the company's `order_tabs` and are handed in as `tabStore`, which
 * the prototype never passes.
 */
import React from "react";
import { ProjectsScreen } from "../../prototype/main.jsx";
import { DataProvider } from "../../lib/data/DataProvider.jsx";
import { createLiveAdapter } from "../live-adapter.js";
import useOrderTabs from "./useOrderTabs.js";

export default function LiveBrandOrders({ org, user, goTo, onViewOrder }) {
  const tabStore = useOrderTabs(org, user);
  return (
    <main className="rfqs-page brand-projects-page">
      <DataProvider adapter={createLiveAdapter({ org, isFactory: false, user })}>
        <ProjectsScreen goTo={goTo} onViewOrder={onViewOrder} live tabStore={tabStore} />
      </DataProvider>
    </main>
  );
}
