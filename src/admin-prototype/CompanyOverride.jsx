/**
 * Live only (Nov 24): staff correct a vendor's type from the review page, and
 * see who changed what (the review history). Drawn in the page's own
 * small-dialog style; the prototype passes no actions and draws none of it.
 * The address is edited in the verification card's Address block (Nov 25),
 * in `AddressDialog`, the same dialog.
 *
 *   actions.updateCompanyProfile(orgId, { vendorKind })
 *   actions.updateCompanyProfile(orgId, { companyName | legalName | country | website })
 *   actions.reviewChanges(orgId) → [{ kind, details, at, by }]
 *
 * Company name, legal name, country and website are edited where Review
 * details shows them (`CompanyFields`), for brands and vendors, in the same
 * dialog and written to the same history. Change type is a vendor's only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { countryName } from "../shared/company-address.mjs";
import { WEB_ADDRESS_WORDS, webAddress } from "../shared/web-address.mjs";

const KIND_WORDS = { manufacturer: "Factory", trading_company: "Trading company" };
const RESULT_WORDS = { found: "Found on", expired: "Expired on", not_found: "Not found on", could_not_check: "Couldn't check" };
const DAY = { month: "short", day: "numeric" };
const STAFF_RESULT_WORDS = {
  confirmed: "Confirmed", problem: "Problem found", could_not_check: "Couldn't check",
  factory: "Factory", trading_company: "Trading company", could_not_tell: "Couldn't tell", original: "Original",
};
// A company value staff edited (Nov 26): its kind, or `company_field` with the field in its details.
const FIELD_WORDS = { company_name: "Company name", name: "Company name", legal_name: "Legal name", country: "Country", website: "Website", registration_number: "Registration number" };
const DECISION_WORDS = { approved: "Approved", declined: "Declined", needs_information: "Asked for more information" };

/** One line of the history, in plain words. */
export function changeWords(change) {
  const d = change.details ?? {};
  const files = d.files ? ` · ${d.files} ${d.files === 1 ? "file" : "files"}` : "";
  const note = d.note ? ` · ${d.note}` : "";
  const result = d.site ? `${RESULT_WORDS[d.result] ?? "Recorded on"} ${d.site}` : (RESULT_WORDS[d.result] ?? "Recorded").replace(/ on$/, "");
  if (change.kind === "registry_check") return `Registry check: ${result}${note}${files}`;
  if (change.kind === "certificate_check") return `Certificate check: ${result}${note}${files}`;
  if (change.kind === "vendor_kind") return `Type changed to ${KIND_WORDS[d.to] ?? d.to}`;
  if (change.kind === "address") return d.to ? `Address changed to ${d.to}` : "Address changed";
  const field = change.kind === "company_field" ? d.field : change.kind;
  if (FIELD_WORDS[field]) {
    const to = field === "country" ? countryName(d.to) ?? d.to : d.to;
    return to ? `${FIELD_WORDS[field]} changed to ${to}` : `${FIELD_WORDS[field]} changed`;
  }
  // Staff's own result on a check, and each decision (Nov 25).
  const staffCheck = { address_check: "Address check", scope_check: "Factory or trader", licence_check: "Licence check" }[change.kind];
  if (staffCheck) return `${staffCheck}: ${STAFF_RESULT_WORDS[d.result] ?? d.result}${note}`;
  if (change.kind === "decision") return DECISION_WORDS[d.state] ?? "Decided";
  return "Changed";
}

function stamp(change) {
  const when = change.at ? new Date(change.at).toLocaleDateString("en-US", DAY) : "";
  return [change.by, when].filter(Boolean).join(", ");
}

