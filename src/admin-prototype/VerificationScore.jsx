/**
 * Staff verification review, Nov 12 design (mock only).
 *
 * Replaces the two cards "Verification checks" (% complete) and "Official
 * registry" (High / Medium / Can't tell) with one card in one scoring system
 * (Queena, Nov 11). The card shows a score and a one-line verdict per row;
 * everything else lives in the row's modal: the checks behind the score, what
 * was read from the document as editable fields, the file itself, and one
 * action, Run again.
 *
 * Drawn only for a profile that carries `verification` (the mock profiles in
 * verification-mock.js), so the live page is unchanged until it is ported.
 */
import React, { useEffect, useId, useRef, useState } from "react";
import {
  GROUP_TIPS, GROUP_WEIGHTS, RECORD_RESULTS, photoCaption, recordedCheck, scoreGroup, scoreOverall, standingFor, tierFor, weakestCheck, withPhotoCheck, withReason,
} from "./verification-mock.js";
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
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

function Score({ value, size = "row" }) {
  const shown = useCountUp(value);
  if (value == null) return <span className={`vr-score vr-score-${size} vr-tier-none`}>—</span>;
  return <span className={`vr-score vr-score-${size} vr-tier-${tierFor(value)}`}>{shown}<small>%</small></span>;
}

function Meter({ value }) {
  if (value == null) return null;
  return (
    <span className={`vr-meter vr-tier-${tierFor(value)}`} aria-hidden="true">
      <span style={{ width: `${value ?? 0}%` }} />
    </span>
  );
}

