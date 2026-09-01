/**
 * The authenticated app shell.
 *
 * One entry point for both sides: after Google sign-in, the org's type decides
 * whether the brand or the factory experience renders. The two existing
 * prototypes are wired in behind this gate phase by phase; until a phase
 * lands, its screens still run on their own mock data at their original URLs.
 */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "../lib/auth.jsx";
import { createOrg } from "../lib/domain/org.js";
import { isConfigured } from "../lib/supabase.js";
import "./shell.css";

function Loading({ label }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="spinner" aria-hidden="true" />
        <p className="gate-note">{label}</p>
      </div>
    </div>
  );
}

function SetupNeeded() {
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>Backend not connected</h1>
        <p className="gate-note">
          This build has no Supabase credentials, so there is nothing to sign in to.
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then
          redeploy.
        </p>
        <p className="gate-note">
          Running locally? <code>supabase start</code> prints both values.
        </p>
      </div>
    </div>
  );
}

function SignIn() {
  const { signInWithGoogle, error } = useAuth();

  return (
    <div className="gate">
      <div className="gate-card">
        <p className="gate-eyebrow">The Sourcing Club</p>
        <h1>Sign in</h1>
        <p className="gate-note">
          We use your Google account. There is no password to set or remember.
        </p>

        <button type="button" className="google-btn" onClick={signInWithGoogle}>
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
            <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
          </svg>
          Continue with Google
        </button>

        {error ? <p className="gate-error">{error.message}</p> : null}
      </div>
    </div>
  );
}

function ChooseOrgType() {
  const { user, refreshOrgs, signOut } = useAuth();
  const [kind, setKind] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!kind || !name.trim() || busy) return;

    setBusy(true);
    setError(null);
    try {
      await createOrg(name, kind);
      await refreshOrgs();
    } catch (createError) {
      setError(createError);
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <p className="gate-eyebrow">Signed in as {user?.email}</p>
        <h1>Which side are you on?</h1>
        <p className="gate-note">
          This decides what you see. It cannot be changed later without our help,
          so pick the one that matches your business.
        </p>

        <div className="kind-grid">
          <button
            type="button"
            className={`kind-card${kind === "brand" ? " is-selected" : ""}`}
            aria-pressed={kind === "brand"}
            onClick={() => setKind("brand")}
          >
            <strong>I&rsquo;m a brand</strong>
            <span>I want things made. I post requests and choose factories.</span>
          </button>

          <button
            type="button"
            className={`kind-card${kind === "factory" ? " is-selected" : ""}`}
            aria-pressed={kind === "factory"}
            onClick={() => setKind("factory")}
          >
            <strong>I&rsquo;m a factory</strong>
            <span>I make things. I quote on requests and run production.</span>
          </button>
        </div>

        <label className="field">
          <span>{kind === "factory" ? "Factory name" : "Brand name"}</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={kind === "factory" ? "Atelier Minho" : "Maison Rue"}
            autoComplete="organization"
          />
        </label>

        <button type="submit" className="primary-btn" disabled={!kind || !name.trim() || busy}>
          {busy ? "Creating…" : "Continue"}
        </button>

        {error ? <p className="gate-error">{error.message}</p> : null}

        <button type="button" className="quiet-btn" onClick={signOut}>
          Sign out
        </button>
      </form>
    </div>
  );
}

/**
 * Routed by org type. Each side's real screens land here as their phase is
 * wired up; right now this confirms the whole chain works end to end —
 * Google session, org membership, and an RLS-scoped read.
 */
function Shell() {
  const { activeOrg, orgs, selectOrg, signOut, user } = useAuth();
  const isFactory = activeOrg.type === "factory";

  return (
    <div className="shell">
      <header className="shell-bar">
        <span className="shell-mark">The Sourcing Club</span>

        {orgs.length > 1 ? (
          <select
            className="org-switch"
            value={activeOrg.id}
            onChange={(event) => selectOrg(event.target.value)}
            aria-label="Active organisation"
          >
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        ) : null}

        <button type="button" className="quiet-btn" onClick={signOut}>
          Sign out
        </button>
      </header>

      <main className="shell-body">
        <span className={`side-chip side-chip--${activeOrg.type}`}>
          {isFactory ? "Factory" : "Brand"}
        </span>
        <h1>{activeOrg.name}</h1>
        <p className="shell-note">
          Signed in as {user?.email}. You are the {activeOrg.role} of this organisation.
        </p>

        <dl className="fact-grid">
          <div>
            <dt>Org id</dt>
            <dd>{activeOrg.id}</dd>
          </div>
          <div>
            <dt>Slug</dt>
            <dd>{activeOrg.slug}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{activeOrg.type}</dd>
          </div>
        </dl>

        <p className="shell-note">
          Auth, tenancy and access rules are live. The {isFactory ? "factory" : "brand"} screens
          are wired to this shell phase by phase; until then they run on mock data at{" "}
          <a href={isFactory ? "/factory-prototype.html" : "/prototype.html"}>
            their original address
          </a>
          .
        </p>
      </main>
    </div>
  );
}

function App() {
  const { status, error } = useAuth();

  if (status === "unconfigured") return <SetupNeeded />;
  if (status === "loading") return <Loading label="Checking your session…" />;
  if (status === "signed-out") return <SignIn />;
  if (status === "no-org") return <ChooseOrgType />;
  if (status === "error") {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Something went wrong</h1>
          <p className="gate-error">{error?.message}</p>
        </div>
      </div>
    );
  }
  return <Shell />;
}

createRoot(document.getElementById("root")).render(
  <AuthProvider>
    <App />
  </AuthProvider>,
);
