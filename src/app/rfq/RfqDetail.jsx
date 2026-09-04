/**
 * A request in full.
 *
 * Serves both sides, because it is the same row: a brand sees its own request
 * and who has quoted; a factory sees what is being asked and whether it may
 * bid. Splitting it into two components would be two places for the same
 * fields to drift apart, which is what the prototypes did.
 *
 * Everything shown traces to a stored column. The design system is explicit
 * about that — the prototype's quote detail is almost entirely hardcoded copy,
 * and none of it survives here.
 */
import React, { useEffect, useState } from "react";
import { getColourSplits, getInvitations, getQuestions, getRfq } from "../../lib/domain/rfq.js";
import { listDocuments, urlFor } from "../../lib/domain/documents.js";
import { termLabel } from "../../lib/domain/taxonomy.js";
import { formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { supabase, unwrap } from "../../lib/supabase.js";
import "./rfq.css";

const MONTH = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });

function Fact({ label, children }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children ?? "—"}</dd>
    </div>
  );
}

export default function RfqDetail({ org, rfqId, isFactory, profile }) {
  const { navigate } = useRouter();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const rfq = await getRfq(rfqId);
      if (!rfq) throw new Error("this request is not available to you");

      const [colours, questions, docs, links, brandRow] = await Promise.all([
        getColourSplits(rfqId),
        getQuestions(rfqId),
        listDocuments(rfq.brand_org_id).catch(() => []),
        supabase
          .from("taxonomy_links")
          .select("taxonomy_terms (id, kind, slug, label_en, label_zh)")
          .eq("subject_type", "rfq")
          .eq("subject_id", rfqId),
        // A factory learns about the brand only through this function; the
        // brand_profiles table stays locked to its own org, because row
        // policies cannot redact columns.
        isFactory
          ? supabase.rpc("brand_summary_for_factory", { brand_org: rfq.brand_org_id })
          : Promise.resolve({ data: null }),
      ]);

      const invitations = isFactory ? [] : await getInvitations(rfqId).catch(() => []);
      const quotes = isFactory
        ? []
        : unwrap(
            await supabase
              .from("quotes")
              .select("id, status, unit_price_cents, production_quantity, bulk_lead_time_days, version")
              .eq("rfq_id", rfqId)
              .in("status", ["submitted", "accepted", "declined"]),
            "load quotes",
          );

      if (cancelled) return;

      setState({
        rfq,
        colours,
        questions,
        documents: docs.filter((doc) => doc.rfq_id === rfqId),
        terms: (links.data ?? []).map((row) => row.taxonomy_terms).filter(Boolean),
        brand: Array.isArray(brandRow?.data) ? brandRow.data[0] : brandRow?.data ?? null,
        invitations,
        quotes,
      });
    }

    load().catch((failure) => {
      if (!cancelled) setError(failure);
    });
    return () => {
      cancelled = true;
    };
  }, [rfqId, isFactory]);

  if (error) {
    return (
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={() => navigate(isFactory ? "/browse" : "/rfqs")}>
          ← Back
        </button>
        <h1>Not available</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="rfq-page">
        <div className="spinner" aria-hidden="true" />
      </div>
    );
  }

  const { rfq, colours, questions, documents, terms, brand, quotes } = state;
  const byKind = (kind) => terms.filter((term) => term.kind === kind);
  const canQuote = profile?.verification_status === "verified" && rfq.status === "open";

  return (
    <div className="rfq-page rfq-detail">
      <button type="button" className="quiet-btn" onClick={() => navigate(isFactory ? "/browse" : "/rfqs")}>
        ← Back to {isFactory ? "open requests" : "requests"}
      </button>

      <header className="rfq-page-head">
        <div>
          <span className={`rfq-status rfq-status--${rfq.status}`}>
            {rfq.status === "open" ? "Accepting quotes" : rfq.status}
          </span>
          <h1>{rfq.title || "Untitled request"}</h1>
          <p>
            {isFactory ? brand?.name ?? "A brand" : "Your request"}
            {rfq.quote_deadline ? ` · quotes due ${new Date(rfq.quote_deadline).toLocaleDateString()}` : ""}
          </p>
        </div>

        {isFactory && rfq.status === "open" ? (
          <button
            type="button"
            className="primary-btn"
            disabled={!canQuote}
            title={canQuote ? undefined : "Quoting opens once your registration is verified"}
            onClick={() => navigate(`/browse/${rfq.id}/quote`)}
          >
            {canQuote ? "Send a quote" : "Verification needed"}
          </button>
        ) : null}
      </header>

      <section className="detail-card">
        <h2>What they need</h2>
        <p className="detail-body">{rfq.brief || "No description given."}</p>

        <dl className="fact-row">
          <Fact label="Quantity">
            {rfq.quantity_total ? `${rfq.quantity_total.toLocaleString()} units` : null}
          </Fact>
          <Fact label="Target unit price">
            {formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents)}
          </Fact>
          <Fact label="Bulk delivery">
            {rfq.target_delivery_month ? MONTH.format(new Date(rfq.target_delivery_month)) : null}
          </Fact>
          <Fact label="Samples">
            {rfq.requires_sample ? "Required before bulk" : "Not required"}
          </Fact>
        </dl>

        {colours.length ? (
          <>
            <h3>Colour breakdown</h3>
            <dl className="fact-row">
              {colours.map((split) => (
                <Fact key={split.id} label={split.colour}>{split.quantity.toLocaleString()} units</Fact>
              ))}
            </dl>
          </>
        ) : null}

        {rfq.material_notes ? (
          <>
            <h3>Materials and quality</h3>
            <p className="detail-body">{rfq.material_notes}</p>
          </>
        ) : null}

        {rfq.sample_notes ? (
          <>
            <h3>Sample plan</h3>
            <p className="detail-body">{rfq.sample_notes}</p>
          </>
        ) : null}

        {rfq.additional_details ? (
          <>
            <h3>Anything else</h3>
            <p className="detail-body">{rfq.additional_details}</p>
          </>
        ) : null}
      </section>

      {terms.length ? (
        <section className="detail-card">
          <h2>Requirements</h2>
          {["product_category", "certification", "region"].map((kind) =>
            byKind(kind).length ? (
              <div key={kind} className="detail-terms">
                <span className="ob-label">
                  {kind === "product_category" ? "Category" : kind === "certification" ? "Certifications" : "Preferred regions"}
                </span>
                <div className="chip-row">
                  {byKind(kind).map((term) => (
                    <span key={term.id} className="chip-toggle">{termLabel(term)}</span>
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </section>
      ) : null}

      {questions.length ? (
        <section className="detail-card">
          <h2>Questions to answer in your quote</h2>
          <ol className="detail-questions">
            {questions.map((question) => (
              <li key={question.id}>
                {question.prompt}
                {question.is_sensitive ? <span className="private-tag">Private</span> : null}
              </li>
            ))}
          </ol>
          <p className="ob-hint">
            {isFactory
              ? "Answers go to the brand with your quote. Anything not marked private is also visible to the other factories quoting."
              : "Every factory answers these, so you can compare like for like."}
          </p>
        </section>
      ) : null}

      {documents.length ? (
        <section className="detail-card">
          <h2>Attachments</h2>
          <ul className="file-list">
            {documents.map((doc) => (
              <li key={doc.id}>
                <span className="file-name">{doc.file_name}</span>
                <span className="file-meta">{Math.round((doc.size_bytes ?? 0) / 1024)} KB</span>
                <button
                  type="button"
                  className="admin-link"
                  onClick={async () => window.open(await urlFor(doc, 300), "_blank", "noopener,noreferrer")}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {isFactory && brand ? (
        <section className="detail-card">
          <h2>About the brand</h2>
          <dl className="fact-row">
            <Fact label="Brand">{brand.name}</Fact>
            <Fact label="Location">{brand.hq_location}</Fact>
            <Fact label="Verified">{brand.verified ? "Yes" : "Not yet"}</Fact>
          </dl>
          <p className="ob-hint">
            Order history and payment record appear here once there are orders to count. We would
            rather show nothing than a number we made up.
          </p>
        </section>
      ) : null}

      {!isFactory && rfq.status === "open" ? (
        <section className="detail-card">
          <h2>Who can see this</h2>
          <p className="ob-hint">
            {rfq.visibility === "open_to_all"
              ? "Every factory on the Club can see this request. Only verified ones can quote."
              : state.invitations.length
                ? `${state.invitations.length} factor${state.invitations.length === 1 ? "y has" : "ies have"} been invited. Nobody else can see it.`
                : "Nobody has been invited yet, so nobody can see this request."}
          </p>
          <button
            type="button"
            className={state.invitations.length || rfq.visibility === "open_to_all" ? "secondary-btn" : "primary-btn"}
            style={{ alignSelf: "flex-start" }}
            onClick={() => navigate(`/rfqs/${rfq.id}/invite`)}
          >
            {state.invitations.length ? "Change who is invited" : "Invite factories"}
          </button>
        </section>
      ) : null}

      {!isFactory ? (
        <section className="detail-card">
          <h2>Quotes ({quotes.length})</h2>
          {quotes.length === 0 ? (
            <p className="ob-hint">
              Nothing yet. Factories see this request in their browse list, sorted by how well it
              fits what they make.
            </p>
          ) : (
            <button type="button" className="primary-btn" onClick={() => navigate(`/rfqs/${rfq.id}/quotes`)}>
              Compare {quotes.length} quote{quotes.length === 1 ? "" : "s"}
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}
