/**
 * The authenticated app shell.
 *
 * One entry point for both sides: after sign-in, the org's type decides
 * whether the brand or the factory experience renders.
 *
 * Requests, quotes, awards, production orders, milestones, payments and
 * conversations all run against the database now. What has NOT been rebuilt —
 * saved factories, collections, analytics, the settings screens — still lives
 * only in the prototypes at their own URLs, and is reached from there rather
 * than being half-linked from here.
 */
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider, useAuth } from "../lib/auth.jsx";
import { acceptInvitation, createOrg, listMyInvitations } from "../lib/domain/org.js";
import { getBrandProfile, getFactoryProfile } from "../lib/domain/profile.js";
import BrandOnboarding from "./onboarding/LiveBrandOnboarding.jsx";
import FactoryOnboarding from "./onboarding/LiveFactoryOnboarding.jsx";
import { isConfigured } from "../lib/supabase.js";
import { RouterProvider, useRoute, useRouter } from "../lib/router.jsx";
import { isPlatformAdmin } from "../lib/domain/admin.js";
import AdminVerifications from "./admin/AdminVerifications.jsx";
import AdminPayments from "./admin/AdminPayments.jsx";
import RfqList from "./rfq/RfqList.jsx";
import RfqCreate from "./rfq/RfqCreate.jsx";
import RfqDetail from "./rfq/RfqDetail.jsx";
import BrowseRfqs from "./rfq/BrowseRfqs.jsx";
import QuoteForm from "./quote/QuoteForm.jsx";
import QuoteSent from "./quote/QuoteSent.jsx";
import QuoteCompare from "./quote/QuoteCompare.jsx";
import InviteFactories from "./rfq/InviteFactories.jsx";
import OrderList from "./order/OrderList.jsx";
// The designed screens, mounted against live data through the seam. Importing
// them pulls in the prototype stylesheet, which is the point — the design is
// the CSS.
import { ProjectsScreen, RfqsScreen } from "../prototype/main.jsx";
import { AuthScreen } from "../shared/AuthScreen.jsx";
import { DataProvider } from "../lib/data/DataProvider.jsx";
import { createLiveAdapter } from "./live-adapter.js";
import OrderDetail from "./order/OrderDetail.jsx";
import ScheduleEditor from "./order/ScheduleEditor.jsx";
import MilestoneDetail from "./order/MilestoneDetail.jsx";
import PaymentInstructions from "./order/PaymentInstructions.jsx";
import PayoutDetails from "./order/PayoutDetails.jsx";
import MessageList from "./message/MessageList.jsx";
import ThreadPage from "./message/ThreadPage.jsx";
import LiveHome from "./home/LiveHome.jsx";
import Team from "./settings/Team.jsx";
import NotificationList from "./NotificationList.jsx";
import ErrorBoundary from "../lib/ErrorBoundary.jsx";
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

/**
 * Sign in and sign up, on the designed screen.
 *
 * src/shared/AuthScreen.jsx is the same component the two prototypes mount;
 * here it is given real handlers. Which portal you are standing in decides
 * what kind of company a signup creates — `?portal=factory` for vendors,
 * anything else for brands — and that is the whole of the question the app
 * used to ask separately as "which side are you on?".
 *
 * Three states share the screen: log in, sign up, and the password reset the
 * "forgot password" link starts. Reset is a mode rather than a page because
 * the link lands back on app.html and there is nothing else for it to land on.
 */
function portalFromUrl() {
  const portal = new URLSearchParams(window.location.search).get("portal");
  return portal === "factory" || portal === "vendor" ? "factory" : "brand";
}

