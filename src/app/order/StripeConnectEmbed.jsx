import React, { useRef, useState } from "react";
import { ConnectAccountManagement, ConnectAccountOnboarding, ConnectComponentsProvider } from "@stripe/react-connect-js";
import { STRIPE_PUBLISHABLE_KEY } from "../../lib/domain/stripe.js";
import { connectInstanceFor } from "../../lib/stripe-connect-embed.js";

/**
 * Stripe's own payout forms, inside TSC's page: onboarding for a factory
 * setting up, account management (its payout bank accounts included) for one
 * already set up. No design draws them; they sit in the payout dialogs.
 *
 * Stripe draws its own errors once a form is showing. Before that it draws
 * nothing at all, so the loading line and a failure to load are ours.
 */
export default function StripeConnectEmbed({ org, country, form, onExit }) {
  const [shown, setShown] = useState(false);
  const [failure, setFailure] = useState(null);
  const shownRef = useRef(false);

  if (!STRIPE_PUBLISHABLE_KEY) {
    return <p className="tsc-connect-status error" role="alert">Payouts through Stripe are not set up on this site yet.</p>;
  }

  const common = {
    onLoaderStart: () => {
      shownRef.current = true;
      setShown(true);
    },
    onLoadError: ({ error }) => {
      if (!shownRef.current) setFailure(error?.message || "Stripe's form could not load.");
    },
  };

  return (
    <div className="tsc-connect-embed">
      {failure ? (
        <p className="tsc-connect-status error" role="alert">{failure} Close this window and try again.</p>
      ) : !shown ? (
        <p className="tsc-connect-status" role="status">Loading Stripe’s secure form…</p>
      ) : null}
      <ConnectComponentsProvider connectInstance={connectInstanceFor(org.id, country)}>
        {form === "onboarding" ? (
          // eventually_due: ask for everything Stripe will need once, rather
          // than sending the factory back for more after its first payout.
          <ConnectAccountOnboarding {...common} onExit={onExit} collectionOptions={{ fields: "eventually_due" }} />
        ) : (
          <ConnectAccountManagement {...common} />
        )}
      </ConnectComponentsProvider>
    </div>
  );
}
