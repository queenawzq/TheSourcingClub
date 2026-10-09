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
import { listThreads } from "../../lib/domain/message.js";
import { useRouter } from "../../lib/router.jsx";
import { BACK_LABELS, brandFactoryView } from "./brand-factory-view.js";
import { loadVendorProfileForBrand } from "./load-profile.js";
import { useSavedVendors } from "../browse/useSavedVendors.js";
import "./profile.css";

/** Where the back link goes when there is no in-app page to go back to. */
const FALLBACK = { browse: "/browse", saved: "/saved", dashboard: "/", quotes: "/rfqs", order: "/orders", invite: "/rfqs" };

function Frame({ children }) {
  return <main className="factory-profile-page brand-profile-page">{children}</main>;
}

/**
 * `from`: where it was opened ("browse", "saved", "dashboard", "quotes", "order", "invite"),
 * which picks the back link's words. `onBack` / `onRequestQuote` replace the
 * default actions (the composer shows this in place of its invite step).
 */
export default function LiveBrandFactoryProfile({ org, user, vendorOrgId, from = null, onBack = null, onRequestQuote = null }) {
  const { navigate } = useRouter();
  const { saveFor, error: saveError } = useSavedVendors(org, user);
  const [state, setState] = useState({ parts: undefined, thread: null, error: null });

  useEffect(() => {
    let cancelled = false;
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

  const requestQuote = onRequestQuote ?? (() => navigate(`/rfqs/new?invite=${vendorOrgId}`));
  const message = state.thread ? () => navigate(`/messages/${state.thread.id}`) : null;

  return (
    <Frame>
      <BrandFactoryProfileScreen
        live={{
          ...brandFactoryView(state.parts),
          back: { label: backLabel, onClick: back },
          // Only where the brand can save (the composer's invite step has no user).
          save: user ? saveFor(vendorOrgId) : null,
          onSave: null,
          onMessage: message,
          onRequestQuote: requestQuote,
          // A conversation belongs to a request or an order, so without one
          // the contact card's way in is a request.
          contact: message ? { label: "Message factory", onClick: message } : { label: "Request quote", onClick: requestQuote },
        }}
      />
      {saveError && <p className="live-profile-error" role="alert">Couldn't update your saved vendors: {saveError.message}</p>}
    </Frame>
  );
}
