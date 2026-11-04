/**
 * Browse vendors: every verified, published vendor, on the designed marketplace
 * (`FactoryMarketplaceScreen`, /browse) and the designed directory list
 * (`FactorySearchScreen`, /browse/list), with the same filters, search and
 * ranking on both.
 *
 * Only what the access rules give any brand for a published profile is read
 * (load-profile.js's loadVendorDirectory). A card opens the vendor's profile
 * as a brand sees it (/factories/:id). "Request quote" opens the composer
 * with the vendor ticked; "Message" opens the brand's latest conversation
 * with it, and is left out when there is none, as on the profile. "Save"
 * keeps the vendor on the brand's Saved page.
 *
 * The chosen filters, search and sort are kept for the tab (sessionStorage,
 * per company), so switching between the two layouts keeps them.
 */
import React, { useEffect, useMemo, useState } from "react";
import { FactoryMarketplaceScreen, FactorySearchScreen } from "../../prototype/main.jsx";
import { useRouter } from "../../lib/router.jsx";
import { loadVendorDirectory } from "../profile/load-profile.js";
import { useSavedVendors } from "./useSavedVendors.js";
import BrowseSort from "./BrowseSort.jsx";
import {
  SORTS,
  activeFilterCount,
  emptyFilters,
  filterPanel,
  filterVendors,
  keepKnownFilters,
  sortVendors,
  toggleFilter,
  vendorCard,
} from "./vendor-directory-view.js";
import "./browse.css";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** This tab's last Browse choices for the company; null when none or unreadable. */
function readChoices(orgId) {
  try {
    return JSON.parse(window.sessionStorage.getItem(`tscBrowse:${orgId}`) ?? "null");
  } catch {
    return null;
  }
}

function keepChoices(orgId, choices) {
  try {
    window.sessionStorage.setItem(`tscBrowse:${orgId}`, JSON.stringify(choices));
  } catch {
    // Private mode or full storage: the choices just don't outlive the page.
  }
}

/** The chosen filters and order in words, for the line under the count. */
function matchingLine(panel, filters, query, sort) {
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
    ...panel.tiers.filter((option) => filters.tiers.includes(option.id)).map((option) => `${option.label} standard`),
    filters.moq ? `MOQ ${filters.moq[0].toLocaleString("en")}-${filters.moq[1].toLocaleString("en")}${filters.moq[1] >= panel.moq.max ? "+" : ""}` : null,
    panel.startWindows.find((option) => option.key === filters.startWindow)?.label,
    panel.quantities.find((option) => option.id === filters.quantity)?.label,
    query.trim() ? `"${query.trim()}"` : null,
  ].filter(Boolean);
  const order = `${(SORTS.find((option) => option.key === sort) ?? SORTS[0]).words} first`;
  return words.length ? `matching ${words.join(", ")}, ${order}` : `every vendor listed on TSC, ${order}`;
}

export default function LiveBrandBrowse({ org, user, view = "cards" }) {
  const { navigate } = useRouter();
  const { saveFor, error: saveError } = useSavedVendors(org, user);
  const [state, setState] = useState({ data: null, error: null });
  const [vendorType, setVendorType] = useState(
    () => (new URLSearchParams(window.location.search).get("type") === "trading" ? "trading" : "factories"),
  );
  // Restored only for the same tab of vendors; options no longer offered are
  // dropped against the panel below (keepKnownFilters).
  const [restored] = useState(() => {
    const kept = readChoices(org.id);
    return kept?.vendorType === vendorType ? kept : null;
  });
  const [filters, setFilters] = useState(() => restored?.filters ?? emptyFilters());
  const [query, setQuery] = useState(() => (typeof restored?.query === "string" ? restored.query : ""));
  const [sort, setSort] = useState(() => (SORTS.some((option) => option.key === restored?.sort) ? restored.sort : "fit"));

  useEffect(() => {
    keepChoices(org.id, { vendorType, filters, query, sort });
  }, [org.id, vendorType, filters, query, sort]);

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

  const chosen = keepKnownFilters(filters, panel);
  const shown = sortVendors(filterVendors(ofType, chosen, query), sort);
  const filterCount = activeFilterCount(chosen);
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
      save: saveFor(vendor.id),
    };
  };

  const summaryText = isTrading ? plural(shown.length, "trading company", "trading companies") : plural(shown.length, "factory", "factories");
  const live = {
    vendorType,
    vendors: shown,
    filters: {
      panel,
      value: chosen,
      // From the previous state, so two changes in one tick both count.
      onToggle: (group, id) => setFilters((current) => toggleFilter(keepKnownFilters(current, panel), group, id)),
      onMoq: (range) => setFilters((current) => ({
        ...keepKnownFilters(current, panel),
        // The full span is the same as no MOQ filter.
        moq: panel.moq && range[0] <= panel.moq.min && range[1] >= panel.moq.max ? null : range,
      })),
      onReset: () => {
        setFilters(emptyFilters());
        setQuery("");
        setSort("fit");
      },
      // Below 1180px the panel is a dialog over the results: its button says
      // how many filters are on, and its footer how many vendors match.
      buttonLabel: filterCount ? `Filters · ${filterCount}` : "Filters",
      footer: (close) => (
        <div className="browse-filter-footer">
          <button className="primary-btn" type="button" onClick={close}>Show {summaryText}</button>
        </div>
      ),
    },
    matching: matchingLine(panel, chosen, query, sort),
    sortControl: <BrowseSort options={SORTS} value={sort} onChange={setSort} />,
    search: query,
    onSearch: setQuery,
    summary: summaryText,
    empty: filterCount || query.trim()
      ? "No vendors match these filters. Remove one, or press Reset."
      : `No ${isTrading ? "trading companies" : "factories"} are listed yet.`,
    card,
  };

  const saveAlert = saveError
    ? <p className="live-profile-error directory-save-error" role="alert">Couldn't update your saved vendors: {saveError.message}</p>
    : null;

  if (view === "list") {
    return (
      <main className="directory-page">
        {saveAlert}
        <FactorySearchScreen
          goTo={() => {}}
          live={{
            ...live,
            onCardsView: () => navigate(`/browse${typeQuery}`),
          }}
        />
      </main>
    );
  }

  return (
    <main className="directory-page">
      {saveAlert}
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