/** The small dialog's frame, above the verification pop-up when it opens from there (`over`). */
function OverrideDialog({ title, busy, error, saveDisabled, onSave, onClose, over = false, children }) {
  const close = () => { if (!busy) onClose(); };
  const dialog = (
    <div className={`approve-fund-modal-layer${over ? " vr-dialog-over" : ""}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="approve-fund-modal admin-review-modal small" role="dialog" aria-modal="true" aria-labelledby="company-override-title">
        <button className="settings-drawer-close" type="button" aria-label="Close" onClick={close}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
        <header>
          <div>
            <span>Company</span>
            <h2 id="company-override-title">{title}</h2>
            <p>The company is told its profile was updated.</p>
          </div>
        </header>
        {children}
        {error && <p className="admin-error" role="alert">{error}</p>}
        <footer>
          <button className="secondary-btn" type="button" onClick={close} disabled={busy}>Cancel</button>
          <button className="primary-btn" type="button" disabled={busy || saveDisabled} onClick={onSave}>{busy ? "Saving…" : "Save"}</button>
        </footer>
      </section>
    </div>
  );
  return over ? createPortal(dialog, document.body) : dialog;
}

/** Edit address, from the Address block: `onSave(address)` saves it and has the address checked again. */
export function AddressDialog({ label, address, onSave, onClose }) {
  const [text, setText] = useState(address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave(text.trim());
      onClose();
    } catch (failure) {
      setError(failure?.message || "Couldn't save. Try again.");
      setBusy(false);
    }
  };
  return (
    <OverrideDialog
      title={`Edit ${label.toLowerCase()}`}
      busy={busy}
      error={error}
      saveDisabled={!text.trim() || text.trim() === (address ?? "").trim()}
      onSave={save}
      onClose={onClose}
      over
    >
      <label className="factory-onboarding-field">
        <span>{label}</span>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Street, district, city, province, country" />
      </label>
    </OverrideDialog>
  );
}

export function CompanyOverride({ orgId, entityType, actions, refreshKey = 0, onChanged, canChangeType = true }) {
  const [open, setOpen] = useState(null);
  const [kind, setKind] = useState("manufacturer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const currentKind = entityType === "Trading company" ? "trading_company" : "manufacturer";

  const loadHistory = useCallback(() => {
    if (!actions?.reviewChanges || !orgId) return;
    actions.reviewChanges(orgId).then((rows) => setHistory(rows ?? []), () => setHistory([]));
  }, [actions, orgId]);
  useEffect(() => { loadHistory(); }, [loadHistory, refreshKey]);

  if (!actions?.updateCompanyProfile) return null;

  const start = () => {
    setError("");
    setKind(currentKind);
    setOpen("type");
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await actions.updateCompanyProfile(orgId, { vendorKind: kind });
      setOpen(null);
      loadHistory();
      onChanged?.();
    } catch (failure) {
      setError(failure?.message || "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const shown = showAll ? history : history.slice(0, 3);

  return (
    <div className="vr-override">
      {canChangeType && (
        <div className="vr-override-actions">
          <button className="vr-text-action" type="button" onClick={start}>Change type</button>
        </div>
      )}
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
        <OverrideDialog title="Change type" busy={busy} error={error} saveDisabled={kind === currentKind} onSave={save} onClose={() => setOpen(null)}>
          <fieldset className="admin-tier-picker">
            <legend>Type</legend>
            {Object.entries(KIND_WORDS).map(([key, label]) => (
              <label className={`admin-tier-option${kind === key ? " selected" : ""}`} key={key}>
                <input type="radio" name="vendor-kind" value={key} checked={kind === key} onChange={() => setKind(key)} />
                <span><strong>{label}</strong></span>
              </label>
            ))}
          </fieldset>
        </OverrideDialog>
      )}
    </div>
  );
}

/** Every country the platform names, by its English name. */
function countryOptions() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const rows = [];
  for (const a of letters) for (const b of letters) {
    const name = countryName(a + b);
    if (name) rows.push({ code: a + b, name });
  }
  return rows.sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * Company name, Legal name, Country and Website in Review details, each with
 * its Edit link (Nov 26): edited where it is shown, in Change type's dialog,
 * written to the same history, and the company is told. Brands and vendors.
 * The legal name is what the registry and licence checks compare; saving it
 * empty clears it, and the checks then use the company name.
 *
 *   values: { companyName, legalName, country (two-letter code), website }
 *   onSave({ companyName } | { legalName } | { country } | { website }) saves one value.
 */
export function CompanyFields({ values, onSave }) {
  const [open, setOpen] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const countries = useMemo(() => (open === "country" ? countryOptions() : []), [open]);
  const fields = [
    { key: "companyName", label: "Company name", shown: values.companyName },
    { key: "legalName", label: "Legal name", shown: values.legalName },
    { key: "country", label: "Country", shown: countryName(values.country) ?? values.country },
    { key: "website", label: "Website", shown: values.website },
  ];
  const current = fields.find((field) => field.key === open);
  const before = (values[open] ?? "").trim();
  const start = (key) => {
    setError("");
    setText(values[key] ?? "");
    setOpen(key);
  };
  const save = async () => {
    // A website is a domain or a URL, saved with https:// when it has none (M1).
    const value = open === "website" ? webAddress(text) : text.trim();
    if (value == null) {
      setError(WEB_ADDRESS_WORDS);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({ [open]: value });
      setOpen(null);
    } catch (failure) {
      setError(failure?.message || "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="vr-override vr-company-fields">
      {fields.map((field) => (
        <div className="vr-company-field" key={field.key}>
          <div className="factory-detail-pair"><span>{field.label}</span><strong>{field.shown || "Not given"}</strong></div>
          <button className="vr-text-action" type="button" aria-label={`Edit ${field.label.toLowerCase()}`} onClick={() => start(field.key)}>Edit</button>
        </div>
      ))}
      {current && (
        <OverrideDialog
          title={`Edit ${current.label.toLowerCase()}`}
          busy={busy}
          error={error}
          saveDisabled={(!text.trim() && !(open === "legalName" && before)) || text.trim() === before}
          onSave={save}
          onClose={() => setOpen(null)}
        >
          <label className="factory-onboarding-field">
            <span>{current.label}</span>
            {open === "country" ? (
              <select value={text} onChange={(event) => setText(event.target.value)}>
                {!text && <option value="">Choose a country</option>}
                {countries.map((row) => <option key={row.code} value={row.code}>{row.name}</option>)}
              </select>
            ) : (
              <input
                type={open === "website" ? "url" : "text"}
                value={text}
                autoFocus
                placeholder={open === "website" ? "https://" : undefined}
                onChange={(event) => { setText(event.target.value); setError(""); }}
              />
            )}
          </label>
        </OverrideDialog>
      )}
    </div>
  );
}