function StandingPill({ score }) {
  const standing = standingFor(score);
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

/** `shown` with the parts that differ from `other` marked: characters for a number, words for a name or address. */
function marked(shown, other) {
  const isCode = !/\s/.test(shown) && !/\s/.test(other) && shown.length === other.length;
  if (isCode) return [...shown].map((char, index) => (char === other[index] ? char : <mark key={index}>{char}</mark>));
  const words = new Set(other.toLowerCase().split(/[\s,]+/).filter(Boolean));
  return shown.split(/([\s,]+)/).map((part, index) => (/^[\s,]*$/.test(part) || words.has(part.toLowerCase()) ? part : <mark key={index}>{part}</mark>));
}

/* ------------------------------------------------------------------ card */

export function VerificationScoreCard({ profile }) {
  const [groups, setGroups] = useState(profile.verification.groups);
  const [openKey, setOpenKey] = useState(() => new URLSearchParams(window.location.search).get("check"));
  // Automatic checks still running when the page opens; Run again adds its group while it runs.
  const [checking, setChecking] = useState(() => new Set(profile.verification.groups.filter((group) => group.checkingMs).map((group) => group.key)));
  const setGroupChecking = (key, on) => setChecking((current) => {
    const next = new Set(current);
    if (on) next.add(key); else next.delete(key);
    return next;
  });
  useEffect(() => {
    const timers = profile.verification.groups
      .filter((group) => group.checkingMs)
      .map((group) => window.setTimeout(() => setGroupChecking(group.key, false), group.checkingMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [profile.verification.groups]);

  const overall = scoreOverall(groups);
  const weakest = weakestCheck(groups);
  const counted = groups.filter((group) => GROUP_WEIGHTS[group.key]);
  const open = groups.find((group) => group.key === openKey) ?? null;
  const updateGroup = (next) => setGroups((current) => current.map((group) => (group.key === next.key ? next : group)));

  return (
    <section className="factory-dashboard-panel admin-panel vr-card" aria-labelledby="vr-card-title">
      <header className="vr-card-head">
        <h2 id="vr-card-title">Verification score</h2>
      </header>

      <div className="vr-overall">
        <div className="vr-overall-figure">
          <Score value={overall} size="hero" />
          <StandingPill score={overall} />
        </div>
        <p className="vr-overall-line">
          {weakest ? <><span>Weakest:</span> {weakest.label}, {weakest.verdict.charAt(0).toLowerCase()}{weakest.verdict.slice(1)}</> : null}
        </p>
        <div className="vr-weightbar" role="img" aria-label={counted.map((group) => `${group.label} ${scoreGroup(group)}%`).join(", ")}>
          {counted.map((group) => {
            const score = scoreGroup(group);
            return (
              <div className="vr-weightbar-part" style={{ flexGrow: GROUP_WEIGHTS[group.key] }} key={group.key}>
                <span className={`vr-weightbar-track vr-tier-${tierFor(score)}`}><span style={{ width: `${score}%` }} /></span>
                <span className="vr-weightbar-label">{group.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="vr-rows">
        {groups.map((group) => {
          const isChecking = checking.has(group.key);
          const score = isChecking ? null : scoreGroup(group);
          const counts = Boolean(GROUP_WEIGHTS[group.key]);
          return (
            <article
              className={`vr-row${counts ? "" : " vr-row-uncounted"}${isChecking ? " is-checking" : ""}`}
              role="button"
              tabIndex={0}
              aria-busy={isChecking || undefined}
              aria-label={`${group.label}, ${isChecking ? "checking" : score == null ? "no score" : `${score}%`}: open details`}
              onClick={() => setOpenKey(group.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpenKey(group.key); }
              }}
              key={group.key}
            >
              <div className="vr-row-copy">
                <span className="vr-row-title">{group.label}<InfoTip text={GROUP_TIPS[group.key]} label={group.label} /></span>
                {isChecking
                  ? <span className="vr-row-verdict vr-row-checking"><Spinner ink />Checking…</span>
                  : <span className={`vr-row-verdict vr-tier-${tierFor(score)}`}><i aria-hidden="true" />{group.verdict}</span>}
              </div>
              <div className="vr-row-score">
                <Score value={score} />
                {!isChecking && <Meter value={score} />}
              </div>
              <Chevron />
            </article>
          );
        })}
      </div>

      {open && (
        <VerificationModal
          group={open}
          onUpdate={updateGroup}
          onRunning={(on) => setGroupChecking(open.key, on)}
          onClose={() => setOpenKey(null)}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------ sub-checks */

const sameName = (a, b) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

function ReasonForm({ initial = "", label = "Reason", saveLabel = "Save reason", onSave, onCancel }) {
  const [text, setText] = useState(initial);
  const id = useId();
  return (
    <form className="vr-record" onSubmit={(event) => { event.preventDefault(); if (text.trim()) onSave(text.trim()); }}>
      <div className="vr-field">
        <label htmlFor={id}>{label}</label>
        <textarea id={id} rows={2} value={text} autoFocus onChange={(event) => setText(event.target.value)} />
      </div>
      <div className="vr-record-actions">
        <button className="secondary-btn compact-btn" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-btn compact-btn" type="submit" disabled={!text.trim()}>{saveLabel}</button>
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

function RecordForm({ check, legalName, onSave, onCancel }) {
  const registry = check.registry;
  const isCert = check.kind === "certificate";
  const ids = { name: useId(), reason: useId(), reference: useId() };
  const [result, setResult] = useState(registry.result && !registry.for ? registry.result : "found");
  const [name, setName] = useState(isCert ? "" : (registry.result === "name_differs" ? registry.name : legalName) ?? "");
  const [reference, setReference] = useState(registry.reference ?? "");
  const [reason, setReason] = useState("");
  const showsName = !isCert && (result === "found" || result === "name_differs");
  const needsReason = result === "name_differs";

  // Typing a name the registry shows differently is "Name differs"; typing it back is "Found".
  const changeName = (value) => {
    setName(value);
    if (!legalName) return;
    if (!sameName(value, legalName) && result === "found") setResult("name_differs");
    if (sameName(value, legalName) && result === "name_differs") setResult("found");
  };

  const save = (event) => {
    event.preventDefault();
    if (needsReason && !reason.trim()) return;
    onSave(recordedCheck(check, { result, reference: reference.trim(), name: showsName ? name.trim() : "", reason: needsReason ? reason.trim() : "" }));
  };

  return (
    <form className="vr-record" onSubmit={save}>
      <Segmented
        options={RECORD_RESULTS[isCert ? "certificate" : "registry"]}
        value={result}
        onChange={setResult}
        name={`record-${check.key}`}
        label={`What ${isCert ? "the issuer's list" : registry.source} showed`}
      />
      {showsName && (
        <div className={`vr-field${needsReason ? " is-differs" : ""}`}>
          <label htmlFor={ids.name}>Name on {registry.source}</label>
          <input id={ids.name} value={name} spellCheck={false} onChange={(event) => changeName(event.target.value)} />
        </div>
      )}
      {needsReason && (
        <div className="vr-field">
          <label htmlFor={ids.reason}>Reason</label>
          <textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
      )}
      <div className="vr-field">
        <label htmlFor={ids.reference}>Link or reference</label>
        <input id={ids.reference} value={reference} onChange={(event) => setReference(event.target.value)} placeholder={`${isCert ? "Issuer's list" : registry.source} page link`} />
      </div>
      <div className="vr-record-actions">
        <button className="secondary-btn compact-btn" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-btn compact-btn" type="submit" disabled={needsReason && !reason.trim()}>Save check</button>
      </div>
    </form>
  );
}

function SubCheck({ check, legalName, canReason, onChange }) {
  const [mode, setMode] = useState(null);
  const registry = check.registry;
  const canRecord = Boolean(registry) && registry.by !== "Checked automatically";
  const done = (next) => { onChange(next); setMode(null); };
  return (
    <li className={`vr-sub${mode ? " is-open" : ""}`}>
      <div className="vr-sub-line">
        <div className="vr-sub-copy">
          <strong>{check.label}</strong>
          <span>{check.verdict}</span>
          {registry?.by && <small>{registry.source} · {registry.by}{registry.for ? `, for “${registry.for}”` : ""}</small>}
        </div>
        <div className="vr-sub-score">
          <Score value={check.score} size="sub" />
          <Meter value={check.score} />
        </div>
      </div>
      {check.reason && mode !== "reason" && (
        <p className="vr-sub-note"><span>{check.reason.text}</span><small>{check.reason.by}</small></p>
      )}
      {!mode && (canRecord || check.lookup || canReason) && (
        <div className="vr-sub-actions">
          {canRecord && (
            <button className="vr-text-action" type="button" onClick={() => setMode("record")}>
              {registry.result ? "Update check" : `Record ${registry.source} check`}
            </button>
          )}
          {check.lookup && <LookupAction lookup={check.lookup} />}
          {canReason && (
            <button className="vr-text-action is-quiet" type="button" onClick={() => setMode("reason")}>
              {check.reason ? "Edit reason" : "Add reason"}
            </button>
          )}
        </div>
      )}
      {mode === "record" && <RecordForm check={check} legalName={legalName} onSave={done} onCancel={() => setMode(null)} />}
      {mode === "reason" && (
        <ReasonForm initial={check.reason?.text} onSave={(text) => done(withReason(check, text))} onCancel={() => setMode(null)} />
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- fields */

function ReadField({ field, value, onChange, onExplain }) {
  const id = useId();
  const [explaining, setExplaining] = useState(false);
  const isEdited = value !== field.value;
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
      {field.typed && value !== field.typed && (
        <p className="vr-compare is-typed"><span>Typed:</span> {marked(field.typed, value ?? "")}</p>
      )}
      {field.licence && value !== field.licence && (
        <p className="vr-compare is-licence"><span>Licence:</span> {marked(field.licence, value ?? "")}</p>
      )}
      {dup && !dup.explained && !explaining && (
        <p className="vr-compare is-dup">
          <span>Same number as</span> <strong>{dup.with}</strong>
          <button className="vr-text-action" type="button" onClick={() => setExplaining(true)}>Explain</button>
        </p>
      )}
      {dup && explaining && (
        <ReasonForm
          label={`Why ${dup.with} has the same number`}
          saveLabel="Save"
          initial={dup.explained?.text}
          onSave={(text) => { onExplain({ text, by: "You, just now" }); setExplaining(false); }}
          onCancel={() => setExplaining(false)}
        />
      )}
      {dup?.explained && !explaining && (
        <p className="vr-sub-note">
          <span>Same number as {dup.with}: {dup.explained.text}</span>
          <small>{dup.explained.by} · <button className="vr-text-action is-quiet is-inline" type="button" onClick={() => setExplaining(true)}>Edit</button></small>
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- modal */

function VerificationModal({ group, onUpdate, onRunning, onClose }) {
  const titleId = useId();
  const [values, setValues] = useState(() => Object.fromEntries(group.fields.map((field) => [field.key, field.value])));
  const [run, setRun] = useState({ state: "idle", from: null, to: null });
  const score = scoreGroup(group);
  const canRun = group.fields.length > 0;
  const canReason = group.evidence?.kind !== "none";

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runAgain = () => {
    setRun({ state: "running", from: score, to: null });
    onRunning(true);
    window.setTimeout(() => {
      onRunning(false);
      const outcome = group.rerun?.(values, group) ?? null;
      if (outcome?.error) {
        setRun({ state: "error", message: outcome.error });
        return;
      }
      const { values: read = {}, error, ...patch } = outcome ?? {};
      const nextValues = { ...values, ...read };
      setValues(nextValues);
      const fields = group.fields.map((field) => ({ ...field, value: nextValues[field.key] }));
      const next = withPhotoCheck({ ...group, ...patch, fields, stale: null, readAt: "Read just now", rerun: outcome ? null : group.rerun });
      onUpdate(next);
      setRun({ state: "done", from: score, to: scoreGroup(next) });
    }, 1200);
  };

  // A registry check staff record becomes the group's verdict: the header must not keep saying "not checked" or "renamed".
  const changeCheck = (check) => onUpdate({
    ...group,
    ...(check.key === "registry" && check.registry?.by === "You, just now" ? { verdict: check.verdict, why: "" } : {}),
    checks: group.checks.map((item) => (item.key === check.key ? check : item)),
  });
  const changePhotos = (photos) => onUpdate(withPhotoCheck({ ...group, evidence: { ...group.evidence, photos } }));
  const explainField = (key, explained) => onUpdate({
    ...group,
    fields: group.fields.map((field) => (field.key === key ? { ...field, duplicate: { ...field.duplicate, explained } } : field)),
  });

  const delta = run.state === "done" ? run.to - run.from : 0;
  const status = run.state === "running" ? { text: "Checking again…" }
    : run.state === "error" ? { text: run.message, tone: "error" }
      : run.state === "done" ? { text: run.to === run.from ? `Same result: ${run.to}%` : `Score updated: ${run.from}% to ${run.to}%`, tone: "done" }
        : group.stale ? { text: group.stale, tone: "stale" }
          : { text: group.readAt };

  return (
    <div className="vr-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="vr-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="vr-modal-head">
          <div className="vr-modal-title">
            <h2 id={titleId}>{group.label}</h2>
            <p className={`vr-modal-verdict vr-tier-${tierFor(score)}`}><i aria-hidden="true" /><span><strong>{group.verdict}.</strong>{group.why ? ` ${group.why}` : ""}</span></p>
          </div>
          <div className="vr-modal-score">
            <Score value={score} size="modal" />
            {run.state === "done" && delta !== 0 && <span className={`vr-delta ${delta > 0 ? "is-up" : "is-down"}`}>{delta > 0 ? "+" : ""}{delta}</span>}
          </div>
          <button className="vr-close" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </header>

        <div className="vr-modal-body">
          <div className="vr-modal-main">
            <section className="vr-section" aria-label="Checks">
              <h3>Checks</h3>
              <ul className="vr-subs">
                {group.checks.map((check) => (
                  <SubCheck
                    check={check}
                    legalName={values.legalName}
                    canReason={canReason}
                    onChange={changeCheck}
                    key={`${check.key}-${check.registry?.by ?? ""}-${check.reason?.by ?? ""}`}
                  />
                ))}
              </ul>
            </section>

            {group.fields.length > 0 && (
              <section className="vr-section">
                <h3>What the AI read</h3>
                <div className="vr-fields">
                  {group.fields.map((field) => (
                    <ReadField
                      field={field}
                      value={values[field.key]}
                      onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
                      onExplain={(explained) => explainField(field.key, explained)}
                      key={field.key}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          <EvidencePane evidence={group.evidence} onPhotos={changePhotos} key={group.readAt} />
        </div>

        <footer className="vr-modal-foot">
          <p className={`vr-run-status${status.tone ? ` is-${status.tone}` : ""}`} role="status">
            {(status.tone === "error" || status.tone === "stale") && <i aria-hidden="true" />}
            {status.text}
          </p>
          <button className="secondary-btn" type="button" onClick={onClose}>Close</button>
          {canRun && (
            <button className="primary-btn vr-run" type="button" disabled={run.state === "running"} onClick={runAgain}>
              {run.state === "running" && <Spinner />}
              {run.state === "running" ? "Running" : "Run again"}
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

function PhotoRecord({ photo, index, onSave, onCancel }) {
  const start = photo.flag ? "elsewhere" : photo.result === "unchecked" ? "own" : photo.result;
  const [result, setResult] = useState(start);
  const [where, setWhere] = useState(photo.where ?? "");
  const whereId = useId();
  return (
    <form
      className={`vr-photo-pop ${index % 2 ? "is-right" : "is-left"}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ ...photo, result, where: result === "elsewhere" ? where.trim().replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "", flag: null, by: "You, just now" });
      }}
    >
      <div className="vr-photo-pop-head">
        <strong>Photo {index + 1}</strong>
        <LookupAction lookup={{ label: "Search image", href: "https://lens.google.com/" }} />
      </div>
      <Segmented options={PHOTO_RESULTS} value={result} onChange={setResult} name={`photo-${index}`} label={`What a search showed for photo ${index + 1}`} />
      {result === "elsewhere" && (
        <div className="vr-field">
          <label htmlFor={whereId}>Where</label>
          <input id={whereId} value={where} placeholder="Page link" onChange={(event) => setWhere(event.target.value)} />
        </div>
      )}
      <div className="vr-record-actions">
        <button className="secondary-btn compact-btn" type="button" onClick={onCancel}>Cancel</button>
        <button className="primary-btn compact-btn" type="submit">Save</button>
      </div>
    </form>
  );
}

function PhotoGrid({ photos, onPhotos }) {
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
                key={`${photo.src}-${index}`}
              >
                <img src={photo.src} alt="" />
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
              onCancel={() => setSelected(null)}
              onSave={(photo) => { onPhotos(photos.map((item, index) => (index === selected ? photo : item))); setSelected(null); }}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function EvidencePane({ evidence, onPhotos }) {
  const [index, setIndex] = useState(0);
  if (!evidence || evidence.kind === "none") {
    return <aside className="vr-evidence vr-evidence-empty"><p>No file uploaded</p></aside>;
  }
  if (evidence.kind === "photos") {
    return (
      <aside className="vr-evidence" aria-label="Photos">
        <PhotoGrid photos={evidence.photos} onPhotos={onPhotos} />
        <div className="vr-evidence-file"><span>{evidence.photos.length} photos</span></div>
      </aside>
    );
  }
  if (evidence.kind === "certificate") {
    return (
      <aside className="vr-evidence" aria-label="Certificate">
        <div className="vr-paper vr-cert">
          <span className="vr-cert-mark" aria-hidden="true" />
          <strong>{evidence.name}</strong>
          <span>Certificate</span>
          <dl>
            <div><dt>Holder</dt><dd>{evidence.holder}</dd></div>
            <div><dt>Number</dt><dd>{evidence.number}</dd></div>
            <div><dt>Valid until</dt><dd>{evidence.valid}</dd></div>
          </dl>
        </div>
        <div className="vr-evidence-file"><span>certificate.pdf</span><button className="vr-text-action" type="button">Open</button></div>
      </aside>
    );
  }
  const files = evidence.files ?? [{ variant: evidence.variant, file: evidence.file }];
  const file = files[Math.min(index, files.length - 1)];
  return (
    <aside className="vr-evidence" aria-label="Registration document">
      <LicencePaper variant={file.variant} key={file.variant} />
      {files.length > 1 && (
        <div className="vr-switcher">
          <button type="button" aria-label="Newer file" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <span aria-live="polite">{index + 1} of {files.length}</span>
          <button type="button" aria-label="Earlier file" disabled={index === files.length - 1} onClick={() => setIndex(index + 1)}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}
      <div className="vr-evidence-file">
        <span>{file.file}{file.when ? `, ${file.when}` : ""}</span>
        <button className="vr-text-action" type="button">Open</button>
      </div>
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

function LicencePaper({ variant }) {
  const paper = PAPERS[variant] ?? PAPERS.cn;
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
