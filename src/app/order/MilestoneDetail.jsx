/**
 * One step, with everything posted against it.
 *
 * Updates are queried by milestone_id. The prototype renders every update
 * under milestone one regardless of which one opened the composer, which reads
 * as "the feature works" right up until there are two steps in flight.
 */
import React, { useCallback, useEffect, useState } from "react";
import { getOrder, milestoneStatusLabel, paymentStatusLabel } from "../../lib/domain/order.js";
import {
  getMilestone, listUpdates, milestoneAction, postUpdate, submitMilestone,
} from "../../lib/domain/milestone.js";
import { urlFor } from "../../lib/domain/documents.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./order.css";

function Photo({ document }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    urlFor(document, 600).then((value) => !cancelled && setUrl(value)).catch(() => {});
    return () => { cancelled = true; };
  }, [document.id]);

  if (!url) return <span className="update-photo is-loading" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="update-photo"
       data-testid="update-photo">
      <img src={url} alt={document.file_name} />
    </a>
  );
}

export default function MilestoneDetail({ org, orderId, milestoneId, isFactory, isOwner }) {
  const { navigate } = useRouter();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);

  const load = useCallback(async () => {
    const [order, milestone] = await Promise.all([getOrder(orderId), getMilestone(orderId, milestoneId)]);
    if (!order || !milestone) throw new Error("that step is not available to you");
    const updates = await listUpdates(milestoneId);
    setState({ order, milestone, updates });
  }, [orderId, milestoneId]);

  useEffect(() => { load().catch(setError); }, [load]);

  async function run(action) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setBody("");
      setFiles([]);
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) {
    return (
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={() => navigate(`/orders/${orderId}`)}>← Back</button>
        <h1>Not available</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!state) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  const { order, milestone, updates } = state;
  const payment = milestone.order_payments?.[0] ?? null;
  const action = milestoneAction(milestone, { isFactory, isOwner, order });
  const canPost = isFactory && action.kind === "update";

  return (
    <div className="rfq-page rfq-detail">
      <button type="button" className="quiet-btn" onClick={() => navigate(`/orders/${orderId}`)}>
        ← Back to the order
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>{milestone.title}</h1>
          <p>
            {order.order_number} · {milestoneStatusLabel(milestone.state, { isFactory })}
            {payment ? ` · ${paymentStatusLabel(payment.state, { isFactory })}` : ""}
          </p>
        </div>
        {milestone.amount_cents ? (
          <strong className="milestone-amount">
            {formatMoney(milestone.amount_cents, milestone.currency)}
          </strong>
        ) : null}
      </header>

      {milestone.description ? (
        <section className="detail-card"><p className="detail-body">{milestone.description}</p></section>
      ) : null}

      {action.reason ? (
        <section className="detail-card order-gate-card">
          <p className="milestone-gate" data-testid="milestone-gate">{action.reason}</p>
        </section>
      ) : null}

      {error ? <p className="ob-error">{error.message}</p> : null}

      {canPost ? (
        <section className="detail-card">
          <h2>Post an update</h2>
          <p className="ob-hint">
            What you have done, and photographs of it. The brand sees this and approves from it.
          </p>
          <label className="ob-label" htmlFor="update-body">Note</label>
          <textarea id="update-body" data-field="update_body" rows={3} value={body}
                    placeholder="Fit sample finished — front, back and detail photographed."
                    onChange={(event) => setBody(event.target.value)} />

          <label className="ob-label" htmlFor="update-photos">Photos</label>
          <input
            id="update-photos"
            data-field="update_photos"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/heic"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          {files.length ? <p className="ob-hint">{files.length} file(s) ready to upload.</p> : null}

          <div className="order-actions">
            <button
              type="button"
              className="primary-btn"
              data-testid="post-update"
              disabled={busy || !body.trim()}
              onClick={() => run(() => postUpdate({
                orderId, milestoneId, orgId: org.id, body, files,
              }))}
            >
              {busy ? "Posting…" : "Post update"}
            </button>
            {milestone.state === "active" ? (
              <button type="button" className="secondary-btn" data-testid="submit-milestone"
                      disabled={busy} onClick={() => run(() => submitMilestone(milestone.id))}>
                Send for approval
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="detail-card">
        <h2>Updates ({updates.length})</h2>
        {updates.length === 0 ? (
          <p className="ob-hint">
            {isFactory ? "You have not posted anything on this step yet." : "The factory has not posted anything yet."}
          </p>
        ) : (
          <ul className="update-list">
            {updates.map((update) => (
              <li key={update.id} className="update-item" data-testid="milestone-update">
                <header>
                  <strong>{update.orgs?.name ?? "Factory"}</strong>
                  <span>{new Date(update.created_at).toLocaleString()}</span>
                </header>
                <p className="detail-body">{update.body}</p>
                {update.documents?.length ? (
                  <div className="update-photos">
                    {update.documents.map((doc) => <Photo key={doc.id} document={doc} />)}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
