/**
 * Choosing which factories see a request.
 *
 * This screen closes a real hole: the composer offered "only factories I
 * invite" while nothing could actually invite anyone, so choosing it published
 * a request nobody could see. The e2e run never caught it because it always
 * picked "any factory".
 *
 * Factories are ranked by how well they fit THIS request, using the same
 * match_score_rfq the factory side sees. One score, computed in one place, so
 * neither party is looking at a different number from the other.
 */
import React, { useEffect, useMemo, useState } from "react";
import { getInvitations, getRfq, saveRfq, setInvitations } from "../../lib/domain/rfq.js";
import { termLabel } from "../../lib/domain/taxonomy.js";
import { useRouter } from "../../lib/router.jsx";
import { supabase, unwrap } from "../../lib/supabase.js";
import "./rfq.css";

function fitTier(score) {
  if (score == null) return null;
  return score >= 0.9 ? "strong" : score >= 0.75 ? "good" : score >= 0.6 ? "potential" : "weak";
}

export default function InviteFactories({ org, rfqId }) {
  const { navigate } = useRouter();
  const [rfq, setRfq] = useState(null);
  const [factories, setFactories] = useState(null);
  const [selected, setSelected] = useState([]);
  const [scores, setScores] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const request = await getRfq(rfqId);
      if (!request) throw new Error("this request is not available");

      const [rows, invited] = await Promise.all([
        unwrap(
          await supabase
            .from("factory_profiles")
            .select(`
              org_id, location, country_code, moq, typical_lead_days, verification_status, intro,
              orgs (id, name, slug)
            `)
            .not("published_at", "is", null),
          "load factories",
        ),
        getInvitations(rfqId),
      ]);

      if (cancelled) return;

      setRfq(request);
      setFactories(rows);
      setSelected(invited.map((row) => row.factory_org_id));

      const scored = await Promise.all(
        rows.map(async (factory) => {
          const { data } = await supabase.rpc("match_score_rfq", {
            rfq_id: rfqId,
            factory_org: factory.org_id,
          });
          return [factory.org_id, data];
        }),
      );
      if (!cancelled) setScores(Object.fromEntries(scored));
    }

    load().catch((failure) => {
      if (!cancelled) setError(failure);
    });
    return () => {
      cancelled = true;
    };
  }, [rfqId]);

  const ranked = useMemo(() => {
    if (!factories) return [];
    return [...factories].sort((a, b) => (scores[b.org_id] ?? -1) - (scores[a.org_id] ?? -1));
  }, [factories, scores]);

  function toggle(orgId) {
    setSelected((current) =>
      current.includes(orgId) ? current.filter((id) => id !== orgId) : [...current, orgId],
    );
  }

  async function save({ alsoOpen = false } = {}) {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await setInvitations(rfqId, selected);
      if (alsoOpen) await saveRfq(rfqId, { visibility: "open_to_all" });
      navigate(`/rfqs/${rfqId}`);
    } catch (saveError) {
      setError(saveError);
      setSaving(false);
    }
  }

  if (error && !factories) {
    return (
      <div className="rfq-page">
        <h1>Invite factories</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }

  if (!rfq || !factories) {
    return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;
  }

  return (
    <div className="rfq-page">
      <button type="button" className="quiet-btn" onClick={() => navigate(`/rfqs/${rfqId}`)}>
        ← Back to the request
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>Invite factories</h1>
          <p>
            {rfq.title} · ranked by how well each fits this request, not your profile in general.
          </p>
        </div>
      </header>

      {rfq.visibility === "open_to_all" ? (
        <div className="browse-gate">
          <strong>This request is already open to every factory.</strong>
          <span>
            Inviting specific factories on top of that just makes sure they see it — it does not
            exclude anyone else.
          </span>
        </div>
      ) : null}

      {ranked.length === 0 ? (
        <div className="rfq-empty">
          <p>No factories have published a profile yet.</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>
            Open the request to everyone instead, and it will reach factories as they join.
          </p>
        </div>
      ) : (
        <div className="rfq-list">
          {ranked.map((factory) => {
            const score = scores[factory.org_id];
            const isSelected = selected.includes(factory.org_id);
            const verified = factory.verification_status === "verified";

            return (
              <button
                key={factory.org_id}
                type="button"
                className={`rfq-card invite-card${isSelected ? " is-selected" : ""}`}
                data-testid="invite-factory"
                aria-pressed={isSelected}
                onClick={() => toggle(factory.org_id)}
              >
                <div>
                  {score != null ? (
                    <span className={`fit-chip fit-chip--${fitTier(score)}`}>
                      {Math.round(score * 100)}% fit
                    </span>
                  ) : null}
                  {!verified ? <span className="fit-chip fit-chip--weak">Not yet verified</span> : null}
                  <h2>{factory.orgs?.name ?? "Factory"}</h2>
                  <p className="rfq-card-meta">
                    {factory.location ?? "Location not given"}
                    {factory.moq ? ` · MOQ ${factory.moq.toLocaleString()}` : ""}
                    {factory.typical_lead_days ? ` · ${factory.typical_lead_days} day lead` : ""}
                  </p>
                  {factory.intro ? <p className="rfq-card-meta">{factory.intro.slice(0, 140)}</p> : null}
                </div>

                <span className={`invite-toggle${isSelected ? " is-on" : ""}`}>
                  {isSelected ? "Invited" : "Invite"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {error ? <p className="ob-error">{error.message}</p> : null}

      <footer className="ob-actions quote-actions">
        <span className="ob-hint">
          {selected.length
            ? `${selected.length} factor${selected.length === 1 ? "y" : "ies"} invited`
            : "Nobody invited yet"}
        </span>
        <span style={{ display: "flex", gap: 12 }}>
          {rfq.visibility !== "open_to_all" ? (
            <button type="button" className="secondary-btn" onClick={() => save({ alsoOpen: true })} disabled={saving}>
              Open to everyone instead
            </button>
          ) : null}
          <button type="button" className="primary-btn" onClick={() => save()} disabled={saving}>
            {saving ? "Saving…" : "Save invitations"}
          </button>
        </span>
      </footer>
    </div>
  );
}