function SignIn() {
  const {
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    signInWithGoogle,
    googleEnabled,
    minPasswordLength,
    clearError,
    error,
  } = useAuth();

  const params = new URLSearchParams(window.location.search);
  const accountType = portalFromUrl();

  const [mode, setMode] = useState(params.get("mode") === "signup" ? "signup" : "login");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [resetFor, setResetFor] = useState(null);

  async function authenticate(submitted) {
    if (submitted.provider === "google") {
      await signInWithGoogle();
      return;
    }

    setBusy(true);
    setNotice(null);
    if (submitted.mode === "signup") {
      await signUpWithPassword({
        email: submitted.email,
        password: submitted.password,
        fullName: submitted.fullName,
        companyName: submitted.companyName,
        accountType: submitted.accountType,
      });
    } else {
      await signInWithPassword({
        email: submitted.email,
        password: submitted.password,
        keepSignedIn: submitted.keepSignedIn,
      });
    }
    // No navigation on success: the session changes, AuthProvider re-renders,
    // and App picks the next screen. Setting one here would race that.
    setBusy(false);
  }

  async function sendReset(email) {
    setBusy(true);
    await requestPasswordReset(email);
    setBusy(false);
    setResetFor(null);
    // Deliberately the same message whether or not an account exists. Saying
    // otherwise turns this box into a way to ask who your customers are.
    setNotice(`If an account exists for ${email}, a reset link is on its way.`);
  }

  if (resetFor !== null) {
    return (
      <div className="gate">
        <form
          className="gate-card"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && resetFor.includes("@")) sendReset(resetFor);
          }}
        >
          <p className="gate-eyebrow">The Sourcing Club</p>
          <h1>Reset your password</h1>
          <p className="gate-note">
            Tell us the address on the account and we will email a link to set a new
            password.
          </p>

          <label className="field">
            <span>Work email</span>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              value={resetFor}
              onChange={(event) => setResetFor(event.target.value)}
              placeholder="you@company.com"
            />
          </label>

          <button type="submit" className="primary-btn" disabled={busy || !resetFor.includes("@")}>
            {busy ? "Sending…" : "Email me a reset link"}
          </button>

          <button
            type="button"
            className="quiet-btn"
            onClick={() => {
              setResetFor(null);
              clearError();
            }}
          >
            Back to log in
          </button>

          {error ? <p className="gate-error">{error.message}</p> : null}
        </form>
      </div>
    );
  }

  return (
    <AuthScreen
      accountType={accountType}
      initialMode={mode}
      busy={busy}
      error={error}
      notice={notice}
      googleEnabled={googleEnabled}
      minPasswordLength={minPasswordLength}
      homeHref="/"
      switchPortalHref={accountType === "factory" ? "/app.html" : "/app.html?portal=factory"}
      onModeChange={(next) => {
        setMode(next);
        setNotice(null);
        clearError();
      }}
      onForgotPassword={() => {
        clearError();
        setResetFor("");
      }}
      onAuthenticate={authenticate}
    />
  );
}

/**
 * The landing for a password-reset link.
 *
 * The link signs the user in — that is how Supabase recovery works — so this
 * screen is reachable only with a live session, and its whole job is to set a
 * password before letting them go any further.
 */
function SetNewPassword({ onDone }) {
  const { updatePassword, minPasswordLength, error } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy || password.length < minPasswordLength) return;
    setBusy(true);
    const changed = await updatePassword(password);
    setBusy(false);
    if (changed) onDone();
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <p className="gate-eyebrow">The Sourcing Club</p>
        <h1>Choose a new password</h1>
        <p className="gate-note">At least {minPasswordLength} characters.</p>

        <label className="field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button
          type="submit"
          className="primary-btn"
          disabled={busy || password.length < minPasswordLength}
        >
          {busy ? "Saving…" : "Save password"}
        </button>

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
  // Someone who was invited lands here, and used to be told to create an
  // organisation of their own — the one thing they should not do. The
  // invitation existed in the database and no screen ever showed it.
  const [invitations, setInvitations] = useState([]);

  useEffect(() => {
    listMyInvitations().then(setInvitations).catch(() => {});
  }, []);

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

  if (invitations.length) {
    return (
      <div className="gate">
        <div className="gate-card">
          <p className="gate-eyebrow">Signed in as {user?.email}</p>
          <h1>You have been invited</h1>
          <p className="gate-note">
            Join an organisation that already exists, rather than starting one of your own.
          </p>
          {invitations.map((invitation) => (
            <button
              key={invitation.id}
              type="button"
              className="primary-btn"
              data-testid="accept-invitation"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await acceptInvitation(invitation.id);
                  await refreshOrgs();
                } catch (failure) {
                  setError(failure);
                  setBusy(false);
                }
              }}
            >
              Join {invitation.orgs?.name} as {invitation.role}
            </button>
          ))}
          {error ? <p className="gate-error">{error.message}</p> : null}
          <div className="gate-row">
            <button type="button" className="quiet-btn" onClick={() => setInvitations([])}>
              Start my own organisation instead
            </button>
            <button type="button" className="quiet-btn" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>
    );
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
/**
 * The prototype's screens navigate with a screen KEY and no entity id
 * (`goTo("projectDetail")`). The real app navigates by path. Until the ported
 * screens carry ids, the translation lives here rather than in each screen.
 */
