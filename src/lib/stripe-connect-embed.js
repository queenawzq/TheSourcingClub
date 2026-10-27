import { loadConnectAndInitialize } from "@stripe/connect-js/pure";
import { STRIPE_PUBLISHABLE_KEY, connectSession } from "./domain/stripe.js";

/**
 * Stripe's embedded payout forms (Connect embedded components): one instance
 * per company per page, as Stripe asks, reused by every form that opens.
 *
 * `pure` loads Stripe's script only when a form first opens, not on every
 * page of the app. Stripe calls fetchClientSecret again on its own when a
 * session expires, so it always asks the server for a fresh one.
 */
const instances = new Map();

// Design System v2 (src/app/shell.css :root). Stripe's forms render in their
// own frame, where our CSS variables do not reach, so the values are copied.
const APPEARANCE = {
  overlays: "dialog",
  variables: {
    fontFamily: "Satoshi, system-ui, sans-serif",
    colorPrimary: "#1a4df2",
    colorText: "#0b1020",
    colorSecondaryText: "#5a6b87",
    colorBorder: "#d7e0ea",
    colorDanger: "#b33416",
    borderRadius: "8px",
    buttonBorderRadius: "34px",
    formBorderRadius: "8px",
  },
};

// Stripe fetches fonts from inside its frame, and only over https: a laptop
// on http gets the system face rather than a console error.
function fonts() {
  if (window.location.protocol !== "https:") return [];
  return [["Regular", "400"], ["Medium", "500"], ["Bold", "700"]].map(([file, weight]) => ({
    family: "Satoshi",
    src: `url(${window.location.origin}/assets/fonts/Satoshi-${file}.otf)`,
    weight,
  }));
}

/**
 * The Connect instance for a company. `country` is used only if the company
 * has no Stripe account yet, when the first session creates one.
 */
export function connectInstanceFor(orgId, country) {
  let entry = instances.get(orgId);
  if (!entry) {
    entry = { country };
    entry.instance = loadConnectAndInitialize({
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      fetchClientSecret: () => connectSession(orgId, entry.country),
      appearance: APPEARANCE,
      fonts: fonts(),
    });
    instances.set(orgId, entry);
  }
  if (country) entry.country = country;
  return entry.instance;
}

/**
 * End every Stripe session this page opened. Only on signing out: Stripe's
 * logout also ends the person's Stripe sign-in, so calling it when a form
 * closes would make them confirm the code again next time.
 */
export function logoutStripeConnect() {
  for (const { instance } of instances.values()) {
    // Signing out of TSC must never wait on, or fail because of, Stripe.
    Promise.resolve().then(() => instance.logout()).catch(() => {});
  }
  instances.clear();
}
