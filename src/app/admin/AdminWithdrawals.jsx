import React, { useState } from "react";
import { formatMoney } from "../../lib/money.js";
import { approveWithdrawal, declineWithdrawal, previewWithdrawal } from "../../lib/domain/withdrawals.js";
import { withdrawalFee } from "../../shared/withdrawal-fees.mjs";

/**
 * The board's Withdrawals tab: what factories asked for. Hand-built like the
 * rest of AdminPayments (no design draws a payments board). Approve reviews
 * first (the provider's quote and TSC's balance there), then pays; Decline
 * needs a reason the company reads. A bank withdrawal (refused since
 * 20261117500000) is only declined: TSC no longer pays a bank by hand.
 */

const NAME = { wise: "Wise", paypal: "PayPal", bank: "Bank transfer", tazapay: "Tazapay" };
const STATUS = { requested: "Waiting", paying: "Sending", paid: "Paid", failed: "Failed", declined: "Declined", cancelled: "Cancelled" };
const moneyIn = (minor, currency) => (minor == null ? "—" : formatMoney(Number(minor), currency ?? "USD"));

function WithdrawalActions({ row, onChanged }) {
  const [step, setStep] = useState(null); // null | "review" | "decline"
  const [preview, setPreview] = useState(null);
  const [text, setText] = useState("");
  const [statement, setStatement] = useState(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);
  const [heard, setHeard] = useState(null);
  const cny = row.provider === "wise" && row.wise_currency === "CNY";

  async function run(work) {
    setWorking(true);
    setProblem(null);
    try {
      await work();
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setWorking(false);
      onChanged();
    }
  }
  const review = () => run(async () => {
    setPreview(await previewWithdrawal(row.id, statement));
    setStep("review");
  });
  const pay = () => run(async () => {
    try {
      const result = await approveWithdrawal(row.id, statement);
      setHeard(result.done === "paid" ? "Paid." : result.done === "short_balance" ? result.sentence : "Sent. Waiting for the provider to confirm.");
    } finally {
      // Refused or not, the review is over: the row is read again (run's
      // onChanged), so its buttons are the row's as it is now.
      setStep(null);
      setPreview(null);
    }
  });

  if (!["requested", "paying"].includes(row.status)) return null;
  const said = <>
    {problem ? <span className="admin-error admin-row-message" role="alert" data-testid="withdrawal-refusal">{problem}</span> : null}
    {heard ? <span className="admin-sub admin-row-message" role="status">{heard}</span> : null}
    {/* The server keeps a refusal as the row's sentence too: said once. */}
    {row.staff_sentence && !heard && row.staff_sentence !== problem ? <span className="admin-sub admin-row-message">{row.staff_sentence}</span> : null}
  </>;

  // The provider has it: its answer is read back every 30 s, nothing to press.
  // Only a send that never reached the provider (no reference) is pressed
  // again, with the same key, so it cannot pay twice.
  if (row.status === "paying") {
    return <div className="admin-actions">{said}{row.provider_ref ? null : <button type="button" className="admin-approve" disabled={working} onClick={pay}>Press again</button>}</div>;
  }
  if (step === "decline") {
    return (
      <div className="admin-actions">
        {said}
        <label className="admin-sub">Reason (the factory reads this)
          <input value={text} onChange={(event) => setText(event.target.value)} maxLength={300} />
        </label>
        <button type="button" className="admin-reject" disabled={working || text.trim().length < 3}
          data-testid="withdrawal-decline-confirm"
          onClick={() => run(async () => {
            await declineWithdrawal(row.id, text.trim());
            setStep(null);
          })}>Decline</button>
        <button type="button" className="admin-reject" disabled={working} onClick={() => { setStep(null); setText(""); }}>Back</button>
      </div>
    );
  }
  if (step === "review" && preview) {
    return (
      <div className="admin-actions">
        {said}
        {preview.shortByCents ? (
          <span className="admin-error admin-row-message" data-testid="withdrawal-short">
            {`${NAME[row.provider]} balance is short by ${moneyIn(preview.shortByCents, row.currency)}. Top up TSC's ${NAME[row.provider]} balance first.`}
          </span>
        ) : (
          <span className="admin-sub admin-row-message" data-testid="withdrawal-quote">
            {`Amount ${moneyIn(row.amount_cents, row.currency)} · fee ${moneyIn(preview.feeCents, row.currency)} · factory receives ${moneyIn(preview.receivesMinor, preview.receivesCurrency)}`}
            {preview.leavesCents != null ? ` · leaves TSC's balance ${moneyIn(preview.leavesCents, row.currency)}` : ""}
            {preview.balanceCents != null ? ` · ${NAME[row.provider]} balance ${moneyIn(preview.balanceCents, row.currency)}` : ""}
          </span>
        )}
        <button type="button" className="admin-approve" disabled={working || Boolean(preview.shortByCents)} data-testid="withdrawal-pay" onClick={pay}>
          {working ? "Paying…" : `Pay ${moneyIn(row.amount_cents, row.currency)}`}
        </button>
        <button type="button" className="admin-reject" disabled={working} onClick={() => { setStep(null); setPreview(null); }}>Cancel</button>
      </div>
    );
  }
  return (
    <div className="admin-actions">
      {said}
      {cny ? (
        <label className="admin-check admin-row-message">
          <input type="checkbox" checked={statement} onChange={(event) => setStatement(event.target.checked)} />
          <span>The contract and invoice are denominated in CNY (Wise asks this for a Chinese bank account).</span>
        </label>
      ) : null}
      {row.provider === "bank"
        ? null
        : <button type="button" className="admin-approve" disabled={working || (cny && !statement)} data-testid="withdrawal-review" onClick={review}>Approve…</button>}
      <button type="button" className="admin-reject" disabled={working} data-testid="withdrawal-decline" onClick={() => setStep("decline")}>Decline…</button>
    </div>
  );
}

