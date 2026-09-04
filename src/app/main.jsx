/**
 * The authenticated app shell.
 *
 * One entry point for both sides: after Google sign-in, the org's type decides
 * whether the brand or the factory experience renders. The two existing
 * prototypes are wired in behind this gate phase by phase; until a phase
 * lands, its screens still run on their own mock data at their original URLs.
 */
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "../lib/auth.jsx";
import { createOrg } from "../lib/domain/org.js";
import { getBrandProfile, getFactoryProfile } from "../lib/domain/profile.js";
import BrandOnboarding from "./onboarding/BrandOnboarding.jsx";
import FactoryOnboarding from "./onboarding/FactoryOnboarding.jsx";
import { isConfigured } from "../lib/supabase.js";
import { RouterProvider, useRoute, useRouter } from "../lib/router.jsx";
import { isPlatformAdmin } from "../lib/domain/admin.js";
import AdminVerifications from "./admin/AdminVerifications.jsx";
import RfqList from "./rfq/RfqList.jsx";
import RfqCreate from "./rfq/RfqCreate.jsx";
import RfqDetail from "./rfq/RfqDetail.jsx";
import BrowseRfqs from "./rfq/BrowseRfqs.jsx";
import QuoteForm from "./quote/QuoteForm.jsx";
import QuoteSent from "./quote/QuoteSent.jsx";
import QuoteCompare from "./quote/QuoteCompare.jsx";
import InviteFactories from "./rfq/InviteFactories.jsx";
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
  const { sendEmailCode, verifyEmailCode, signInWithGoogle, googleEnabled, error } = useAuth();

  const [stage, setStage] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resentAt, setResentAt] = useState(null);

  async function requestCode(event) {
    event?.preventDefault();
    if (busy || !email.includes("@")) return;

    setBusy(true);
    const sent = await sendEmailCode(email);
    setBusy(false);
    if (sent) {
      setStage("code");
      setResentAt(Date.now());
    }
  }

  async function submitCode(event) {
    event.preventDefault();
    if (busy || code.trim().length < 6) return;

    setBusy(true);
    await verifyEmailCode(email, code);
    setBusy(false);
  }

  if (stage === "code") {
    return (
      <div className="gate">
        <form className="gate-card" onSubmit={submitCode}>
          <p className="gate-eyebrow">The Sourcing Club</p>
          <h1>Check your email</h1>
          <p className="gate-note">
            We sent a sign-in email to <strong>{email}</strong>. Open the link in it,
            or type the code below if your email has one. Either expires in an hour.
          </p>

          <label className="field">
            <span>Sign-in code</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={8}
              className="code-input"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, ""))}
              placeholder="000000"
            />
          </label>

          <button type="submit" className="primary-btn" disabled={busy || code.length < 6}>
            {busy ? "Checking…" : "Sign in"}
          </button>

          {error ? <p className="gate-error">{error.message}</p> : null}

          <div className="gate-row">
            <button
              type="button"
              className="quiet-btn"
              onClick={() => {
                setStage("email");
                setCode("");
              }}
            >
              Use a different address
            </button>
            <button
              type="button"
              className="quiet-btn"
              disabled={busy || (resentAt && Date.now() - resentAt < 20000)}
              onClick={requestCode}
            >
              Resend
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={requestCode}>
        <p className="gate-eyebrow">The Sourcing Club</p>
        <h1>Sign in</h1>
        <p className="gate-note">
          We email you a sign-in link. No password to set, and nothing to remember.
        </p>

        <label className="field">
          <span>Email address</span>
          <input
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@yourbrand.com"
          />
        </label>

        <button type="submit" className="primary-btn" disabled={busy || !email.includes("@")}>
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>

        {googleEnabled ? (
          <>
            <p className="gate-divider"><span>or</span></p>
            <button type="button" className="google-btn" onClick={signInWithGoogle}>
              <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
              </svg>
              Continue with Google
            </button>
          </>
        ) : null}

        {error ? <p className="gate-error">{error.message}</p> : null}
      </form>
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
 * Routed by org type, and gated on onboarding.
 *
 * A profile that has not finished onboarding cannot be browsed or quoted
 * against, so there is nothing useful to show until it is done.
 */
