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
  const [pause, setPause] = useState({ brand: false, factory: false, key: "" });
  useEffect(() => {
    if (!orgId) return undefined;
    let cancelled = false;
    const read = () => myPaymentPause(orgId)
      .then((status) => {
        if (cancelled) return;
        // What the pause is now: a new review (or the end of one) changes it.
        const key = JSON.stringify([Boolean(status?.brand_paused), status?.brand_since ?? null, status?.factory?.paused ? [status.factory.since, status.factory.count] : null]);
        setPause({ brand: Boolean(status?.brand_paused), factory: Boolean(status?.factory?.paused), key });
      })
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
/** A greyed action's hover text while the brand is paused, as on the order page. */
export const PAUSED_TITLE = "Your account is under review.";
/** The order page's paused line, also on Payments and a payment's page. */
export const PAYMENTS_PAUSED_LINE = "Your account is under review. You can't fund or approve until it's done.";
export const PAUSED_ACCEPT = "You can't accept quotes while your account is under review.";

/** The brand's one paused line, the same on the notice and the Payments page. */
export const BRAND_PAUSED_LINE = "A payment was disputed, so your account is under review. You can still message vendors.";

const closedKey = (orgId) => `tsc-pause-notice-closed:${orgId}`;
const readClosed = (orgId) => { try { return sessionStorage.getItem(closedKey(orgId)); } catch { return null; } };

/**
 * The paused company's notice, on every page, in the team-notice frame, in
 * the page's flow above the content, so it never covers an input. OK closes
 * it until the pause changes (a new review, or the end of one), remembered
 * per company for this tab.
 */
export function PaymentPauseNotice({ org, isFactory }) {
  const pause = usePaymentPause(org?.id);
  const { path } = useRouter();
  const [closed, setClosed] = useState(() => readClosed(org?.id));
  useEffect(() => { setClosed(readClosed(org?.id)); }, [org?.id]);
  const paused = isFactory ? pause.factory : pause.brand;
  // Not paused any more: forget OK, so the next pause is said again.
  useEffect(() => {
    if (!org?.id || !pause.key || paused) return;
    try { sessionStorage.removeItem(closedKey(org.id)); } catch { /* nothing kept */ }
  }, [org?.id, pause.key, paused]);
  const close = () => {
    try { sessionStorage.setItem(closedKey(org.id), pause.key); } catch { /* closed for this page only */ }
    setClosed(pause.key);
  };
  // The factory's Payments page says it on the balance card already; the
  // brand's Payments page says it above its figures.
  if (!paused || (closed && closed === pause.key) || /^\/(payout|payments)(\/|$)/.test(path ?? "")) return null;
  return (
    <div className="tsc-team-notices tsc-review-notice" role="status" data-testid={isFactory ? "factory-under-review" : "brand-under-review"}>
      <div className="tsc-team-notice">
        <p>{isFactory
          ? "Withdrawals are paused while a payment is reviewed."
          : BRAND_PAUSED_LINE}</p>
        <div className="tsc-team-notice-actions">
          <button type="button" className="quiet-btn" onClick={close}>OK</button>
        </div>
      </div>
    </div>
  );
}
