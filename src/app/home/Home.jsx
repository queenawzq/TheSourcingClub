/**
 * The first thing anyone sees.
 *
 * It used to be a heading, a notification list, a row of buttons and a line
 * telling people the real screens lived in the prototype. That line is now
 * mostly untrue, and it was the worst possible thing to say to someone who had
 * just signed up.
 *
 * The organising idea is what is waiting on YOU, versus what you are waiting
 * on. Both sides get the same shape, because it is the same question — a brand
 * approving a sample and a factory cutting cloth are both "the other side
 * cannot move until you do".
 *
 * Every figure comes from dashboard_snapshot(). Nothing is computed here.
 */
import React, { useEffect, useState } from "react";
import { dashboardSnapshot } from "../../lib/domain/dashboard.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import NotificationList from "../NotificationList.jsx";
import "./home.css";

function Waiting({ count, label, detail, to, tone = "warning" }) {
  const { navigate } = useRouter();
  if (!count) return null;
  return (
    <button type="button" className={`home-waiting tone-${tone}`} data-testid="waiting-item"
            onClick={() => navigate(to)}>
      <strong>{count}</strong>
      <span className="home-waiting-label">{label}</span>
      {detail ? <span className="home-waiting-detail">{detail}</span> : null}
    </button>
  );
}

function Figure({ label, value, detail, to }) {
  const { navigate } = useRouter();
  return (
    <button type="button" className="home-figure" onClick={() => navigate(to)}>
      <span className="home-figure-value">{value}</span>
      <span className="home-figure-label">{label}</span>
      {detail ? <span className="home-figure-detail">{detail}</span> : null}
    </button>
  );
}

