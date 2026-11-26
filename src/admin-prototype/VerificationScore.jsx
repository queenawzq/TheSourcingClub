/**
 * Staff verification review, Nov 12 design (mock only).
 *
 * Replaces the two cards "Verification checks" (% complete) and "Official
 * registry" (High / Medium / Can't tell) with one card in one scoring system
 * (Queena, Nov 11). The card shows a score and a one-line verdict per row;
 * everything else lives in the row's modal: the checks behind the score, what
 * was read from the document as editable fields, the file itself, and one
 * action, Save changes.
 *
 * One component, two data sources. The prototype passes a mock profile and
 * the card keeps its edits in local state (`mockActions`). The live review
 * page passes `verification` read from the database and `actions` that write
 * to it; it then reads the score again and passes the new one. Every form
 * awaits its action and says what went wrong, and the card has its own
 * loading and failure states: the mock never has either.
 *
 * Nothing here falls back to mock data: a live file with no preview is
 * drawn as a file, never as the prototype's drawn licence.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  groupTip, groupWeight, RECORD_RESULTS, photoCaption, recordedCheck, scoreGroup, scoreOverall, standingFor, tierFor, weakestCheck, withPhotoCheck, withReason,
} from "./verification-scoring.js";
import { holderCompareName, holderDiffersFrom, overrideCheck, siteDifferences } from "../shared/verification-score.mjs";
import { companyNamesMatch, normaliseRegistrationNumber, sameRegistrationNumber } from "../shared/registration-number.mjs";
import { AddressDialog } from "./CompanyOverride.jsx";
import "./verification-score.css";

function useCountUp(value, duration = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (start === value || value == null || start == null) { setShown(value); return undefined; }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setShown(value); return undefined; }
    let frame;
    const began = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // A background tab pauses animation frames: the final figure lands anyway.
    const settle = window.setTimeout(() => setShown(value), duration + 150);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); };
  }, [value, duration]);
  return shown;
}

function Score({ value, size = "row" }) {
  const shown = useCountUp(value);
  if (value == null) return <span className={`vr-score vr-score-${size} vr-tier-none`}>—</span>;
  return <span className={`vr-score vr-score-${size} vr-tier-${tierFor(value)}`}>{shown}<small>%</small></span>;
}

function StandingPill({ score, groups = null }) {
  const standing = standingFor(score, groups);
  return <span className={`vr-standing vr-tier-${standing.tone}`}>{standing.word}</span>;
}

function InfoTip({ text, label }) {
  const id = useId();
  return (
    <span className="vr-info">
      <button
        type="button"
        className="vr-info-button"
        aria-label={`What ${label} checks`}
        aria-describedby={id}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 7.2v3.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="4.9" r="0.95" fill="currentColor" /></svg>
      </button>
      <span role="tooltip" id={id} className="vr-tip">{text}</span>
    </span>
  );
}

function Chevron() {
  return <svg className="vr-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/* ---------------------------------------------------------------- small */

function Spinner({ ink = false }) {
  return <span className={`vr-spinner${ink ? " vr-spinner-ink" : ""}`} aria-hidden="true" />;
}

/** One save at a time: busy while it runs, its error in words when it fails, and the form stays open. */
function useSave() {
  const [state, setState] = useState({ busy: false, error: "" });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const run = useCallback(async (work) => {
    setState({ busy: true, error: "" });
    try {
      const result = await work();
      if (alive.current) setState({ busy: false, error: "" });
      return { ok: true, result };
    } catch (error) {
      if (alive.current) setState({ busy: false, error: error?.message || "Couldn't save" });
      return { ok: false };
    }
  }, []);
  return [state, run];
}

function SaveError({ text }) {
  return text ? <p className="vr-save-error" role="alert">{text}</p> : null;
}

async function copyText(text) {
  try { await navigator.clipboard?.writeText(text); return true; } catch { return false; }
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={`vr-copy${copied ? " is-done" : ""}`}
      aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      title={copied ? "Copied" : "Copy"}
      onClick={async () => { await copyText(text); setCopied(true); }}
    >
      {copied
        ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.4 6.6 11.4 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.2" y="5.2" width="8" height="8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10.8 3.4V3a1.2 1.2 0 0 0-1.2-1.2H4a1.2 1.2 0 0 0-1.2 1.2v5.6A1.2 1.2 0 0 0 4 9.8h.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>}
    </button>
  );
}

/** A quiet text action that opens a source; a number it needs is copied on the way, as today's "Look up on QCC" does. */
function LookupAction({ lookup }) {
  return (
    <a
      className="vr-text-action"
      href={lookup.href}
      target="_blank"
      rel="noreferrer"
      onClick={() => { if (lookup.copy) copyText(lookup.copy); }}
    >
      {lookup.label}
      <svg className="vr-out" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5h5v5M9.3 2.7 3 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </a>
  );
}

/** Live "Search image": the window opens in the click, the short-lived link is minted, then loaded. */
function SearchImageAction({ onSearch }) {
  const [failed, setFailed] = useState(false);
  const open = async (event) => {
    event.preventDefault();
    const tab = window.open("about:blank", "_blank");
    const href = await Promise.resolve(onSearch()).catch(() => null);
    if (href && tab) { tab.opener = null; tab.location.href = href; }
    else { tab?.close(); setFailed(true); }
  };
  return (
    <a className="vr-text-action" href="https://lens.google.com/" target="_blank" rel="noreferrer" onClick={open}>
      {failed ? "Couldn't open the search" : "Search image"}
      <svg className="vr-out" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5h5v5M9.3 2.7 3 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </a>
  );
}

/** `shown` with the parts that differ from `other` marked: characters for a number, words for a name or address. */
/** A word as compared: no accents, no case, Turkish dotted İ as i, trailing dots dropped ("Mah." = "Mah"). */
const foldWord = (word) => String(word ?? "").replace(/İ/g, "I").replace(/ı/g, "i").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\.+$/, "");

/**
 * `shown` with the parts that differ from `other` marked: characters for a number, words for a name or address.
 * `parts`: when the address check already named the differing parts ("3栋"), only those are marked.
 */
