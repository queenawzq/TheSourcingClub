/**
 * Form controls shared by the onboarding flows.
 *
 * Every option list here comes from taxonomy_terms rather than a hardcoded
 * array, which is the point of the taxonomy table: the two sides of the
 * marketplace can no longer drift into different spellings of the same thing.
 */
import React, { useState } from "react";
import { CUSTOM_KINDS, addCustomTerm, termLabel } from "../../lib/domain/taxonomy.js";

export function Field({ label, hint, children }) {
  return (
    <label className="ob-field">
      <span className="ob-label">{label}</span>
      {children}
      {hint ? <span className="ob-hint">{hint}</span> : null}
    </label>
  );
}

export function TextField({ label, hint, value, onChange, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="text"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
    </Field>
  );
}

export function TextArea({ label, hint, value, onChange, rows = 5, ...rest }) {
  return (
    <Field label={label} hint={hint}>
      <textarea
        rows={rows}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
    </Field>
  );
}

/** Single choice from a vocabulary. Stores the term's slug. */
export function TermSelect({ label, hint, terms, value, onChange, locale, placeholder }) {
  return (
    <Field label={label} hint={hint}>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{placeholder ?? "Select…"}</option>
        {terms.map((term) => (
          <option key={term.id} value={term.slug}>
            {termLabel(term, locale)}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Multi-select chips. Stores term ids, because these become taxonomy_links
 * rows rather than a column on the profile.
 *
 * Kinds flagged allows_custom get an "add your own" affordance; the database
 * rejects a custom term on any other kind, so this is a convenience rather
 * than the actual guard.
 */
export function ChipGroup({ label, hint, kind, terms, selectedIds, onChange, orgId, locale }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [localTerms, setLocalTerms] = useState(terms);
  const [error, setError] = useState(null);

  const allowsCustom = CUSTOM_KINDS.has(kind);

  function toggle(termId) {
    onChange(
      selectedIds.includes(termId)
        ? selectedIds.filter((id) => id !== termId)
        : [...selectedIds, termId],
    );
  }

  async function commitCustom() {
    const label = draft.trim();
    if (!label) {
      setAdding(false);
      return;
    }

    try {
      const term = await addCustomTerm(orgId, kind, label);
      setLocalTerms((current) => [...current, term]);
      onChange([...selectedIds, term.id]);
      setDraft("");
      setAdding(false);
      setError(null);
    } catch (addError) {
      setError(addError);
    }
  }

  return (
    <div className="ob-field">
      <span className="ob-label">{label}</span>
      {hint ? <span className="ob-hint ob-hint--above">{hint}</span> : null}

      <div className="chip-row">
        {localTerms.map((term) => {
          const isSelected = selectedIds.includes(term.id);
          return (
            <button
              key={term.id}
              type="button"
              className={`chip-toggle${isSelected ? " is-selected" : ""}`}
              aria-pressed={isSelected}
              onClick={() => toggle(term.id)}
            >
              {termLabel(term, locale)}
              {term.org_id ? <span className="chip-own" title="Added by you">•</span> : null}
            </button>
          );
        })}

        {allowsCustom && !adding ? (
          <button type="button" className="chip-toggle chip-add" onClick={() => setAdding(true)}>
            + Add your own
          </button>
        ) : null}

        {adding ? (
          <span className="chip-input">
            <input
              autoFocus
              value={draft}
              placeholder="Type and press Enter"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitCustom();
                }
                if (event.key === "Escape") {
                  setAdding(false);
                  setDraft("");
                }
              }}
              onBlur={commitCustom}
            />
          </span>
        ) : null}
      </div>

      {error ? <span className="ob-error">{error.message}</span> : null}
    </div>
  );
}

/**
 * File upload.
 *
 * Says out loud whether a file will be private, because "business
 * registration" and "logo" look identical as an upload box and are not
 * remotely the same decision.
 */
export function UploadField({ label, hint, accept, isPrivate, existing, onUpload, onRemove }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;

    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        await onUpload(file);
      }
    } catch (uploadError) {
      setError(uploadError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ob-field">
      <span className="ob-label">
        {label}
        {isPrivate ? <span className="private-tag">Private</span> : null}
      </span>
      {hint ? <span className="ob-hint ob-hint--above">{hint}</span> : null}

      <label className={`upload-zone${busy ? " is-busy" : ""}`}>
        <input
          type="file"
          accept={accept}
          multiple
          disabled={busy}
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <span>{busy ? "Uploading…" : "Choose a file or drag it here"}</span>
      </label>

      {existing?.length ? (
        <ul className="file-list">
          {existing.map((doc) => (
            <li key={doc.id}>
              <span className="file-name">{doc.file_name}</span>
              <span className="file-meta">{Math.round((doc.size_bytes ?? 0) / 1024)} KB</span>
              <button type="button" className="file-remove" onClick={() => onRemove(doc)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <span className="ob-error">{error.message}</span> : null}
    </div>
  );
}
