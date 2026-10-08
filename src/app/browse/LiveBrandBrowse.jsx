/**
 * Browse vendors: every published vendor, on the designed marketplace
 * (`FactoryMarketplaceScreen`, /browse) and the designed directory list
 * (`FactorySearchScreen`, /browse/list), with the same filters, search and
 * ranking on both.
 *
 * Only what the access rules give any brand for a published profile is read
 * (load-profile.js's loadVendorDirectory). A card opens the vendor's profile
 * as a brand sees it (/factories/:id). "Request quote" opens the composer
 * with the vendor ticked; "Message" opens the brand's latest conversation
 * with it, and is left out when there is none, as on the profile.
 */
import React, { useEffect, useMemo, useState } from "react";
import { FactoryMarketplaceScreen, FactorySearchScreen } from "../../prototype/main.jsx";
import { useRouter } from "../../lib/router.jsx";
import { loadVendorDirectory } from "../profile/load-profile.js";
import {
  activeFilterCount,
  emptyFilters,
  filterPanel,
  filterVendors,
  toggleFilter,
  vendorCard,
} from "./vendor-directory-view.js";
import "./browse.css";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The chosen filters in words, for the list view's summary line. */
function matchingLine(panel, filters, query) {
  const byId = new Map([
    ...panel.checks.flatMap((group) => group.options.map((option) => [option.id, option.label])),
    ...panel.priceLevels.map((option) => [option.id, option.label]),
    ...panel.certifications.map((option) => [option.id, option.label]),
  ]);
  const words = [
    ...Object.values(filters.terms).flat().map((id) => byId.get(id)),
    ...panel.countries.filter((option) => filters.countries.includes(option.id)).map((option) => option.label),
    ...filters.certifications.map((id) => byId.get(id)),
    ...panel.leadTimes.filter((option) => filters.leadTimes.includes(option.id)).map((option) => `${option.label.toLowerCase()} lead`),
    filters.moq ? `MOQ ${filters.moq[0].toLocaleString("en")}-${filters.moq[1].toLocaleString("en")}` : null,
    panel.startWindows.find((option) => option.key === filters.startWindow)?.label,
    panel.quantities.find((option) => option.id === filters.quantity)?.label,
    query.trim() ? `"${query.trim()}"` : null,
  ].filter(Boolean);
  return words.length ? `matching ${words.join(", ")}` : "every vendor listed on TSC, best fit first";
}

export default function LiveBrandBrowse({ org, view = "cards" }) {
  const { navigate } = useRouter();
  const [state, setState] = useState({ data: null, error: null });
  const [vendorType, setVendorType] = useState(
    () => (new URLSearchParams(window.location.search).get("type") === "trading" ? "trading" : "factories"),
  );
  const [filters, setFilters] = useState(emptyFilters);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadVendorDirectory(org).then(
      (data) => !cancelled && setState({ data, error: null }),
      (error) => !cancelled && setState({ data: null, error }),
    );
    return () => { cancelled = true; };
  }, [org.id]);

  const cards = useMemo(() => (state.data?.vendors ?? []).map((parts) => vendorCard(parts)), [state.data]);
  const ofType = useMemo(
    () => cards.filter((card) => (vendorType === "trading" ? card.vendorType === "trading" : card.vendorType === "factory")),
    [cards, vendorType],
  );
  const panel = useMemo(() => filterPanel(state.data?.terms, ofType, vendorType), [state.data, ofType, vendorType]);

  if (state.error) {
    return <main className="directory-page"><p className="live-profile-error" role="alert">Couldn't load vendors: {state.error.message}</p></main>;
  }
  if (!state.data) {
    return <main className="directory-page"><p className="live-profile-loading">Loading vendors…</p></main>;
  }

  const shown = filterVendors(ofType, filters, query);
  const isTrading = vendorType === "trading";
  const threads = state.data.threads;
  const typeQuery = isTrading ? "?type=trading" : "";

  const card = (vendor) => {
    // listThreads is newest first: the latest conversation with this vendor.
    const thread = threads.find((item) => item.brand_org_id === org.id && item.factory_org_id === vendor.id);
    return {
      href: `/app.html/factories/${vendor.id}?from=browse`,
      onOpen: () => navigate(`/factories/${vendor.id}?from=browse`),
      onQuote: () => navigate(`/rfqs/new?invite=${vendor.id}`),
      onMessage: thread ? () => navigate(`/messages/${thread.id}`) : null,
      save: null,
    };
  };

  const live = {
    vendorType,
    vendors: shown,
    filters: {
      panel,
      value: filters,
      onToggle: (group, id) => setFilters((current) => toggleFilter(current, group, id)),
      onMoq: (range) => setFilters((current) => ({
        ...current,
        // The full span is the same as no MOQ filter.
        moq: panel.moq && range[0] <= panel.moq.min && range[1] >= panel.moq.max ? null : range,
      })),
      onReset: () => {
        setFilters(emptyFilters());
        setQuery("");
      },
    },
    search: query,
    onSearch: setQuery,
    summary: isTrading ? plural(shown.length, "trading company", "trading companies") : plural(shown.length, "factory", "factories"),
    empty: activeFilterCount(filters) || query.trim()
      ? "No vendors match these filters. Remove one, or press Reset."
      : `No ${isTrading ? "trading companies" : "factories"} are listed yet.`,
    card,
  };

  if (view === "list") {
    return (
      <main className="directory-page">
        <FactorySearchScreen
          goTo={() => {}}
          live={{
            ...live,
            matching: matchingLine(panel, filters, query),
            onCardsView: () => navigate(`/browse${typeQuery}`),
          }}
        />
      </main>
    );
  }

  return (
    <main className="directory-page">
      <FactoryMarketplaceScreen
        goTo={() => {}}
        live={{
          ...live,
          onVendorType: (next) => {
            setVendorType(next);
            setFilters(emptyFilters());
          },
          onListView: () => navigate(`/browse/list${typeQuery}`),
        }}
      />
    </main>
  );
}
