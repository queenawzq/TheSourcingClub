/**
 * A brand's requests.
 *
 * Counts come from the query rather than a stored column, so they cannot drift
 * from the rows they describe — the prototype keeps a static `metrics` tuple
 * on each card that nothing recomputes.
 */
import React, { useEffect, useState } from "react";
import { listRfqs } from "../../lib/domain/rfq.js";
import { formatRange } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./rfq.css";

const TABS = [
  { key: "open",      label: "Open" },
  { key: "draft",     label: "Drafts" },
  { key: "awarded",   label: "Awarded" },
  { key: "cancelled", label: "Closed" },
];

const STATUS_LABEL = {
  draft: "Draft",
  open: "Accepting quotes",
  awarded: "Awarded",
  cancelled: "Closed",
};

export default function RfqList({ org }) {
  const { navigate } = useRouter();
  const [rfqs, setRfqs] = useState(null);
  const [tab, setTab] = useState("open");
  const [error, setError] = useState(null);

  useEffect(() => {
    listRfqs(org.id).then(setRfqs).catch(setError);
  }, [org.id]);

  if (error) {
    return (
      <div className="rfq-page">
        <h1>Requests</h1>
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

  // Land on a tab that has something in it, rather than an empty "Open".
  const counts = TABS.reduce((acc, entry) => {
    acc[entry.key] = rfqs.filter((rfq) => rfq.status === entry.key).length;
    return acc;
  }, {});
  const visible = rfqs.filter((rfq) => rfq.status === tab);

  return (
    <div className="rfq-page">
      <header className="rfq-page-head">
        <div>
          <h1>Requests</h1>
          <p>Post what you need made, and compare what comes back.</p>
        </div>
        <button type="button" className="primary-btn" onClick={() => navigate("/rfqs/new")}>
          New request
        </button>
      </header>

      <div className="rfq-tabs">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={tab === entry.key ? "is-on" : undefined}
            onClick={() => setTab(entry.key)}
          >
            {entry.label} {counts[entry.key] ? `(${counts[entry.key]})` : ""}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="rfq-empty">
          {tab === "open" && counts.draft > 0 ? (
            <p>
              Nothing published yet — but you have {counts.draft} draft
              {counts.draft === 1 ? "" : "s"} waiting.
            </p>
          ) : tab === "open" ? (
            <>
              <p>No open requests.</p>
              <p style={{ marginTop: 8 }}>
                <button type="button" className="primary-btn" onClick={() => navigate("/rfqs/new")}>
                  Write your first one
                </button>
              </p>
            </>
          ) : (
            <p>Nothing here.</p>
          )}
        </div>
      ) : (
        <div className="rfq-list">
          {visible.map((rfq) => {
            const quoteCount = rfq.quotes?.[0]?.count ?? 0;
            const invitedCount = rfq.rfq_invitations?.[0]?.count ?? 0;

            return (
              <button
                key={rfq.id}
                type="button"
                className="rfq-card"
                onClick={() =>
                  navigate(rfq.status === "draft" ? `/rfqs/${rfq.id}/edit` : `/rfqs/${rfq.id}`)
                }
              >
                <div>
                  <span className={`rfq-status rfq-status--${rfq.status}`}>
                    {STATUS_LABEL[rfq.status]}
                  </span>
                  <h2>{rfq.title || "Untitled request"}</h2>
                  <p className="rfq-card-meta">
                    {rfq.quantity_total ? `${rfq.quantity_total.toLocaleString()} units` : "Quantity not set"}
                    {" · "}
                    {formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents)}
                    {rfq.visibility === "open_to_all" ? " · Open to any factory" : " · Invited factories only"}
                  </p>
                </div>

                {rfq.status === "draft" ? (
                  <p className="rfq-card-meta">Continue writing →</p>
                ) : (
                  <dl className="rfq-card-metrics">
                    <div>
                      <dt>Quotes</dt>
                      <dd>{quoteCount}</dd>
                    </div>
                    <div>
                      <dt>Invited</dt>
                      <dd>{invitedCount || "All"}</dd>
                    </div>
                  </dl>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
