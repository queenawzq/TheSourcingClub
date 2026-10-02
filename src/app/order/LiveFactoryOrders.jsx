/**
 * A factory's production orders, on its own designed list.
 *
 * `FactoryProjectsPage` comes from src/factory-prototype/main.jsx. It brings
 * its own `<main>`, and reads the counterparty as `brand` with an avatar, so
 * the shared order card (`toProjectCard`) is given those two names here.
 */
import React from "react";
import { FactoryProjectsPage } from "../../factory-prototype/main.jsx";
import { DataProvider, useOrders } from "../../lib/data/DataProvider.jsx";
import { createLiveAdapter } from "../live-adapter.js";
import { initials } from "./order-view.js";

function Orders({ onViewOrder }) {
  const { data, loading, error } = useOrders();
  const projects = (data ?? []).map((card) => ({
    ...card,
    brand: card.factory,
    initials: initials(card.factory),
    images: [],
  }));
  return (
    <FactoryProjectsPage
      language="en"
      live={{ projects, loading, error }}
      onViewProject={onViewOrder}
    />
  );
}

export default function LiveFactoryOrders({ org, user, onViewOrder }) {
  return (
    <DataProvider adapter={createLiveAdapter({ org, isFactory: true, user })}>
      <Orders onViewOrder={onViewOrder} />
    </DataProvider>
  );
}
