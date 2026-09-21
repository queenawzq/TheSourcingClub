/**
 * The public Terms and Privacy pages — app.html?legal=terms&type=brand, and
 * app.html?legal=privacy.
 *
 * Readable signed out: the signup screen links here before the visitor has an
 * account, and current_legal_documents() is granted to anon for exactly that.
 *
 * Not a new design: it is Queena's Terms dialog, the same one onboarding
 * opens, showing the published document. Closing it goes back to where the
 * reader came from.
 */
import React, { useEffect, useState } from "react";
import { TermsDialog } from "../shared/TermsDialog.jsx";
import { TERMS_TYPES, listCurrentLegalDocuments, pickText } from "../lib/domain/legal.js";

function readLanguage(params) {
  if (params.get("lang") === "zh") return "zh";
  try {
    return window.localStorage.getItem("factoryLang") === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

function leave() {
  if (window.history.length > 1) window.history.back();
  else window.location.assign("/app.html");
}

export default function LegalPage() {
  const params = new URLSearchParams(window.location.search);
  const isPrivacy = params.get("legal") === "privacy";
  const language = readLanguage(params);
  const type = TERMS_TYPES[params.get("type")] ? params.get("type") : "brand";
  const kind = isPrivacy ? "privacy" : TERMS_TYPES[type];
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listCurrentLegalDocuments().then(
      (byKind) => !cancelled && setDocuments(byKind),
      (err) => !cancelled && setError(err),
    );
    return () => { cancelled = true; };
  }, []);

  const doc = documents?.[kind];
  if (error || (documents && !doc)) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>{language === "zh" ? "无法加载文件" : "This document could not be loaded"}</h1>
          <p className="gate-error">{error?.message ?? (language === "zh" ? "该文件尚未发布。" : "It has not been published.")}</p>
        </div>
      </div>
    );
  }
  if (!doc) return null;

  return (
    <TermsDialog
      accountType={type === "brand" ? "brand" : "factory"}
      language={language}
      text={pickText(doc.full_en, doc.full_zh, language)}
      title={isPrivacy ? (language === "zh" ? "隐私政策" : "Privacy Policy") : undefined}
      onClose={leave}
    />
  );
}
