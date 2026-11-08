/**
 * "Official registry" on the staff review page (live only, inside the admin
 * design's own Panel): the company's registration number, the country's
 * official sources as links, every check recorded with who and when, and a
 * form to record one. Portugal also has "Check on VIES", run by the server.
 *
 * No design draws this yet (question for Queena, Nov 8). Built from the
 * review page's own pieces: detail pairs, check rows, status pills and the
 * onboarding field style.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ProfileDetailPair } from "../../shared/ProfileShell.jsx";
import { adminRegistryDetail, recordRegistryCheck, requestViesCheck } from "../../lib/domain/registration.js";
import {
  REGISTRY_RESULTS, registryResultLabel, registrySourceLabel, registrySources,
} from "../../shared/registration-number.mjs";

const COUNTRY_NAMES = { CN: "China", TR: "Turkey", PT: "Portugal" };
const TONE = { found: "success", mismatch: "warning", not_found: "danger", could_not_check: "neutral" };

function when(iso) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function RegistryPanel({ orgId }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState("");
  const [result, setResult] = useState("found");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminRegistryDetail(orgId).then(setDetail, setError);
  }, [orgId]);
  useEffect(() => { setDetail(null); setError(null); load(); }, [load]);

  const country = detail?.registration?.country ?? detail?.countryCode ?? null;
  const sources = registrySources(country);
  useEffect(() => { setSource((current) => current || sources[0]?.key || ""); }, [sources]);

  if (error) return <p className="factory-onboarding-save-error" role="alert">{error.message}</p>;
  if (!detail) return <p>Loading…</p>;

  const registration = detail.registration;
  const noteRequired = result !== "found";
  const record = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await recordRegistryCheck(orgId, { source, result, note: note.trim() });
      setNote("");
      setResult("found");
      load();
    } catch (recordError) {
      setError(recordError);
    } finally {
      setBusy(false);
    }
  };
  const vies = async () => {
    setBusy(true);
    try {
      await requestViesCheck(orgId, { force: true });
      load();
    } catch (viesError) {
      setError(viesError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-registry">
      <div className="admin-detail-grid">
        <ProfileDetailPair label="Country" value={COUNTRY_NAMES[country] ?? country ?? (detail.location || "Not set")} />
        <ProfileDetailPair label="Registration number" value={registration?.number ?? "Not given"} />
        {registration && (
          <ProfileDetailPair
            label="Format"
            value={registration.problem ? (registration.problem === "check_digit" ? "Check digit doesn't match" : "Wrong format") : country === "TR" ? "16 digits" : COUNTRY_NAMES[country] ? "Check digit matches" : "Not checked"}
          />
        )}
        {registration?.accessCode && <ProfileDetailPair label="Certificate access code" value={registration.accessCode} />}
      </div>

      <div className="admin-registry-sources">
        {sources.map((item) => (
          <a className="secondary-btn compact-btn" href={item.url} target="_blank" rel="noreferrer noopener" key={item.key}>{item.label} ↗</a>
        ))}
        {country === "PT" && registration && (
          <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={vies}>Check on VIES</button>
        )}
      </div>

      <div className="admin-check-list">
        {detail.checks.length ? detail.checks.map((check) => (
          <article className="admin-check-row" key={check.id}>
            <div className="admin-check-copy">
              <strong>{registrySourceLabel(country, check.source)}</strong>
              {check.details?.name && <p>{check.details.name}{check.details.address ? ` · ${check.details.address.replace(/\s*\n\s*/g, ", ")}` : ""}</p>}
              {check.note && <p>{check.note}</p>}
              {check.details?.reason && <p>{check.details.reason}</p>}
              <span>
                {check.automatic ? "Automatic" : check.checkedBy ?? "Staff"} · {when(check.checkedAt)}
                {registration && check.numberChecked && check.numberChecked !== registration.number ? ` · for ${check.numberChecked}, since changed` : ""}
              </span>
            </div>
            <div className="admin-check-result">
              <span className={`project-status shared-card-status ${TONE[check.result] ?? "neutral"}`}>{registryResultLabel(check.result)}</span>
            </div>
          </article>
        )) : <p>No checks recorded.</p>}
      </div>

      <form className="admin-registry-form" onSubmit={record}>
        <label className="factory-onboarding-field">
          <span>Source</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            {sources.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="factory-onboarding-field">
          <span>Result</span>
          <select value={result} onChange={(event) => setResult(event.target.value)}>
            {REGISTRY_RESULTS.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label className="factory-onboarding-field admin-registry-note">
          <span>Note{noteRequired ? " *" : ""}</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
        </label>
        <button className="primary-btn compact-btn" type="submit" disabled={busy || !source || (noteRequired && !note.trim())} title={noteRequired && !note.trim() ? "Say what differed or why it couldn't be checked" : undefined}>
          Record check
        </button>
      </form>
    </div>
  );
}
