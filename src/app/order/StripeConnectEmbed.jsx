import React, { useEffect, useRef, useState } from "react";
import { ConnectAccountManagement, ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import { STRIPE_PUBLISHABLE_KEY } from "../../lib/domain/stripe.js";
import { connectInstanceFor } from "../../lib/stripe-connect-embed.js";

/**
 * Stripe's own payout forms, inside TSC's page: onboarding for a factory
 * setting up, account management (its payout bank accounts included) for one
 * already set up. No design draws them; they sit in the payout dialogs.
 *
 * Stripe draws its own errors once a form is showing. Before that it draws
 * nothing at all, so the loading line and a failure to load are ours. Its
 * "loader started" callback comes at once and its frame then stays one pixel
 * high for up to 20 s, then about 130 px while its own placeholder shows, so
 * the form has arrived when the frame is taller than that.
 */
const ARRIVED_PX = 200;
const STARTED_PX = 40;
const GIVE_UP_MS = 45000;

export default function StripeConnectEmbed({ org, country, form, onExit, upgrade = false }) {
  const [shown, setShown] = useState(false);
  const [failure, setFailure] = useState(null);
  const shownRef = useRef(false);
  const frame = useRef(null);

  useEffect(() => {
    if (!frame.current || !STRIPE_PUBLISHABLE_KEY) return undefined;
    const arrive = () => {
      shownRef.current = true;
      setShown(true);
      setFailure(null);
      window.clearTimeout(timer);
      watcher.disconnect();
    };
    const timer = window.setTimeout(() => {
      // A short form is still a form: only an empty frame has failed.
      if ((frame.current?.offsetHeight ?? 0) >= STARTED_PX) arrive();
      else if (!shownRef.current) setFailure("The form could not load.");
    }, GIVE_UP_MS);
    const watcher = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height >= ARRIVED_PX) arrive();
    });
    watcher.observe(frame.current);
    return () => {
      window.clearTimeout(timer);
      watcher.disconnect();
    };
  }, []);

  if (!STRIPE_PUBLISHABLE_KEY) {
    return <p className="tsc-connect-status error" role="alert">Withdrawals are not set up on this site yet.</p>;
  }

  const common = {
    onLoadError: ({ error }) => {
      if (!shownRef.current) setFailure(error?.message || "The form could not load.");
    },
  };

  return (
    <div className="tsc-connect-embed">
      {failure ? (
        <p className="tsc-connect-status error" role="alert">{failure} Close this window and try again.</p>
      ) : !shown ? (
        <div className="tsc-connect-status tsc-connect-loading" role="status"><div className="spinner" aria-hidden="true" />Loading…</div>
      ) : null}
      <div ref={frame}>
        <ConnectComponentsProvider connectInstance={connectInstanceFor(org.id, country, upgrade)}>
          {form === "onboarding" ? (
            // eventually_due: ask for everything Stripe will need once, rather
            // than sending the factory back for more after its first payout.
            <ConnectAccountOnboarding {...common} onExit={onExit} collectionOptions={{ fields: "eventually_due" }} />
          ) : (
            <ConnectAccountManagement {...common} />
          )}
        </ConnectComponentsProvider>
      </div>
    </div>
  );
}