function Shell() {
  const { activeOrg, orgs, selectOrg, signOut, user } = useAuth();
  const isFactory = activeOrg.type === "factory";

  const [profile, setProfile] = useState(undefined);
  const [profileError, setProfileError] = useState(null);

  const loadProfile = useCallback(() => {
    const load = isFactory ? getFactoryProfile : getBrandProfile;
    load(activeOrg.id)
      .then(setProfile)
      .catch(setProfileError);
  }, [activeOrg.id, isFactory]);

  useEffect(() => {
    setProfile(undefined);
    setProfileError(null);
    loadProfile();
  }, [loadProfile]);

  if (profileError) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Could not load {activeOrg.name}</h1>
          <p className="gate-error">{profileError.message}</p>
        </div>
      </div>
    );
  }

  if (profile === undefined) return <Loading label={`Loading ${activeOrg.name}…`} />;

  if (!profile?.onboarding_completed_at) {
    const Onboarding = isFactory ? FactoryOnboarding : BrandOnboarding;
    return <Onboarding org={activeOrg} user={user} onComplete={loadProfile} />;
  }

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

      <ShellRoutes activeOrg={activeOrg} profile={profile} user={user} isFactory={isFactory} />
    </div>
  );
}

/**
 * What the signed-in user is looking at. Each Phase 2 screen lands here as it
 * is built; until then this is the dashboard plus the admin queue.
 */
function ShellRoutes({ activeOrg, profile, user, isFactory }) {
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    isPlatformAdmin().then(setAdmin);
  }, [user?.id]);

  return useRoute([
    // Brand-only for now; the factory side of the loop lands next.
    {
      path: "/rfqs",
      render: () =>
        isFactory ? <NotForThisSide isFactory /> : <RfqList org={activeOrg} />,
    },
    {
      path: "/rfqs/new",
      render: () =>
        isFactory ? <NotForThisSide isFactory /> : <RfqCreate org={activeOrg} />,
    },
    {
      path: "/rfqs/:id/edit",
      render: (params) =>
        isFactory ? <NotForThisSide isFactory /> : <RfqCreate org={activeOrg} rfqId={params.id} />,
    },
    {
      path: "/rfqs/:id",
      render: (params) =>
        isFactory ? <NotForThisSide isFactory /> : (
          <RfqDetail org={activeOrg} rfqId={params.id} isFactory={false} profile={profile} />
        ),
    },
    {
      path: "/browse",
      render: () =>
        isFactory ? <BrowseRfqs org={activeOrg} profile={profile} /> : <NotForThisSide isFactory={false} />,
    },
    {
      path: "/rfqs/:id/invite",
      render: (params) =>
        isFactory ? <NotForThisSide isFactory /> : <InviteFactories org={activeOrg} rfqId={params.id} />,
    },
    {
      path: "/rfqs/:id/quotes",
      render: (params) =>
        isFactory ? <NotForThisSide isFactory /> : <QuoteCompare org={activeOrg} rfqId={params.id} />,
    },
    {
      path: "/browse/:id/quote",
      render: (params) =>
        isFactory ? <QuoteForm org={activeOrg} rfqId={params.id} profile={profile} /> : <NotForThisSide isFactory={false} />,
    },
    {
      path: "/browse/:id/quote/sent",
      render: (params) =>
        isFactory ? <QuoteSent rfqId={params.id} /> : <NotForThisSide isFactory={false} />,
    },
    {
      path: "/browse/:id",
      render: (params) =>
        isFactory ? (
          <RfqDetail org={activeOrg} rfqId={params.id} isFactory profile={profile} />
        ) : <NotForThisSide isFactory={false} />,
    },
    {
      render: () => (
        <Dashboard activeOrg={activeOrg} profile={profile} isFactory={isFactory} user={user} admin={admin} />
      ),
    },
  ]);
}

