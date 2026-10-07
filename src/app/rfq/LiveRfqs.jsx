/**
 * The brand's requests, on Queena's designed `RfqsScreen`.
 *
 * The card's "Archive quote" menu item cancels the request through
 * cancel_rfq(), which closes the quotes on it and tells every vendor involved.
 * That is not something to do on one mis-click, so it asks first — in the
 * design's own modal, not a browser dialog.
 */
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { RfqsScreen } from "../../prototype/main.jsx";
import { DataProvider } from "../../lib/data/DataProvider.jsx";
import { cancelRfq } from "../../lib/domain/rfq.js";
import { useRouter } from "../../lib/router.jsx";
import { createLiveAdapter } from "../live-adapter.js";

export default function LiveRfqs({ org, user, isOwner, goTo }) {
  const { navigate } = useRouter();
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Bumped after a cancel so the list is read again with the request moved to
  // Closed, rather than trusting local state to have guessed right.
  const [version, setVersion] = useState(0);
  const adapter = useMemo(
    () => createLiveAdapter({ org, isFactory: false, user }),
    [org.id, user?.id, version],
  );

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancelRfq(confirming.id);
      setConfirming(null);
      setVersion((current) => current + 1);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const close = () => { setConfirming(null); setError(null); };

  return (
    <main className="rfqs-page brand-rfqs-page">
      <DataProvider adapter={adapter} key={version}>
        <RfqsScreen
          goTo={goTo}
          onViewQuotes={(rfq) => navigate(rfq?.id ? `/rfqs/${rfq.id}/quotes` : "/rfqs")}
          onEditRfq={(rfq) => navigate(rfq?.id ? `/rfqs/${rfq.id}/edit` : "/rfqs")}
          onInviteVendors={(rfq) => navigate(rfq?.id ? `/rfqs/${rfq.id}/invite` : "/rfqs")}
          onArchiveRfq={(rfq) => setConfirming(rfq)}
        />
      </DataProvider>
      {confirming && createPortal(
        <div className="brand-profile-modal-layer" data-testid="cancel-rfq-dialog">
          <button className="brand-profile-modal-scrim" type="button" aria-label="Keep the request" onClick={close} />
          <section className="brand-profile-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-rfq-title">
            <button className="brand-profile-modal-close" type="button" aria-label="Close" onClick={close}>×</button>
            <header className="brand-profile-modal-header">
              <h1 id="cancel-rfq-title">Archive “{confirming.title}”?</h1>
              <p>
                {isOwner
                  ? "The request closes to new quotes. Quotes already sent on it are declined, and every vendor you invited or who quoted is told."
                  : "Only an owner of your company can archive a request, because it closes every vendor's quote on it."}
              </p>
            </header>
            {error && <p className="composer-error" role="alert">{error.message}</p>}
            <footer className="brand-profile-modal-actions">
              <button className="secondary-btn" type="button" onClick={close}>Keep request</button>
              {isOwner && (
                <button className="primary-btn" type="button" onClick={confirm} disabled={busy} data-testid="confirm-cancel-rfq">
                  {busy ? "Archiving…" : "Archive request"}
                </button>
              )}
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </main>
  );
}
