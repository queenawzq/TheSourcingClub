/**
 * The checks Queena asked for beyond the registry (Nov 5), inside the staff
 * "Official registry" panel, live only (verification v2):
 *
 *   - Read with AI: the registration's fields copied by the model, and where
 *     they differ from what the factory typed (our code compares, quoting
 *     the document). Off where VERIFY_AI_READS_DOCUMENTS is off.
 *   - Address: OpenStreetMap's tags around the address, judged industrial /
 *     office / residential / unknown, with the tags and map links.
 *   - Photos: reverse image search per public photo; staff record what they
 *     found.
 *   - Certificates: the issuer's own lookup; staff record what they found,
 *     and a brand then reads "checked <month>".
 *
 * `TradingSignals` sums up the four signals of a trader posing as a factory
 * in one block. Words for a person, never a score or a decision.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  adminSetRegistrationNumber, explainCheck, explainTradingScope, recordCompanyFacts, recordSignal, requestRegistryAssist, runPhotoCheck,
} from "../../lib/domain/registration.js";
import { urlFor } from "../../lib/domain/documents.js";
import { dateFrom } from "../../lib/dates.js";
import { certificateLookup, mapLinks, reverseImageLinks } from "../../shared/certificate-lookups.mjs";
import { registrySourceLabel } from "../../shared/registration-number.mjs";
import { FilePreview, Pill, when } from "./RegistryPanel.jsx";
import { CHECKS, LEVEL_TONE, LEVEL_WORDS, computeLevels } from "../../shared/verification-levels.mjs";
import "./verification-levels.css";

const ADDRESS_WORDS = { industrial: "Industrial area", office: "Office or commercial building", residential: "Residential area", unknown: "Can't tell" };
const ADDRESS_TONE = { industrial: "success", office: "danger", residential: "warning", unknown: "neutral" };
const PHOTO_RESULTS = [
  { key: "own", label: "Own photos" },
  { key: "found_elsewhere", label: "Found elsewhere" },
  { key: "could_not_check", label: "Couldn't check" },
];
const CERT_RESULTS = [
  { key: "found", label: "Found, valid" },
  { key: "not_found", label: "Not found" },
  { key: "expired", label: "Expired" },
  { key: "could_not_check", label: "Couldn't check" },
];
const FIELD_LABELS = {
  documentType: "Document", registrationNumber: "Number", legalName: "Legal name", legalNameEnglish: "English name",
  legalRepresentative: "Legal representative", address: "Address", businessScope: "Business scope", taxOffice: "Tax office", issueDate: "Issued",
};

function latest(signals, kind, subjectId) {
  return (signals ?? []).find((signal) => signal.kind === kind && (subjectId === undefined || signal.subjectId === subjectId));
}

export function TradingSignals({ detail, extra }) {
  if (!extra) return null;
  const signals = extra.signals ?? [];
  const address = latest(signals, "address");
  const reading = latest(signals, "document_reading");
  const photos = extra.photos ?? [];
  const photoChecks = photos.map((photo) => latest(signals, "photo", photo.id)).filter(Boolean);
  const elsewhere = photoChecks.filter((check) => check.result === "found_elsewhere").length;
  const scope = reading?.details?.tradingScope;
  const rows = [
    ["Address", address ? ADDRESS_WORDS[address.result] ?? address.result : "Not checked", address ? ADDRESS_TONE[address.result] : "neutral"],
    ["Licence scope", !reading ? "Not read" : !scope?.read ? "No business scope on the document"
      : scope.recognised === false ? "No trading or making words recognised"
      : scope.trading ? `Trading only: ${scope.quote}` : `Includes making: ${scope.quote}`,
      !scope?.read || scope.recognised === false ? "neutral" : scope.trading ? "danger" : "success"],
    ["Photos", !photos.length ? "None uploaded" : `${photoChecks.length} of ${photos.length} searched${elsewhere ? `, ${elsewhere} found elsewhere` : ""}`, elsewhere ? "danger" : photoChecks.length === photos.length ? "success" : "neutral"],
    ["Duplicate number", detail?.duplicates?.length ? `Shared with ${detail.duplicates.map((other) => other.name).join(", ")}` : "None", detail?.duplicates?.length ? "danger" : "success"],
  ];
  return (
    <section className="admin-signals-summary" aria-label="Trading-company signals">
      <h3>Trading-company signals</h3>
      <dl>
        {rows.map(([label, words, tone]) => (
          <div key={label}><dt>{label}</dt><dd><Pill tone={tone}>{words}</Pill></dd></div>
        ))}
      </dl>
    </section>
  );
}

/** A3: staff type the number off the image when the AI's reading fails its check digit or is missing. */
function StaffNumberForm({ orgId, currentNumber, onChange }) {
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try { await adminSetRegistrationNumber(orgId, number.replace(/\s+/g, "").toUpperCase()); setNumber(""); onChange(); } catch (error) { setFailure(error.message); }
    setBusy(false);
  };
  return (
    <form className="admin-signal-form" onSubmit={save}>
      <label className="factory-onboarding-field">
        <span>{currentNumber ? "Correct the number from the image" : "Type the number from the image"}</span>
        <input name="staff-registration-number" value={number} onChange={(event) => setNumber(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <button className="secondary-btn compact-btn" type="submit" disabled={busy || !number.trim()}>{busy ? "Saving…" : "Save number"}</button>
      {failure && <p className="factory-onboarding-save-error" role="alert">{failure}</p>}
    </form>
  );
}

function DocumentReading({ orgId, reading, hasFile, currentNumber, latestFileId, signer, country, onChange }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const read = async () => {
    setBusy(true);
    setProblem("");
    const answer = await requestRegistryAssist(orgId, "read_document");
    setBusy(false);
    if (!answer.available) setProblem(answer.reason);
    else onChange();
  };
  // The page runs the read by itself when it has none (useAutoRun).
  const details = reading?.details;
  const extracted = details?.extracted ?? {};
  return (
    <section className="admin-signal-block">
      <div className="admin-signal-head">
        <h3>Registration read by AI</h3>
        <button className="secondary-btn compact-btn" type="button" disabled={busy || !hasFile} onClick={read}>{busy ? "Running…" : "Run again"}</button>
      </div>
      {problem && <p className="factory-onboarding-save-error" role="alert">{problem}</p>}
      {reading ? (
        <>
          {(details.numberAtReading !== undefined && details.numberAtReading !== currentNumber) && <p className="admin-registry-differs">Read when the number was {details.numberAtReading ?? "not given"}; it has changed since. Read again.</p>}
          {latestFileId && reading.subjectId !== latestFileId && <p className="admin-registry-differs">Read from an earlier upload. Read again.</p>}
          {extracted.readable === false && <p>The AI could not read this as a registration document.</p>}
          {(details.differences ?? []).map((line) => (
            <p className="admin-registry-differs" key={line.field}>
              {line.field === "number" ? "Number" : "Name"} differs: document "{line.document || "none"}", factory typed "{line.typed}"
            </p>
          ))}
          {details.tradingScope?.trading && <p className="admin-registry-differs">Business scope has trading words only: {details.tradingScope.quote}</p>}
          <dl className="admin-signal-fields">
            {Object.entries(FIELD_LABELS).filter(([key]) => extracted[key]).map(([key, label]) => (
              <div key={key}><dt>{label}</dt><dd>{extracted[key]}</dd></div>
            ))}
            {signer && (signer.signature || signer.signedBy) && <div><dt>Signed the terms</dt><dd>{signer.signature || signer.signedBy}{signer.signature && signer.signedBy && signer.signature !== signer.signedBy ? ` (account: ${signer.signedBy})` : ""}</dd></div>}
          </dl>
          <span className="admin-signal-meta">Copied by AI from {details.fileName ?? "the document"} · {when(reading.checkedAt)}{reading.checkedBy ? ` · asked by ${reading.checkedBy}` : ""}</span>
        </>
      ) : !hasFile ? <p>No registration document uploaded.</p> : null}
      {hasFile && (country === "CN" || !currentNumber) && <StaffNumberForm orgId={orgId} currentNumber={currentNumber} onChange={onChange} />}
    </section>
  );
}

function AddressCheck({ orgId, check, onChange }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const run = async () => {
    setBusy(true);
    setProblem("");
    const answer = await requestRegistryAssist(orgId, "address", { force: Boolean(check) });
    setBusy(false);
    if (!answer.available) setProblem(answer.reason);
    else onChange();
  };
  const details = check?.details;
  return (
    <section className="admin-signal-block">
      <div className="admin-signal-head">
        <h3>Address</h3>
        <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={run}>{busy ? "Running…" : "Run again"}</button>
      </div>
      {problem && <p className="factory-onboarding-save-error" role="alert">{problem}</p>}
      {details && (
        <>
          <p><Pill tone={ADDRESS_TONE[check.result] ?? "neutral"}>{ADDRESS_WORDS[check.result] ?? check.result}</Pill></p>
          <p>{details.address} <span className="admin-signal-meta">(from {details.from})</span></p>
          {details.displayName && <p className="admin-signal-meta">Placed as: {details.displayName}{details.precise ? "" : " (town or district only)"}</p>}
          <ul className="admin-signal-reasons">{(details.reasons ?? []).map((reason) => <li key={reason}>{reason}</li>)}</ul>
          {details.tags?.length > 0 && <p className="admin-signal-meta">Tags nearby: {details.tags.map((tag) => `${tag.tag}${tag.nearest != null ? ` (${tag.nearest} m)` : ""}`).join(", ")}</p>}
          {details.tagsUnavailable && <p className="admin-signal-meta">OpenStreetMap's tags didn't load; judged on the placement only.</p>}
          {details.found && (
            <div className="admin-registry-sources">
              {mapLinks(details.lat, details.lon).map((link) => <a className="text-link" href={link.href} target="_blank" rel="noreferrer noopener" key={link.key}>{link.label} ↗</a>)}
            </div>
          )}
          <span className="admin-signal-meta">{details.how === "model" ? "Judged by AI from the tags" : "Judged from the tags"} · {when(check.checkedAt)} · Map data © OpenStreetMap contributors</span>
        </>
      )}
    </section>
  );
}

/** One record form for a photo or a certificate. */
function SignalForm({ orgId, kind, subjectId, results, needsLink, numberField, onChange }) {
  const [result, setResult] = useState(results[0].key);
  const [note, setNote] = useState("");
  const [link, setLink] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const linkNeeded = needsLink && result === "found_elsewhere";
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await recordSignal(orgId, { kind, subjectId, result, note: note.trim(), details: { link: link.trim(), number: number.trim() } });
      setNote("");
      setLink("");
      setNumber("");
      onChange();
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="admin-signal-form" onSubmit={submit}>
      <select aria-label="Result" value={result} onChange={(event) => setResult(event.target.value)}>
        {results.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
      </select>
      {numberField && <input aria-label="Certificate number" placeholder="Certificate number" value={number} onChange={(event) => setNumber(event.target.value)} />}
      {linkNeeded && <input aria-label="Where it was found" placeholder="Link where it was found *" value={link} onChange={(event) => setLink(event.target.value)} />}
      <input aria-label="What you saw" placeholder="What you saw *" value={note} onChange={(event) => setNote(event.target.value)} />
      <button className="secondary-btn compact-btn" type="submit" disabled={busy || !note.trim() || (linkNeeded && !link.trim())}>Record</button>
      {problem && <p className="factory-onboarding-save-error" role="alert">{problem}</p>}
    </form>
  );
}

function resultLabel(results, key) {
  return results.find((item) => item.key === key)?.label ?? key;
}

function Photo({ orgId, photo, check, onChange }) {
  const [href, setHref] = useState(null);
  useEffect(() => {
    let cancelled = false;
    urlFor({ bucket: photo.bucket, storage_path: photo.path, file_name: photo.name }).then((url) => { if (!cancelled) setHref(url); }, () => {});
    return () => { cancelled = true; };
  }, [photo.bucket, photo.path, photo.name]);
  // A local stack's photo URL (127.0.0.1) can't be fetched by the search sites.
  const local = href && /\/\/(127\.0\.0\.1|localhost)[:/]/.test(href);
  return (
    <article className="admin-signal-photo">
      {href ? <img src={href} alt={photo.name} /> : <span className="admin-signal-meta">{photo.name}</span>}
      <div>
        <div className="admin-registry-sources">
          {href && reverseImageLinks(href).map((link) => <a className="text-link" href={link.href} target="_blank" rel="noreferrer noopener" key={link.key}>{link.label} ↗</a>)}
        </div>
        {local && <p className="admin-signal-meta">Local photo: the search sites can't open it.</p>}
        {check && (
          <p>
            <Pill tone={check.result === "own" ? "success" : check.result === "found_elsewhere" ? "danger" : "neutral"}>{resultLabel(PHOTO_RESULTS, check.result)}</Pill>{" "}
            {check.details?.link && <a className="text-link" href={check.details.link} target="_blank" rel="noreferrer noopener">where ↗</a>} {check.note} <span className="admin-signal-meta">· {check.checkedBy ?? "Staff"} · {when(check.checkedAt)}</span>
          </p>
        )}
        <SignalForm orgId={orgId} kind="photo" subjectId={photo.id} results={PHOTO_RESULTS} needsLink onChange={onChange} />
      </div>
    </article>
  );
}

function Certificate({ orgId, cert, check, title, onChange }) {
  const lookup = certificateLookup(cert.slug);
  const [previewOpen, setPreviewOpen] = useState(false);
  const number = check?.details?.number ?? "";
  const lookupUrl = lookup.url(number, title);
  // Expired once the day after the stored date has begun, in the reader's zone.
  const expiry = dateFrom(cert.expiresAt);
  const expired = expiry && new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate() + 1) <= new Date();
  return (
    <article className="admin-signal-cert">
      <div className="admin-signal-head">
        <strong>{cert.label}</strong>
        {check && <Pill tone={check.result === "found" ? "success" : check.result === "could_not_check" ? "neutral" : "danger"}>{resultLabel(CERT_RESULTS, check.result)}</Pill>}
      </div>
      {cert.expiresAt && <p className={expired ? "admin-registry-differs" : "admin-signal-meta"}>Expires {cert.expiresAt}{expired ? " (past)" : ""}</p>}
      <div className="admin-registry-sources">
        {lookupUrl && <a className="text-link" href={lookupUrl} target="_blank" rel="noreferrer noopener">{lookup.label} ↗</a>}
        {lookup.also && <a className="text-link" href={lookup.also.url} target="_blank" rel="noreferrer noopener">{lookup.also.label} ↗</a>}
        {lookup.note && <span className="admin-signal-meta">{lookup.note}</span>}
        {cert.document && <button className="text-link" type="button" onClick={() => setPreviewOpen((open) => !open)}>{previewOpen ? "Hide certificate" : "Show certificate"}</button>}
      </div>
      {!cert.document && <p className="admin-signal-meta">No certificate file uploaded.</p>}
      {previewOpen && cert.document && <FilePreview file={cert.document} label={`${cert.label} certificate`} />}
      {check && <p>{check.details?.number ? `No. ${check.details.number} · ` : ""}{check.note} <span className="admin-signal-meta">· {check.checkedBy ?? "Staff"} · {when(check.checkedAt)}</span></p>}
      <SignalForm orgId={orgId} kind="certificate" subjectId={cert.id} results={CERT_RESULTS} numberField onChange={onChange} />
    </article>
  );
}

/** The row's grey line: when it was checked. */
function rowMeta(item) {
  return item.checkedAt ? when(item.checkedAt) : "";
}

const ADDRESS_SOURCES = [["typed", "Typed by the factory"], ["license", "On the license"], ["registry", "On the registry"]];
const ADDRESS_PART_WORDS = { province: "Province", city: "City", district: "District", town: "Town or neighbourhood", road: "Street", number: "Street number", postcode: "Postcode" };

/** A4: the addresses compared, and the parts that differ (the address check's parsed result). */
function AddressCompare({ item }) {
  const addresses = item.details?.addresses ?? {};
  const comparisons = Array.isArray(item.details?.comparisons) ? item.details.comparisons : [];
  const sourceLabel = (key) => ADDRESS_SOURCES.find(([source]) => source === key)?.[1] ?? key;
  return (
    <>
      <dl className="admin-signal-fields">
        {ADDRESS_SOURCES.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{addresses[key] || "Not given"}</dd></div>)}
      </dl>
      {comparisons.map((comparison) => (
        <div className="admin-address-compare" key={comparison.between.join("-")}>
          <h4>{sourceLabel(comparison.between[0])} · {sourceLabel(comparison.between[1]).toLowerCase()}</h4>
          {comparison.differs?.length > 0 ? (
            <table className="admin-address-parts">
              <thead><tr><th>Part</th><th>{sourceLabel(comparison.between[0])}</th><th>{sourceLabel(comparison.between[1])}</th></tr></thead>
              <tbody>
                {comparison.differs.map((part) => (
                  <tr key={part.part}><th>{ADDRESS_PART_WORDS[part.part] ?? part.part}</th><td>{part.a}</td><td>{part.b}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {comparison.same?.length > 0 && <p className="admin-signal-meta">Same: {comparison.same.map((part) => (ADDRESS_PART_WORDS[part] ?? part).toLowerCase()).join(", ")}</p>}
          {!comparison.differs?.length && !comparison.same?.length && <p className="admin-signal-meta">Could not be compared</p>}
        </div>
      ))}
    </>
  );
}

/** A10: staff record why a row's level may stand; a reason lifts Low to Medium. */
function ExplainForm({ orgId, checkKey, explanation, onChange }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try { await explainCheck(orgId, checkKey, note.trim()); setNote(""); onChange(); } catch (error) { setFailure(error.message); }
    setBusy(false);
  };
  return (
    <form className="admin-signal-form admin-explain-form" onSubmit={save}>
      {explanation?.note && <p className="admin-signal-note">Staff reason: {explanation.note}{explanation.reviewedBy ? ` · ${explanation.reviewedBy}` : ""}{explanation.reviewedAt ? ` · ${when(explanation.reviewedAt)}` : ""}</p>}
      <label className="factory-onboarding-field">
        <span>{explanation?.note ? "Change the reason" : "Reason"}</span>
        <textarea name={`reason-${checkKey}`} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="submit" className="secondary-btn compact-btn" disabled={busy || !note.trim()}>{busy ? "Saving…" : "Save reason"}</button>
      {failure && <p className="factory-onboarding-save-error" role="alert">{failure}</p>}
    </form>
  );
}

/** B3: insured staff (参保人数) and founding date (成立日期), from the annual report. */
function CompanyFactsForm({ orgId, facts, onChange }) {
  const [insured, setInsured] = useState(facts?.insuredStaff != null ? String(facts.insuredStaff) : "");
  const [founded, setFounded] = useState(facts?.foundedOn ?? "");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await recordCompanyFacts(orgId, { insuredStaff: insured.trim() === "" ? null : Number(insured), foundedOn: founded || null });
      onChange();
    } catch (error) { setFailure(error.message); }
    setBusy(false);
  };
  return (
    <form className="admin-signal-form" onSubmit={save}>
      <label className="factory-onboarding-field">
        <span>Insured staff</span>
        <input name="insured-staff" type="number" min="0" step="1" value={insured} onChange={(event) => setInsured(event.target.value)} />
      </label>
      <label className="factory-onboarding-field">
        <span>Founded</span>
        <input name="founded-on" type="date" value={founded} onChange={(event) => setFounded(event.target.value)} />
      </label>
      <button type="submit" className="secondary-btn compact-btn" disabled={busy || (insured.trim() === "" && !founded)}>{busy ? "Saving…" : "Save"}</button>
      {failure && <p className="factory-onboarding-save-error" role="alert">{failure}</p>}
    </form>
  );
}

/** What a row opens: the check's evidence, links and record forms. */
function LevelDetail({ item, label, orgId, detail, extra, registryBody, onChange, onClose }) {
  const signals = extra.signals ?? [];
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const reading = latest(signals, "document_reading");
  let body = null;
  if (item.key === "license_read" || item.key === "trading_scope") {
    body = <>{item.key === "trading_scope" && <TradingReasonForm orgId={orgId} rules={extra.rules} onChange={onChange} />}<DocumentReading orgId={orgId} reading={reading} hasFile={(extra.registrationFiles ?? []).length > 0} currentNumber={detail?.registration?.number ?? null} latestFileId={extra.registrationFiles?.[0]?.id ?? null} signer={item.key === "license_read" ? extra.signer : null} country={detail?.registration?.country ?? detail?.countryCode ?? null} onChange={onChange} /></>;
  } else if (item.key === "registry") {
    body = registryBody?.();
  } else if (item.key === "address_owner") {
    body = <AddressCompare item={item} />;
  } else if (item.key === "address_site") {
    body = <AddressCheck orgId={orgId} check={signals.find((signal) => signal.kind === "address" && signal.automatic)} onChange={onChange} />;
  } else if (item.key === "company_facts") {
    body = <CompanyFactsForm orgId={orgId} facts={extra.rules?.companyFacts ?? null} onChange={onChange} key={JSON.stringify(extra.rules?.companyFacts ?? null)} />;
  } else if (item.key === "photos") {
    body = (
      <>
        <PhotoCheckButton orgId={orgId} hasPhotos={(extra.photos ?? []).length > 0} onChange={onChange} />
        {(extra.photos ?? []).map((photo) => (
          <Photo orgId={orgId} photo={photo} check={latest(signals, "photo", photo.id)} onChange={onChange} key={photo.id} />
        ))}
      </>
    );
  }
  const DETAIL_WORDS = { codes: "Activity codes", claimedWorkers: "Workers claimed", insuredStaff: "Insured staff", claimedFounded: "Founded (claimed)", founded: "Founded" };
  const extraLines = Object.entries(item.details ?? {}).filter(([key, value]) => typeof value === "string" && value && DETAIL_WORDS[key]);
  return (
    <div className="approve-fund-modal-layer admin-evidence-modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="approve-fund-modal admin-review-modal admin-evidence-modal admin-level-modal" role="dialog" aria-modal="true" aria-labelledby="level-detail-title">
        <button ref={closeRef} className="settings-drawer-close" type="button" aria-label="Close" onClick={onClose}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
        <header>
          <div><span>Verification check</span><h2 id="level-detail-title">{label}</h2></div>
        </header>
        <div className="admin-level-detail">
          <div className="admin-level-summary">
            <Pill tone={LEVEL_TONE[item.level]}>{LEVEL_WORDS[item.level]}</Pill>
            <ul className="admin-signal-reasons">{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            {extraLines.length > 0 && (
              <dl className="admin-signal-fields">
                {extraLines.map(([key, value]) => <div key={key}><dt>{DETAIL_WORDS[key]}</dt><dd>{value}</dd></div>)}
              </dl>
            )}
            {item.checkedAt && <span className="admin-signal-meta">{when(item.checkedAt)}</span>}
          </div>
          {body && <div className="admin-level-evidence">{body}</div>}
          {item.key !== "video" && <ExplainForm orgId={orgId} checkKey={item.key} explanation={item.details?.explanation ?? null} onChange={onChange} />}
        </div>
      </section>
    </div>
  );
}

/**
 * Queena, Nov 9: one row per check, the level on the right, click for the
 * details. Levels come from src/shared/verification-levels.mjs (fixed rules).
 */
export function ScoreRows({ results, overall, onOpen, running = new Set() }) {
  return (
    <section className="admin-levels" aria-label="Verification levels">
      <div className={`admin-levels-overall level-${overall.level}`}>
        <div>
          <span>Overall</span>
          <strong>{LEVEL_WORDS[overall.level]}</strong>
        </div>
        <p>{overall.reasons.join(" · ")}</p>
        {overall.level === "low" && <Pill tone="danger">Flagged</Pill>}
      </div>
      <div className="admin-check-list admin-levels-list">
        {results.map((item) => {
          const label = CHECKS.find((check) => check.key === item.key)?.label ?? item.key;
          const meta = rowMeta(item);
          return (
            <article
              className={`admin-check-row admin-level-row level-${item.level}`}
              role="button"
              tabIndex={0}
              aria-label={`${label}: ${LEVEL_WORDS[item.level]}. View details`}
              onClick={() => onOpen(item.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item.key); }
              }}
              data-check={item.key}
              key={item.key}
            >
              <div className="admin-check-copy">
                <strong>{label}</strong>
                {running.has(item.key) ? <p>Running…</p> : item.reasons.slice(0, 2).map((reason) => <p key={reason}>{reason}</p>)}
                {meta && <span>{meta}</span>}
              </div>
              <div className="admin-check-result">
                <div className="admin-check-confidence"><strong>{running.has(item.key) ? "Running…" : LEVEL_WORDS[item.level]}</strong><span>level</span></div>
                {item.level === "low" && !running.has(item.key) && <Pill tone="danger">Flagged</Pill>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PhotoCheckButton({ orgId, hasPhotos, onChange }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  if (!hasPhotos) return null;
  const run = async () => {
    setBusy(true);
    setFailure(null);
    const answer = await runPhotoCheck(orgId);
    setBusy(false);
    if (answer.available === false) setFailure(answer.reason);
    else onChange();
  };
  return (
    <div className="admin-signal-actions">
      <button type="button" className="secondary-btn" disabled={busy} onClick={run}>{busy ? "Running…" : "Run again"}</button>
      {failure && <p className="admin-error" role="alert">{failure}</p>}
    </div>
  );
}

/** A trading-only license blocks approval until staff say why it may pass. */
function TradingReasonForm({ orgId, rules, onChange }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const trading = rules?.tradingOnly;
  if (!trading) return null;
  if (trading.explanation) return <p className="admin-signal-note">Staff reason: {trading.explanation.note}</p>;
  const save = async (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    setFailure(null);
    try { await explainTradingScope(orgId, note.trim()); onChange(); } catch (error) { setFailure(error.message); }
    setBusy(false);
  };
  return (
    <form className="admin-signal-form" onSubmit={save}>
      <label>
        Why may this company be approved as a factory?
        <textarea name="trading-reason" rows={3} value={note} onChange={(event) => setNote(event.target.value)} required />
      </label>
      <button type="submit" className="secondary-btn" disabled={busy || !note.trim()}>{busy ? "Saving…" : "Save reason"}</button>
      {failure && <p className="admin-error" role="alert">{failure}</p>}
    </form>
  );
}

/**
 * AUTO: the checks run by themselves when the factory uploads or submits
 * (api/verification-run.js). Opening the page runs, once, whatever has no
 * result yet: the license read, then the address, then the photos. Each row
 * says "Running…" meanwhile.
 */
function useAutoRun(orgId, extra, detail, onChange) {
  const tried = useRef(false);
  const [running, setRunning] = useState(() => new Set());
  const signals = extra?.signals ?? [];
  const reading = latest(signals, "document_reading");
  const latestFileId = extra?.registrationFiles?.[0]?.id ?? null;
  const currentNumber = detail?.registration?.number ?? null;
  const readCurrent = Boolean(reading && reading.subjectId === latestFileId && (reading.details?.numberAtReading === undefined || reading.details.numberAtReading === currentNumber));
  const addressDone = signals.some((signal) => signal.kind === "address" && signal.automatic);
  const photosDone = (extra?.checkResults ?? []).some((item) => item?.key === "photos");
  const hasPhotos = (extra?.photos ?? []).length > 0;
  useEffect(() => {
    if (tried.current || !extra || !detail) return;
    tried.current = true;
    const steps = [
      !readCurrent && latestFileId && { keys: ["license_read", "trading_scope"], run: () => requestRegistryAssist(orgId, "read_document") },
      !addressDone && { keys: ["address_owner", "address_site"], run: () => requestRegistryAssist(orgId, "address") },
      !photosDone && hasPhotos && { keys: ["photos"], run: () => runPhotoCheck(orgId) },
    ].filter(Boolean);
    if (!steps.length) return;
    setRunning(new Set(steps.flatMap((step) => step.keys)));
    (async () => {
      for (const step of steps) {
        // The address check reads the license's address, so the read goes first.
        const answer = await step.run().catch(() => null);
        setRunning((current) => new Set([...current].filter((key) => !step.keys.includes(key))));
        if (answer?.available !== false) onChange();
      }
    })();
  }, [extra, detail]); // eslint-disable-line react-hooks/exhaustive-deps
  return running;
}

export default function VerificationSignals({ orgId, detail, extra, registryBody, onChange }) {
  const [open, setOpen] = useState(null);
  const running = useAutoRun(orgId, extra, detail, onChange);
  if (!extra) return <p>Loading…</p>;
  const { results, overall } = computeLevels({ detail, extra, sourceLabel: registrySourceLabel });
  const openItem = results.find((item) => item.key === open);
  return (
    <div className="admin-signals">
      <ScoreRows results={results} overall={overall} onOpen={setOpen} running={running} />
      {openItem && (
        <LevelDetail
          item={openItem}
          label={CHECKS.find((check) => check.key === openItem.key)?.label ?? openItem.key}
          orgId={orgId}
          detail={detail}
          extra={extra}
          registryBody={registryBody}
          onChange={onChange}
          onClose={() => setOpen(null)}
        />
      )}
      <section className="admin-signal-block">
        <h3>Certificates</h3>
        {(extra.certificates ?? []).length ? extra.certificates.map((cert) => (
          <Certificate orgId={orgId} cert={cert} check={latest(signals(extra), "certificate", cert.id)} title={detail?.title} onChange={onChange} key={cert.id} />
        )) : <p>No certificates listed.</p>}
      </section>
    </div>
  );
}

function signals(extra) {
  return extra?.signals ?? [];
}
