/**
 * Everything posted on one production step, as a pop-up over the order.
 *
 * The design review (Oct 2) asked for updates to open in a pop-up rather
 * than a separate page. The designs draw only the latest update on a row
 * ("View all updates (n)") and no list behind that link, so this is the
 * design's own dialog frame (`approve-fund-modal`) holding the design's own
 * update card, once per update, newest first. Adding an update or a comment
 * stays where the design puts it: the row's own dialog.
 *
 * Shared by both apps' order pages, so the brand and the factory read a
 * step's history the same way.
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./step-updates.css";

const PHOTO = /^image\//;

/**
 * `step`: `{ title }`. `updates`: that step's updates, newest first, each
 * `{ id, author, when, body, documents: [{ id, file_name, mime_type }] }`.
 * `urlFor(document)` mints a signed URL; `onOpenFile(document)` opens a file.
 */
export function StepUpdatesModal({ step, updates, urlFor, onOpenFile, onClose }) {
  const [urls, setUrls] = useState({});

  // Signed URLs for every photo in the history, minted when it opens.
  useEffect(() => {
    let cancelled = false;
    const photos = updates.flatMap((update) => (update.documents ?? []).filter((doc) => PHOTO.test(doc.mime_type ?? "")));
    Promise.all(photos.map(async (doc) => [doc.id, await urlFor(doc).catch(() => null)]))
      .then((pairs) => { if (!cancelled) setUrls(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [updates, urlFor]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal((
    <div className="approve-fund-modal-layer" role="presentation">
      <button className="approve-fund-modal-scrim" type="button" aria-label="Close updates" onClick={onClose} />
      <section className="approve-fund-modal step-updates-modal" role="dialog" aria-modal="true" aria-labelledby="step-updates-title" data-testid="step-updates">
        <button className="settings-drawer-close" type="button" aria-label="Close updates" onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header>
          <p>Production step</p>
          <h2 id="step-updates-title">{step.title}</h2>
          <span>
            {updates.length
              ? `${updates.length} ${updates.length === 1 ? "update" : "updates"} on this step, newest first.`
              : "Nothing has been posted on this step yet."}
          </span>
        </header>
        <div className="step-updates-list">
          {updates.map((update) => {
            const documents = update.documents ?? [];
            const photos = documents.filter((doc) => PHOTO.test(doc.mime_type ?? ""));
            const others = documents.filter((doc) => !PHOTO.test(doc.mime_type ?? ""));
            return (
              <div className="project-update-card" key={update.id} data-testid="step-update">
                <div className="project-update-header">
                  <strong>{update.author}</strong>
                  <span>{update.when}</span>
                </div>
                <p>{update.body}</p>
                {documents.length > 0 && (
                  <div className="sample-file-row">
                    {photos.map((doc) => (
                      <button className="sample-file" type="button" key={doc.id} onClick={() => onOpenFile(doc)}>
                        {urls[doc.id] ? <img src={urls[doc.id]} alt="" /> : null}
                        <span>{doc.file_name}</span>
                      </button>
                    ))}
                    {others.map((doc) => (
                      <button type="button" key={doc.id} onClick={() => onOpenFile(doc)}>{doc.file_name}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <footer>
          <button className="secondary-btn" type="button" onClick={onClose}>Close</button>
        </footer>
      </section>
    </div>
  ), document.body);
}
