/**
 * Live only (Nov 24): staff correct a vendor's type and address from the
 * review page, and see who changed what (the review history). Drawn in the
 * page's own small-dialog style; the prototype passes no actions and draws
 * none of it.
 *
 *   actions.updateCompanyProfile(orgId, { vendorKind, address })
 *   actions.reviewChanges(orgId) → [{ kind, details, at, by }]
 */
import { useCallback, useEffect, useState } from "react";

const KIND_WORDS = { manufacturer: "Factory", trading_company: "Trading company" };
const RESULT_WORDS = { found: "Found on", expired: "Expired on", not_found: "Not found on", could_not_check: "Couldn't check" };
const DAY = { month: "short", day: "numeric" };

/** One line of the history, in plain words. */
export function changeWords(change) {
  const d = change.details ?? {};
  const files = d.files ? ` · ${d.files} ${d.files === 1 ? "file" : "files"}` : "";
  const note = d.note ? ` · ${d.note}` : "";
  const result = d.site ? `${RESULT_WORDS[d.result] ?? "Recorded on"} ${d.site}` : (RESULT_WORDS[d.result] ?? "Recorded").replace(/ on$/, "");
  if (change.kind === "registry_check") return `Registry check: ${result}${note}${files}`;
  if (change.kind === "certificate_check") return `Certificate check: ${result}${note}${files}`;
  if (change.kind === "vendor_kind") return `Type changed to ${KIND_WORDS[d.to] ?? d.to}`;
  if (change.kind === "address") return "Address changed";
  return "Changed";
}

function stamp(change) {
  const when = change.at ? new Date(change.at).toLocaleDateString("en-US", DAY) : "";
  return [change.by, when].filter(Boolean).join(", ");
}

export function CompanyOverride({ orgId, entityType, address, actions, refreshKey = 0, onChanged }) {
  const [open, setOpen] = useState(null);
  const [kind, setKind] = useState("manufacturer");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const currentKind = entityType === "Trading company" ? "trading_company" : "manufacturer";
  const addressLabel = currentKind === "trading_company" ? "Company address" : "Factory address";

  const loadHistory = useCallback(() => {
    if (!actions?.reviewChanges || !orgId) return;
    actions.reviewChanges(orgId).then((rows) => setHistory(rows ?? []), () => setHistory([]));
  }, [actions, orgId]);
  useEffect(() => { loadHistory(); }, [loadHistory, refreshKey]);

  if (!actions?.updateCompanyProfile) return null;

  const start = (which) => {
    setError("");
    setKind(currentKind);
    setText(address ?? "");
    setOpen(which);
  };
  const close = () => { if (!busy) setOpen(null); };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = await actions.updateCompanyProfile(orgId, open === "type" ? { vendorKind: kind } : { address: text.trim() });
      setOpen(null);
      loadHistory();
      onChanged?.();
      // The address check runs after the save: the score is read again when it is done.
      saved?.checked?.then(() => onChanged?.(), () => null);
    } catch (failure) {
      setError(failure?.message || "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const unchanged = open === "type" ? kind === currentKind : !text.trim() || text.trim() === (address ?? "").trim();
  const shown = showAll ? history : history.slice(0, 3);

  return (
    <div className="vr-override">
      <div className="vr-override-actions">
        <button className="vr-text-action" type="button" onClick={() => start("type")}>Change type</button>
        <button className="vr-text-action" type="button" onClick={() => start("address")}>Edit address</button>
      </div>
      {history.length > 0 && (
        <div className="vr-history">
          <span>History</span>
          <ul>
            {shown.map((change) => (
              <li key={change.id}><strong>{changeWords(change)}</strong><small>{stamp(change)}</small></li>
            ))}
          </ul>
          {history.length > 3 && (
            <button className="vr-text-action" type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? "Show less" : `Show all ${history.length}`}</button>
          )}
        </div>
      )}
      {open && (
        <div className="approve-fund-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <section className="approve-fund-modal admin-review-modal small" role="dialog" aria-modal="true" aria-labelledby="company-override-title">
            <button className="settings-drawer-close" type="button" aria-label="Close" onClick={close}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
            <header>
              <div>
                <span>Company</span>
                <h2 id="company-override-title">{open === "type" ? "Change type" : `Edit ${addressLabel.toLowerCase()}`}</h2>
                <p>The company is told its profile was updated.</p>
              </div>
            </header>
            {open === "type" ? (
              <fieldset className="admin-tier-picker">
                <legend>Type</legend>
                {Object.entries(KIND_WORDS).map(([key, label]) => (
                  <label className={`admin-tier-option${kind === key ? " selected" : ""}`} key={key}>
                    <input type="radio" name="vendor-kind" value={key} checked={kind === key} onChange={() => setKind(key)} />
                    <span><strong>{label}</strong></span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <label className="factory-onboarding-field">
                <span>{addressLabel}</span>
                <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Street, district, city, province, country" />
              </label>
            )}
            {error && <p className="admin-error" role="alert">{error}</p>}
            <footer>
              <button className="secondary-btn" type="button" onClick={close} disabled={busy}>Cancel</button>
              <button className="primary-btn" type="button" disabled={busy || unchanged} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
