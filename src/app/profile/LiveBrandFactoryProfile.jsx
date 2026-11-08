import FactoryMatch from "../matching/FactoryMatch.jsx";
import { matchingEnabled, assessFactories } from "../../lib/domain/matching.js";
/**
 * A vendor's profile as a brand sees it, on the designed
 * `BrandFactoryProfileScreen`, with the vendor's real profile behind it.
 *
 * It reads only what the access rules give any brand for a published profile
 * (load-profile.js says what, and what it leaves out). The designed buttons
 * go where something real is behind them: "Request quote" opens the composer
 * with this vendor ticked, "Message" opens the brand's conversation with it
 * when there is one. "Save factory" keeps it on the brand's Saved page, and
 * pressing it again ("Saved") removes it.
 */
import React, { useEffect, useState } from "react";
import { BrandFactoryProfileScreen } from "../../prototype/main.jsx";
import { FactoryManufacturingProfilePage } from "../../factory-prototype/main.jsx";
import { factoryProfileView } from "./factory-profile-view.js";
import { supabase } from "../../lib/supabase.js";
import { englishProfileParts } from "./profile-translation.mjs";
import { urlFor } from "../../lib/domain/documents.js";
import { listThreads } from "../../lib/domain/message.js";
import { useRouter } from "../../lib/router.jsx";
import { BACK_LABELS, brandFactoryView } from "./brand-factory-view.js";
import { loadVendorProfileForBrand } from "./load-profile.js";
import { useSavedVendors } from "../browse/useSavedVendors.js";
import "./profile.css";
import { can, permissionHint } from "../../lib/domain/org.js";

/** Where the back link goes when there is no in-app page to go back to. */
const FALLBACK = { browse: "/browse", saved: "/saved", dashboard: "/", quotes: "/rfqs", order: "/orders", invite: "/rfqs" };

function Frame({ children }) {
  return <div>{children}</div>;
}

/**
 * `from`: where it was opened ("browse", "saved", "dashboard", "quotes", "order", "invite"),
 * which picks the back link's words. `onBack` / `onRequestQuote` replace the
 * default actions (the composer shows this in place of its invite step).
 */
