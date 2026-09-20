/**
 * The admin operations workspace, on live data.
 *
 * Mounts the SAME App as admin-prototype.html, against the marketplace
 * instead of the constants in the file. There is no second copy of the admin
 * UI: everything on screen is Queena's, reached through the data seam.
 *
 * Two gates before it renders, and they are not the same gate:
 *
 *   signed out          → sign in, like everywhere else
 *   signed in, not staff → told plainly, and shown nothing
 *
 * The second is a courtesy, not a control. Every function this page calls is
 * gated on is_platform_admin() inside the database, so a non-admin who edits
 * this check out gets four 42501s and an empty screen.
 */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth, MIN_PASSWORD_LENGTH } from "../../lib/auth.jsx";
import { AuthScreen } from "../../shared/AuthScreen.jsx";
import { isConfigured } from "../../lib/supabase.js";
import { isPlatformAdmin } from "../../lib/domain/admin.js";
import { DataProvider } from "../../lib/data/DataProvider.jsx";
import { createAdminAdapter } from "./live-admin-adapter.js";
import ErrorBoundary from "../../lib/ErrorBoundary.jsx";
import App from "../../admin-prototype/main.jsx";
import "../shell.css";

function Gate({ title, children }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <p className="gate-eyebrow">The Sourcing Club</p>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

/**
 * Staff sign in here, not on the brand portal and then back.
 *
 * This page previously sent people to /app.html to sign in and return, which
 * left no way to tell which account you had used — the complaint that
 * prompted this. Mounting the designed AuthScreen in its `staff` variant says
 * "Admin sign-in" on the screen you are typing into.
 *
 * Google is off here regardless of the flag: a staff account is created by
 * someone with database access, not by whoever happens to hold a Google
 * account with that address.
 */
function StaffSignIn() {
  const { signInWithPassword, requestPasswordReset, error, clearError } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [resetFor, setResetFor] = useState(null);

  async function authenticate(submitted) {
    setBusy(true);
    setNotice(null);
    await signInWithPassword({
      email: submitted.email,
      password: submitted.password,
      keepSignedIn: submitted.keepSignedIn,
    });
    // No navigation on success: the session changes and AdminConsole re-renders.
    setBusy(false);
  }

  async function sendReset(email) {
    setBusy(true);
    const { exists } = await requestPasswordReset(email);
    setBusy(false);
    setResetFor(null);
    setNotice(
      exists === true
        ? `A reset link is on its way to ${email}.`
        : exists === false
          ? `There is no account for ${email}. Check the address.`
          : `If an account exists for ${email}, a reset link is on its way.`
    );
  }

  if (resetFor !== null) {
    return (
      <Gate title="Reset your password">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sendReset(new FormData(event.currentTarget).get("email"));
          }}
        >
          <label className="gate-field">
            <span>Work email</span>
            <input name="email" type="email" required autoFocus defaultValue={resetFor} />
          </label>
          <button className="primary-btn" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <button className="secondary-btn" type="button" onClick={() => setResetFor(null)}>
            Back
          </button>
        </form>
      </Gate>
    );
  }

  return (
    <AuthScreen
      staff
      initialMode="login"
      busy={busy}
      error={error}
      notice={notice}
      googleEnabled={false}
      minPasswordLength={MIN_PASSWORD_LENGTH}
      homeHref="/"
      onForgotPassword={() => {
        clearError();
        setResetFor("");
      }}
      onAuthenticate={authenticate}
    />
  );
}

/**
 * Signed in, for this page's purposes.
 *
 * There is no "signed-in" status: the auth machine reports "ready" when the
 * user has an org and "no-org" when they do not. Platform staff usually have
 * none — that is the normal shape of an admin account, not an incomplete one
 * — so both count here. Checking for a status that does not exist would have
 * left every admin staring at the sign-in prompt.
 */
const SIGNED_IN = ["ready", "no-org"];

function AdminConsole() {
  const { status, error, user, signOut } = useAuth();
  const [staff, setStaff] = useState(null);

  useEffect(() => {
    if (!SIGNED_IN.includes(status)) {
      setStaff(null);
      return undefined;
    }
    let cancelled = false;
    isPlatformAdmin().then((result) => !cancelled && setStaff(result));
    return () => { cancelled = true; };
  }, [status]);

  if (status === "unconfigured" || !isConfigured) {
    return (
      <Gate title="Backend not connected">
        <p className="gate-note">
          This build has no Supabase credentials. Set <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>, then redeploy.
        </p>
      </Gate>
    );
  }
  if (status === "loading") return <Gate title="Checking your session…" />;
  if (status === "signed-out") return <StaffSignIn />;
  if (status === "error") {
    return (
      <Gate title="Something went wrong">
        <p className="gate-note">{error?.message ?? "Your session could not be loaded."}</p>
        <button type="button" className="secondary-btn" onClick={signOut}>Sign out</button>
      </Gate>
    );
  }
  if (staff === null) return <Gate title="Checking your access…" />;

  if (!staff) {
    return (
      <Gate title="Not a staff account">
        <p className="gate-note">
          {user?.email} is not on the platform admin list, so this workspace has nothing
          to show. If that is wrong, ask someone who already has access to add the
          address — it takes effect the next time you sign in.
        </p>
        <button type="button" className="secondary-btn" onClick={signOut}>Sign out</button>
      </Gate>
    );
  }

  return (
    <DataProvider adapter={createAdminAdapter({ user })}>
      <App />
    </DataProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <AuthProvider>
      <AdminConsole />
    </AuthProvider>
  </ErrorBoundary>,
);
