/**
 * The public Terms and Privacy pages — app.html?legal=terms&type=brand, and
 * app.html?legal=privacy.
 *
 * Readable signed out: the signup screen links here before the visitor has an
 * account, and current_legal_documents() is granted to anon for exactly that.
 *
 * Not a new design. The frame is the signup screen's and the document is the
 * admin editor's own preview (LegalDocumentBody), so what staff see when they
 * publish is what a reader sees. Loaded lazily from main.jsx, which keeps the
 * admin stylesheet out of every other screen in the app.
 */
import React, { useEffect, useState } from "react";
import { LegalDocumentBody } from "../admin-prototype/main.jsx";
import { TERMS_TYPES, listCurrentLegalDocuments, pickText } from "../lib/domain/legal.js";
import "../shared/auth-screen.css";
import "./legal-page.css";

const TYPE_LABELS = { brand: "Brand", factory: "Factory", trading: "Trading company" };

function readLanguage(params) {
  if (params.get("lang") === "zh") return "zh";
  try {
    return window.localStorage.getItem("factoryLang") === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

export default function LegalPage() {
  const params = new URLSearchParams(window.location.search);
  const isPrivacy = params.get("legal") === "privacy";
  const language = readLanguage(params);
  const [type, setType] = useState(() => (TERMS_TYPES[params.get("type")] ? params.get("type") : "brand"));
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

  // Keep the address in step, so a copied link opens the tab being read.
  function chooseType(next) {
    setType(next);
    const url = new URL(window.location.href);
    url.searchParams.set("type", next);
    window.history.replaceState(null, "", url.toString());
  }

  const kind = isPrivacy ? "privacy" : TERMS_TYPES[type];
  const doc = documents?.[kind];
  const audience = isPrivacy || type === "brand" ? "brand" : "factory";
  const title = isPrivacy
    ? (language === "zh" ? "隐私政策" : "Privacy Policy")
    : (language === "zh" ? "条款与条件" : "Terms and Conditions");

  return (
    <main className={`auth-page auth-page-${audience} legal-page`}>
      <section className="auth-story" aria-label={title}>
        <a className="auth-logo" href="/">
          <img src="/assets/logo.svg" alt="The Sourcing Club" />
        </a>
        <div className="auth-story-copy">
          <span>The Sourcing Club</span>
          <h1>{title}</h1>
          {doc && <p>{language === "zh" ? `第 ${doc.version} 版` : `Version ${doc.version}`} · {new Date(doc.published_at).toLocaleDateString(language === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", year: "numeric" })}</p>}
        </div>
      </section>

      <section className="auth-workspace legal-page-workspace">
        <div className="auth-mobile-logo">
          <img src="/assets/logo.svg" alt="The Sourcing Club" />
        </div>
        <div className="legal-page-content">
          {!isPrivacy && (
            <nav className="admin-terms-tabs" aria-label="Terms account type">
              {Object.keys(TERMS_TYPES).map((option) => (
                <button className={type === option ? "active" : ""} type="button" aria-current={type === option ? "page" : undefined} onClick={() => chooseType(option)} key={option}>{TYPE_LABELS[option]}</button>
              ))}
            </nav>
          )}
          {error
            ? <p className="auth-error" role="alert">{language === "zh" ? "无法加载文件。" : "This document could not be loaded."} {error.message}</p>
            : !documents
              ? <p className="auth-notice" role="status">{language === "zh" ? "加载中…" : "Loading…"}</p>
              : doc
                ? <LegalDocumentBody text={pickText(doc.full_en, doc.full_zh, language)} />
                : <p className="auth-error" role="alert">{language === "zh" ? "该文件尚未发布。" : "This document has not been published."}</p>}
        </div>
      </section>
    </main>
  );
}
