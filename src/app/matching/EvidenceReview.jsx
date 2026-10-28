import { getSelectedTerms } from "../../lib/domain/profile.js";
import React, { useEffect, useState } from "react";
import { supabase, unwrap } from "../../lib/supabase.js";
import { uploadDocument, urlFor } from "../../lib/domain/documents.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { MATCH_KINDS } from "../../lib/domain/matching.js";
import { useMatchingEnabled } from "./MatchingProfile.jsx";
import "./matching.css";
// What each state means to the person reading it. "pending" with a note from
// staff is a request for more information, not a file waiting in the queue.
function statusLabel(row, decision) {
  if (row.status === "verified") return "approved";
  if (row.status === "rejected") return "not accepted";
  if (decision?.decision === "pending" && decision.note) return "needs information";
  return "waiting for review";
}
export default function EvidenceReview({ org = null, staff = false }) {
  const enabled = useMatchingEnabled(),
    [rows, setRows] = useState(null),
    [terms, setTerms] = useState({}),
    [selected, setSelected] = useState([]),
    [error, setError] = useState(null),
    [busy, setBusy] = useState(false),
    [term, setTerm] = useState("");
  const [orgNames, setOrgNames] = useState({});
  const [reviewNotes, setReviewNotes] = useState({});
  // The factory's own: staff's latest decision on each item, with its note.
  const [decisions, setDecisions] = useState({});
  // The capabilities the factory offers, read again whenever the picker opens:
  // one saved in the matching profile beside this panel is offered at once.
  async function refreshOffered() {
    setSelected(Object.values(await getSelectedTerms("factory_profile", org.id)).flat());
  }
  async function load() {
    const byKind = await listTermsByKind([...MATCH_KINDS, "country"]);
    setTerms(byKind);
    if (org) await refreshOffered();
    let a = supabase
      .from("factory_capability_evidence")
      .select("id,org_id,term_id,document_id,status,reviewed_at,created_at");
    let b = supabase
      .from("factory_certifications")
      .select(
        "id,org_id,term_id,document_id,status,expires_at,non_expiring,facility_country,facility_name,scope_term_ids,scope_all_products,created_at",
      );
    if (org) {
      a = a.eq("org_id", org.id);
      b = b.eq("org_id", org.id);
    }
    const [cap, cert] = await Promise.all([a, b]);
    // Staff's latest decision on each item, with its note: one company for
    // the factory, every company in the queue for staff.
    const orgIds = org
      ? [org.id]
      : [
          ...new Set(
            [
              ...unwrap(cap, "load capability evidence"),
              ...unwrap(cert, "load certificate evidence"),
            ].map((r) => r.org_id),
          ),
        ];
    const notes = await Promise.all(
      orgIds.map(async (id) =>
        unwrap(
          await supabase.rpc("matching_evidence_notes", { target_org: id }),
          "load review notes",
        ),
      ),
    );
    setDecisions(Object.fromEntries(notes.flat().map((n) => [n.evidence_id, n])));
    if (staff) {
      const ids = [
        ...new Set(
          [
            ...unwrap(cap, "load capability evidence"),
            ...unwrap(cert, "load certificate evidence"),
          ].map((r) => r.org_id),
        ),
      ];
      if (ids.length) {
        const names = unwrap(
          await supabase.from("orgs").select("id,name").in("id", ids),
          "load company names",
        );
        setOrgNames(Object.fromEntries(names.map((o) => [o.id, o.name])));
      }
    }
    // What still needs someone first, settled items last; a stable order
    // so a decision does not shuffle the list under the reader.
    const rank = { pending: 0, rejected: 1, verified: 2 };
    setRows(
      [
        ...unwrap(cap, "load capability evidence").map((r) => ({ ...r, type: "capability" })),
        ...unwrap(cert, "load certificate evidence").map((r) => ({ ...r, type: "certificate" })),
      ].sort(
        (a, b) =>
          (rank[a.status] ?? 0) - (rank[b.status] ?? 0) ||
          String(a.org_id).localeCompare(String(b.org_id)) ||
          String(a.created_at ?? a.id).localeCompare(String(b.created_at ?? b.id)),
      ),
    );
  }
  useEffect(() => {
    if (enabled) load().catch(setError);
  }, [enabled, org?.id]);
  async function action(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function view(id) {
    const d = unwrap(
      await supabase.from("documents").select("*").eq("id", id).single(),
      "load private evidence",
    );
    window.open(await urlFor(d), "_blank", "noopener,noreferrer");
  }
  async function upload(file) {
    if (!file || !term) return;
    await action(async () => {
      const d = await uploadDocument({
        orgId: org.id,
        kind: "capability_evidence",
        file,
      });
      unwrap(
        await supabase
          .from("factory_capability_evidence")
          .upsert(
            { org_id: org.id, term_id: term, document_id: d.id },
            { onConflict: "org_id,term_id" },
          ),
        "attach capability evidence",
      );
    });
  }
  const options = Object.values(terms).flat();
  if (!enabled) return null;
  const termName = (id) => termLabel(options.find((t) => t.id === id) ?? { label_en: "Capability" });
  const offered = options.filter(
    (t) =>
      selected.includes(t.id) &&
      ["product_category", "fabric", "technique", "development_service"].includes(t.kind),
  );
  const countryName = (code) =>
    termLabel((terms.country ?? []).find((t) => t.extra?.code === code) ?? { label_en: code });
  return (
    <section className="matching-panel" aria-label="Matching evidence review">
      <header className="matching-head">
        <h2>{staff ? "Matching evidence" : "Supporting evidence"}</h2>
        <p>
          {staff
            ? "Files factories sent to support a capability or a certificate. A decision here changes the factory's matches, never its company verification. Rejecting or asking for more needs a note: it is all the factory is told."
            : "Show brands a capability is real by uploading proof, such as sample photos or a test report. Files stay private to your company and TSC. Approval here is separate from your company verification."}
        </p>
      </header>
      {!staff && (
        <div className="matching-fields">
          <label className="matching-field">
            <span className="matching-label">Capability</span>
            <select
              value={term}
              onFocus={() => refreshOffered().catch(setError)}
              onPointerDown={() => refreshOffered().catch(setError)}
              onChange={(e) => setTerm(e.target.value)}
            >
              <option value="">Choose a capability</option>
              {offered.map((t) => (
                <option key={t.id} value={t.id}>{termLabel(t)}</option>
              ))}
            </select>
          </label>
          <label className={`matching-upload${busy || !term ? " is-disabled" : ""}`}>
            <input
              type="file"
              aria-label="Upload supporting evidence"
              disabled={busy || !term}
              onChange={(e) => upload(e.target.files[0])}
            />
            <strong>{busy ? "Uploading…" : "Upload supporting evidence"}</strong>
            <span className="matching-small">
              {term ? "PDF, PNG or JPG" : "Choose a capability first"}
            </span>
          </label>
        </div>
      )}
      {(rows ?? []).length > 0 && (
        <ul className="matching-list">
          {(rows ?? []).map((r) => {
            const label = statusLabel(r, decisions[r.id]);
            const tone =
              label === "approved" ? "is-good" : label === "not accepted" ? "is-bad" : label === "needs information" ? "is-warn" : "";
            const note = r.status !== "verified" ? decisions[r.id]?.note : null;
            return (
              <li className="matching-item" key={`${r.type}-${r.id}`}>
                <div className="matching-item-head">
                  <div className="matching-item-title">
                    <strong>{termName(r.term_id)}</strong>
                    <span className="matching-small">
                      {r.type === "certificate" ? "Certificate" : "Capability evidence"}
                      {staff ? ` · ${orgNames[r.org_id] ?? "Company"}` : ""}
                    </span>
                  </div>
                  <span className={`matching-pill ${tone}`}>
                    {label.charAt(0).toUpperCase() + label.slice(1)}
                  </span>
                  {r.document_id && (
                    <button type="button" className="matching-btn" onClick={() => action(() => view(r.document_id))}>
                      View file
                    </button>
                  )}
                </div>
                {note && (
                  <p className="matching-note">
                    <strong>{staff ? "Sent to the factory" : "Note from TSC"}</strong>
                    {note}
                  </p>
                )}
                {r.type === "certificate" && staff && (
                  <dl className="matching-facts">
                    <div><dt>Facility</dt><dd>{r.facility_name || "Not given"}</dd></div>
                    <div><dt>Country</dt><dd>{r.facility_country ? countryName(r.facility_country) : "Not given"}</dd></div>
                    <div><dt>Valid until</dt><dd>{r.non_expiring ? "Does not expire" : r.expires_at || "Not given"}</dd></div>
                    <div>
                      <dt>Covers</dt>
                      <dd>
                        {r.scope_all_products
                          ? "All products"
                          : r.scope_term_ids?.length
                            ? r.scope_term_ids.map(termName).join(", ")
                            : "Not given"}
                      </dd>
                    </div>
                  </dl>
                )}
                {r.type === "certificate" && !staff && (
                  <CertificateScope
                    row={r}
                    terms={terms}
                    busy={busy}
                    onSave={(patch) =>
                      action(async () =>
                        unwrap(
                          await supabase
                            .from("factory_certifications")
                            .update(patch)
                            .eq("id", r.id),
                          "save certificate details",
                        ),
                      )
                    }
                  />
                )}
                {staff && (
                  <>
                    <label className="matching-field">
                      <span className="matching-label">Note to the factory</span>
                      <textarea
                        placeholder="Needed to reject or ask for more information. Say what to change."
                        value={reviewNotes[r.id] ?? ""}
                        onChange={(e) =>
                          setReviewNotes((notes) => ({ ...notes, [r.id]: e.target.value }))
                        }
                      />
                    </label>
                    <div className="matching-actions">
                      {[
                        ["rejected", "Reject"],
                        ["pending", "Ask for more information"],
                        ["verified", "Approve"],
                      ].map(([decision, text]) => (
                        <button
                          type="button"
                          key={decision}
                          className={`matching-btn${decision === "verified" ? " is-primary" : ""}`}
                          // Rejecting or asking for more needs a note: it is all the factory is told.
                          disabled={busy || (decision !== "verified" && !reviewNotes[r.id]?.trim())}
                          onClick={() =>
                            action(async () => {
                              unwrap(
                                await supabase.rpc("review_matching_evidence", {
                                  evidence_type: r.type,
                                  evidence_id: r.id,
                                  decision,
                                  note: reviewNotes[r.id]?.trim() || null,
                                }),
                                "review matching evidence",
                              );
                              // Sent: the box is for the next note, not a draft of this one.
                              setReviewNotes((notes) => ({ ...notes, [r.id]: "" }));
                            })
                          }
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows?.length === 0 && (
        <p className="matching-hint">
          {staff
            ? "Nothing to review."
            : "No evidence yet. Certificates you add under Verification appear here too, to set their facility and scope."}
        </p>
      )}
      {error && <p role="alert">{error.message}</p>}
    </section>
  );
}
function CertificateScope({ row, terms, busy, onSave }) {
  const [d, setD] = useState(row);
  useEffect(() => setD(row), [row]);
  const scopeTerms = ["product_category", "fabric", "technique"].flatMap((k) => terms[k] ?? []);
  const complete =
    (d.non_expiring || d.expires_at) && d.facility_country && d.facility_name?.trim() &&
    (d.scope_all_products || d.scope_term_ids.length > 0);
  return (
    <div className="matching-section">
      <h3>Certificate details</h3>
      <p className="matching-hint">
        TSC checks these against the file before approving. Changing them sends the certificate back for review.
      </p>
      <div className="matching-fields">
        <label className="matching-field">
          <span className="matching-label">Facility name on the certificate</span>
          <input
            value={d.facility_name ?? ""}
            onChange={(e) => setD((cur) => ({ ...cur, facility_name: e.target.value }))}
          />
        </label>
        <label className="matching-field">
          <span className="matching-label">Facility country</span>
          <select
            value={d.facility_country ?? ""}
            onChange={(e) => setD((cur) => ({ ...cur, facility_country: e.target.value || null }))}
          >
            <option value="">Choose a country</option>
            {(terms.country ?? [])
              .filter((t) => t.extra?.code)
              .map((t) => (
                <option key={t.id} value={t.extra.code}>{termLabel(t)}</option>
              ))}
          </select>
        </label>
        <label className="matching-field">
          <span className="matching-label">Valid until</span>
          <input
            type="date"
            disabled={d.non_expiring}
            value={d.expires_at ?? ""}
            onInput={(e) => setD((cur) => ({ ...cur, expires_at: e.currentTarget.value || null }))}
          />
        </label>
      </div>
      <label className="matching-check">
        <input
          type="checkbox"
          checked={d.non_expiring}
          onChange={(e) =>
            setD((cur) => ({ ...cur, non_expiring: e.target.checked, expires_at: e.target.checked ? null : cur.expires_at }))
          }
        />
        This certificate does not expire
      </label>
      <label className="matching-check">
        <input
          type="checkbox"
          checked={d.scope_all_products}
          onChange={(e) => setD((cur) => ({ ...cur, scope_all_products: e.target.checked }))}
        />
        It covers everything this facility makes
      </label>
      {!d.scope_all_products && (
        <>
          <span className="matching-label">What it covers</span>
          <div className="matching-chips">
            {scopeTerms.map((t) => (
              <button
                type="button"
                key={t.id}
                aria-pressed={d.scope_term_ids.includes(t.id)}
                onClick={() =>
                  setD((cur) => ({ ...cur,
                    scope_term_ids: cur.scope_term_ids.includes(t.id)
                      ? cur.scope_term_ids.filter((x) => x !== t.id)
                      : [...cur.scope_term_ids, t.id],
                  }))
                }
              >
                {termLabel(t)}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="matching-actions">
        {!complete && (
          <p className="matching-small">TSC needs the facility, its country, the validity and what it covers.</p>
        )}
        <button
          type="button"
          className="matching-btn"
          disabled={busy}
          onClick={() =>
            onSave({
              expires_at: d.expires_at,
              non_expiring: d.non_expiring,
              facility_country: d.facility_country,
              facility_name: d.facility_name,
              scope_term_ids: d.scope_term_ids,
              scope_all_products: d.scope_all_products,
            })
          }
        >
          Save certificate details
        </button>
      </div>
    </div>
  );
}
