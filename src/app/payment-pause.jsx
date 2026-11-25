import React, { useEffect, useState } from "react";
import { myPaymentPause } from "../lib/domain/payment-reviews.js";
import { useRouter } from "../lib/router.jsx";

/**
 * Whether this company is paused by a payment review (20261124100000):
 * `brand` (only messaging while a dispute is reviewed) and `factory`
 * (withdrawals paused). Read on mount, every minute and when the tab is shown
 * again. Unknown (a failed read) is "not paused": the database refuses either
 * way, and says why.
 */
export function usePaymentPause(orgId) {
  const [pause, setPause] = useState({ brand: false, factory: false });
  useEffect(() => {
    if (!orgId) return undefined;
    let cancelled = false;
    const read = () => myPaymentPause(orgId)
      .then((status) => { if (!cancelled) setPause({ brand: Boolean(status?.brand_paused), factory: Boolean(status?.factory?.paused) }); })
      .catch(() => {});
    read();
    const timer = setInterval(read, 60000);
    const onShow = () => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener("visibilitychange", onShow); };
  }, [orgId]);
  return pause;
}

/** The brand's refusal, said before it does the work (the database refuses the same). */
export const PAUSED_POST = "You can't post requests while your account is under review.";
export const PAUSED_ACCEPT = "You can't accept quotes while your account is under review.";

/**
 * The paused company's notice, on every page, in the team-notice frame. OK
 * closes it for this visit only: it is back on the next page load while the
 * company is still paused.
 */
export function PaymentPauseNotice({ org, isFactory }) {
  const pause = usePaymentPause(org?.id);
  const { path } = useRouter();
  const [closed, setClosed] = useState(false);
  const paused = isFactory ? pause.factory : pause.brand;
  // The factory's Payments page says it on the balance card already.
  if (!paused || closed || (isFactory && /^\/payout(\/|$)/.test(path ?? ""))) return null;
  return (
    <div className="tsc-team-notices tsc-review-notice" role="status" data-testid={isFactory ? "factory-under-review" : "brand-under-review"}>
      <div className="tsc-team-notice">
        <p>{isFactory
          ? "Withdrawals are paused while a payment is reviewed."
          : "A payment was disputed, so your account is under review. You can still message vendors."}</p>
        <div className="tsc-team-notice-actions">
          <button type="button" className="quiet-btn" onClick={() => setClosed(true)}>OK</button>
        </div>
      </div>
    </div>
  );
}
