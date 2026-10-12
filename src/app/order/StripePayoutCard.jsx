/**
 * "Get paid with Stripe", on the factory's Payments page (Earnings tab).
 *
 * TSC holds each payment the brand funds and pays the factory when the brand
 * approves the step: by Stripe transfer to the factory's own Express account
 * where Stripe can pay out (the US, Canada, the UK, Switzerland and the EEA),
 * otherwise by bank transfer from staff to the bank details below this card.
 *
 * Only an owner sets it up: Stripe's own pages take the company's identity,
 * business and bank details and its Connected Account Agreement; nothing of
 * that passes through TSC. Coming back (?stripe=return) reads the account's
 * status from Stripe; an expired link (?stripe=refresh) makes a fresh one.
 * Live only: there is no design for this card.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { connectAccountFor, connectAction } from "../../lib/domain/stripe.js";
import { PAYOUT_COUNTRIES } from "../../shared/stripe-payout-countries.mjs";

// Where factories on TSC are, besides the countries Stripe pays out to.
const OTHER_COUNTRIES = ["CN", "HK", "TW", "VN", "IN", "BD", "PK", "TR", "ID", "TH", "KH", "LK", "KR", "JP", "MX", "BR", "MA", "EG"];
const names = new Intl.DisplayNames(["en"], { type: "region" });
const COUNTRIES = [...new Set([...PAYOUT_COUNTRIES, ...OTHER_COUNTRIES])]
  .map((code) => ({ code, name: names.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name));

const countryName = (code) => (code ? names.of(code) ?? code : "");

export default function StripePayoutCard({ org, isOwner }) {
  const [account, setAccount] = useState(undefined);
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [saved, { data: profile }] = await Promise.all([
      connectAccountFor(org.id),
      supabase.from("factory_profiles").select("country_code").eq("org_id", org.id).maybeSingle(),
    ]);
    setAccount(saved);
    setCountry((current) => current || saved?.country || profile?.country_code || "");
  }, [org.id]);

  // Back from Stripe: read the account's status, or make a new link when the
  // old one expired. The query string is cleared either way.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const back = params.get("stripe");
    const clean = () => {
      params.delete("stripe");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    };
    (async () => {
      if (back && isOwner) {
        clean();
        if (back === "refresh") {
          const { url } = await connectAction(org.id, "onboard");
          window.location.assign(url);
          return;
        }
        await connectAction(org.id, "refresh");
      }
      await load();
    })().catch((failure) => {
      setError(failure);
      setAccount((current) => (current === undefined ? null : current));
    });
  }, [org.id, isOwner, load]);

  const supported = PAYOUT_COUNTRIES.has(country);
  const status = useMemo(() => {
    if (!account) return null;
    if (account.transfers_active) return { label: "Payouts on", tone: "on", text: "TSC pays you through Stripe as soon as a brand approves a funded step." };
    if (account.details_submitted) {
      return { label: "Checking", tone: "wait", text: "Stripe is checking your details. Payouts start once it has finished; approved payments wait for you until then." };
    }
    return { label: "Finish setup", tone: "wait", text: "Stripe still needs some details before it can pay you." };
  }, [account]);

  async function go(action, extra) {
    setBusy(true);
    setError(null);
    try {
      const result = await connectAction(org.id, action, extra);
      if (result.url) {
        if (action === "dashboard") window.open(result.url, "_blank", "noopener");
        else window.location.assign(result.url);
      }
      if (result.account) setAccount(result.account);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (account === undefined) return null;

  return (
    <section className="live-payout-method-card live-stripe-payout-card" data-testid="stripe-payout-card">
      <div>
        <span>Get paid with Stripe</span>
        {account ? (
          <>
            <strong>
              {status.label} · {countryName(account.country)}
            </strong>
            <p>{status.text}</p>
          </>
        ) : isOwner ? (
          <>
            <strong>Receive payouts straight to your bank</strong>
            <label className="live-stripe-country">
              <span>Where your company is registered</span>
              <select name="stripe_country" value={country} onChange={(event) => setCountry(event.target.value)}>
                <option value="">Choose a country</option>
                {COUNTRIES.map((item) => <option value={item.code} key={item.code}>{item.name}</option>)}
              </select>
            </label>
            {country && !supported ? (
              <p data-testid="stripe-unsupported">
                Stripe can't pay out to companies in {countryName(country)} yet. Add your bank details below
                and TSC staff pay you by bank transfer when a brand approves a step.
              </p>
            ) : (
              <p>Stripe verifies your company and bank account on its own pages. TSC pays you when a brand approves a funded step.</p>
            )}
          </>
        ) : (
          <>
            <strong>Not set up yet</strong>
            <p>An owner of your company can set up payouts through Stripe here.</p>
          </>
        )}
        {error ? <p className="live-stripe-error" role="alert">{error.message}</p> : null}
      </div>
      {isOwner ? (
        account ? (
          <div className="live-stripe-actions">
            {!account.transfers_active && (
              <button className="primary-btn compact-btn" type="button" disabled={busy} onClick={() => go("onboard")}>
                {busy ? "Opening Stripe…" : "Finish setup"}
              </button>
            )}
            {account.details_submitted && (
              <button className="secondary-btn compact-btn" type="button" disabled={busy} onClick={() => go("dashboard")}>
                Open Stripe dashboard
              </button>
            )}
          </div>
        ) : (
          <button className="primary-btn compact-btn" type="button" data-testid="stripe-onboard"
                  disabled={busy || !supported} onClick={() => go("onboard", { country })}>
            {busy ? "Opening Stripe…" : "Set up payouts"}
          </button>
        )
      ) : null}
    </section>
  );
}