export default function Home({ org, profile, isFactory, user, admin }) {
  const { navigate } = useRouter();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    dashboardSnapshot(org.id)
      .then((row) => !cancelled && setSnapshot(row))
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id]);

  const s = snapshot ?? {};
  const nothingWaiting =
    snapshot &&
    !s.steps_awaiting_you && !s.unread_messages &&
    !(isFactory ? 0 : s.payments_due_cents) &&
    !(isFactory ? 0 : s.quotes_to_compare) &&
    !s.orders_awaiting_schedule;

  return (
    <main className="home">
      <header className="home-head">
        <span className="home-eyebrow">{isFactory ? "Factory" : "Brand"}</span>
        <h1>{org.name}</h1>
        <p className="home-sub">
          Signed in as {user?.email}
          {profile?.verification_status === "verified" ? " · verified" : null}
        </p>
      </header>

      {error ? <p className="ob-error">{error.message}</p> : null}

      <section className="home-block">
        <h2>Waiting on you</h2>
        {!snapshot ? (
          <div className="spinner" aria-hidden="true" />
        ) : nothingWaiting ? (
          <p className="home-clear" data-testid="nothing-waiting">
            Nothing needs you right now.
          </p>
        ) : (
          <div className="home-waiting-row">
            <Waiting
              count={s.orders_awaiting_schedule}
              label={s.orders_awaiting_schedule === 1 ? "schedule to agree" : "schedules to agree"}
              detail="Work cannot start until both sides agree"
              to="/orders"
            />
            <Waiting
              count={s.steps_awaiting_you}
              label={isFactory
                ? (s.steps_awaiting_you === 1 ? "step to work on" : "steps to work on")
                : (s.steps_awaiting_you === 1 ? "step to approve" : "steps to approve")}
              detail={isFactory ? "The brand is waiting on you" : "The factory is waiting on you"}
              to="/orders"
            />
            {!isFactory && s.payments_due_cents > 0 ? (
              <Waiting
                count={formatMoney(s.payments_due_cents)}
                label="due to pay"
                detail="The factory cannot start until it arrives"
                to="/orders"
                tone="danger"
              />
            ) : null}
            {!isFactory ? (
              <Waiting
                count={s.quotes_to_compare}
                label={s.quotes_to_compare === 1 ? "request with quotes" : "requests with quotes"}
                detail="Factories are waiting to hear"
                to="/rfqs"
              />
            ) : null}
            <Waiting
              count={s.unread_messages}
              label={s.unread_messages === 1 ? "unread message" : "unread messages"}
              to="/messages"
              tone="ready"
            />
          </div>
        )}
      </section>

      <NotificationList org={org} isFactory={isFactory} />

      <section className="home-block">
        <h2>{isFactory ? "Your work" : "Your orders"}</h2>
        <div className="home-figures">
          <Figure
            label={s.orders_active === 1 ? "order in production" : "orders in production"}
            value={s.orders_active ?? "—"}
            to="/orders"
          />
          {isFactory ? (
            <>
              <Figure label="awaiting our confirmation"
                      value={formatMoney(s.payments_in_flight_cents ?? 0)}
                      detail="Sent by the brand, not yet checked"
                      to="/orders" />
              <Figure label="confirmed for you"
                      value={formatMoney(s.payments_received_cents ?? 0)}
                      to="/orders" />
            </>
          ) : (
            <>
              <Figure label="due to pay"
                      value={formatMoney(s.payments_due_cents ?? 0)} to="/orders" />
              <Figure label="paid so far"
                      value={formatMoney(s.payments_received_cents ?? 0)} to="/orders" />
            </>
          )}
        </div>
      </section>

      <section className="home-block">
        <h2>{isFactory ? "Work worth quoting" : "Your requests"}</h2>
        <div className="home-figures">
          {isFactory ? (
            <>
              <Figure label={s.rfqs_open === 1 ? "open request you have not quoted" : "open requests you have not quoted"}
                      value={s.rfqs_open ?? "—"} to="/browse" />
              <Figure label={s.quotes_awaiting_decision === 1 ? "quote awaiting a decision" : "quotes awaiting a decision"}
                      value={s.quotes_awaiting_decision ?? "—"} to="/browse" />
            </>
          ) : (
            <>
              <Figure label={s.rfqs_open === 1 ? "open request" : "open requests"}
                      value={s.rfqs_open ?? "—"} to="/rfqs" />
              <Figure label={s.quotes_to_compare === 1 ? "with quotes to compare" : "with quotes to compare"}
                      value={s.quotes_to_compare ?? "—"} to="/rfqs" />
            </>
          )}
        </div>
        <div className="home-actions">
          {isFactory ? (
            <button type="button" className="primary-btn" onClick={() => navigate("/browse")}>
              Browse open requests
            </button>
          ) : (
            <>
              <button type="button" className="primary-btn" onClick={() => navigate("/rfqs/new")}>
                Post a request
              </button>
              {/* The figures above link here too, but someone scanning the row
                  of buttons will not see that. */}
              <button type="button" className="secondary-btn" onClick={() => navigate("/rfqs")}>
                Requests for quotes
              </button>
            </>
          )}
          <button type="button" className="secondary-btn" onClick={() => navigate("/orders")}>
            Production orders
          </button>
          <button type="button" className="secondary-btn" onClick={() => navigate("/messages")}>
            Conversations
          </button>
          <button type="button" className="quiet-btn" onClick={() => navigate("/team")}>
            Your team
          </button>
          {isFactory ? (
            <button type="button" className="quiet-btn" onClick={() => navigate("/payout")}>
              Where you get paid
            </button>
          ) : null}
          {admin ? (
            <button type="button" className="quiet-btn" onClick={() => navigate("/admin")}>
              Platform admin
            </button>
          ) : null}
        </div>
      </section>

      {profile && profile.verification_status !== "verified" ? (
        <p className="home-note">
          {isFactory
            ? "Your business registration is with our review team. You can browse and be found while you wait; quoting opens once it is approved."
            : "Your business registration is with our review team. Everything else works while you wait."}
        </p>
      ) : null}
    </main>
  );
}