function NotForThisSide({ isFactory }) {
  const { navigate } = useRouter();
  return (
    <main className="shell-body">
      <h1>Not your side of the marketplace</h1>
      <p className="shell-note">
        {isFactory
          ? "Requests are written by brands. You will find open requests to quote on under Browse, once that lands."
          : "This page belongs to factories."}
      </p>
      <p className="shell-note">
        <button type="button" className="quiet-btn" onClick={() => navigate("/")}>← Back</button>
      </p>
    </main>
  );
}

function Dashboard({ activeOrg, profile, isFactory, user, admin }) {
  const { navigate } = useRouter();

  return (
      <main className="shell-body">
        <span className={`side-chip side-chip--${activeOrg.type}`}>
          {isFactory ? "Factory" : "Brand"}
        </span>
        <h1>{activeOrg.name}</h1>
        <p className="shell-note">
          Onboarding complete. Signed in as {user?.email}, {activeOrg.role} of this organisation.
        </p>

        <dl className="fact-grid">
          <div>
            <dt>Verification</dt>
            <dd>{profile.verification_status}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{new Date(profile.onboarding_completed_at).toLocaleDateString()}</dd>
          </div>
          <div>
            <dt>Org id</dt>
            <dd>{activeOrg.id}</dd>
          </div>
        </dl>

        <p className="shell-note">
          {profile.verification_status === "verified"
            ? "Your business registration has been verified."
            : "Your business registration is with our review team. Everything else works while you wait."}
        </p>

        <p className="shell-note">
          The remaining {isFactory ? "factory" : "brand"} screens are wired to this shell phase by
          phase; until then they run on mock data at{" "}
          <a href={isFactory ? "/factory-prototype.html" : "/prototype.html"}>
            their original address
          </a>
          .
        </p>

        <p className="shell-note">
          {isFactory ? (
            <button type="button" className="primary-btn" onClick={() => navigate("/browse")}>
              Browse open requests
            </button>
          ) : (
            <button type="button" className="primary-btn" onClick={() => navigate("/rfqs")}>
              Requests for quotes
            </button>
          )}
        </p>

        {admin ? (
          <p className="shell-note">
            <button type="button" className="quiet-btn" onClick={() => navigate("/admin/verifications")}>
              Verification review →
            </button>
          </p>
        ) : null}
      </main>
  );
}

/**
 * Platform staff have no brand or factory org, so the admin tool cannot live
 * behind the org gate — requiring one locked the only people who can use it
 * out of it. Checked here, above everything except being signed in.
 */
function AdminGate({ children }) {
  const { path } = useRouter();
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    isPlatformAdmin().then(setAdmin);
  }, []);

  if (!path.startsWith("/admin")) return children;
  if (admin === null) return <Loading label="Checking your access…" />;
  if (!admin) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Not your page</h1>
          <p className="gate-note">
            Verification review is limited to platform staff. If that should include you, someone
            with database access has to add you.
          </p>
        </div>
      </div>
    );
  }
  return <AdminVerifications />;
}

function App() {
  const { status, error, activeOrg } = useAuth();

  if (status === "unconfigured") return <SetupNeeded />;
  if (status === "loading") return <Loading label="Checking your session…" />;
  if (status === "signed-out") return <SignIn />;
  // Reachable before an org exists, and deliberately so.
  if (status === "no-org") return <AdminGate><ChooseOrgType /></AdminGate>;
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
  // Belt and braces: "ready" with no active org should be unreachable, but
  // rendering the shell in that state is a blank page rather than an error, so
  // it is worth one line to make it impossible.
  if (!activeOrg) return <Loading label="Loading your account…" />;

  return (
    <AdminGate>
      <Shell />
    </AdminGate>
  );
}

createRoot(document.getElementById("root")).render(
  <RouterProvider>
    <AuthProvider>
      <App />
    </AuthProvider>
  </RouterProvider>,
);
