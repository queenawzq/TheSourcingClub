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
import { GROUP_TIPS, GROUP_WEIGHTS, scoreGroup, scoreOverall, standingFor, tierFor, weakestCheck } from "./verification-mock.js";
import "./verification-score.css";

const REGISTRY_RESULTS = [
  { key: "found", label: "Found" },
  { key: "not_found", label: "Not found" },
  { key: "could_not_check", label: "Couldn't check" },
];

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

/* ------------------------------------------------------------------ card */

export function VerificationScoreCard({ profile }) {
  const [groups, setGroups] = useState(profile.verification.groups);
  const [openKey, setOpenKey] = useState(() => new URLSearchParams(window.location.search).get("check"));
  useEffect(() => {
    setGroups(profile.verification.groups);
  }, [profile.id]);

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
          const score = scoreGroup(group);
          const counts = Boolean(GROUP_WEIGHTS[group.key]);
          return (
            <article
              className={`vr-row${counts ? "" : " vr-row-uncounted"}`}
              role="button"
              tabIndex={0}
              aria-label={`${group.label}, ${score == null ? "no score" : `${score}%`}: open details`}
              onClick={() => setOpenKey(group.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpenKey(group.key); }
              }}
              key={group.key}
            >
              <div className="vr-row-copy">
                <span className="vr-row-title">{group.label}<InfoTip text={GROUP_TIPS[group.key]} label={group.label} /></span>
                <span className={`vr-row-verdict vr-tier-${tierFor(score)}`}><i aria-hidden="true" />{group.verdict}</span>
              </div>
              <div className="vr-row-score">
                <Score value={score} />
                <Meter value={score} />
              </div>
              <Chevron />
            </article>
          );
        })}
      </div>

      {open && <VerificationModal group={open} onUpdate={updateGroup} onClose={() => setOpenKey(null)} />}
    </section>
  );
}

/* ----------------------------------------------------------------- modal */

function recordedCheck(check, result, reference) {
  const source = check.registry.source;
  const outcome = {
    found: { score: 90, verdict: `Found on ${source}` },
    not_found: { score: 5, verdict: `Not found on ${source}` },
    could_not_check: { score: null, verdict: `Couldn't check ${source}` },
  }[result];
  return { ...check, ...outcome, registry: { ...check.registry, result, reference, by: "You, just now" } };
}

function SubCheck({ check, onRecord }) {
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState(check.registry?.result ?? "found");
  const [reference, setReference] = useState(check.registry?.reference ?? "");
  const registry = check.registry;
  const save = (event) => {
    event.preventDefault();
    onRecord(recordedCheck(check, result, reference.trim()));
    setEditing(false);
  };
  return (
    <li className="vr-sub">
      <div className="vr-sub-line">
        <div className="vr-sub-copy">
          <strong>{check.label}</strong>
          <span>{check.verdict}</span>
          {registry?.by && <small>{registry.source} · {registry.by}</small>}
        </div>
        <div className="vr-sub-score">
          <Score value={check.score} size="sub" />
          <Meter value={check.score} />
        </div>
      </div>
      {registry && registry.by !== "Checked automatically" && !editing && (
        <button className="vr-text-action" type="button" onClick={() => setEditing(true)}>
          {registry.result ? "Update check" : `Record ${registry.source} check`}
        </button>
      )}
      {editing && (
        <form className="vr-record" onSubmit={save}>
          <div className="vr-segmented" role="radiogroup" aria-label={`What ${registry.source} showed`}>
            {REGISTRY_RESULTS.map((option) => (
              <label className={result === option.key ? "is-on" : ""} key={option.key}>
                <input type="radio" name={`registry-${check.key}`} value={option.key} checked={result === option.key} onChange={() => setResult(option.key)} />
                {option.label}
              </label>
            ))}
          </div>
          <label className="vr-field">
            <span>Link or reference</span>
            <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={`${registry.source} page link`} />
          </label>
          <div className="vr-record-actions">
            <button className="secondary-btn compact-btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
            <button className="primary-btn compact-btn" type="submit">Save check</button>
          </div>
        </form>
      )}
    </li>
  );
}