function navigateFromPrototype(screenKey, navigate) {
  const paths = {
    projects: "/orders",
    rfqs: "/rfqs",
    messages: "/messages",
    home: "/",
    quotes: "/rfqs",
    // The prototype's RFQ flow is a linear wizard with no real form behind it.
    // "describe" is its first step, and it maps to the composer that does.
    describe: "/rfqs/new",
    factoryMarketplace: "/browse",
    profile: "/",
    notifications: "/notifications",
  };
  navigate(paths[screenKey] ?? "/");
}

function ShellRoutes({ activeOrg, profile, user, isFactory }) {
  // listMyOrgs folds the membership role onto the org, and several actions
  // turn on it: awarding a quote, approving a step that releases money, and
  // recording a payment as sent are all owner-only in the database.
  const isOwner = activeOrg.role === "owner";
  // The ported screens navigate through this. Without it every goTo() from a
  // designed screen throws and silently does nothing — which the orders slice
  // shipped with, undetected, because the walkthrough reached /orders by URL
  // rather than by clicking the way a person does.
  const { navigate, path } = useRouter();
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    isPlatformAdmin().then(setAdmin);
  }, [user?.id]);

  // Keyed on the path so navigating away from a crashed screen clears the
  // error rather than showing the crash card on the next screen too.
  const routed = useRoute([
    // Brand-only for now; the factory side of the loop lands next.
    {
      // Slice two: the designed requests screen, live data.
      path: "/rfqs",
      render: () =>
        isFactory ? <NotForThisSide isFactory /> : (
          <DataProvider adapter={createLiveAdapter({ org: activeOrg, isFactory, user })}>
            <RfqsScreen goTo={(next) => navigateFromPrototype(next, navigate)} />
          </DataProvider>
        ),
    },
    {
      path: "/rfqs/legacy",
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
      // Production orders are ONE namespace for both sides, unlike /rfqs and
      // /browse. An order is a single row with two parties, and a link a brand
      // pastes to its factory has to open.
      // Slice one of the port: the designed orders screen, live data.
      path: "/orders",
      render: () => (
        <DataProvider adapter={createLiveAdapter({ org: activeOrg, isFactory, user })}>
          <ProjectsScreen goTo={(next) => navigateFromPrototype(next, navigate)} />
        </DataProvider>
      ),
    },
    {
      // Kept reachable while the ported screen is compared against it. Goes
      // when the slice is signed off, not before.
      path: "/orders/legacy",
      render: () => <OrderList org={activeOrg} isFactory={isFactory} />,
    },
    {
      path: "/orders/:id",
      render: (params) => (
        <OrderDetail org={activeOrg} orderId={params.id} isFactory={isFactory} isOwner={isOwner} />
      ),
    },
    {
      path: "/orders/:id/schedule",
      render: (params) => <ScheduleEditor orderId={params.id} isFactory={isFactory} />,
    },
    {
      path: "/orders/:id/messages",
      render: (params) => (
        <OrderDetail org={activeOrg} orderId={params.id} isFactory={isFactory} isOwner={isOwner} tab="messages" />
      ),
    },
    {
      path: "/orders/:id/files",
      render: (params) => (
        <OrderDetail org={activeOrg} orderId={params.id} isFactory={isFactory} isOwner={isOwner} tab="files" />
      ),
    },
    {
      path: "/orders/:id/contract",
      render: (params) => (
        <OrderDetail org={activeOrg} orderId={params.id} isFactory={isFactory} isOwner={isOwner} tab="contract" />
      ),
    },
    {
      path: "/orders/:id/milestones/:mid",
      render: (params) => (
        <MilestoneDetail org={activeOrg} orderId={params.id} milestoneId={params.mid}
                         isFactory={isFactory} isOwner={isOwner} />
      ),
    },
    {
      // A deliberate crash, so the boundary and the reporter can be verified
      // rather than assumed. Dev only — it is a self-test, not a feature.
      path: "/__crash",
      render: () => {
        if (!import.meta.env.DEV) return <NotForThisSide isFactory={isFactory} />;
        throw new Error("Deliberate crash from /__crash — this is a self-test.");
      },
    },
    {
      path: "/team",
      render: () => <Team org={activeOrg} />,
    },
    {
      path: "/messages",
      render: () => <MessageList org={activeOrg} isFactory={isFactory} />,
    },
    {
      path: "/messages/:id",
      render: (params) => (
        <ThreadPage org={activeOrg} threadId={params.id} isFactory={isFactory} />
      ),
    },
    {
      // A factory has to be able to say where its money goes, or nobody can
      // pay it. Registered before the :id routes so "payout" is never read as
      // an order id.
      path: "/payout",
      render: () => <PayoutDetails org={activeOrg} isFactory={isFactory} />,
    },
    {
      path: "/orders/:id/payments/:pid",
      render: (params) =>
        isFactory
          ? <NotForThisSide isFactory />
          : <PaymentInstructions orderId={params.id} paymentId={params.pid} />,
    },
    {
      path: "/browse/:id",
      render: (params) =>
        isFactory ? (
          <RfqDetail org={activeOrg} rfqId={params.id} isFactory profile={profile} />
        ) : <NotForThisSide isFactory={false} />,
    },
    {
      // The designed home puts notifications behind the activity button in its
      // header rather than listing them inline, so they need a page of their
      // own — there was never a route for them before.
      path: "/notifications",
      render: () => <NotificationList org={activeOrg} isFactory={isFactory} />,
    },
    {
      render: () => (
        <LiveHome
          org={activeOrg}
          isFactory={isFactory}
          goTo={(next) => navigateFromPrototype(next, navigate)}
          onOpenActivity={() => navigate("/notifications")}
        />
      ),
    },
  ]);

  // A crash in one screen must not take the shell, the navigation and the
  // sign-out button with it. Keyed on the path so navigating away from a
  // broken screen clears the error instead of showing the crash card again.
  return <ErrorBoundary key={path} label="This screen">{routed}</ErrorBoundary>;
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
            The admin tools are limited to platform staff. If that should include you, someone
            with database access has to add you.
          </p>
        </div>
      </div>
    );
  }
  return <AdminRoutes />;
}

