import { getSelectedTerms } from "../../lib/domain/profile.js";
import React, { useEffect, useState } from "react";
import { supabase, unwrap } from "../../lib/supabase.js";
import { uploadDocument, urlFor } from "../../lib/domain/documents.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { MATCH_KINDS } from "../../lib/domain/matching.js";
import { useMatchingEnabled } from "./MatchingProfile.jsx";
import "./matching.css";
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
  async function load() {
    const byKind = await listTermsByKind([...MATCH_KINDS, "country"]);
    setTerms(byKind);
    if (org)
      setSelected(
        Object.values(await getSelectedTerms("factory_profile", org.id)).flat(),
      );
    let a = supabase
      .from("factory_capability_evidence")
      .select("id,org_id,term_id,document_id,status,reviewed_at");
    let b = supabase
      .from("factory_certifications")
      .select(
        "id,org_id,term_id,document_id,status,expires_at,non_expiring,facility_country,facility_name,scope_term_ids,scope_all_products",
      );
    if (org) {
      a = a.eq("org_id", org.id);
      b = b.eq("org_id", org.id);
    }
    const [cap, cert] = await Promise.all([a, b]);
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
    setRows([
      ...unwrap(cap, "load capability evidence").map((r) => ({
        ...r,
        type: "capability",
      })),
      ...unwrap(cert, "load certificate evidence").map((r) => ({
        ...r,
        type: "certificate",
      })),
    ]);
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
  return (
    <section className="matching-panel" aria-label="Matching evidence review">
      <h2>
        {staff
          ? "Matching evidence review"
          : "Supporting evidence and certificate scope"}
      </h2>
      <p>
        Company verification is separate. Files remain private to the company
        and TSC staff. Replacing evidence or editing certificate scope requires
        a new evidence review.
      </p>
      {!staff && (
        <>
          <label>
            Offered capability
            <select value={term} onChange={(e) => setTerm(e.target.value)}>
              <option value="">Choose a capability</option>
              {options
                .filter(
                  (t) =>
                    selected.includes(t.id) &&
                    [
                      "product_category",
                      "fabric",
                      "technique",
                      "development_service",
                    ].includes(t.kind),
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {termLabel(t)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Upload supporting evidence
            <input
              type="file"
              disabled={busy || !term}
              onChange={(e) => upload(e.target.files[0])}
            />
          </label>
        </>
      )}
      {(rows ?? []).map((r) => (
        <article key={`${r.type}-${r.id}`}>
          <h3>
            {options.find((t) => t.id === r.term_id)?.label_en ?? "Capability"}{" "}
            · {r.status}
            {staff ? ` · ${orgNames[r.org_id] ?? "Company"}` : ""}
          </h3>
          {r.document_id && (
            <button
              type="button"
              onClick={() => action(() => view(r.document_id))}
            >
              View private evidence
            </button>
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
                    "save certificate scope",
                  ),
                )
              }
            />
          )}
          {staff && (
            <>
              <label>
                Review note
                <textarea
                  value={reviewNotes[r.id] ?? ""}
                  onChange={(e) =>
                    setReviewNotes((notes) => ({
                      ...notes,
                      [r.id]: e.target.value,
                    }))
                  }
                />
              </label>
              {["verified", "rejected", "pending"].map((decision) => (
                <button
                  type="button"
                  key={decision}
                  disabled={busy}
                  onClick={() =>
                    action(async () =>
                      unwrap(
                        await supabase.rpc("review_matching_evidence", {
                          evidence_type: r.type,
                          evidence_id: r.id,
                          decision,
                          note: reviewNotes[r.id]?.trim() || null,
                        }),
                        "review matching evidence",
                      ),
                    )
                  }
                >
                  {decision === "verified"
                    ? "Approve"
                    : decision === "rejected"
                      ? "Reject"
                      : "Needs information"}
                </button>
              ))}
              <p>
                {r.type === "certificate"
                  ? `Facility: ${r.facility_name ?? "missing"} (${r.facility_country ?? "missing"}); validity: ${r.non_expiring ? "non-expiring" : (r.expires_at ?? "missing")}; scope: ${r.scope_all_products ? "all products" : (r.scope_term_ids ?? []).map((id) => options.find((t) => t.id === id)?.label_en ?? id).join(", ") || "missing"}`
                  : "Review this file against the claimed capability."}
              </p>
            </>
          )}
        </article>
      ))}
      {rows?.length === 0 && (
        <p>
          No evidence submitted yet. Existing certificate claims can be managed
          in the profile’s Verification section.
        </p>
      )}
      {error && <p role="alert">{error.message}</p>}
    </section>
  );
}
function CertificateScope({ row, terms, busy, onSave }) {
  const [d, setD] = useState(row);
  useEffect(() => setD(row), [row]);
  return (
    <div>
      <div className="matching-fields">
        <label>
          Expiry date
          <input
            type="date"
            disabled={d.non_expiring}
            value={d.expires_at ?? ""}
            onInput={(e) =>
              setD({ ...d, expires_at: e.currentTarget.value || null })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={d.non_expiring}
            onChange={(e) =>
              setD({
                ...d,
                non_expiring: e.target.checked,
                expires_at: e.target.checked ? null : d.expires_at,
              })
            }
          />
          Explicitly non-expiring
        </label>
        <label>
          Facility name on certificate
          <input
            value={d.facility_name ?? ""}
            onChange={(e) => setD({ ...d, facility_name: e.target.value })}
          />
        </label>
        <label>
          Facility country
          <select
            value={d.facility_country ?? ""}
            onChange={(e) =>
              setD({ ...d, facility_country: e.target.value || null })
            }
          >
            <option value="">Confirm facility country</option>
            {(terms.country ?? [])
              .filter((t) => t.extra?.code)
              .map((t) => (
                <option key={t.id} value={t.extra.code}>
                  {termLabel(t)}
                </option>
              ))}
          </select>
        </label>
      </div>
      <label>
        <input
          type="checkbox"
          checked={d.scope_all_products}
          onChange={(e) => setD({ ...d, scope_all_products: e.target.checked })}
        />
        Certificate covers all this facility’s products/materials
      </label>
      <fieldset>
        <legend>Specific scope (when not all products)</legend>
        {["product_category", "fabric", "technique"]
          .flatMap((k) => terms[k] ?? [])
          .map((t) => (
            <label className="matching-choice" key={t.id}>
              <input
                type="checkbox"
                checked={d.scope_term_ids.includes(t.id)}
                onChange={(e) =>
                  setD({
                    ...d,
                    scope_term_ids: e.target.checked
                      ? [...d.scope_term_ids, t.id]
                      : d.scope_term_ids.filter((x) => x !== t.id),
                  })
                }
              />
              {termLabel(t)}
            </label>
          ))}
      </fieldset>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          onSave({
            expires_at: d.expires_at,
            non_expiring: d.non_expiring,
            facility_country: d.facility_country,
            facility_name,
            scope_term_ids: d.scope_term_ids,
            scope_all_products: d.scope_all_products,
          })
        }
      >
        Save certificate scope
      </button>
    </div>
  );
}
