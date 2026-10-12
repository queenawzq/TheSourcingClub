/**
 * The brand's Saved page: the vendors it saved from Browse vendors or a
 * vendor's profile, on the designed `SavedFactoriesScreen`.
 *
 * saved_factories is the brand's own list. Each card is the same card Browse
 * vendors draws, from the same loader, so it says the same thing. A vendor
 * that has since unpublished its profile keeps its name and nothing else, as
 * a factory's saved brands do. A card opens the vendor's profile, where
 * "Saved" removes it.
 */
import React, { useEffect, useMemo, useState } from "react";
import { SavedFactoriesScreen } from "../../prototype/main.jsx";
import { listSavedFactories } from "../../lib/domain/rfq.js";
import { useRouter } from "../../lib/router.jsx";
import { initialsOf } from "../profile/factory-profile-view.js";
import { loadVendorDirectory } from "../profile/load-profile.js";
import { filterVendors, emptyFilters, vendorCard } from "./vendor-directory-view.js";
import "./browse.css";

/** A saved vendor the brand can no longer read: its name only. */
const unlistedCard = (row) => ({
  id: row.factory_org_id,
  name: row.orgs?.name ?? "Vendor",
  initials: initialsOf(row.orgs?.name),
  logoUrl: null,
  trust: null,
  vendorType: "factory",
  location: "No longer listed on TSC",
  stats: [],
  notes: [],
  products: [],
  categories: [],
  capabilities: [],
  facts: { termIds: new Set(), certificationIds: new Set(), countryCode: null, moq: null, lead: null, openMonths: [] },
  searchText: String(row.orgs?.name ?? "").toLowerCase(),
  unlisted: true,
});

export default function LiveSavedVendors({ org }) {
  const { navigate } = useRouter();
  const [state, setState] = useState({ rows: null, directory: null, error: null });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");

  useEffect(() => {
    let cancelled = false;
    Promise.all([listSavedFactories(org.id), loadVendorDirectory(org)]).then(
      ([rows, directory]) => !cancelled && setState({ rows, directory, error: null }),
      (error) => !cancelled && setState({ rows: null, directory: null, error }),
    );
    return () => { cancelled = true; };
  }, [org.id]);

  const cards = useMemo(() => {
    if (!state.rows) return [];
    const listed = new Map((state.directory?.vendors ?? []).map((parts, rank) => [parts.orgId, { parts, rank }]));
    return state.rows.map((row, recent) => {
      const found = listed.get(row.factory_org_id);
      // Newest saved first (the rows' order); Best fit is Browse's ranking.
      return { card: found ? vendorCard(found.parts) : unlistedCard(row), recent, rank: found ? found.rank : Infinity };
    });
  }, [state.rows, state.directory]);

  if (state.error) {
    return <main className="rfqs-page"><p className="live-profile-error" role="alert">Couldn't load your saved vendors: {state.error.message}</p></main>;
  }
  if (!state.rows) {
    return <main className="rfqs-page"><p className="live-profile-loading">Loading your saved vendors…</p></main>;
  }

  const ordered = [...cards].sort((a, b) => (sort === "fit" ? a.rank - b.rank || a.recent - b.recent : a.recent - b.recent));
  const shown = filterVendors(ordered.map((item) => item.card), emptyFilters(), query);
  const threads = state.directory?.threads ?? [];

  return (
    <main className="rfqs-page">
      <SavedFactoriesScreen
        goTo={() => {}}
        live={{
          brandName: org.name,
          vendors: shown,
          search: query,
          onSearch: setQuery,
          sort,
          onSort: setSort,
          onBrowse: () => navigate("/browse"),
          empty: cards.length
            ? "No saved vendors match this search."
            : "No saved vendors yet. Press Save on a vendor in Browse vendors, or Save factory on its profile, to keep it here.",
          card: (vendor) => {
            if (vendor.unlisted) return { href: null, onOpen: null, onMessage: null, onQuote: null };
            // listThreads is newest first: the latest conversation with this vendor.
            const thread = threads.find((item) => item.brand_org_id === org.id && item.factory_org_id === vendor.id);
            return {
              href: `/app.html/factories/${vendor.id}?from=saved`,
              onOpen: () => navigate(`/factories/${vendor.id}?from=saved`),
              onMessage: thread ? () => navigate(`/messages/${thread.id}`) : null,
              onQuote: () => navigate(`/rfqs/new?invite=${vendor.id}`),
            };
          },
        }}
      />
    </main>
  );
}
