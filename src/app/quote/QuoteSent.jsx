/**
 * Confirmation after sending a quote.
 *
 * Says what happens next, because the commonest complaint about marketplaces
 * like this is quoting into silence. Awarding notifies every factory that
 * quoted — winner and losers alike — and this is where we promise it.
 */
import React from "react";
import { useRouter } from "../../lib/router.jsx";
import "../rfq/rfq.css";

export default function QuoteSent({ rfqId }) {
  const { navigate } = useRouter();

  return (
    <div className="rfq-page">
      <div className="detail-card" style={{ textAlign: "center", padding: 40 }}>
        <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>Quote sent</h1>
        <p className="ob-hint" style={{ maxWidth: "46ch", margin: "0 auto" }}>
          The brand can see your price, sample plan, capacity window and notes alongside every
          other quote. You will hear either way — we tell every factory that quoted, not just the
          one that wins.
        </p>
        <p className="ob-hint" style={{ maxWidth: "46ch", margin: "12px auto 0" }}>
          Changed your mind about something? Reopen the quote from the request and send a revision.
          The brand always sees your current version.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
          <button type="button" className="secondary-btn" onClick={() => navigate(`/browse/${rfqId}`)}>
            Back to the request
          </button>
          <button type="button" className="primary-btn" onClick={() => navigate("/browse")}>
            Find more requests
          </button>
        </div>
      </div>
    </div>
  );
}
