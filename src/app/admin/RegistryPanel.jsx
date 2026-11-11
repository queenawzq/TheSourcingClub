/**
 * "Official registry" on the staff review page (live only, inside the admin
 * design's own Panel). Verification v3 (Queena, Nov 9): one row per check
 * with its level, overall on top, and each row opens its details
 * (VerificationSignals). The registry row opens what is below:
 *
 *   - Trading-company signals: one block, words, no score (Queena, Nov 5:
 *     "trading companies pretend to be factories").
 *   - The number, the company title, and what a registry said about them:
 *     a name that is not the company's is red ("Name doesn't match"), and a
 *     number another company uses names that company, with a link.
 *   - The country's sources, as one-click actions where the source can be
 *     opened on the company (QCC copies the code first; GİB is prefilled).
 *   - The registration document beside the check, and every check recorded.
 *   - The form to record a check: what the source showed, and, when it names
 *     another company, "The names differ and I checked why".
 *   - The other rows (license read, trading scope, addresses, photos, video)
 *     and certificates are VerificationSignals'.
 *
 * VIES's answer is never a match, and neither is a name the database finds
 * different: approval needs a person's "found" on the current number, a
 * confirmed difference, and an explained duplicate (migration
 * 20261108700000, `registry_approval_problem`).
 *
 * No design draws this (question for Queena, Nov 8). Built from the review
 * page's own pieces: detail pairs, check rows, status pills and the
 * onboarding field style.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ProfileDetailPair } from "../../shared/ProfileShell.jsx";
import {
  adminCompanyClaims, adminRegistryDetail, adminTermsSigner, adminVerificationSignals, adminVerificationRules, explainDuplicate, latestPhotoCheck, recordRegistryCheck, requestViesCheck,
} from "../../lib/domain/registration.js";
import { urlFor } from "../../lib/domain/documents.js";
import {
  companyNamesMatch, registrationFlags, registryResultLabel, registryResultsFor, registrySourceLabel, registrySources, registrySourceUrl,
} from "../../shared/registration-number.mjs";
import VerificationSignals from "./VerificationSignals.jsx";

const TONE = { found: "success", registered: "info", mismatch: "warning", not_found: "danger", could_not_check: "neutral" };
// Our own words for a VIES call that did not answer; a provider's code is not shown.
const OUR_REASONS = new Set(["timed out", "unreachable"]);
const SEEN_LABELS = { name: "Name as shown", address: "Address as shown", startDate: "Start date", industry: "Industry" };

export function countryName(code) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function when(iso) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function Pill({ tone, children }) {
  return <span className={`project-status shared-card-status ${tone}`}>{children}</span>;
}

/** An uploaded file shown in place: a picture inline, a PDF in a frame. */
export function FilePreview({ file, label }) {
  const [href, setHref] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHref(null);
    setFailed(false);
    urlFor({ bucket: file.bucket, storage_path: file.path, file_name: file.name }, 900)
      .then((url) => { if (!cancelled) setHref(url); }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [file.bucket, file.path, file.name]);
  const mime = String(file.mimeType ?? "");
  if (failed) return <p className="factory-onboarding-save-error" role="alert">{file.name} could not be opened.</p>;
  if (!href) return <p>Opening {file.name}…</p>;
  return (
    <figure className="admin-registry-preview">
      {mime.startsWith("image/") ? <img src={href} alt={label ?? file.name} />
        : mime === "application/pdf" ? <iframe src={href} title={label ?? file.name} />
        : null}
      <figcaption>
        <a className="text-link" href={href} target="_blank" rel="noreferrer noopener">Open {file.name} ↗</a>
      </figcaption>
    </figure>
  );
}

