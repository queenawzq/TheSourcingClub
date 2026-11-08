/**
 * "Official registry" on the staff review page (live only, inside the admin
 * design's own Panel): the company's registration number, the country's
 * official sources as links, every check recorded with who and when, and a
 * form to record one. Portugal also has "Check on VIES", run by the server.
 *
 * VIES's answer is never a match: a valid number may be another company's,
 * so it reads "Registered for VAT" with the name VIES gives, and only a
 * person's "Found, matches" on the current number lets the company be
 * approved and gives a brand its dated fact (migration 20261108600000).
 *
 * No design draws this yet (question for Queena, Nov 8). Built from the
 * review page's own pieces: detail pairs, check rows, status pills and the
 * onboarding field style.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ProfileDetailPair } from "../../shared/ProfileShell.jsx";
import { adminRegistryDetail, recordRegistryCheck, requestViesCheck } from "../../lib/domain/registration.js";
import {
  registrationFlags, registryResultLabel, registryResultsFor, registrySourceLabel, registrySources,
} from "../../shared/registration-number.mjs";

const COUNTRY_NAMES = { CN: "China", TR: "Turkey", PT: "Portugal" };
const TONE = { found: "success", registered: "info", mismatch: "warning", not_found: "danger", could_not_check: "neutral" };
// Our own words for a VIES call that did not answer; a provider's code is not shown.
const OUR_REASONS = new Set(["timed out", "unreachable"]);

function when(iso) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function Pill({ tone, children }) {
  return <span className={`project-status shared-card-status ${tone}`}>{children}</span>;
}

export default function RegistryPanel({ orgId, onChange }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState("");
  const [result, setResult] = useState("found");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);

  const load = useCallback(() => {
    adminRegistryDetail(orgId).then(setDetail, setError);
  }, [orgId]);
  useEffect(() => { setDetail(null); setError(null); load(); }, [load]);

  const country = detail?.registration?.country ?? detail?.countryCode ?? null;
  const sources = registrySources(country);
  // The choices follow the country, which arrives with the detail: start
  // from the country's first source once it is known.
  const loaded = Boolean(detail);
  useEffect(() => {
    if (loaded) setSource(sources[0]?.key ?? "");
  }, [country, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !detail) return <p className="factory-onboarding-save-error" role="alert">{error.message}</p>;
  if (!detail) return <p>Loading…</p>;

  const registration = detail.registration;
  const results = registryResultsFor(source);
  const copy = (what, text) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(null), 1500); }, () => {});
  };
  const changed = () => { load(); onChange?.(); };
  const record = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await recordRegistryCheck(orgId, { source, result, note: note.trim() });
      setNote("");
      setResult("found");
      changed();
    } catch (recordError) {
      setError(recordError);
    } finally {
      setBusy(false);
    }
  };
  const vies = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestViesCheck(orgId, { force: true });
      changed();
    } catch (viesError) {
      setError(viesError);
    } finally {
      setBusy(false);
    }
  };

  const flags = registration?.number ? registrationFlags(country, registration.number) : [];
  if (registration?.noCompanyNumber) flags.push("No company number (sole proprietor): check the documents");
  if (detail.sameNumber > 0) flags.push(`Also used by ${detail.sameNumber} other ${detail.sameNumber === 1 ? "company" : "companies"}`);
  const checkDigit = !registration?.number ? null
    : registration.problem === "check_digit" ? (registration.confirmed ? "Doesn't match (factory confirmed it)" : "Doesn't match")
    : registration.problem ? "Wrong format"
    : COUNTRY_NAMES[country] ? "Matches" : "None for this country";

  return (
    <div className="admin-registry">
      <div className="admin-detail-grid">
        <ProfileDetailPair label="Country" value={COUNTRY_NAMES[country] ?? country ?? (detail.location || "Not set")} />
        <ProfileDetailPair label="Company title" value={detail.title || "Not given"} />
        <ProfileDetailPair label={country === "TR" ? "Tax number (VKN)" : country === "PT" ? "NIPC" : country === "CN" ? "Credit code" : "Registration number"} value={registration?.number ?? (registration?.noCompanyNumber ? "None (sole proprietor)" : "Not given")} />
        {checkDigit && <ProfileDetailPair label="Check digit" value={checkDigit} />}
        {registration?.accessCode && <ProfileDetailPair label="Certificate access code" value={registration.accessCode} />}
        {registration?.tradeRegistry && <ProfileDetailPair label="Trade registry no. and city" value={registration.tradeRegistry} />}
      </div>

      {flags.length > 0 && (
        <div className="admin-registry-flags">
          {flags.map((flag) => <Pill tone="warning" key={flag}>{flag}</Pill>)}
        </div>
      )}

      <div className="admin-registry-actions">
        {registration?.number && <button className="secondary-btn compact-btn" type="button" onClick={() => copy("number", registration.number)}>{copied === "number" ? "Copied" : "Copy number"}</button>}
        {detail.title && <button className="secondary-btn compact-btn" type="button" onClick={() => copy("title", detail.title)}>{copied === "title" ? "Copied" : "Copy title"}</button>}
        {country === "PT" && registration?.number && <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={vies}>Check on VIES</button>}
      </div>

      <div className="admin-registry-sources">
        {sources.filter((item) => item.url).map((item) => (
          <a className="text-link" href={item.url} target="_blank" rel="noreferrer noopener" key={item.key}>{item.label} ↗</a>
        ))}
      </div>

      <div className="admin-check-list">
        {detail.checks.length ? detail.checks.map((check) => {
          const stale = registration && check.numberChecked && check.numberChecked !== registration.number;
          const reason = check.details?.reason && OUR_REASONS.has(check.details.reason) ? check.details.reason : null;
          return (
            <article className="admin-check-row" key={check.id}>
              <div className="admin-check-copy">
                <strong>{registrySourceLabel(country, check.source)}</strong>
                {check.result === "registered" && <p>{check.details?.name ? `Registered as ${check.details.name}${check.details.address ? `, ${check.details.address.replace(/\s*\n\s*/g, ", ")}` : ""}` : "Registered, no name given"}</p>}
                {check.note && <p>{check.note}</p>}
                {reason && <p>VIES {reason}</p>}
                <span>
                  {check.automatic ? (check.checkedBy ? `Automatic, asked by ${check.checkedBy}` : "Automatic") : check.checkedBy ?? "Staff"} · {when(check.checkedAt)}
                  {stale ? ` · for ${check.numberChecked}, since changed` : ""}
                </span>
              </div>
              <div className="admin-check-result">
                <Pill tone={TONE[check.result] ?? "neutral"}>{registryResultLabel(check.result, { automatic: check.automatic, source: check.source })}</Pill>
              </div>
            </article>
          );
        }) : <p>No checks recorded.</p>}
      </div>

      {error && <p className="factory-onboarding-save-error" role="alert">{error.message}</p>}

      <form className="admin-registry-form" onSubmit={record}>
        <label className="factory-onboarding-field">
          <span>Source</span>
          <select value={source} onChange={(event) => { setSource(event.target.value); setResult("found"); }}>
            {sources.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="factory-onboarding-field">
          <span>Result</span>
          <select value={result} onChange={(event) => setResult(event.target.value)}>
            {results.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="factory-onboarding-field admin-registry-note">
          <span>What you saw *</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder={source === "document" ? "e.g. Licence shows this code and the name Ningbo Loomworks Co., Ltd." : "e.g. Listed as … , active"} />
        </label>
        <button className="primary-btn compact-btn" type="submit" disabled={busy || !source || !registration || !note.trim()} title={!registration ? "The company has not given its number yet" : !note.trim() ? "Write what you saw: the name as shown, what differed, or why you couldn't check" : undefined}>
          Record check
        </button>
      </form>
    </div>
  );
}