export default function WithdrawalsSection({ withdrawals, onChanged, providerLine = null, pausedOrgs = null }) {
  const open = withdrawals.filter((row) => ["requested", "paying"].includes(row.status));
  const recent = withdrawals.filter((row) => !["requested", "paying"].includes(row.status)).slice(0, 20);
  const rows = [...open, ...recent];
  return (
    <section className="payments-queue" data-section="withdrawals">
      <h2>Withdrawals ({open.length})</h2>
      {providerLine}
      {rows.length === 0 ? (
        <div className="payments-empty"><strong>All clear</strong><p className="admin-sub">No factory has asked to withdraw.</p></div>
      ) : (
        <div className="admin-scroll">
          <table>
            <thead><tr><th>Company</th><th>To</th><th>Amount</th><th>Status</th><th className="payments-action-heading">Actions</th></tr></thead>
            <tbody>
              {rows.map((row) => {
                // What it still holds: the asked amount less any part that went back to the brand since.
                // Being sent: the asked amount is what is in flight; the red line carries the rest.
                const refunded = Math.min(Number(row.amount_cents) || 0, Math.max(0, Number(row.refunded_cents) || 0));
                const holds = row.status === "requested" ? Number(row.amount_cents) - refunded : Number(row.amount_cents);
                const estimate = row.fee_cents == null ? withdrawalFee({ provider: row.provider, amountCents: holds, currency: row.currency }) : null;
                return (
                  <tr key={row.id} data-withdrawal={row.id}>
                    <td><strong>{row.factory_name}</strong>{/* The company's balance today, which already excludes every requested and paying withdrawal: true "after" only while this one is still open. */}{["requested", "paying"].includes(row.status) ? <span className="admin-sub">Balance after: {moneyIn(row.balance_after_cents, "USD")}</span> : null}
                      {/* Said before Pay is pressed: the same refusal claim_withdrawal would give. */}
                      {row.status === "requested" && row.covered === false ? <span className="admin-error" data-testid="withdrawal-not-covered">{pausedOrgs?.has(row.org_id)
                        // A payment review pauses it (Needs checking): decided there, not declined here.
                        ? "Withdrawals are paused while a payment is reviewed (Payment reviews, in Needs checking)."
                        : "The factory's balance no longer covers this. Decline it with a reason."}</span> : null}</td>
                    <td><strong className="payout-method-heading">{NAME[row.provider] ?? row.provider}</strong><span className="admin-sub">{row.paid_to}</span></td>
                    <td>
                      <strong>{moneyIn(holds, row.currency)}</strong>
                      <span className="admin-sub">
                        {row.fee_cents != null
                          ? `Fee ${moneyIn(row.fee_cents, row.currency)} · receives ${moneyIn(row.receives_minor, row.receives_currency ?? row.currency)}`
                          : estimate?.feeCents != null ? `Fee about ${moneyIn(estimate.feeCents, row.currency)} · receives about ${moneyIn(estimate.receivesCents, row.currency)}`
                          : estimate?.basis === "quote_needed" ? "Fee: quoted on Approve" : ""}
                      </span>
                    </td>
                    <td>{STATUS[row.status] ?? row.status}{row.reason && row.status !== "paid" ? <span className="admin-sub">{row.reason}</span> : null}
                      {refunded > 0 && row.status === "requested" ? <span className="admin-sub" data-testid="withdrawal-refunded-part">{`${moneyIn(refunded, row.currency)} went back to the brand.`}</span> : null}
                      {/* Already sent: nothing is taken from the factory by itself; a payment review decides. */}
                      {refunded > 0 && row.status === "paying" ? <span className="admin-sub admin-error" data-testid="withdrawal-at-risk">{`${moneyIn(refunded, row.currency)} of this payout went back to the brand after it was sent. It's in Payment reviews.`}</span> : null}</td>
                    <td><WithdrawalActions row={row} onChanged={onChanged} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