export default function RegistryPanel({ orgId, onChange }) {
  const [detail, setDetail] = useState(null);
  const [extra, setExtra] = useState(null);
  const [error, setError] = useState(null);
  const [source, setSource] = useState("");
  const [result, setResult] = useState("found");
  const [note, setNote] = useState("");
  const [seen, setSeen] = useState({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);
  const [overrule, setOverrule] = useState(false);
  const [namesDiffer, setNamesDiffer] = useState(false);
  const [duplicateNote, setDuplicateNote] = useState("");
  const [olderOpen, setOlderOpen] = useState(false);

  const load = useCallback(() => {
    adminRegistryDetail(orgId).then(setDetail, setError);
    Promise.all([
      adminVerificationSignals(orgId).catch(() => ({ signals: [], photos: [], registrationFiles: [], certificates: [] })),
      latestPhotoCheck(orgId),
      adminVerificationRules(orgId),
      adminCompanyClaims(orgId),
      adminTermsSigner(orgId),
    ]).then(([signals, photoResult, rules, claims, signer]) => setExtra({ ...signals, rules, claims, signer, checkResults: photoResult ? [photoResult] : [] }));
  }, [orgId]);
  useEffect(() => { setDetail(null); setExtra(null); setError(null); load(); }, [load]);

  const country = detail?.registration?.country ?? detail?.countryCode ?? null;
  const sources = registrySources(country);
  const loaded = Boolean(detail);
  useEffect(() => {
    if (loaded) setSource(sources[0]?.key ?? "");
  }, [country, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !detail) return <p className="factory-onboarding-save-error" role="alert">{error.message}</p>;
  if (!detail) return <p>Loading…</p>;

  const registration = detail.registration;
  const title = detail.title ?? "";
  const sourceItem = sources.find((item) => item.key === source);
  const results = registryResultsFor(source);
  const lastVies = (detail.checks ?? []).find((check) => check.source === "vies" && check.automatic && check.numberChecked === registration?.number);
  const viesDisagrees = source === "vies" && result === "found" && lastVies && lastVies.result !== "registered";
  // A name a source gave for this number that is not the company's: VIES's
  // own, or what staff are typing now. "Found" then needs the tick.
  const autoNamed = (detail.checks ?? []).find((check) => check.automatic && check.details?.name && check.numberChecked === registration?.number);
  const autoDiffers = autoNamed && !/^-+$/.test(autoNamed.details.name) && !companyNamesMatch(autoNamed.details.name, title) ? autoNamed.details.name : null;
  const typedDiffers = seen.name?.trim() && !companyNamesMatch(seen.name, title) ? seen.name.trim() : null;
  // The AI reading of the current file, on the current number, showing
  // another number or name (registry_reading_differs).
  const readingLines = detail.readingDiffers?.differences ?? [];
  const readingDiffers = readingLines.length
    ? readingLines.map((line) => `${line.field === "number" ? "number" : "name"} "${line.document || "none"}"`).join(", ")
    : null;
  const differsNow = result === "found" && (typedDiffers || autoDiffers || readingDiffers);

  const copy = (what, text) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(null), 1500); }, () => {});
  };
  const changed = () => { load(); onChange?.(); };
  const run = async (work) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      changed();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  const record = (event) => {
    event.preventDefault();
    run(async () => {
      await recordRegistryCheck(orgId, {
        source, result, note: note.trim(), confirmed: Boolean(viesDisagrees && overrule),
        seen: sourceItem?.seen ? Object.fromEntries(sourceItem.seen.map((key) => [key, seen[key] ?? ""])) : {},
        nameDiffersConfirmed: Boolean(differsNow && namesDiffer),
      });
      setNote("");
      setSeen({});
      setResult("found");
      setOverrule(false);
      setNamesDiffer(false);
    });
  };
  // Open a source on this company; copy its number first where it can't be prefilled.
  const openSource = (item) => {
    const url = registrySourceUrl(item, registration, title);
    if (item.copy === "number" && registration?.number) copy(item.key, registration.number);
    if (item.copy === "accessCode" && registration?.accessCode) copy(item.key, registration.accessCode);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  const allFlags = registration?.number ? registrationFlags(country, registration.number) : [];
  // One answer about the number's check characters, not "Matches" beside "doesn't match".
  const orgCodeFails = allFlags.some((flag) => flag.startsWith("Organisation-code check"));
  const flags = allFlags.filter((flag) => !flag.startsWith("Organisation-code check"));
  if (registration?.noCompanyNumber) flags.push("No company number (sole proprietor): check the documents");
  const checkDigit = !registration?.number ? null
    : registration.problem === "check_digit" ? (registration.confirmed ? "Doesn't match (factory confirmed it)" : "Doesn't match")
    : registration.problem ? "Wrong format"
    : orgCodeFails ? "Last character matches; the 17th (organisation code) doesn't, which some real codes fail"
    : ["CN", "TR", "PT"].includes(country) ? "Matches" : "None for this country";
  const files = extra?.registrationFiles ?? [];
  const missingSecond = country === "TR" && registration?.number && !registration?.registrationLetterNumber;

  // The registry row's details: what was typed, the sources, every check
  // recorded and the form to record one.
  const registryBody = () => (
    <div className="admin-registry admin-registry-body">
      <div className="admin-detail-grid">
        <ProfileDetailPair label="Country" value={countryName(country) ?? (detail.location || "Not set")} />
        <ProfileDetailPair label="Company title" value={title || "Not given"} />
        <ProfileDetailPair label={country === "TR" ? "Tax number (VKN)" : country === "PT" ? "NIPC" : country === "CN" ? "Credit code" : "Registration number"} value={registration?.number ?? (registration?.noCompanyNumber ? "None (sole proprietor)" : "Not given")} />
        {checkDigit && <ProfileDetailPair label="Check digit" value={checkDigit} />}
        {registration?.accessCode && <ProfileDetailPair label="Certificate access code" value={registration.accessCode} />}
        {country === "TR" && <ProfileDetailPair label="Letter number (Dilekçe No.)" value={registration?.registrationLetterNumber ?? "Not given"} />}
      </div>

      {(detail.nameDiffers || readingDiffers || detail.renamedSinceCheck || flags.length > 0) && (
        <div className="admin-registry-flags">
          {detail.nameDiffers && <Pill tone="danger">Name doesn't match: {detail.nameDiffers}</Pill>}
          {readingDiffers && <Pill tone="danger">Document shows {readingDiffers}</Pill>}
          {detail.renamedSinceCheck && <Pill tone="danger">Renamed since the check: {detail.current?.details?.nameAtCheck ?? detail.current?.details?.titleAtCheck} → {detail.displayName}</Pill>}
          {flags.map((flag) => <Pill tone="warning" key={flag}>{flag}</Pill>)}
        </div>
      )}

      {detail.duplicates?.length > 0 && (
        <div className="admin-registry-duplicates">
          <h3>Same number as</h3>
          <ul>
            {detail.duplicates.map((other) => (
              <li key={other.orgId}>
                <a className="text-link" href={`/admin.html?screen=review&profile=${other.orgId}`} target="_blank" rel="noreferrer noopener">{other.name} ↗</a>
                <span>{other.status === "verified" ? "Verified" : other.status === "pending" ? "In review" : other.status ?? "No profile"}</span>
              </li>
            ))}
          </ul>
          {detail.duplicateExplained ? (
            <p className="admin-registry-explained">Explained by {detail.duplicateExplained.reviewedBy ?? "staff"} · {when(detail.duplicateExplained.reviewedAt)}: {detail.duplicateExplained.note}</p>
          ) : (
            <form className="admin-registry-form admin-registry-duplicate-form" onSubmit={(event) => { event.preventDefault(); run(async () => { await explainDuplicate(orgId, duplicateNote.trim()); setDuplicateNote(""); }); }}>
              <label className="factory-onboarding-field admin-registry-note">
                <span>Why do they share it? *</span>
                <textarea value={duplicateNote} onChange={(event) => setDuplicateNote(event.target.value)} rows={2} placeholder="e.g. Same group: the other company is its sales office, confirmed on the licence" />
              </label>
              <button className="secondary-btn compact-btn" type="submit" disabled={busy || !duplicateNote.trim()}>Explain duplicate</button>
            </form>
          )}
        </div>
      )}

      <div className="admin-registry-actions">
        {registration?.number && <button className="secondary-btn compact-btn" type="button" onClick={() => copy("number", registration.number)}>{copied === "number" ? "Copied" : country === "TR" ? "Copy VKN" : "Copy number"}</button>}
        {registration?.accessCode && <button className="secondary-btn compact-btn" type="button" onClick={() => copy("code", registration.accessCode)}>{copied === "code" ? "Copied" : "Copy access code"}</button>}
        {registration?.registrationLetterNumber && <button className="secondary-btn compact-btn" type="button" onClick={() => copy("letter", registration.registrationLetterNumber)}>{copied === "letter" ? "Copied" : "Copy letter number"}</button>}
        {title && <button className="secondary-btn compact-btn" type="button" onClick={() => copy("title", title)}>{copied === "title" ? "Copied" : "Copy title"}</button>}
        {country === "PT" && registration?.number && <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={() => run(() => requestViesCheck(orgId, { force: true }))}>Check on VIES</button>}
        {sources.filter((item) => item.action && registration?.number).map((item) => (
          <button className="secondary-btn compact-btn" type="button" key={item.key} disabled={item.key === "gib" && missingSecond} title={item.key === "gib" && missingSecond ? "The factory has not given its letter number" : undefined} onClick={() => openSource(item)}>
            {copied === item.key ? "Code copied, opening…" : item.action}
          </button>
        ))}
      </div>

      <div className="admin-registry-sources">
        {sources.filter((item) => !item.action && typeof item.url === "function").map((item) => (
          <a className="text-link" href={registrySourceUrl(item, registration, title)} target="_blank" rel="noreferrer noopener" key={item.key}>{item.label} ↗</a>
        ))}
      </div>

      <div className="admin-registry-document">
        <h3>Registration document</h3>
        {files.length ? (
          <>
            <p className="admin-registry-current">Current: {files[0].name} · uploaded {when(files[0].createdAt)}</p>
            <FilePreview file={files[0]} label="Registration document" />
            {files.length > 1 && (
              <div>
                <button className="text-link" type="button" onClick={() => setOlderOpen((open) => !open)}>{olderOpen ? "Hide" : "Show"} {files.length - 1} earlier {files.length === 2 ? "upload" : "uploads"}</button>
                {olderOpen && files.slice(1).map((file) => <FilePreview file={file} key={file.id} label={`Earlier upload ${file.name}`} />)}
              </div>
            )}
          </>
        ) : <p>No registration document uploaded.</p>}
      </div>

      <div className="admin-check-list">
        {detail.checks.length ? detail.checks.map((check) => {
          const stale = registration && check.numberChecked && check.numberChecked !== registration.number;
          const reason = check.details?.reason && OUR_REASONS.has(check.details.reason) ? check.details.reason : null;
          const seenLines = Object.entries(SEEN_LABELS).filter(([key]) => key !== "name" && check.details?.[key]).map(([key, label]) => `${label}: ${check.details[key]}`);
          return (
            <article className="admin-check-row" key={check.id}>
              <div className="admin-check-copy">
                <strong>{registrySourceLabel(country, check.source)}</strong>
                {check.result === "registered" && <p>{check.details?.name ? `Registered as ${check.details.name}${check.details.address ? `, ${check.details.address.replace(/\s*\n\s*/g, ", ")}` : ""}` : "Registered, no name given"}</p>}
                {!check.automatic && check.details?.name && <p>Name as shown: {check.details.name}</p>}
                {check.nameMatches === false && <p className="admin-registry-differs">Name doesn't match: {check.details.name}{check.details?.nameDiffersConfirmed ? " (staff confirmed why)" : ""}</p>}
                {seenLines.map((line) => <p key={line}>{line}</p>)}
                {check.note && <p>{check.note}</p>}
                {reason && <p>VIES {reason}</p>}
                <span>
                  {check.automatic ? (check.checkedBy ? `Automatic, asked by ${check.checkedBy}` : "Automatic") : check.checkedBy ?? "Staff"} · {when(check.checkedAt)}
                  {stale ? ` · for ${check.numberChecked}, since changed` : ""}
                </span>
              </div>
              <div className="admin-check-result">
                <Pill tone={check.nameMatches === false && check.result !== "found" ? "danger" : TONE[check.result] ?? "neutral"}>{registryResultLabel(check.result, { automatic: check.automatic, source: check.source })}</Pill>
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
        {(sourceItem?.seen ?? []).map((key) => (
          <label className="factory-onboarding-field" key={key}>
            <span>{SEEN_LABELS[key]}</span>
            <input value={seen[key] ?? ""} onChange={(event) => setSeen((current) => ({ ...current, [key]: event.target.value }))} autoComplete="off" />
          </label>
        ))}
        <label className="factory-onboarding-field admin-registry-note">
          <span>What you saw *</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder={source === "document" ? "e.g. Licence shows this code and the name Ningbo Loomworks Co., Ltd." : "e.g. Listed as … , active"} />
        </label>
        {viesDisagrees && (
          <div className="admin-registry-note">
            <Pill tone="warning">VIES answered "{registryResultLabel(lastVies.result, { automatic: true })}" on {when(lastVies.checkedAt)}</Pill>
            <label className="directory-check">
              <input type="checkbox" checked={overrule} onChange={(event) => setOverrule(event.target.checked)} />
              <span>I checked VIES myself and it shows this company</span>
            </label>
          </div>
        )}
        {differsNow && (
          <div className="admin-registry-note">
            <Pill tone="danger">{typedDiffers || autoDiffers ? `Name doesn't match: ${typedDiffers ?? autoDiffers}` : `Document shows ${readingDiffers}`} · company {title}{registration?.number ? ` · ${registration.number}` : ""}</Pill>
            <label className="directory-check">
              <input type="checkbox" checked={namesDiffer} onChange={(event) => setNamesDiffer(event.target.checked)} />
              <span>They differ and I checked why (say why above)</span>
            </label>
          </div>
        )}
        <button
          className="primary-btn compact-btn"
          type="submit"
          disabled={busy || !source || !registration || !note.trim() || (viesDisagrees && !overrule) || (differsNow && !namesDiffer)}
          title={!registration ? "The company has not given its number yet" : !note.trim() ? "Write what you saw: the name as shown, what differed, or why you couldn't check" : viesDisagrees && !overrule ? "Tick that you checked VIES yourself" : differsNow && !namesDiffer ? "Tick that they differ and you checked why" : undefined}
        >
          Record check
        </button>
      </form>
    </div>
  );

  return (
    <div className="admin-registry">
      <VerificationSignals orgId={orgId} detail={detail} extra={extra} registryBody={registryBody} onChange={changed} />
    </div>
  );
}
