/**
 * A brand's profile as a vendor sees it, on the designed
 * `FactoryBrandPublicProfilePage`, with the brand's real profile behind it.
 *
 * It reads only what brand_profile_for_factory() returns, and only for a
 * brand whose request this vendor can see: never the brand's revenue, email,
 * website, documents or dealings with other vendors. "Save brand" keeps it on
 * the vendor's Saved page. "Contact brand" opens the latest conversation with
 * the brand; without one, the brand's newest open request.
 */
import React, { useCallback, useEffect, useState } from "react";
import { FactoryBrandPublicProfilePage } from "../../factory-prototype/main.jsx";
import { saveBrand, unsaveBrand } from "../../lib/domain/rfq.js";
import { useRouter } from "../../lib/router.jsx";
import { factoryBrandView } from "./brand-profile-view.js";
import { loadBrandProfileForFactory } from "./load-profile.js";
import "./profile.css";

/** Where it was opened → the back link's words, and where it goes when there is no history. */
const BACK = {
  saved: ["Back to saved brands", "/saved"],
  request: ["Back to request", "/browse"],
  order: ["Back to order", "/orders"],
};

function Frame({ children }) {
  return <main className="factory-profile-page brand-profile-page factory-brand-public-page">{children}</main>;
}

export default function LiveFactoryBrandProfile({ org, user, brandOrgId, from = null }) {
  const { navigate } = useRouter();
  const [state, setState] = useState({ parts: undefined, error: null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(() => loadBrandProfileForFactory(org, brandOrgId), [org.id, brandOrgId]);

  useEffect(() => {
    let cancelled = false;
    setState({ parts: undefined, error: null });
    load().then(
      (parts) => !cancelled && setState({ parts, error: null }),
      (error) => !cancelled && setState({ parts: null, error }),
    );
    return () => { cancelled = true; };
  }, [load]);

  const [backLabel, fallback] = BACK[from] ?? ["Back", "/saved"];
  const back = () => {
    // An in-app visit has history state (router.jsx pushes it); a page opened
    // straight from a link has none, so it goes to the list it came from.
    if (window.history.state) window.history.back();
    else navigate(fallback);
  };

  if (state.parts === undefined) {
    return <Frame><p className="live-profile-loading">Loading the profile…</p></Frame>;
  }
  if (!state.parts) {
    // The function refuses a brand none of whose requests this vendor can see.
    const refused = /visibility|42501|permission/i.test(state.error?.message ?? "");
    return (
      <Frame>
        <div className="factory-profile-shell">
          <button className="factory-profile-public-back" type="button" onClick={back}>← {backLabel}</button>
          <p className={refused ? "live-profile-loading" : "live-profile-error"} role={refused ? undefined : "alert"}>
            {refused
              ? "This brand's profile opens once you can see one of its requests."
              : `Couldn't load this profile: ${state.error?.message ?? "unknown error"}`}
          </p>
        </div>
      </Frame>
    );
  }

  const { parts } = state;
  const toggleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      if (parts.saved) await unsaveBrand(org.id, brandOrgId);
      else await saveBrand(org.id, brandOrgId, user.id);
      setState({ parts: { ...parts, saved: !parts.saved }, error: null });
    } catch (error) {
      setSaveError(error);
    } finally {
      setSaving(false);
    }
  };
  const contact = parts.thread
    ? { label: "Contact brand", onClick: () => navigate(`/messages/${parts.thread.id}`) }
    : parts.openRequest
      ? { label: "View request", onClick: () => navigate(`/browse/${parts.openRequest.id}`) }
      : null;

  return (
    <>
      <FactoryBrandPublicProfilePage
        brandName={parts.data?.name}
        language="en"
        onBack={back}
        live={{
          ...factoryBrandView(parts),
          back: { label: backLabel, onClick: back },
          save: { saved: parts.saved, busy: saving, onToggle: toggleSave },
          contact,
        }}
      />
      {saveError && <p className="live-profile-error" role="alert">{saveError.message}</p>}
    </>
  );
}