function VerificationModal({ group, onUpdate, onClose }) {
  const titleId = useId();
  const [values, setValues] = useState(() => Object.fromEntries(group.fields.map((field) => [field.key, field.value])));
  const [run, setRun] = useState({ state: "idle", from: null, to: null });
  const score = scoreGroup(group);
  const edited = group.fields.filter((field) => values[field.key] !== field.value).map((field) => field.key);
  const canRun = group.fields.length > 0;

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runAgain = () => {
    setRun({ state: "running", from: score, to: null });
    window.setTimeout(() => {
      const improved = group.rerun?.(values) ?? null;
      const fields = group.fields.map((field) => ({ ...field, value: values[field.key] }));
      const next = improved ? { ...group, ...improved, fields, rerun: null, readAt: "Read just now" } : { ...group, fields, readAt: "Read just now" };
      onUpdate(next);
      setRun({ state: "done", from: score, to: scoreGroup(next) });
    }, 1200);
  };

  const recordCheck = (check) => {
    const next = { ...group, checks: group.checks.map((item) => (item.key === check.key ? check : item)) };
    onUpdate(next);
  };

  const delta = run.state === "done" ? run.to - run.from : 0;

  return (
    <div className="vr-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="vr-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="vr-modal-head">
          <div className="vr-modal-title">
            <h2 id={titleId}>{group.label}</h2>
            <p className={`vr-modal-verdict vr-tier-${tierFor(score)}`}><i aria-hidden="true" /><span><strong>{group.verdict}.</strong> {group.why}</span></p>
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
                {group.checks.map((check) => <SubCheck check={check} onRecord={recordCheck} key={`${check.key}-${check.registry?.by ?? ""}`} />)}
              </ul>
            </section>

            {group.fields.length > 0 && (
              <section className="vr-section">
                <h3>What the AI read</h3>
                <div className="vr-fields">
                  {group.fields.map((field) => {
                    const isEdited = edited.includes(field.key);
                    const Control = field.multiline ? "textarea" : "input";
                    return (
                      <label className={`vr-field${field.wide ? " is-wide" : ""}${isEdited ? " is-edited" : ""}`} key={field.key}>
                        <span>{field.label}{isEdited && <em>Edited</em>}</span>
                        <Control
                          name={field.key}
                          value={values[field.key] ?? ""}
                          rows={field.multiline ? 2 : undefined}
                          spellCheck={false}
                          onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                        />
                      </label>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <EvidencePane evidence={group.evidence} />
        </div>

        <footer className="vr-modal-foot">
          <p className="vr-run-status" role="status">
            {run.state === "running" ? "Checking again…"
              : run.state === "done" ? (run.to === run.from ? `Same result: ${run.to}%` : `Score updated: ${run.from}% to ${run.to}%`)
              : group.readAt}
          </p>
          <button className="secondary-btn" type="button" onClick={onClose}>Close</button>
          {canRun && (
            <button className="primary-btn vr-run" type="button" disabled={run.state === "running"} onClick={runAgain}>
              {run.state === "running" && <span className="vr-spinner" aria-hidden="true" />}
              {run.state === "running" ? "Running" : "Run again"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------- evidence */

function EvidencePane({ evidence }) {
  if (!evidence || evidence.kind === "none") {
    return <aside className="vr-evidence vr-evidence-empty"><p>No file uploaded</p></aside>;
  }
  if (evidence.kind === "photos") {
    const words = { own: "Their own", elsewhere: "Found elsewhere", unchecked: "Not checked" };
    return (
      <aside className="vr-evidence" aria-label="Photos">
        <div className="vr-photos">
          {evidence.photos.map((photo, index) => (
            <figure className={`vr-photo is-${photo.result}`} key={`${photo.src}-${index}`}>
              <img src={photo.src} alt={`Factory photo ${index + 1}`} />
              <figcaption>{photo.result === "elsewhere" && photo.where ? `On ${photo.where}` : words[photo.result]}</figcaption>
            </figure>
          ))}
        </div>
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
  return (
    <aside className="vr-evidence" aria-label="Registration document">
      <LicencePaper variant={evidence.variant} />
      <div className="vr-evidence-file"><span>{evidence.file}</span><button className="vr-text-action" type="button">Open</button></div>
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
      ["Ana faaliyet", "464201 · Toptan giyim ticareti"], ["İş yeri adresi", "Merter Mah., Güngören, İstanbul"],
    ],
  },
  pt: {
    kicker: "Conservatória do Registo Comercial",
    title: "Certidão Permanente",
    rows: [
      ["NIPC", "513284976"], ["Firma", "TÊXTEIS DOURO –\nCONFECÇÕES, LDA"], ["Natureza jurídica", "Sociedade por quotas"],
      ["CAE principal", "14130"], ["Sede", "Rua da Igreja 214, 4750-142 Arcozelo, Barcelos"], ["Data do registo", "2012-03-08"],
    ],
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