/**
 * This used to return AdminVerifications for ANY path under /admin, which
 * meant a second admin screen could be built, linked and deployed while every
 * link to it silently rendered the first one — right header, no error, and the
 * obvious conclusion that the new screen was never finished.
 */
function AdminRoutes() {
  return useRoute([
    { path: "/admin/verifications", render: () => <AdminVerifications /> },
    { path: "/admin/payments", render: () => <AdminPayments /> },
    { render: () => <AdminIndex /> },
  ]);
}

function AdminIndex() {
  const { navigate } = useRouter();
  const { user, signOut } = useAuth();

  return (
    <div className="admin">
      <header className="admin-bar">
        <span className="shell-mark">The Sourcing Club</span>
        <span className="admin-sub">{user?.email}</span>
        <button type="button" className="quiet-btn" onClick={signOut}>Sign out</button>
      </header>

      <h1>Platform admin</h1>
      <p className="admin-intro">
        Two queues, and both of them are things only staff can do: deciding whether an
        organisation is who it says it is, and confirming that money actually arrived.
      </p>

      <div className="admin-index">
        <button type="button" className="admin-index-card" onClick={() => navigate("/admin/verifications")}>
          <strong>Verification review</strong>
          <span>Business registrations and certificates. Approving one is what lets a factory quote.</span>
        </button>
        <button type="button" className="admin-index-card" onClick={() => navigate("/admin/payments")}>
          <strong>Payments</strong>
          <span>
            Brands mark a payment sent; a factory does not start work until someone here confirms
            it arrived.
          </span>
        </button>
      </div>
    </div>
  );
}

function App() {
  const { status, error, activeOrg } = useAuth();

  /**
   * A password-reset link signs the user in and comes back with ?reset=1.
   * Without this the session would simply drop them at their dashboard and
   * the password they came to change would stay as it was.
   *
   * Held in state, not read from the URL each render, so clearing the query
   * string after saving does not bounce them back here.
   */
  const [resetting, setResetting] = useState(
    () => new URLSearchParams(window.location.search).get("reset") === "1",
  );

  if (status === "unconfigured") return <SetupNeeded />;
  if (status === "loading") return <Loading label="Checking your session…" />;
  if (status === "signed-out") return <SignIn />;
  if (resetting) {
    return (
      <SetNewPassword
        onDone={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete("reset");
          window.history.replaceState(null, "", url.toString());
          setResetting(false);
        }}
      />
    );
  }
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

// Two boundaries, not one. The outer catches anything in the router, the auth
// provider or the shell itself; the inner one (around each route, below) keeps
// a single broken screen from taking the whole application down with it.
createRoot(document.getElementById("root")).render(
  <ErrorBoundary label="The Sourcing Club">
    <RouterProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </RouterProvider>
  </ErrorBoundary>,
);