export default function LiveBrandFactoryProfile({ org, user, vendorOrgId, from = null, onBack = null, onRequestQuote = null }) {
  const { navigate } = useRouter();
  const { saveFor, error: saveError } = useSavedVendors(org, user);
  const [preview, setPreview] = useState(null);
  const [translation, setTranslation] = useState({ loading: true, texts: {}, error: false });
  const [showOriginal, setShowOriginal] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setShowOriginal(false);
    setTranslation({ loading: true, texts: {}, error: false });
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch("/api/profile-translation", {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
          body: JSON.stringify({ orgId: vendorOrgId }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (!cancelled) setTranslation({ loading: false, texts: data.translations ?? {}, error: Boolean(data.incomplete) });
      } catch {
        if (!cancelled) setTranslation({ loading: false, texts: {}, error: true });
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [vendorOrgId, org.id]);
  const [assessment, setAssessment] = useState(null);
  const [state, setState] = useState({ parts: undefined, thread: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setAssessment(null);
    matchingEnabled().then(async enabled=>{if(enabled){const matches=await assessFactories("brand_profile",org.id,[vendorOrgId]); if(!cancelled)setAssessment(matches.get(vendorOrgId));}}).catch(()=>{});
    setState({ parts: undefined, thread: null, error: null });
    Promise.all([loadVendorProfileForBrand(vendorOrgId), listThreads(org.id)]).then(
      ([parts, threads]) => {
        if (cancelled) return;
        // listThreads is newest first: the latest conversation with this vendor.
        const thread = threads.find((item) => item.brand_org_id === org.id && item.factory_org_id === vendorOrgId) ?? null;
        setState({ parts, thread, error: null });
      },
      (error) => !cancelled && setState({ parts: null, thread: null, error }),
    );
    return () => { cancelled = true; };
  }, [org.id, vendorOrgId]);

  const back = onBack ?? (() => {
    // An in-app visit has history state (router.jsx pushes it); a page opened
    // straight from a link has none, so it goes to the list it came from.
    if (window.history.state) window.history.back();
    else navigate(FALLBACK[from] ?? "/");
  });
  const backLabel = BACK_LABELS[from] ?? "previous page";

  if (state.parts === undefined) {
    return <Frame><p className="live-profile-loading">Loading the profile…</p></Frame>;
  }
  if (!state.parts) {
    return (
      <Frame>
        <div className="brand-factory-profile-back-row">
          <button className="project-back-link" type="button" onClick={back}>‹ Back to {backLabel}</button>
        </div>
        <p className={state.error ? "live-profile-error" : "live-profile-loading"} role={state.error ? "alert" : undefined}>
          {state.error ? `Couldn't load this profile: ${state.error.message}` : "This vendor isn't listed on TSC."}
        </p>
      </Frame>
    );
  }

  const translated = Object.keys(translation.texts).length > 0;
  const displayedParts = showOriginal ? state.parts : englishProfileParts(state.parts, translation.texts);
  const isTrading = state.parts.profile?.vendor_kind === "trading_company";
  const ProfileComponent = isTrading ? BrandFactoryProfileScreen : FactoryManufacturingProfilePage;
  const publicView = factoryProfileView(displayedParts);
  publicView.data = {
    ...publicView.data,
    clubOrders: String(state.parts.publicMetrics?.clubOrders ?? 0),
    repeatBrands: String(state.parts.publicMetrics?.repeatBrands ?? 0),
    certifications: brandFactoryView(displayedParts).trust,
  };
  const quoteLocked = can(org, "rfqFlow") ? "" : permissionHint(org, "rfqFlow");
  const requestQuote = onRequestQuote ?? (() => navigate(`/rfqs/new?invite=${vendorOrgId}`));
  const message = state.thread ? () => navigate(`/messages/${state.thread.id}`) : null;

  return (
    <Frame>
      <ProfileComponent
        language="en"
        live={{
          ...(isTrading ? brandFactoryView(displayedParts) : publicView),
          publicView: true,
          translationControls: (<div className="profile-translation-controls" aria-live="polite">
        {translation.loading ? <span>Preparing English version…</span> : <>
          {translated && <><span className="profile-translation-label">{showOriginal ? "Original text" : "Automatically translated to English"}</span><button type="button" onClick={() => setShowOriginal((current) => !current)}>{showOriginal ? "See English translation" : "See original"}</button></>}
        </>}
      </div>),
          onPreviewDocument: async (document) => {
            setPreview({ document, loading: true });
            try {
              const url = await urlFor(document);
              setPreview((current) => current?.document.id === document.id ? { document, url } : current);
            } catch (error) {
              setPreview((current) => current?.document.id === document.id ? { document, error: error.message } : current);
            }
          },
          matchPanel: assessment ? (
            <section className="matching-panel matching-in-column" aria-label="How this factory matches">
              <header className="matching-head"><h2>How it matches your needs</h2></header>
              <FactoryMatch match={assessment} name={state.parts.orgName} open />
            </section>
          ) : null,
          back: { label: backLabel, onClick: back },
          // Only where the brand can save (the composer's invite step has no user).
          save: user ? saveFor(vendorOrgId) : null,
          onSave: null,
          onMessage: message,
          onRequestQuote: requestQuote,
          quoteLocked,
          // A conversation belongs to a request or an order, so without one
          // the contact card's way in is a request.
          contact: message ? { label: "Message factory", onClick: message } : { label: "Request quote", onClick: requestQuote, quoteLocked },
        }}
      />
      {preview && <div className="approve-fund-modal-layer">
        <section className="approve-fund-modal profile-document-modal" role="dialog" aria-modal="true" aria-label={`${preview.document.file_name} preview`}>
          <button className="settings-drawer-close" type="button" aria-label="Close document preview" autoFocus onClick={() => setPreview(null)}><img src="/assets/prototype-icons/close.svg" alt="" /></button>
          <header><h2>{preview.document.file_name}</h2></header>
          {preview.loading ? <p role="status">Loading preview…</p> : preview.error ? <p role="alert">{preview.error}</p> : <>
            {preview.document.mime_type?.startsWith("image/") ? <img src={preview.url} alt={preview.document.file_name} />
              : /\.pdf$/i.test(preview.document.file_name) || preview.document.mime_type === "application/pdf" ? <iframe src={preview.url} title={preview.document.file_name} />
              : <p>This file type cannot be previewed here.</p>}
            <a href={preview.url} target="_blank" rel="noopener noreferrer">Open document in a new tab</a>
          </>}
        </section>
      </div>}
      {saveError && <p className="live-profile-error" role="alert">Couldn't update your saved vendors: {saveError.message}</p>}
    </Frame>
  );
}
