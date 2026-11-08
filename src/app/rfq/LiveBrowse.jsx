/**
 * The factory's view of the marketplace, on Queena's designed screen.
 *
 * `FactoryBrowsePage` comes from src/factory-prototype/main.jsx. This file is
 * the seam.
 *
 * What a factory can see here is decided by RLS, not by this query: an
 * open-to-all request reaches every factory, an invite-only one only the
 * factories with an invitation row. Visibility and the right to quote are
 * separate — an unverified factory sees the marketplace and is refused at the
 * quote, which is what makes verification the thing that unlocks earning
 * rather than the thing that unlocks looking.
 *
 * The chosen filters, search and sort are kept for the tab (sessionStorage,
 * per company). rfq-browse-view.js says what each one reads.
 */
import React, { useEffect, useState } from "react";
import { FactoryBrowsePage } from "../../factory-prototype/main.jsx";
import { brandSummary, listOpenRfqs, matchScoresForRfq } from "../../lib/domain/rfq.js";
import { getRfqDocumentPresentation } from "../../lib/domain/documents.js";
import { formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { listLinks, listTermsByKind } from "../../lib/domain/taxonomy.js";
import { loadRequestTagMetadata, requestTags } from "./request-tags.js";
import BrowseSort from "../browse/BrowseSort.jsx";
import {
  SORTS,
  activeFilterCount,
  emptyFilters,
  filterPanel,
  filterRows,
  keepKnownFilters,
  matchingLine,
  regionsOfCountry,
  sortRows,
  toggleFilter,
} from "./rfq-browse-view.js";
import "../browse/browse.css";

const FILTER_KINDS = ["product_category", "price_point", "quantity_band", "region", "client_trust_band", "timeline_band", "certification", "sourcing_region"];

const choicesKey = (orgId) => `tscRfqBrowse:${orgId}`;

/** This tab's last choices for the company; null when none or unreadable. */
function readChoices(orgId) {
  try {
    return JSON.parse(window.sessionStorage.getItem(choicesKey(orgId)) ?? "null");
  } catch {
    return null;
  }
}

function keepChoices(orgId, choices) {
  try {
    window.sessionStorage.setItem(choicesKey(orgId), JSON.stringify(choices));
  } catch {
    // Private mode or full storage: the choices just don't outlive the page.
  }
}

const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

/** "18 minutes ago", from when it was published. */
function posted(value) {
  if (!value) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `Posted ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Posted ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `Posted ${Math.round(hours / 24)} days ago`;
}

function fitBand(score) {
  if (score !== null && score >= 90) return { label: "Great fit", tone: "strong" };
  if (score !== null && score >= 75) return { label: "Strong fit", tone: "good" };
  return { label: "Potential fit", tone: "warn" };
}

export default function LiveBrowse({ org, profile }) {
  // Visibility and the right to quote are separate, and the designs express
  // only the first. A factory that can see the marketplace but cannot yet bid
  // has to be told which it is — finding out at the quote button is finding
  // out too late.

  const { navigate } = useRouter();
  const [rfqs, setRfqs] = useState(null);
  const [matchScores, setMatchScores] = useState(new Map());
  const [requestDocuments, setRequestDocuments] = useState(new Map());
  const [tagMetadata, setTagMetadata] = useState(new Map());
  const [terms, setTerms] = useState({});
  const [paymentVerified, setPaymentVerified] = useState(new Map());
  const [ownRegions, setOwnRegions] = useState([]);
  const [error, setError] = useState(null);
  const [restored] = useState(() => readChoices(org.id));
  const [filters, setFilters] = useState(() => restored?.filters ?? emptyFilters());
  const [query, setQuery] = useState(() => (typeof restored?.query === "string" ? restored.query : ""));
  const [sort, setSort] = useState(() => (SORTS.some((option) => option.key === restored?.sort) ? restored.sort : "fit"));
  const isTrading = profile?.vendor_kind === "trading_company";

  useEffect(() => {
    keepChoices(org.id, { filters, query, sort });
  }, [org.id, filters, query, sort]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listOpenRfqs();
      const [scores, documents, metadata, vocabulary, summaries, ownLinks] = await Promise.all([
        Promise.all(rows.map(async (rfq) => {
          const result = await matchScoresForRfq(rfq.id, [org.id]);
          return [rfq.id, result.get(org.id) ?? null];
        })),
        Promise.all(rows.map(async (rfq) => [
          rfq.id,
          await getRfqDocumentPresentation(rfq.id).catch(() => ({ files: [], images: [] })),
        ])),
        loadRequestTagMetadata(rows),
        listTermsByKind(FILTER_KINDS),
        // One failed look-up leaves that brand unconfirmed, not the page empty.
        Promise.all([...new Set(rows.map((rfq) => rfq.brand_org_id))].map(async (brandId) => [
          brandId,
          await brandSummary(brandId).then((summary) => summary?.payment_verified === true, () => false),
        ])),
        isTrading ? listLinks("factory_profile", org.id) : [],
      ]);
      if (!cancelled) {
        setRfqs(rows);
        setMatchScores(new Map(scores));
        setRequestDocuments(new Map(documents));
        setTagMetadata(metadata);
        setTerms(vocabulary);
        setPaymentVerified(new Map(summaries));
        // A factory's region is where it is; a trading company's, where it sources.
        setOwnRegions(isTrading
          ? (vocabulary.sourcing_region ?? []).filter((term) => ownLinks.includes(term.id)).map((term) => term.slug)
          : regionsOfCountry(profile?.country_code));
      }
    })().catch((failure) => {
      if (!cancelled) setError(failure);
    });
    return () => { cancelled = true; };
  }, [org.id, isTrading, profile?.country_code]);

  if (!rfqs) {
    return error ? <p className="composer-error" role="alert">{error.message}</p> : null;
  }

  const panel = filterPanel(terms, ownRegions);
  const chosen = keepKnownFilters(filters, panel);
  const rows = rfqs.map((rfq) => {
    const metadata = tagMetadata.get(rfq.id);
    return {
      rfq,
      termIds: new Set(metadata?.termIds ?? []),
      paymentVerified: paymentVerified.get(rfq.brand_org_id) ?? false,
      match: matchScores.get(rfq.id) ?? null,
      text: [rfq.title, rfq.brief, rfq.material_notes, rfq.additional_details, rfq.orgs?.name, ...requestTags(rfq, metadata)]
        .filter(Boolean).join(" ").toLowerCase(),
    };
  });
  const shown = sortRows(filterRows(rows, panel, chosen, query), sort);
  const filterCount = activeFilterCount(chosen);
  const summaryText = `${shown.length} open request${shown.length === 1 ? "" : "s"}`;

  const projects = shown.map(({ rfq }) => {
    const fit = fitBand(matchScores.get(rfq.id) ?? null);
    return {
      id: rfq.id,
      initials: initialsOf(rfq.orgs?.name),
      title: rfq.title || "Untitled request",
      brand: rfq.orgs?.name ?? "A brand",
      location: "",
      posted: posted(rfq.published_at ?? rfq.created_at),
      match: matchScores.get(rfq.id) ?? null,
      fitLabel: fit.label,
      quoteDue: rfq.quote_deadline ? new Date(rfq.quote_deadline).toLocaleDateString("en", { month: "short", day: "numeric" }) : "",
      budget: formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents, rfq.currency),
      quantity: rfq.quantity_total ? `${rfq.quantity_total} units` : "",
      samples: rfq.requires_sample ? "Sample required" : "No sample",
      specialty: rfq.brief ?? rfq.material_notes ?? "",
      tags: requestTags(rfq, tagMetadata.get(rfq.id)),
      capacity: [],
      images: requestDocuments.get(rfq.id)?.images ?? [],
      fitTone: fit.tone,
      trust: "",
      paymentVerified: paymentVerified.get(rfq.brand_org_id) ?? false,
      insight: [],
    };
  });

  return (
    <>
      {error && <p className="composer-error" role="alert">{error.message}</p>}
      {profile?.verification_status !== "verified" && (
        <div className="browse-gate">
          <strong>You can look, but not bid yet.</strong>
          <span>
            Your business registration is with our review team. Quoting opens as soon as it
            is approved — everything else works while you wait.
          </span>
        </div>
      )}
      <FactoryBrowsePage
        companyType={isTrading ? "trading" : "factory"}
        language="en"
        projects={projects}
        emptyNote={rfqs.length ? "No open requests match these filters. Remove one, or press Reset." : undefined}
        live={{
          panel,
          value: chosen,
          // From the previous state, so two changes in one tick both count.
          onToggle: (group, id) => setFilters((current) => toggleFilter(keepKnownFilters(current, panel), group, id)),
          onReset: () => {
            setFilters(emptyFilters());
            setQuery("");
            setSort("fit");
          },
          // Below 1180px the panel is a dialog over the results.
          buttonLabel: filterCount ? `Filters · ${filterCount}` : "Filters",
          footer: (close) => (
            <div className="browse-filter-footer">
              <button className="primary-btn" type="button" onClick={close}>Show {summaryText}</button>
            </div>
          ),
          matching: matchingLine(panel, chosen, query, sort),
          sortControl: <BrowseSort options={SORTS} value={sort} onChange={setSort} ariaLabel="Sort requests" />,
          search: query,
          onSearch: setQuery,
        }}
        onViewDetails={(project) => navigate(`/browse/${project.id}?from=browse`)}
      />
    </>
  );
}