function marked(shown, other, parts = null) {
  if (parts?.length) {
    const pieces = parts.filter((part) => part && shown.includes(part));
    if (pieces.length) {
      const pattern = new RegExp(`(${pieces.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
      return shown.split(pattern).map((piece, index) => (pieces.includes(piece) ? <mark key={index}>{piece}</mark> : piece));
    }
  }
  const isCode = !/\s/.test(shown) && !/\s/.test(other) && shown.length === other.length;
  if (isCode) return [...shown].map((char, index) => (char === other[index] ? char : <mark key={index}>{char}</mark>));
  // Text in another script than what it is compared with: nothing to compare word for word, so nothing is marked.
  if (parts && /[\p{Script=Han}]/u.test(shown) !== /[\p{Script=Han}]/u.test(other)) return shown;
  const words = new Set(other.split(/[\s,]+/).filter(Boolean).map(foldWord));
  // A street-type abbreviation ("Mah." for Mahallesi, "Cad.", "No.") is how an address is written, not a difference.
  const isAbbreviation = (part) => /^(mah|mh|cad|cd|sok|sk|blv|bulv|no|apt|rd|st|ave|bldg|av|r|tv|est)\.$/i.test(part);
  return shown.split(/([\s,]+)/).map((part, index) => (/^[\s,]*$/.test(part) || words.has(foldWord(part)) || isAbbreviation(part) ? part : <mark key={index}>{part}</mark>));
}

/* ------------------------------------------------------------------ card */

const byMe = "You, just now";

/**
 * The prototype's actions: each changes the card's own copy of the groups,
 * as the database would. Same signatures as the live ones, so the modal
 * cannot tell them apart.
 */
function mockActions(setGroups, groupsRef, entityType = null) {
  const change = (groupKey, update) => setGroups((current) => current.map((group) => (group.key === groupKey ? update(group) : group)));
  const changeCheck = (groupKey, next) => change(groupKey, (group) => ({
    ...group,
    // A registry check staff record becomes the group's verdict: the header must not keep saying "not checked" or "renamed".
    ...(next.key === "registry" && next.registry?.by === byMe ? { verdict: next.verdict, why: "" } : {}),
    // So does staff's own decision on what the company is: the heading must not keep the automatic "Not a factory".
    ...(next.key === "scope" && next.staff?.by === byMe ? { verdict: next.verdict, why: next.staff.note } : {}),
    checks: group.checks.map((item) => (item.key === next.key ? next : item)),
  }));
  return {
    recordCheck: async (groupKey, check, record) => changeCheck(groupKey, recordedCheck(check, record)),
    // Proof files stay in this browser: a link to the file itself.
    uploadProof: async (file) => {
      // The same rule as the live upload (uploadProofFile): a dropped file skips the picker's filter.
      if (!PROOF_ACCEPT.split(",").includes(file.type)) throw new Error("Use a screenshot (PNG, JPG, WebP) or a PDF");
      if (file.size > 20 * 1024 * 1024) throw new Error("Files up to 20 MB");
      const url = URL.createObjectURL(file);
      return { path: url, name: file.name, type: file.type, size: file.size, url };
    },
    removeProof: (path) => { try { URL.revokeObjectURL(path); } catch { /* not a blob link */ } },
    proofUrl: async (file) => file.url ?? null,
    saveReason: async (groupKey, check, text) => changeCheck(groupKey, withReason(check, text)),
    recordPhoto: async (groupKey, index, record) => change(groupKey, (group) => withPhotoCheck({
      ...group,
      evidence: { ...group.evidence, photos: group.evidence.photos.map((photo, at) => (at === index ? { ...photo, ...record, flag: null, by: byMe } : photo)) },
    })),
    explainField: async (groupKey, field, text) => change(groupKey, (group) => ({
      ...group,
      fields: group.fields.map((item) => (item.key === field.key ? { ...item, duplicate: { ...item.duplicate, explained: { text, by: byMe } } } : item)),
    })),
    // A check decided by staff: scored as the live page scores it (overrideCheck).
    recordOverride: async (groupKey, check, { result, note }) => changeCheck(groupKey, overrideCheck(check, { result, note, by: byMe }, { vendorKind: entityType === "Trading company" ? "trading_company" : null })),
    // Edit address: the typed line changes; the address check is not run again in the prototype.
    saveAddress: async (address) => setGroups((current) => current.map((group) => ({
      ...group,
      checks: group.checks.map((check) => (!check.edit ? check : {
        ...check,
        edit: { ...check.edit, value: address },
        lines: [{ key: "typed", label: "Typed", value: address }, ...(check.lines ?? []).filter((line) => line.key !== "typed")],
      })),
    }))),
    runAgain: (groupKey, values) => new Promise((resolve) => {
      window.setTimeout(() => {
        const group = groupsRef.current.find((item) => item.key === groupKey);
        const outcome = group?.rerun?.(values, group) ?? null;
        if (outcome?.error) { resolve({ error: outcome.error }); return; }
        const { values: read = {}, error, ...patch } = outcome ?? {};
        const nextValues = { ...values, ...read };
        change(groupKey, (current) => withPhotoCheck({
          ...current,
          ...patch,
          fields: current.fields.map((field) => ({ ...field, value: nextValues[field.key] })),
          stale: null,
          readAt: "Read just now",
          rerun: outcome ? null : current.rerun,
        }));
        resolve({});
      }, 1200);
    }),
  };
}

function CardSkeleton() {
  return (
    <>
      <div className="vr-overall" aria-hidden="true">
        <div className="vr-overall-figure"><span className="vr-skel vr-skel-hero" /></div>
        <p className="vr-overall-line"><span className="vr-skel vr-skel-line" /></p>
      </div>
      <div className="vr-rows" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div className="vr-row is-loading" key={index}>
            <div className="vr-row-copy"><span className="vr-skel vr-skel-title" /><span className="vr-skel vr-skel-verdict" /></div>
            <div className="vr-row-score"><span className="vr-skel vr-skel-score" /></div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * `profile` (the prototype) or `verification` (live). Live also passes
 * `actions`, `loading`, `error`, `onRetry` and `fileUrl` (a signed link for a
 * stored file).
 */
export function VerificationScoreCard({ profile, verification: given, actions: liveActions = null, loading = false, error = null, onRetry, fileUrl }) {
  const verification = given ?? profile?.verification ?? null;
  const [localGroups, setLocalGroups] = useState(() => verification?.groups ?? []);
  const localRef = useRef(localGroups);
  localRef.current = localGroups;
  const groups = (liveActions ? verification?.groups : localGroups) ?? [];
  const actions = useMemo(() => liveActions ?? mockActions(setLocalGroups, localRef, profile?.entityType ?? null), [liveActions, profile?.entityType]);
  const [openKey, setOpenKey] = useState(() => new URLSearchParams(window.location.search).get("check"));
  // Automatic checks still running when the page opens (the mock's timers, or the database saying so);
  // Run again adds its group while it runs.
  const [checking, setChecking] = useState(() => new Set((verification?.groups ?? []).filter((group) => group.checkingMs).map((group) => group.key)));
  const setGroupChecking = useCallback((key, on) => setChecking((current) => {
    const next = new Set(current);
    if (on) next.add(key); else next.delete(key);
    return next;
  }), []);
  useEffect(() => {
    const timers = (verification?.groups ?? [])
      .filter((group) => group.checkingMs)
      .map((group) => window.setTimeout(() => setGroupChecking(group.key, false), group.checkingMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // The mock's timers start once, when the profile opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isChecking = (group) => checking.has(group.key) || Boolean(group.checking);
  const ready = groups.filter((group) => !isChecking(group) && !group.error);
  // Only a counted group holds the overall back: certification is shown, not counted.
  const anyPending = groups.some((group) => groupWeight(group) && (isChecking(group) || group.error));
  const overall = groups.length ? scoreOverall(groups) : null;
  const weakest = weakestCheck(ready);
  const open = groups.find((group) => group.key === openKey) ?? null;
  const closeModal = useCallback(() => setOpenKey(null), []);
  const runningChange = useCallback((on) => openKey && setGroupChecking(openKey, on), [openKey, setGroupChecking]);

  const head = (
    <header className="vr-card-head">
      <h2 id="vr-card-title">Verification score</h2>
      {verification && error && (
        <p className="vr-card-alert" role="alert">Couldn't refresh <button className="vr-text-action" type="button" onClick={onRetry}>Try again</button></p>
      )}
    </header>
  );

  if (!verification) {
    return (
      <section className="factory-dashboard-panel admin-panel vr-card" aria-labelledby="vr-card-title" aria-busy={loading || undefined}>
        {head}
        {error && !loading ? (
          <div className="vr-card-state" role="alert">
            <p>Couldn't load the score</p>
            {onRetry && <button className="secondary-btn compact-btn" type="button" onClick={onRetry}>Try again</button>}
          </div>
        ) : <CardSkeleton />}
      </section>
    );
  }

  return (
    <section className="factory-dashboard-panel admin-panel vr-card" aria-labelledby="vr-card-title" aria-busy={loading || undefined}>
      {head}

      <div className="vr-overall">
        <div className="vr-overall-figure">
          <Score value={anyPending && overall != null ? null : overall} size="hero" />
          {anyPending ? <span className="vr-standing vr-tier-none">{groups.some((group) => groupWeight(group) && isChecking(group)) ? "Checking…" : "Not scored"}</span> : <StandingPill score={overall} groups={groups} />}
        </div>
        <p className="vr-overall-line">
          {/* "Factory: …" / "Not a factory: …" names its check already, so it stands alone. */}
          {weakest ? <><span>Weakest:</span> {/^((Not a )?[Ff]actory|Trading company):/.test(weakest.verdict) ? weakest.verdict : <>{weakest.label}, {weakest.verdict.charAt(0).toLowerCase()}{weakest.verdict.slice(1)}</>}</> : null}
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="vr-card-state"><p>Nothing to score yet</p></div>
      ) : (
        <div className="vr-rows">
          {groups.map((group) => {
            const busy = isChecking(group);
            const failed = !busy && group.error;
            const score = busy || failed ? null : scoreGroup(group);
            const counts = Boolean(groupWeight(group));
            return (
              <article
                className={`vr-row${counts ? "" : " vr-row-uncounted"}${busy ? " is-checking" : ""}`}
                role="button"
                tabIndex={0}
                aria-busy={busy || undefined}
                aria-label={`${group.label}, ${busy ? "checking" : failed ? group.error : score == null ? "no score" : `${score}%`}: open details`}
                onClick={() => setOpenKey(group.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpenKey(group.key); }
                }}
                key={group.key}
              >
                <div className="vr-row-copy">
                  <span className="vr-row-title">{group.label}{groupTip(group) && <InfoTip text={groupTip(group)} label={group.label} />}</span>
                  {busy
                    ? <span className="vr-row-verdict vr-row-checking"><Spinner ink />{group.checkingWords ?? "Checking…"}</span>
                    : failed
                      ? <span className="vr-row-verdict vr-tier-low"><i aria-hidden="true" />{group.error}</span>
                      : <span className={`vr-row-verdict vr-tier-${tierFor(score)}`}><i aria-hidden="true" />{group.verdict || "Nothing submitted"}</span>}
                </div>
                <div className="vr-row-score">
                  {busy ? null : <StandingPill score={score} />}
                </div>
                <Chevron />
              </article>
            );
          })}
        </div>
      )}

      {open && (
        <VerificationModal
          group={open}
          groups={groups}
          actions={actions}
          fileUrl={fileUrl}
          onRunning={runningChange}
          onClose={closeModal}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------ sub-checks */

function ReasonForm({ initial = "", label = "Reason", saveLabel = "Save reason", onSave, onDone }) {
  const [text, setText] = useState(initial);
  const [save, run] = useSave();
  const id = useId();
  const submit = async (event) => {
    event.preventDefault();
    if (!text.trim() || save.busy) return;
    const { ok } = await run(() => onSave(text.trim()));
    if (ok) onDone();
  };
  return (
    <form className="vr-record" onSubmit={submit}>
      <div className="vr-field">
        <label htmlFor={id}>{label}</label>
        <textarea id={id} rows={2} value={text} autoFocus onChange={(event) => setText(event.target.value)} />
      </div>
      <SaveError text={save.error} />
      <div className="vr-record-actions">
        <button className="secondary-btn compact-btn" type="button" onClick={onDone}>Cancel</button>
        <button className="primary-btn compact-btn" type="submit" disabled={!text.trim() || save.busy}>{save.busy ? "Saving…" : saveLabel}</button>
      </div>
    </form>
  );
}

function Segmented({ options, value, onChange, name, label }) {
  return (
    <div className={`vr-segmented is-${options.length}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label className={value === option.key ? "is-on" : ""} key={option.key}>
          <input type="radio" name={name} value={option.key} checked={value === option.key} onChange={() => onChange(option.key)} />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/** A proof file: opens in a new tab (a signed link, minted on click, live). */
function ProofChip({ file, onOpen, onRemove }) {
  const [failed, setFailed] = useState(false);
  const open = async (event) => {
    event.preventDefault();
    const tab = window.open("about:blank", "_blank");
    const href = file.url ?? await Promise.resolve(onOpen?.(file)).catch(() => null);
    if (href && tab) { tab.opener = null; tab.location.href = href; }
    else { tab?.close(); setFailed(true); }
  };
  return (
    <span className="vr-proof-chip">
      <a href={file.url ?? "#"} onClick={open} title={failed ? "Couldn't open the file" : file.name}>{file.name}</a>
      {onRemove && (
        <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </span>
  );
}

const PROOF_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

const fileKind = (file) => (isPdf({ name: file.name, mimeType: file.type }) ? "PDF"
  : (String(file.name ?? "").match(/\.([a-z0-9]{2,4})$/i)?.[1] ?? String(file.type ?? "").split("/")[1] ?? "File").toUpperCase());

const sizeWords = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** A proof file in the record form, as the product's upload rows draw one: opens on click, removed with ×. */
function ProofRow({ file, onOpen, onRemove }) {
  const [failed, setFailed] = useState(false);
  const open = async (event) => {
    event.preventDefault();
    const tab = window.open("about:blank", "_blank");
    const href = file.url ?? await Promise.resolve(onOpen?.(file)).catch(() => null);
    if (href && tab) { tab.opener = null; tab.location.href = href; }
    else { tab?.close(); setFailed(true); }
  };
  const image = isImage({ name: file.name, mimeType: file.type }) && file.url;
  return (
    <div className="vr-file-row">
      {image ? <img src={file.url} alt="" /> : <span className="vr-file-kind">{fileKind(file)}</span>}
      <div>
        <a href={file.url ?? "#"} onClick={open} title={file.name}>{file.name}</a>
        {failed ? <span className="is-error">Couldn't open the file</span> : file.size != null && <span>{sizeWords(file.size)}</span>}
      </div>
      <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
}

// A prefilled value is selected on focus, so what is typed replaces it rather than joining its end.
const selectAll = (event) => event.target.select();

const SAME_INPUT_WORDS = { name: "Name in the registry", number: "Number in the registry", address: "Address in the registry" };

/** A registration number as it is saved: the country's rule, a typed prefix ("NIF 519211596") dropped. */
const savedNumber = (country, value) => normaliseRegistrationNumber(country, String(value ?? "").trim());

/** An address as compared: case, spacing and punctuation aside. */
const plainAddress = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** A value typed as the registry shows it that is the company's own after all: saved as Same. */
function sameAsProfile(key, typed, profileValue, country) {
  if (!String(profileValue ?? "").trim() || !String(typed ?? "").trim()) return false;
  if (key === "number") return sameRegistrationNumber(country, savedNumber(country, typed), profileValue);
  // Names only ever compare through companyNamesMatch, the rule the checks use.
  if (key === "name") return companyNamesMatch(typed, profileValue);
  return plainAddress(typed) === plainAddress(profileValue);
}

const SEEN_FIELDS = {
  registry: [["name", "Company name"], ["number", "Registration number"], ["address", "Address", true]],
  certificate: [["number", "Certificate number"], ["holder", "Holder"]],
};

/**
 * The one record form (Nov 24): where staff checked, what it showed, the values as the site shows them
 * (prefilled from the document), proof files and a link or note. The page compares the values itself.
 */
function RecordForm({ check, onSave, onDone, actions }) {
  const registry = check.registry;
  const isCert = check.kind === "certificate";
  const form = registry.form ?? { sites: [], defaultSite: registry.source ?? "", prefill: {}, profile: {} };
  const country = form.profile?.country ?? null;
  const ids = { site: useId(), list: useId(), note: useId(), link: useId(), files: useId() };
  const savedByPerson = registry.result && registry.by && registry.by !== "Checked automatically" && !registry.for;
  const earlier = savedByPerson && registry.version === 2 ? registry : null;
  // An earlier record's site; never the generic "Issuer's list" of a record made before the form.
  const [site, setSite] = useState(earlier?.site || (savedByPerson && !isCert ? registry.source : "") || form.defaultSite || "");
  // A first record starts with nothing chosen: staff pick what the site showed (Nov 24 tester).
  const initialResult = savedByPerson ? (registry.result === "name_differs" ? "found" : registry.result) : null;
  const [result, setResult] = useState(initialResult);
  const fieldsFor = SEEN_FIELDS[isCert ? "certificate" : "registry"];
  const [seen, setSeen] = useState(() => Object.fromEntries(fieldsFor.map(([key]) => [key, String((earlier && earlier[key]) || (savedByPerson && key === "name" ? registry.name : "") || form.prefill?.[key] || "")])));
  // One note per outcome (fix round, Nov 24): a note written for Not found never rides along into Found.
  const [notes, setNotes] = useState(() => (initialResult ? { [initialResult]: earlier?.note ?? registry.reason ?? "" } : {}));
  const note = (result && notes[result]) || "";
  const setNote = (text) => setNotes((current) => ({ ...current, [result]: text }));
  // Only a person's own earlier link; never an automatic answer's reference (a VAT id is not a link).
  const [link, setLink] = useState(savedByPerson ? registry.reference ?? "" : "");
  // Proof files belong to their outcome too (fix round 2): a Found record's screenshots never ride into Couldn't check.
  // Files added before an outcome is chosen go with the first one chosen.
  const [proofs, setProofs] = useState(() => ({ [initialResult ?? ""]: earlier?.proof ?? [] }));
  const proof = proofs[result ?? ""] ?? [];
  const setProof = (update) => {
    const bucket = result ?? "";
    setProofs((current) => ({ ...current, [bucket]: update(current[bucket] ?? []) }));
  };
  const chooseResult = (next) => {
    if (result == null) setProofs((current) => (current[""]?.length && !current[next]?.length ? { ...current, [next]: current[""], "": [] } : current));
    setResult(next);
  };
  // Found (Nov 26): each of the company's values is the same in the registry, or different and typed as the registry shows it.
  // Editing an earlier record opens on what it said: the company's own value as Same, another as Different with it typed.
  const earlierSeen = (key) => String((earlier && earlier[key]) || (savedByPerson && key === "name" ? registry.name : "") || "").trim();
  const [same, setSame] = useState(() => (isCert ? {} : Object.fromEntries(fieldsFor.map(([key]) => [key, earlierSeen(key)])
    .filter(([key, value]) => value && String(form.profile?.[key] ?? "").trim())
    .map(([key, value]) => [key, sameAsProfile(key, value, form.profile[key], country) || value === String(form.profile[key]).trim() ? "same" : "different"]))));
  const [registryValue, setRegistryValue] = useState(() => (isCert ? {} : Object.fromEntries(fieldsFor.map(([key]) => [key, earlierSeen(key)])
    .filter(([key, value]) => value && !(String(form.profile?.[key] ?? "").trim() && (sameAsProfile(key, value, form.profile[key], country) || value === String(form.profile[key]).trim()))))));
  // The company gave no value: the registry's is typed straight in. A "Different" value that is the company's own is saved as Same.
  const hasProfile = (key) => Boolean(String(form.profile?.[key] ?? "").trim());
  const answerFor = (key) => {
    if (!hasProfile(key)) return String(registryValue[key] ?? "").trim() ? "different" : null;
    if (same[key] === "different" && sameAsProfile(key, registryValue[key], form.profile?.[key], country)) return "same";
    return same[key] ?? null;
  };
  const [added] = useState(() => new Set());
  const [upload, setUpload] = useState({ busy: 0, error: "" });
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef(null);
  const [save, run] = useSave();
  const known = form.sites?.find((item) => item.name.toLowerCase() === site.trim().toLowerCase()) ?? null;
  const showsSeen = result === "found";
  const needsNote = result === "not_found" || result === "could_not_check";
  // A note is optional on Found and Expired, required on Not found and Couldn't check.
  const showsNote = Boolean(result);
  const differs = isCert ? { holder: holderDiffersFrom(seen.holder, form.holderNames) } : siteDifferences(seen, form.profile);
  const ready = site.trim() && result && (!needsNote || note.trim()) && !upload.busy;

  const addFiles = async (list) => {
    const files = [...(list ?? [])];
    if (!files.length) return;
    setUpload((current) => ({ busy: current.busy + files.length, error: "" }));
    for (const file of files) {
      try {
        const saved = await actions.uploadProof(file);
        added.add(saved.path);
        // The size is the chosen file's: the row says how big it is.
        setProof((current) => [...current, { size: file.size, ...saved, type: saved.type || file.type }]);
      } catch (error) {
        setUpload((current) => ({ ...current, error: error?.message || "Couldn't upload the file" }));
      } finally {
        setUpload((current) => ({ ...current, busy: current.busy - 1 }));
      }
    }
  };
  const removeFile = (file) => {
    setProof((current) => current.filter((item) => item.path !== file.path));
    // Only a file added in this form goes for good; a saved one stays with the earlier record.
    if (added.has(file.path)) actions.removeProof?.(file.path);
  };
  const cancel = () => {
    added.forEach((path) => actions.removeProof?.(path));
    onDone();
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!ready || save.busy) return;
    const { ok } = await run(() => onSave({
      site: site.trim(),
      siteKey: known?.key ?? "site",
      result,
      // An address left as prefilled was never read off the registry: it is not recorded, so it claims no match
      // and flags no difference later (Nov 25 tester). Name and number keep their prefill: staff compare those.
      seen: !showsSeen ? {} : isCert ? Object.fromEntries(Object.entries(seen).map(([key, value]) => [key, value.trim()]))
        : Object.fromEntries(fieldsFor.filter(([key]) => answerFor(key)).map(([key]) => [key, answerFor(key) === "same"
          ? String(form.profile?.[key] ?? "") : key === "number" ? savedNumber(country, registryValue[key]) : String(registryValue[key] ?? "").trim()])),
      note: note.trim(),
      link: link.trim(),
      proof,
    }));
    if (!ok) return;
    // Files added under another outcome and not saved with this one go for good.
    added.forEach((path) => { if (!proof.some((file) => file.path === path)) actions.removeProof?.(path); });
    onDone();
  };

  return (
    <form className="vr-record" onSubmit={submit}>
      <div className="vr-field">
        <label htmlFor={ids.site}>Where you checked</label>
        <div className="vr-input has-open">
          <input id={ids.site} list={ids.list} value={site} spellCheck={false} placeholder={isCert ? "Issuer's site" : "Registry or directory site"} onFocus={selectAll} onChange={(event) => setSite(event.target.value)} />
          {known?.href && <LookupAction lookup={{ label: "Open", href: known.href }} />}
        </div>
        {form.sites?.length > 0 && <datalist id={ids.list}>{form.sites.map((item) => <option value={item.name} key={item.key}>{item.label}</option>)}</datalist>}
      </div>
      <Segmented
        options={RECORD_RESULTS[isCert ? "certificate" : "registry"]}
        value={result}
        onChange={chooseResult}
        name={`record-${check.key}`}
        label="What it showed"
      />
      {showsSeen && isCert && fieldsFor.map(([key, label, multiline]) => {
        const Control = multiline ? "textarea" : "input";
        const other = holderCompareName(seen[key], form.holderNames);
        return (
          <div className={`vr-field${differs[key] ? " is-differs" : ""}`} key={key}>
            <label htmlFor={`${ids.site}-${key}`}>{label}</label>
            <Control id={`${ids.site}-${key}`} rows={multiline ? 2 : undefined} value={seen[key]} spellCheck={false} onChange={(event) => setSeen((current) => ({ ...current, [key]: event.target.value }))} />
            {differs[key] && <p className="vr-compare is-typed"><span>Profile:</span> {marked(other, seen[key])}</p>}
          </div>
        );
      })}
      {showsSeen && !isCert && fieldsFor.map(([key, label, multiline]) => {
        const Control = multiline ? "textarea" : "input";
        const typed = registryValue[key] ?? "";
        const savedAs = key === "number" ? savedNumber(country, typed) : "";
        return (
          !hasProfile(key) ? (
            <div className="vr-field vr-same-input" key={key}>
              <label htmlFor={`${ids.site}-${key}`}>{SAME_INPUT_WORDS[key]}</label>
              <Control id={`${ids.site}-${key}`} rows={multiline ? 2 : undefined} value={typed} spellCheck={false} onChange={(event) => setRegistryValue((current) => ({ ...current, [key]: event.target.value }))} />
              {savedAs && savedAs !== typed.trim() && <small className="vr-field-by">Saved as {savedAs}</small>}
            </div>
          ) : (
          <div className="vr-field vr-same-row" key={key}>
            <span className="vr-field-label">{label}</span>
            <div className="vr-same-line">
              <span className="vr-same-value">{form.profile?.[key] || "Not given"}</span>
              <div className="vr-same">
                <Segmented
                  options={[{ key: "same", label: "Same in registry" }, { key: "different", label: "Different" }]}
                  value={same[key] ?? null}
                  onChange={(next) => setSame((current) => ({ ...current, [key]: next }))}
                  name={`same-${ids.site}-${key}`}
                  label={`${label} in the registry`}
                />
              </div>
            </div>
            {same[key] === "different" && (
              <div className="vr-field vr-same-input">
                <label htmlFor={`${ids.site}-${key}`}>{SAME_INPUT_WORDS[key]}</label>
                <Control id={`${ids.site}-${key}`} rows={multiline ? 2 : undefined} value={typed} spellCheck={false} autoFocus onChange={(event) => setRegistryValue((current) => ({ ...current, [key]: event.target.value }))} />
                {sameAsProfile(key, typed, form.profile?.[key], country)
                  ? <small className="vr-field-by">Same as the profile ({form.profile[key]})</small>
                  : savedAs && savedAs !== typed.trim() && <small className="vr-field-by">Saved as {savedAs}</small>}
              </div>
            )}
          </div>
          )
        );
      })}
      {showsNote && (
        <div className="vr-field">
          <label htmlFor={ids.note}>{needsNote ? "Note" : "Note (optional)"}</label>
          <textarea id={ids.note} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
      )}
      <div className="vr-field">
        <span className="vr-field-label" id={ids.files}>Proof</span>
        {proof.length > 0 && (
          <div className="vr-file-list" aria-labelledby={ids.files}>
            {proof.map((file) => <ProofRow file={file} onOpen={actions.proofUrl} onRemove={removeFile} key={file.path} />)}
          </div>
        )}
        {/* The product's upload box (the factory's update dialog): drop files on it, or click to choose. */}
        <label
          className={`vr-dropzone${dragging ? " is-dragging" : ""}${upload.busy ? " is-busy" : ""}`}
          tabIndex={0}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pickerRef.current?.click(); } }}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
        >
          <strong>{upload.busy ? <><Spinner ink />Uploading…</> : proof.length ? "+ Add more files" : "+ Upload screenshots or PDFs"}</strong>
          <span>Drag and drop or click to choose · PNG, JPG or PDF</span>
          <input ref={pickerRef} type="file" multiple hidden accept={PROOF_ACCEPT} onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
        </label>
        {upload.error && <p className="vr-save-error" role="alert">{upload.error}</p>}
      </div>
      <div className="vr-field">
        <label htmlFor={ids.link}>Link (optional)</label>
        <input id={ids.link} value={link} spellCheck={false} onFocus={selectAll} onChange={(event) => setLink(event.target.value)} />
      </div>
      <SaveError text={save.error} />
      <div className="vr-record-actions">
        <button className="secondary-btn compact-btn" type="button" onClick={cancel}>Cancel</button>
        <button className="primary-btn compact-btn" type="submit" disabled={!ready || save.busy}>{save.busy ? "Saving…" : "Save check"}</button>
      </div>
    </form>
  );
}

// The checks staff can decide themselves (Nov 25). The address: the whole check, not only whose address it is
// (a home or an office at the right address is a problem too). Factory or trader: what the company is.
const OVERRIDE_RESULTS = {
  address: [{ key: "confirmed", label: "Confirmed" }, { key: "problem", label: "Problem found" }, { key: "could_not_check", label: "Couldn't check" }],
  scope: [{ key: "factory", label: "Factory" }, { key: "trading_company", label: "Trading company" }, { key: "could_not_tell", label: "Couldn't tell" }],
  licence: [{ key: "original", label: "Original" }, { key: "problem", label: "Problem found" }, { key: "could_not_check", label: "Couldn't check" }],
};

/** A check decided by staff: one of its results, and what they saw. */
function OverrideForm({ check, onSave, onDone }) {
  const [result, setResult] = useState(check.staff?.result ?? null);
  const [note, setNote] = useState(check.staff?.note ?? "");
  const [save, run] = useSave();
  const id = useId();
  const ready = Boolean(result && note.trim());
  const submit = async (event) => {
    event.preventDefault();
    if (!ready || save.busy) return;
    const { ok } = await run(() => onSave({ result, note: note.trim() }));
    if (ok) onDone();
  };
  return (
    <form className="vr-record" onSubmit={submit}>
      <Segmented options={OVERRIDE_RESULTS[check.key]} value={result} onChange={setResult} name={`override-${id}`} label="What you found" />
      <div className="vr-field">
        <label htmlFor={id}>Note</label>
        <textarea id={id} rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      <SaveError text={save.error} />
      <div className="vr-record-actions">
        <button className="secondary-btn compact-btn" type="button" onClick={onDone}>Cancel</button>
        <button className="primary-btn compact-btn" type="submit" disabled={!ready || save.busy}>{save.busy ? "Saving…" : "Save check"}</button>
      </div>
    </form>
  );
}

// The address's versions, in plain words (Nov 26): whose address each line is.
const ADDRESS_LINE_WORDS = { typed: "Company", licence: "Licence", registry: "Registry" };

function SubCheck({ check, groupKey, legalName, canReason: canReasonGiven, actions, numberShown = false, dupField = null, onExplainDup = null, typedFields = [], onExplainTyped = null }) {
  const [explainingTyped, setExplainingTyped] = useState(null);
  const [mode, setMode] = useState(null);
  // One row per check (Nov 26): a check that needs a look starts open, and so does a registration number
  // another company uses until it is explained; Strong and Not checked start closed.
  const [expanded, setExpanded] = useState(() => ["low", "potential"].includes(standingFor(check.score).tone)
    || Boolean(dupField?.duplicate && !dupField.duplicate.explained));
  const [explainingDup, setExplainingDup] = useState(false);
  const registry = check.registry;
  // An automatic check has no form unless the data says a person's record is still needed (live: approval).
  const canRecord = Boolean(registry) && (registry.recordable ?? registry.by !== "Checked automatically");
  const close = () => setMode(null);
  const canEditAddress = Boolean(check.edit && actions.saveAddress);
  // Staff decide the address, factory-or-trader and licence checks themselves (Nov 25).
  const canOverride = Boolean(OVERRIDE_RESULTS[check.key] && actions.recordOverride && check.canOverride !== false);
  // A check staff record by hand has its own note: no separate reason (Nov 25).
  const canReason = canReasonGiven && !canOverride && !canRecord;
  const dup = dupField?.duplicate ?? null;
  // The row's one line: a saved record's summary says it all (Nov 24); a renamed company keeps its verdict.
  const line = registry?.summary && !registry.for ? registry.summary : check.verdict;
  // A row with nothing more to show (a brand's details, its terms) is a plain line: nothing opens.
  const hasBody = Boolean(check.lookup || registry?.for || (!registry?.summary && registry?.by) || (check.sharedNumber && !numberShown)
    || typedFields.length > 0 || check.staff || check.blocks || registry?.proof?.length || check.lines?.length || dup || check.reason
    || canRecord || canOverride || canEditAddress || canReason || (check.duplicate && !numberShown && actions.explainField));
  const open = hasBody && (expanded || Boolean(mode));
  const toggle = () => { if (!mode && hasBody) setExpanded(!open); };
  return (
    <li className={`vr-sub vr-sub-row${open ? " is-expanded" : ""}${mode && mode !== "address" ? " is-open" : ""}`}>
      <div
        className={`vr-sub-line vr-sub-toggle${hasBody ? "" : " is-static"}`}
        role={hasBody ? "button" : undefined}
        tabIndex={hasBody ? 0 : undefined}
        aria-expanded={hasBody ? open : undefined}
        onClick={toggle}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } }}
      >
        <div className="vr-sub-copy">
          <strong>{check.label}</strong>
          <span>{line}</span>
        </div>
        <div className="vr-sub-score">
          <StandingPill score={check.score} />
        </div>
        {hasBody ? <Chevron /> : <span aria-hidden="true" />}
      </div>
      {open && (
        <div className="vr-sub-body">
          {/* The form has its own "Where you checked … Open": the row's link waits while it is open (Nov 26). */}
          {check.lookup && mode !== "record" && <div className="vr-sub-actions"><LookupAction lookup={check.lookup} /></div>}
          {(registry?.for || (!registry?.summary && registry?.by) || (check.sharedNumber && !numberShown) || check.staff?.by || check.blocks || (registry?.proof?.length > 0 && !mode)) && (
            <div className="vr-sub-copy">
              {registry?.summary && registry.for && <small className="vr-sub-summary">{registry.summary}, for “{registry.for}”</small>}
              {!registry?.summary && registry?.by && <small>{registry.source} · {registry.by}{registry.for ? `, for “${registry.for}”` : ""}</small>}
              {check.sharedNumber && !numberShown && <small>Same registration number as {check.sharedNumber.with}</small>}
              {registry?.proof?.length > 0 && !mode && (
                <div className="vr-proof">{registry.proof.map((file) => <ProofChip file={file} onOpen={actions.proofUrl} key={file.path} />)}</div>
              )}
              {check.staff?.by && <small>Checked by staff · {check.staff.by}</small>}
              {check.blocks && <small className="vr-sub-blocks">{check.blocks}</small>}
            </div>
          )}
          {check.lines?.length > 0 && (
            // The address, each version on its own line (Nov 25); Edit address sits with the company's own (Nov 26).
            <div className="vr-sub-lines">
              {check.lines.map((entry) => (
                <p className="vr-compare" key={entry.key}>
                  <span>{ADDRESS_LINE_WORDS[entry.key] ?? entry.label}:</span> {entry.value}
                  {entry.key === "typed" && canEditAddress && !mode && (
                    <button className="vr-text-action is-inline vr-line-action" type="button" onClick={() => setMode("address")}>Edit address</button>
                  )}
                </p>
              ))}
            </div>
          )}
          {/* The licence against what the company typed (was the Typed: line under the reading). */}
          {typedFields.map((field) => (
            <div className="vr-sub-lines" key={`typed-${field.key}`}>
              <p className="vr-compare"><span>Company:</span> {field.typed}</p>
              <p className="vr-compare"><span>Licence:</span> {field.value}
                {field.explainTyped && onExplainTyped && explainingTyped !== field.key && !mode && (
                  <button className="vr-text-action is-inline vr-line-action" type="button" onClick={() => setExplainingTyped(field.key)}>Explain</button>
                )}
              </p>
              {explainingTyped === field.key && (
                <ReasonForm label={field.explainTyped} saveLabel="Save" onSave={(text) => onExplainTyped(field, text)} onDone={() => setExplainingTyped(null)} />
              )}
            </div>
          ))}
          {/* The shared registration number (Nov 26): said once, in the registry row. */}
          {dup && !dup.explained && !explainingDup && (
            <p className="vr-compare is-dup">
              <span>Same number as</span> <strong>{dup.with}</strong>
              {onExplainDup && <button className="vr-text-action" type="button" onClick={() => setExplainingDup(true)}>Explain</button>}
            </p>
          )}
          {dup && explainingDup && (
            <ReasonForm label={`Why ${dup.with} has the same number`} saveLabel="Save" initial={dup.explained?.text} onSave={onExplainDup} onDone={() => setExplainingDup(false)} />
          )}
          {dup?.explained && !explainingDup && (
            <p className="vr-sub-note">
              <span>Same number as {dup.with}: {dup.explained.text}</span>
              <small>{dup.explained.by}{onExplainDup && <> · <button className="vr-text-action is-quiet is-inline" type="button" onClick={() => setExplainingDup(true)}>Edit</button></>}</small>
            </p>
          )}
          {check.staff?.note && mode !== "override" && <p className="vr-sub-note"><span>{check.staff.note}</span></p>}
          {check.sharedNumber?.explained && !numberShown && mode !== "shared" && (
            <p className="vr-sub-note"><span>{check.sharedNumber.explained.text}</span><small>{check.sharedNumber.explained.by}</small></p>
          )}
          {check.reason && mode !== "reason" && (
            <p className={`vr-sub-note${check.reason.earlier ? " is-earlier" : ""}`}>
              <span>{check.reason.text}</span>
              <small>{[check.reason.by, check.reason.earlier && check.reason.for ? `for: ${check.reason.for}` : ""].filter(Boolean).join(" · ")}</small>
            </p>
          )}
          {!mode && (canRecord || canReason || (check.duplicate && !numberShown && actions.explainField) || canOverride || (canEditAddress && !check.lines?.some((entry) => entry.key === "typed"))) && (
            <div className="vr-sub-actions">
              {canRecord && (
                <button className="vr-text-action" type="button" onClick={() => setMode("record")}>
                  {registry.result && registry.by && registry.by !== "Checked automatically" ? "Edit" : "Record check"}
                </button>
              )}
              {canOverride && <button className="vr-text-action" type="button" onClick={() => setMode("override")}>{check.staff ? "Edit check" : "Record check"}</button>}
              {canEditAddress && !check.lines?.some((entry) => entry.key === "typed") && <button className="vr-text-action" type="button" onClick={() => setMode("address")}>Edit address</button>}
              {check.duplicate && !numberShown && actions.explainField && (
                <button className="vr-text-action" type="button" onClick={() => setMode("shared")}>Explain shared number</button>
              )}
              {canReason && (
                <button className="vr-text-action is-quiet" type="button" onClick={() => setMode("reason")}>
                  {check.reason && !check.reason.earlier ? "Edit reason" : "Add reason"}
                </button>
              )}
            </div>
          )}
          {mode === "override" && <OverrideForm check={check} onSave={(record) => actions.recordOverride(groupKey, check, record)} onDone={close} />}
          {mode === "address" && (
            <AddressDialog label={check.edit.label} address={check.edit.value} onSave={actions.saveAddress} onClose={close} />
          )}
          {mode === "record" && <RecordForm check={check} actions={actions} onSave={(record) => actions.recordCheck(groupKey, check, record)} onDone={close} />}
          {mode === "shared" && (
            <ReasonForm label={`Why ${check.duplicate.with} has the same number`} saveLabel="Save" onSave={(text) => actions.explainField(groupKey, { key: "number" }, text)} onDone={close} />
          )}
          {mode === "reason" && (
            <ReasonForm initial={check.reason?.earlier ? "" : check.reason?.text} onSave={(text) => actions.saveReason(groupKey, check, text)} onDone={close} />
          )}
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- fields */

/** Read from this document (Nov 26): the value as read; the checks on the left say whether it matches. */
function ReadValue({ field, value }) {
  return (
    <div className={`vr-field vr-read${field.wide ? " is-wide" : ""}`}>
      <span className="vr-field-label">{field.label}</span>
      <div className="vr-read-line">
        <span className="vr-read-value">{value || "Not read"}</span>
        {field.copy && value && <CopyButton text={value} label={field.label} />}
      </div>
    </div>
  );
}

function ReadField({ field, value, onChange, onExplain, onExplainTyped, plain = false }) {
  const id = useId();
  const [explaining, setExplaining] = useState(false);
  const [explainingTyped, setExplainingTyped] = useState(false);
  const isEdited = (value ?? "") !== (field.value ?? "");
  const Control = field.multiline ? "textarea" : "input";
  const dup = field.duplicate;
  return (
    <div className={`vr-field${field.wide ? " is-wide" : ""}${isEdited ? " is-edited" : ""}`}>
      <label htmlFor={id}>{field.label}{isEdited && <em>Edited</em>}</label>
      <div className={`vr-input${field.copy ? " has-copy" : ""}`}>
        <Control
          id={id}
          name={field.key}
          value={value ?? ""}
          rows={field.multiline ? 2 : undefined}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.copy && <CopyButton text={value ?? ""} label={field.label} />}
      </div>
      {field.by && !isEdited && <small className="vr-field-by">{field.by}</small>}
      {!plain && field.typed && (value ?? "") !== field.typed && (
        <p className="vr-compare is-typed">
          <span>Typed:</span> {marked(field.typed, value ?? "")}
          {field.explainTyped && onExplainTyped && !explainingTyped && (
            <button className="vr-text-action" type="button" onClick={() => setExplainingTyped(true)}>Explain</button>
          )}
        </p>
      )}
      {field.explainTyped && onExplainTyped && explainingTyped && (
        <ReasonForm label={field.explainTyped} saveLabel="Save" onSave={onExplainTyped} onDone={() => setExplainingTyped(false)} />
      )}
      {!plain && field.licence && (value ?? "") !== field.licence && (
        <p className="vr-compare is-licence"><span>Licence:</span> {marked(field.licence, value ?? "", field.licenceParts ?? [])}</p>
      )}
      {!plain && dup && !dup.explained && !explaining && (
        <p className="vr-compare is-dup">
          <span>Same number as</span> <strong>{dup.with}</strong>
          <button className="vr-text-action" type="button" onClick={() => setExplaining(true)}>Explain</button>
        </p>
      )}
      {!plain && dup && explaining && (
        <ReasonForm
          label={`Why ${dup.with} has the same number`}
          saveLabel="Save"
          initial={dup.explained?.text}
          onSave={onExplain}
          onDone={() => setExplaining(false)}
        />
      )}
      {!plain && dup?.explained && !explaining && (
        <p className="vr-sub-note">
          <span>Same number as {dup.with}: {dup.explained.text}</span>
          <small>{dup.explained.by} · <button className="vr-text-action is-quiet is-inline" type="button" onClick={() => setExplaining(true)}>Edit</button></small>
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- modal */

const fieldValues = (fields) => Object.fromEntries((fields ?? []).map((field) => [field.key, field.value ?? ""]));

function VerificationModal({ group, groups = null, actions, fileUrl, onRunning, onClose }) {
  const titleId = useId();
  // Several certificates: one tab each, showing that certificate's check, fields and file (Nov 13).
  const certs = group.evidence?.kind === "certificate" ? (group.evidence.certificates ?? []) : [];
  const tabbed = certs.length > 1;
  const [certId, setCertId] = useState(() => (certs.find((c) => c.file && c.file.id === group.evidence?.file?.id) ?? certs[0])?.id ?? null);
  const cert = tabbed ? certs.find((c) => c.id === certId) ?? certs[0] : null;
  const fields = (cert ? cert.fields : group.fields) ?? [];
  const checks = cert ? (group.checks ?? []).filter((check) => check.subjectId === cert.id) : group.checks;
  const evidence = cert ? { kind: "certificate", name: cert.label, number: cert.number, valid: cert.valid, holder: cert.holder, file: cert.file } : group.evidence;
  const [values, setValues] = useState(() => fieldValues(fields));
  const [run, setRun] = useState({ state: "idle" });
  // "Fix misread" (Nov 26): the reading is shown as read; a misread is fixed here, and it changes the reading only.
  const [fixing, setFixing] = useState(false);
  // Save changes (Nov 24, was Run again): only once a field the AI read was changed; it re-checks with the change.
  const edited = fields.filter((field) => (values[field.key] ?? "") !== (field.value ?? "")).map((field) => field.key);
  const canRun = group.rerunnable !== false && fields.length > 0;
  // A brand's groups have nowhere to keep a reason (`reasons: false`); otherwise each check says (`canReason`).
  const canReason = group.reasons !== false;
  // A new reading (Run again, or a teammate's) replaces the fields; staff's own unsaved edits are only replaced by it.
  const readSignature = fields.map((field) => `${field.key}=${field.value ?? ""}`).join("\u0001");
  useEffect(() => { setValues(fieldValues(fields)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [readSignature]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape" && !document.querySelector(".vr-layer .vr-record, .vr-dialog-over")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runAgain = async () => {
    if (!edited.length) return;
    setRun({ state: "running" });
    onRunning(true);
    let outcome;
    try {
      outcome = await actions.runAgain(group.key, values, edited, cert?.id ?? null);
    } catch (error) {
      outcome = { error: error?.message || "Couldn't save. Try again." };
    }
    onRunning(false);
    setRun(outcome?.error ? { state: "error", message: outcome.error } : { state: "done" });
    if (!outcome?.error) setFixing(false);
  };

  const status = run.state === "running" ? { text: "Saving…" }
    : run.state === "error" ? { text: run.message, tone: "error" }
      : run.state === "done" ? { text: "Saved", tone: "done" }
        : group.checking && group.checkingWords ? { text: group.checkingWords }
        : group.error ? { text: group.error, tone: "error" }
          : group.stale ? { text: group.stale, tone: "stale" }
            : { text: group.readAt ?? "" };

  // A registration number another company also uses: said in the Official registry row (Nov 26).
  // The licence's number or name against the company's own, worked out now: said, and explained, in the registry row.
  const typedFields = (checks ?? []).some((check) => check.key === "registry") ? fields.filter((field) => field.typed && field.typed !== field.value) : [];
  const dupField = (checks ?? []).some((check) => check.key === "registry") ? fields.find((field) => field.key === "number" && field.duplicate) ?? null : null;
  const readSection = fields.length > 0 && (
    <section className="vr-section vr-read-section">
      <div className="vr-section-head">
        <h3>{group.evidencePane === false ? "What the AI read" : "Read from this document"}</h3>
        {canRun && (
          <button className="vr-text-action" type="button" onClick={() => { if (fixing) setValues(fieldValues(fields)); setFixing(!fixing); }}>
            {fixing ? "Cancel" : "Fix misread"}
          </button>
        )}
      </div>
      <div className="vr-fields">
        {fields.map((field) => (!fixing ? <ReadValue field={field} value={values[field.key]} key={field.key} /> : (
          <ReadField
            plain
            field={field}
            value={values[field.key]}
            onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
            onExplain={(text) => actions.explainField(group.key, field, text)}
            onExplainTyped={actions.explainTyped ? (text) => actions.explainTyped(group.key, field, text, group.checks.find((check) => check.key === "registry")) : null}
            key={field.key}
          />
        )))}
      </div>
    </section>
  );

  return (
    // A click beside the pop-up closes it, unless a form is open in it: typed words are never lost that way (Nov 24 tester).
    <div className="vr-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !event.currentTarget.querySelector(".vr-record") && onClose()}>
      <section className="vr-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="vr-modal-head">
          <div className="vr-modal-title">
            <h2 id={titleId}>{group.label}</h2>
          </div>
          <button className="vr-close" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </header>

        <div className={`vr-modal-body${group.evidencePane === false ? " is-single" : ""}`}>
          <div className="vr-modal-main">
            {tabbed && (
              <div className="vr-cert-tabs">
                <Segmented options={certs.map((c) => ({ key: c.id, label: c.label }))} value={cert.id} onChange={setCertId} name={`cert-${titleId}`} label="Certificates" />
              </div>
            )}
            <section className="vr-section" aria-label="Checks">
              <h3>Checks</h3>
              {checks?.length ? (
                <ul className="vr-subs">
                  {checks.map((check) => (
                    <SubCheck
                      check={check}
                      groupKey={group.key}
                      legalName={values.legalName}
                      canReason={canReason && check.canReason !== false}
                      numberShown={Boolean(dupField)}
                      dupField={check.key === "registry" ? dupField : null}
                      typedFields={check.key === "registry" ? typedFields : []}
                      onExplainTyped={check.key === "registry" && actions.explainTyped ? (field, text) => actions.explainTyped(group.key, field, text, check) : null}
                      onExplainDup={dupField ? (text) => actions.explainField(group.key, dupField, text) : null}
                      actions={actions}
                      key={`${check.key}-${check.registry?.by ?? ""}-${check.reason?.by ?? ""}`}
                    />
                  ))}
                </ul>
              ) : <p className="vr-section-empty">Nothing to check yet</p>}
            </section>
            {group.evidencePane === false && readSection}
          </div>

          {/* The document, and under it what was read from it (Nov 26). A group with no file at all keeps the reading in one column. */}
          {group.evidencePane !== false ? (
            <div className="vr-side">
              <EvidencePane
                evidence={evidence}
                fileUrl={fileUrl}
                onPhoto={(index, record, photo) => actions.recordPhoto(group.key, index, record, photo)}
                key={`${group.readAt ?? ""}-${cert?.id ?? ""}`}
              />
              {readSection}
            </div>
          ) : null}
        </div>

        <footer className="vr-modal-foot">
          <p className={`vr-run-status${status.tone ? ` is-${status.tone}` : ""}`} role="status">
            {(status.tone === "error" || status.tone === "stale") && <i aria-hidden="true" />}
            {status.text}
          </p>
          <button className="secondary-btn" type="button" onClick={onClose}>Close</button>
          {canRun && (edited.length > 0 || run.state === "running") && (
            <button className="primary-btn vr-run" type="button" disabled={run.state === "running"} onClick={runAgain}>
              {run.state === "running" && <Spinner />}
              {run.state === "running" ? "Saving" : "Save changes"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------- evidence */

const PHOTO_RESULTS = [
  { key: "own", label: "Own" },
  { key: "elsewhere", label: "Found elsewhere" },
  { key: "could_not", label: "Couldn't check" },
];

/** A stored file's link: `url`/`src` as given, or a signed one minted by `fileUrl` (live). */
function useFileHref(file, fileUrl) {
  const direct = file?.url ?? file?.src ?? null;
  const [state, setState] = useState({ href: direct, failed: false });
  useEffect(() => {
    if (direct || !file || !fileUrl || !file.path) { setState({ href: direct, failed: !direct && Boolean(file?.path) && !fileUrl }); return undefined; }
    let cancelled = false;
    setState({ href: null, failed: false });
    Promise.resolve(fileUrl(file)).then(
      (href) => { if (!cancelled) setState({ href: href || null, failed: !href }); },
      () => { if (!cancelled) setState({ href: null, failed: true }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direct, file?.bucket, file?.path, file?.name]);
  return state;
}

function PhotoRecord({ photo, index, onSave, onDone }) {
  // Opens on what is recorded; only a copy across TSC starts on "Found elsewhere". A stock or office tile
  // starts on nothing (fix round 4): Save without looking must not mark it their own.
  const start = photo.flag === "stock" || photo.flag === "office" ? null
    : photo.result && photo.result !== "unchecked" ? photo.result : photo.flag === "tsc" ? "elsewhere" : "own";
  const [result, setResult] = useState(start);
  const [where, setWhere] = useState(photo.whereUrl ?? photo.link ?? photo.where ?? "");
  const [save, run] = useSave();
  const whereId = useId();
  const submit = async (event) => {
    event.preventDefault();
    if (save.busy || !result) return;
    const link = result === "elsewhere" ? where.trim() : "";
    const { ok } = await run(() => onSave({ result, where: link.replace(/^https?:\/\/(www\.)?/, "").split("/")[0], whereUrl: link }));
    if (ok) onDone();
  };
  return (
    <form className={`vr-photo-pop ${index % 2 ? "is-right" : "is-left"}`} onSubmit={submit}>
      <div className="vr-photo-pop-head">
        <strong>Photo {index + 1}</strong>
        {photo.onSearch
          ? <SearchImageAction onSearch={photo.onSearch} />
          : <LookupAction lookup={photo.searchHref ? { label: "Search image", href: photo.searchHref } : { label: "Search image", href: "https://lens.google.com/" }} />}
      </div>
      <Segmented options={PHOTO_RESULTS} value={result} onChange={setResult} name={`photo-${index}`} label={`What a search showed for photo ${index + 1}`} />
      {result === "elsewhere" && (
        <div className="vr-field">
          <label htmlFor={whereId}>Where</label>
          <input id={whereId} value={where} placeholder="Page link" onChange={(event) => setWhere(event.target.value)} />
        </div>
      )}
      <SaveError text={save.error} />
      <div className="vr-record-actions">
        <button className="secondary-btn compact-btn" type="button" onClick={onDone}>Cancel</button>
        <button className="primary-btn compact-btn" type="submit" disabled={save.busy || !result}>{save.busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}

function PhotoImage({ photo, fileUrl }) {
  const { href, failed } = useFileHref(photo, fileUrl);
  if (href) return <img src={href} alt="" />;
  return <span className="vr-photo-wait" aria-hidden="true">{failed ? null : <Spinner ink />}</span>;
}

function PhotoGrid({ photos, onPhoto, fileUrl }) {
  const [selected, setSelected] = useState(null);
  const rows = [];
  for (let index = 0; index < photos.length; index += 2) rows.push(index);
  return (
    <div className="vr-photos">
      {rows.map((first) => (
        <React.Fragment key={first}>
          {photos.slice(first, first + 2).map((photo, offset) => {
            const index = first + offset;
            const caption = photoCaption(photo);
            const tone = photo.flag ? "problem" : photo.result;
            return (
              <button
                type="button"
                className={`vr-photo is-${tone}${selected === index ? " is-selected" : ""}`}
                aria-expanded={selected === index}
                aria-label={`Photo ${index + 1}: ${caption ?? "their own"}. Record what a search showed`}
                onClick={() => setSelected(selected === index ? null : index)}
                key={`${photo.id ?? photo.src ?? photo.path}-${index}`}
              >
                <PhotoImage photo={photo} fileUrl={fileUrl} />
                {caption
                  ? <span className="vr-photo-cap">{caption}</span>
                  : <span className="vr-photo-own" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.4 6.6 11.4 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
              </button>
            );
          })}
          {selected != null && selected >= first && selected < first + 2 && (
            <PhotoRecord
              photo={photos[selected]}
              index={selected}
              key={`pop-${selected}`}
              onDone={() => setSelected(null)}
              onSave={(record) => onPhoto(selected, record, photos[selected])}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

const isImage = (file) => /^image\//.test(file?.mimeType ?? "") || /\.(png|jpe?g|webp|gif)$/i.test(file?.name ?? "");
const isPdf = (file) => file?.mimeType === "application/pdf" || /\.pdf$/i.test(file?.name ?? "");

/** What the first bytes say a file is: "pdf", an image's type, or "other". */
function sniffBytes(bytes) {
  const head = Array.from(bytes.slice(0, 1024), (b) => String.fromCharCode(b)).join("");
  if (head.includes("%PDF-")) return "pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && head.slice(1, 4) === "PNG") return "image/png";
  if (head.slice(0, 4) === "RIFF" && head.slice(8, 12) === "WEBP") return "image/webp";
  if (head.slice(0, 3) === "GIF") return "image/gif";
  return "other";
}

/**
 * Whether the browser's PDF viewer can be given this file (Nov 13): a file named .pdf that is not
 * one (a photo saved as .pdf), is empty, or stops before its end shows the viewer's "Failed to load
 * PDF document" box. Reads the first 2 KB and the last 8 KB; if that read itself fails, the file is
 * shown as before. `{ kind: "pdf" | "image" | "none" (nothing the page can draw), src? }`, or null
 * while reading. A photo stored as a PDF is served as one, so it is drawn from its own bytes.
 */
function usePdfPreview(href, enabled) {
  const [kind, setKind] = useState(null);
  useEffect(() => {
    if (!enabled || !href) { setKind(null); return undefined; }
    let cancelled = false;
    let objectUrl = null;
    setKind(null);
    const range = async (value) => {
      const response = await fetch(href, { headers: { Range: value } });
      // An empty file has no bytes to range over.
      if (response.status === 416) return { whole: true, bytes: new Uint8Array(0) };
      if (!response.ok) throw new Error(String(response.status));
      return { whole: response.status === 200, bytes: new Uint8Array(await response.arrayBuffer()) };
    };
    (async () => {
      const head = await range("bytes=0-2047");
      if (!head.bytes.length) return { kind: "none", why: "the file is empty" };
      const what = sniffBytes(head.bytes);
      if (what.startsWith("image/")) {
        const whole = head.whole ? head.bytes : new Uint8Array(await (await fetch(href)).arrayBuffer());
        objectUrl = URL.createObjectURL(new Blob([whole], { type: what }));
        return { kind: "image", src: objectUrl };
      }
      if (what !== "pdf") return { kind: "none", why: "not a PDF or a photo" };
      const tail = head.whole ? head : await range("bytes=-8192");
      const end = Array.from(tail.bytes.slice(-8192), (b) => String.fromCharCode(b)).join("");
      return end.includes("%%EOF") ? { kind: "pdf" } : { kind: "none", why: "the PDF is incomplete" };
    })().then(
      (found) => { if (!cancelled) setKind(found); },
      () => { if (!cancelled) setKind({ kind: "pdf" }); },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [href, enabled]);
  return kind;
}

/** One file behind a check: the prototype's drawn paper, or the stored file itself. */
function EvidenceFile({ file, fileUrl, label, children }) {
  const { href, failed } = useFileHref(file.variant ? null : file, fileUrl);
  const pdf = usePdfPreview(href, !file.variant && !children && !isImage(file) && isPdf(file));
  const preview = file.variant ? <LicencePaper variant={file.variant} key={file.variant} />
    : children ?? (failed ? <div className="vr-paper vr-file is-empty"><p>Couldn't open the file</p></div>
      : !href ? <div className="vr-paper vr-file is-empty"><Spinner ink /></div>
        : isImage(file) ? <div className="vr-paper vr-file"><img src={href} alt={label} /></div>
          : isPdf(file) && pdf == null ? <div className="vr-paper vr-file is-empty"><Spinner ink /></div>
            : pdf?.kind === "image" ? <div className="vr-paper vr-file"><img src={pdf.src} alt={label} /></div>
              : isPdf(file) && pdf.kind === "pdf" ? <div className="vr-paper vr-file is-pdf"><iframe src={href} title={label} /></div>
              : isPdf(file) ? <div className="vr-paper vr-file is-empty"><p>Can't preview: {pdf.why}</p></div>
                : <div className="vr-paper vr-file is-empty"><p>{file.name}</p></div>);
  // Open shows what the window shows: a photo stored as .pdf opens as the photo; a file the viewer can't load doesn't open.
  const openHref = pdf?.kind === "image" ? pdf.src : pdf?.kind === "none" ? null : href;
  return (
    <>
      {preview}
      <EvidenceFoot file={file} href={openHref} />
    </>
  );
}

function EvidenceFoot({ file, href, switcher = null }) {
  return (
    <>
      {switcher}
      <div className="vr-evidence-file">
        <span>{file.name ?? file.file}{file.when ? `, ${file.when}` : ""}</span>
        {href
          ? <a className="vr-text-action" href={href} target="_blank" rel="noreferrer noopener">Open</a>
          : <button className="vr-text-action" type="button" disabled={!file.variant && !file.drawn}>Open</button>}
      </div>
    </>
  );
}

function Switcher({ index, count, onChange }) {
  if (count < 2) return null;
  return (
    <div className="vr-switcher">
      <button type="button" aria-label="Newer file" disabled={index === 0} onClick={() => onChange(index - 1)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <span aria-live="polite">{index + 1} of {count}</span>
      <button type="button" aria-label="Earlier file" disabled={index === count - 1} onClick={() => onChange(index + 1)}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

function CertificateCard({ evidence }) {
  return (
    <div className="vr-paper vr-cert">
      <span className="vr-cert-mark" aria-hidden="true" />
      <strong>{evidence.name}</strong>
      <span>Certificate</span>
      <dl>
        {evidence.holder && <div><dt>Holder</dt><dd>{evidence.holder}</dd></div>}
        {evidence.number && <div><dt>Number</dt><dd>{evidence.number}</dd></div>}
        {evidence.valid && <div><dt>Valid until</dt><dd>{evidence.valid}</dd></div>}
      </dl>
    </div>
  );
}

function EvidencePane({ evidence, onPhoto, fileUrl }) {
  const [index, setIndex] = useState(0);
  if (!evidence || evidence.kind === "none") {
    return <aside className="vr-evidence vr-evidence-empty"><p>No file uploaded</p></aside>;
  }
  if (evidence.kind === "photos") {
    if (!evidence.photos?.length) return <aside className="vr-evidence vr-evidence-empty"><p>No photos uploaded</p></aside>;
    return (
      <aside className="vr-evidence" aria-label="Photos">
        <PhotoGrid photos={evidence.photos} onPhoto={onPhoto} fileUrl={fileUrl} />
        <div className="vr-evidence-file"><span>{evidence.photos.length} {evidence.photos.length === 1 ? "photo" : "photos"}</span></div>
      </aside>
    );
  }
  const isCert = evidence.kind === "certificate";
  const files = evidence.files ?? (evidence.file && typeof evidence.file === "object" ? [evidence.file] : evidence.variant ? [{ variant: evidence.variant, file: evidence.file }] : []);
  if (!files.length) {
    // The prototype's certificate is drawn from its own fields; a live certificate with no file shows the same card, with no file line.
    if (isCert && evidence.name) {
      return (
        <aside className="vr-evidence" aria-label="Certificate">
          <CertificateCard evidence={evidence} />
          {evidence.fileName && <EvidenceFoot file={{ name: evidence.fileName, drawn: true }} />}
        </aside>
      );
    }
    return <aside className="vr-evidence vr-evidence-empty"><p>No file uploaded</p></aside>;
  }
  const at = Math.min(index, files.length - 1);
  const file = files[at];
  const label = evidence.label ?? (isCert ? "Certificate" : "Registration document");
  return (
    <aside className="vr-evidence" aria-label={label}>
      <EvidenceFile file={file} fileUrl={fileUrl} label={label} key={`${file.path ?? file.variant}-${at}`} />
      <Switcher index={at} count={files.length} onChange={setIndex} />
    </aside>
  );
}

const PAPERS = {
  cn: {
    title: "营业执照",
    rows: [
      ["统一社会信用代码", "91330109MA2B3K7Q4X"], ["名称", "杭州钱江服装有限公司"], ["类型", "有限责任公司"],
      ["法定代表人", "张伟"], ["经营范围", "服装制造；服装服饰批发；货物进出口"], ["成立日期", "2015年04月16日"], ["住所", "杭州市萧山区江东三路18号"],
    ],
    seal: true,
  },
  "cn-copy": {
    title: "营业执照",
    rows: [
      ["统一社会信用代码", "91440111MA59C2RX8L"], ["名称", "广州越秀服饰有限公司"], ["类型", "有限责任公司"],
      ["法定代表人", "李娜"], ["经营范围", "针织服装制造；服装服饰零售"], ["成立日期", "2018年06月02日"], ["住所", "广州市白云区黄浦路112号3栋"],
    ],
    seal: true,
    watermark: "仅供认证使用 · For verification use only",
  },
  tr: {
    kicker: "T.C. Gelir İdaresi Başkanlığı",
    title: "Vergi Levhası",
    rows: [
      ["Ticaret unvanı", "Merter Tekstil Toptan Ticaret Ltd. Şti."], ["Vergi kimlik no", "6230418795"], ["Vergi dairesi", "Merter"],
      ["Ana faaliyet", "464201 · Toptan giyim ticareti"], ["İş yeri adresi", "Merter Mah., Güngören, İstanbul"], ["Onay kodu", "2026-GIB-0451887"],
    ],
  },
  pt: {
    kicker: "Conservatória do Registo Comercial",
    title: "Certidão Permanente",
    rows: [
      ["NIPC", "513284976"], ["Firma", "TÊXTEIS DOURO –\nCONFECÇÕES, LDA"], ["Natureza jurídica", "Sociedade por quotas"],
      ["CAE principal", "14130"], ["Sede", "Rua da Igreja 214, 4750-142 Arcozelo, Barcelos"], ["Data do registo", "2012-03-08"], ["Código de acesso", "4821-7730-9145"],
    ],
  },
  "pt-old": {
    kicker: "Conservatória do Registo Comercial",
    title: "Certidão Permanente",
    rows: [
      ["NIPC", "513284976"], ["Firma", "TÊXTEIS DOURO, LDA"], ["Natureza jurídica", "Sociedade por quotas"],
      ["CAE principal", "14130"], ["Sede", "Rua da Igreja 214, 4750-142 Arcozelo, Barcelos"], ["Data do registo", "2012-03-08"], ["Válida até", "2023-11-02"],
    ],
    stamp: "Expirada",
  },
};

/** The prototype's drawn licences. Only a mock file names a `variant`; nothing falls back to one. */
function LicencePaper({ variant }) {
  const paper = PAPERS[variant];
  if (!paper) return null;
  return (
    <div className={`vr-paper vr-licence vr-licence-${variant}`}>
      {paper.kicker && <span className="vr-licence-kicker">{paper.kicker}</span>}
      <strong className="vr-licence-title">{paper.title}</strong>
      <dl>
        {paper.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {paper.seal && <span className="vr-seal" aria-hidden="true">★</span>}
      {paper.stamp && <span className="vr-stamp">{paper.stamp}</span>}
      {paper.watermark && (
        <span className="vr-watermark" aria-label={`Watermark: ${paper.watermark}`}>
          {Array.from({ length: 14 }, (_, index) => <span key={index}>{`${paper.watermark}   ${paper.watermark}`}</span>)}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------- review details rail */

export function VerificationFacts({ facts }) {
  return (
    <ul className="vr-facts">
      {facts.map((fact) => (
        <li key={fact.label} className={fact.ok === true ? "is-ok" : fact.ok === false ? "is-gap" : "is-info"}>
          <span className="vr-fact-mark" aria-hidden="true">
            {fact.ok === true ? <svg viewBox="0 0 16 16"><path d="M3.5 8.4 6.6 11.4 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              : fact.ok === false ? <svg viewBox="0 0 16 16"><path d="M8 4.2v4.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="8" cy="11.6" r="1.1" fill="currentColor" /></svg>
              : <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" fill="currentColor" /></svg>}
          </span>
          <span className="vr-fact-copy"><span>{fact.label}</span><strong>{fact.value}</strong></span>
        </li>
      ))}
    </ul>
  );
}
