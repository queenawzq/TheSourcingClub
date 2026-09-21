import React from "react";

/**
 * "I have read and agree to the Terms and Conditions", with the document's
 * name linked to the full terms when there is somewhere to link to. Opens in
 * a new tab so the half-signed onboarding step survives.
 *
 * The prototypes pass no href and render the sentence exactly as designed.
 */
const DOCUMENT_NAME = /(Terms and Conditions|条款与条件)$/;

export function AgreementText({ text, href }) {
  const match = href ? String(text).match(DOCUMENT_NAME) : null;
  if (!match) return text;
  return (
    <>
      {text.slice(0, match.index)}
      <a href={href} target="_blank" rel="noopener">{match[0]}</a>
    </>
  );
}
