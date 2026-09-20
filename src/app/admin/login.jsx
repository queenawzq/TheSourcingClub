import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "../../lib/auth.jsx";
import { isConfigured } from "../../lib/supabase.js";
import { isPlatformAdmin } from "../../lib/domain/admin.js";
import ErrorBoundary from "../../lib/ErrorBoundary.jsx";
import "./admin-login.css";

const SIGNED_IN = ["ready", "no-org"];

function safeDestination() {
  const value = new URLSearchParams(window.location.search).get("next");
  return value?.startsWith("/admin.html") ? value : "/admin.html?screen=overview";
}

function AdminLogin() {
  const {
    status,
    error,
    clearError,
    signInWithPassword,
    requestPasswordReset,
    sendEmailCode,
    verifyEmailCode,
    updatePassword,
    signOut,
  } = useAuth();
  const destination = useMemo(safeDestination, []);
  const resetting = useMemo(() => new URLSearchParams(window.location.search).get("reset") === "1", []);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [codeFor, setCodeFor] = useState("");
  const [accessState, setAccessState] = useState("idle");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (resetting) {
      setAccessState("idle");
      return undefined;
    }
    if (!SIGNED_IN.includes(status)) {
      setAccessState("idle");
      return undefined;
    }

    let cancelled = false;
    setAccessState("checking");
    isPlatformAdmin().then((allowed) => {
      if (cancelled) return;
      if (allowed) {
        setAccessState("allowed");
        window.location.replace(destination);
      } else {
        setAccessState("denied");
      }
    });
    return () => { cancelled = true; };
  }, [status, destination, resetting]);

  async function submitLogin(event) {
    event.preventDefault();
    clearError();
    setLocalError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    await signInWithPassword({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      keepSignedIn: form.get("keepSignedIn") === "on",
    });
    setBusy(false);
  }

  async function submitRecovery(event) {
    event.preventDefault();
    clearError();
    setLocalError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const { exists } = await requestPasswordReset(email);
    setRecoveryMessage(
      exists === true
        ? `A reset link is on its way to ${email}.`
        : exists === false
          ? `There is no account for ${email}. Check the address.`
          : `If an account exists for ${email}, a reset link is on its way.`,
    );
    setBusy(false);
  }

  async function submitEmailCode(event) {
    const form = event.currentTarget.closest("form");
    const email = String(new FormData(form).get("email") ?? "").trim();
    clearError();
    setLocalError("");
    if (!email.includes("@")) {
      setLocalError("Enter your staff email first.");
      return;
    }
    setBusy(true);
    const sent = await sendEmailCode(email, { createUser: false });
    setBusy(false);
    if (sent) setCodeFor(email);
  }

  async function submitCode(event) {
    event.preventDefault();
    clearError();
    setLocalError("");
    setBusy(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    await verifyEmailCode(codeFor, code);
    setBusy(false);
  }

  async function submitNewPassword(event) {
    event.preventDefault();
    clearError();
    setLocalError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirmation") ?? "");
    if (password !== confirmation) {
      setLocalError("The passwords do not match.");
      return;
    }
    setBusy(true);
    const changed = await updatePassword(password);
    setBusy(false);
    if (changed) {
      const nextUrl = new URL("/admin-login.html", window.location.origin);
      nextUrl.searchParams.set("next", destination);
      window.location.replace(nextUrl.toString());
    }
  }

  const checking = status === "loading" || accessState === "checking" || accessState === "allowed";

  return (
    <main className="admin-login-page">
      <section className="admin-login-story" aria-label="Operations workspace overview">
        <a className="admin-login-logo" href="/" aria-label="The Sourcing Club homepage">
          <img src="/assets/logo.svg" alt="The Sourcing Club" />
        </a>

        <div className="admin-login-story-copy">
          <span className="admin-login-kicker">Private operations portal</span>
          <h1>Keep the marketplace moving.</h1>
          <p>Review profiles, monitor sourcing activity, and manage the people who keep every order accountable.</p>
        </div>

        <div className="admin-login-signals" aria-label="Operations responsibilities">
          <div><strong>01</strong><span>Profile verification</span></div>
          <div><strong>02</strong><span>Marketplace oversight</span></div>
          <div><strong>03</strong><span>Payment operations</span></div>
        </div>

        <p className="admin-login-confidential">Internal access · Authorized staff only</p>
      </section>

      <section className="admin-login-workspace">
        <a className="admin-login-close" href="/" aria-label="Close and return to homepage">
          <img src="/assets/prototype-icons/close.svg" alt="" />
        </a>

        <div className="admin-login-card">
          <header>
            <span>Operations team</span>
            <h2>{resetting ? "Set a new password" : codeFor ? "Enter your sign-in code" : recovery ? "Reset your password" : "Staff sign-in"}</h2>
            <p>{resetting ? "Choose a new password for your staff account." : codeFor ? `We emailed a one-time code to ${codeFor}.` : recovery ? "Enter your staff email and we’ll send a secure reset link." : "Use your authorized staff account to continue to the admin workspace."}</p>
          </header>

          {!isConfigured || status === "unconfigured" ? (
            <div className="admin-login-message error">
              <strong>Backend not connected</strong>
              <p>Add the Supabase credentials before signing in.</p>
            </div>
          ) : accessState === "denied" ? (
            <div className="admin-login-access-denied">
              <span aria-hidden="true">!</span>
              <h3>This account does not have staff access</h3>
              <p>Ask an existing administrator to add this email to the platform staff list.</p>
              <button type="button" onClick={signOut}>Use another account</button>
            </div>
          ) : checking ? (
            <div className="admin-login-checking" role="status">
              <span className="admin-login-spinner" aria-hidden="true" />
              <strong>{accessState === "checking" || accessState === "allowed" ? "Verifying staff access…" : "Checking your session…"}</strong>
            </div>
          ) : codeFor ? (
            <form className="admin-login-form" onSubmit={submitCode}>
              <label>
                <span>Six-digit code</span>
                <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required autoFocus />
              </label>
              {(localError || error) && <p className="admin-login-message error" role="alert">{localError || error.message}</p>}
              <button className="admin-login-submit" type="submit" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
              <button className="admin-login-text-button" type="button" onClick={() => { setCodeFor(""); clearError(); }}>Back to password sign-in</button>
            </form>
          ) : resetting ? (
            <form className="admin-login-form" onSubmit={submitNewPassword}>
              <label>
                <span>New password</span>
                <input type="password" name="password" placeholder="At least 8 characters" autoComplete="new-password" minLength="8" required />
              </label>
              <label>
                <span>Confirm new password</span>
                <input type="password" name="confirmation" placeholder="Enter it again" autoComplete="new-password" minLength="8" required />
              </label>
              {(localError || error) && <p className="admin-login-message error" role="alert">{localError || error.message}</p>}
              <button className="admin-login-submit" type="submit" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
            </form>
          ) : recovery ? (
            <form className="admin-login-form" onSubmit={submitRecovery}>
              <label>
                <span>Staff email</span>
                <input type="email" name="email" placeholder="you@thesourcingclub.com" autoComplete="email" required />
              </label>
              {recoveryMessage && <p className="admin-login-message success" role="status">{recoveryMessage}</p>}
              {(localError || error) && <p className="admin-login-message error" role="alert">{localError || error.message}</p>}
              <button className="admin-login-submit" type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
              <button className="admin-login-text-button" type="button" onClick={() => { setRecovery(false); setRecoveryMessage(""); clearError(); }}>Back to sign-in</button>
            </form>
          ) : (
            <form className="admin-login-form" onSubmit={submitLogin}>
              <label>
                <span>Staff email</span>
                <input type="email" name="email" placeholder="you@thesourcingclub.com" autoComplete="email" required />
              </label>
              <label>
                <span>Password</span>
                <span className="admin-login-password">
                  <input type={showPassword ? "text" : "password"} name="password" placeholder="Enter your password" autoComplete="current-password" required />
                  <button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button>
                </span>
              </label>
              <div className="admin-login-options">
                <label><input type="checkbox" name="keepSignedIn" defaultChecked /><span>Keep me signed in</span></label>
                <button type="button" onClick={() => { setRecovery(true); clearError(); }}>Forgot password?</button>
              </div>
              {(localError || error) && <p className="admin-login-message error" role="alert">{localError || error.message}</p>}
              <button className="admin-login-submit" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button>
              <button className="admin-login-text-button" type="button" disabled={busy} onClick={submitEmailCode}>Email me a sign-in code</button>
            </form>
          )}

          <footer>
            <span className="admin-login-lock" aria-hidden="true"><img src="/assets/prototype-icons/verification.svg" alt="" /></span>
            <p>Access is restricted and activity may be logged for marketplace security.</p>
          </footer>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary label="Staff sign-in">
    <AuthProvider>
      <AdminLogin />
    </AuthProvider>
  </ErrorBoundary>,
);
