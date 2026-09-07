/**
 * Open requests, as a factory sees them.
 *
 * Which requests appear is decided entirely by the RLS policy — an open-to-all
 * request, or one this factory was invited to. This screen deliberately does
 * not re-implement that rule in JavaScript, where it could drift from the
 * policy and start showing something the database would refuse to return.
 *
 * Verification is a separate matter from visibility: an unverified factory
 * sees everything here and can open any of it, but cannot bid. That is the
 * point — a new factory should find a marketplace worth finishing signup for.
 */
import React, { useEffect, useMemo, useState } from "react";
import { listOpenRfqs } from "../../lib/domain/rfq.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { supabase, unwrap } from "../../lib/supabase.js";
import "./rfq.css";

const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

function daysLeft(deadline) {
  if (!deadline) return null;
  const diff = Math.ceil((new Date(deadline) - Date.now()) / 86400000);
  if (diff < 0) return "Closed";
  if (diff === 0) return "Due today";
  if (diff === 1) return "1 day left";
  return `${diff} days left`;
}

export default function BrowseRfqs({ org, profile }) {
  const { navigate } = useRouter();
  const [rfqs, setRfqs] = useState(null);
  const [scores, setScores] = useState({});
  const [terms, setTerms] = useState({});
  const [filters, setFilters] = useState({ category: null, region: null });
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [open, byKind] = await Promise.all([
        listOpenRfqs(),
        listTermsByKind(["product_category", "region"]),
      ]);
      if (cancelled) return;

      setRfqs(open);
      setTerms(byKind);

      // Score against each specific request, not the brand's general profile.
      // A brand that mostly makes shirts may post one request for knitwear.
      const results = await Promise.all(
        open.map(async (rfq) => {
          const { data } = await supabase.rpc("match_score_rfq", {
            rfq_id: rfq.id,
            factory_org: org.id,
          });
          return [rfq.id, data];
        }),
      );
      if (!cancelled) setScores(Object.fromEntries(results));
    }

    load().catch((failure) => {
      if (!cancelled) setError(failure);
    });
    return () => {
      cancelled = true;
    };
  }, [org.id]);

  // Requirement links per request, so a card can show what is being asked for.
  const [links, setLinks] = useState({});
  useEffect(() => {
    if (!rfqs?.length) return;
    let cancelled = false;

    supabase
      .from("taxonomy_links")
      .select("subject_id, taxonomy_terms (id, kind, slug, label_en, label_zh)")
      .eq("subject_type", "rfq")
      .in("subject_id", rfqs.map((rfq) => rfq.id))
      .then(({ data, error: linkError }) => {
        if (cancelled || linkError) return;
        const grouped = {};
        for (const row of data ?? []) {
          (grouped[row.subject_id] ||= []).push(row.taxonomy_terms);
        }
        setLinks(grouped);
      });

    return () => {
      cancelled = true;
    };
  }, [rfqs]);

  const visible = useMemo(() => {
    if (!rfqs) return [];
    return rfqs
      .filter((rfq) => {
        const terms = links[rfq.id] ?? [];
        if (filters.category && !terms.some((t) => t.id === filters.category)) return false;
        if (filters.region && !terms.some((t) => t.id === filters.region)) return false;
        return true;
      })
      .sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  }, [rfqs, links, filters, scores]);

  const canQuote = profile?.verification_status === "verified";

  if (error) {
    return (
      <div className="rfq-page">
        <h1>Open requests</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }

  if (!rfqs) {
    return (
      <div className="rfq-page">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="rfq-page">
      <header className="rfq-page-head">
        <div>
          <h1>Open requests</h1>
          <p>Brands looking for a factory. Sorted by how well each one fits what you make.</p>
        </div>
      </header>

      {!canQuote ? (
        <div className="browse-gate">
          <strong>You can look, but not yet bid.</strong>
          <span>
            Quoting opens once we have verified your business registration — usually within a
            working day of you uploading it.
          </span>
        </div>
      ) : null}

      {(terms.product_category?.length || terms.region?.length) && rfqs.length > 1 ? (
        <div className="browse-filters">
          <select
            value={filters.category ?? ""}
            onChange={(event) => setFilters((f) => ({ ...f, category: event.target.value || null }))}
            aria-label="Filter by product category"
          >
            <option value="">Any category</option>
            {(terms.product_category ?? []).map((term) => (
              <option key={term.id} value={term.id}>{termLabel(term)}</option>
            ))}
          </select>
          <select
            value={filters.region ?? ""}
            onChange={(event) => setFilters((f) => ({ ...f, region: event.target.value || null }))}
            aria-label="Filter by region"
          >
            <option value="">Any region</option>
            {(terms.region ?? []).map((term) => (
              <option key={term.id} value={term.id}>{termLabel(term)}</option>
            ))}
          </select>
          {filters.category || filters.region ? (
            <button type="button" className="quiet-btn" onClick={() => setFilters({ category: null, region: null })}>
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="rfq-empty">
          <p>{rfqs.length ? "Nothing matches those filters." : "No open requests right now."}</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>
            Requests appear here as brands publish them. A complete profile means more of them
            reach you.
          </p>
        </div>
      ) : (
        <div className="rfq-list">
          {visible.map((rfq) => {
            const score = scores[rfq.id];
            const tier = score == null ? null : score >= 0.9 ? "strong" : score >= 0.75 ? "good" : score >= 0.6 ? "potential" : "weak";
            const due = daysLeft(rfq.quote_deadline);

            return (
              <button
                key={rfq.id}
                type="button"
                className="rfq-card"
                data-testid="open-rfq-card"
                onClick={() => navigate(`/browse/${rfq.id}`)}
              >
                <div>
                  {score != null ? (
                    <span className={`fit-chip fit-chip--${tier}`}>
                      {Math.round(score * 100)}% fit
                    </span>
                  ) : null}
                  <h2>{rfq.title || "Untitled request"}</h2>
                  <p className="rfq-card-meta">
                    {rfq.orgs?.name ?? "A brand"}
                    {rfq.quantity_total ? ` · ${rfq.quantity_total.toLocaleString()} units` : ""}
                    {rfq.target_delivery_month ? ` · deliver ${MONTH.format(new Date(rfq.target_delivery_month))}` : ""}
                  </p>
                  {(links[rfq.id] ?? []).length ? (
                    <p className="rfq-card-tags">
                      {(links[rfq.id] ?? []).slice(0, 4).map((term) => (
                        <span key={term.id} className="chip-toggle">{termLabel(term)}</span>
                      ))}
                    </p>
                  ) : null}
                </div>

                <dl className="rfq-card-metrics">
                  <div>
                    <dt>Target price</dt>
                    <dd>{formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents)}</dd>
                  </div>
                  {due ? (
                    <div>
                      <dt>Quotes</dt>
                      <dd>{due}</dd>
                    </div>
                  ) : null}
                </dl>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
