/**
 * The messaging guidelines, opened from a blocked message's "guidelines" link.
 *
 * No design draws this pop-up's contents; the frame is the design's own dialog
 * (`approve-fund-modal`, as StepUpdatesModal uses), and the words are the
 * three rules in src/shared/message-guidelines.mjs, in the page's language
 * (`language`, English unless the page itself is Chinese).
 */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { guidelinesFor } from "../../shared/message-guidelines.mjs";

export default function MessageGuidelinesDialog({ onClose, language = "en" }) {
  const words = guidelinesFor(language);

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal((
    <div className="approve-fund-modal-layer" role="presentation">
      <button className="approve-fund-modal-scrim" type="button" aria-label={words.close} onClick={onClose} />
      <section className="approve-fund-modal message-guidelines-modal" role="dialog" aria-modal="true" aria-labelledby="message-guidelines-title" data-testid="message-guidelines">
        <button className="settings-drawer-close" type="button" aria-label={words.close} onClick={onClose}>
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </button>
        <header>
          <h2 id="message-guidelines-title">{words.title}</h2>
        </header>
        <ol className="message-guidelines-list">
          {words.rules.map((rule) => (
            <li key={rule.heading}>
              <strong>{rule.heading}</strong>
              <span>{rule.body}</span>
            </li>
          ))}
        </ol>
        <p className="message-guidelines-footer">{words.footer}</p>
      </section>
    </div>
  ), document.body);
}
