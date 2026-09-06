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
import BrandOnboarding from "./onboarding/BrandOnboarding.jsx";
import FactoryOnboarding from "./onboarding/FactoryOnboarding.jsx";
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
import { ProjectsScreen } from "../prototype/main.jsx";
import { DataProvider } from "../lib/data/DataProvider.jsx";
import { createLiveAdapter } from "./live-adapter.js";
import OrderDetail from "./order/OrderDetail.jsx";
import ScheduleEditor from "./order/ScheduleEditor.jsx";
import MilestoneDetail from "./order/MilestoneDetail.jsx";
import PaymentInstructions from "./order/PaymentInstructions.jsx";
import PayoutDetails from "./order/PayoutDetails.jsx";
import MessageList from "./message/MessageList.jsx";
import ThreadPage from "./message/ThreadPage.jsx";
import Home from "./home/Home.jsx";
import Team from "./settings/Team.jsx";
import NotificationList from "./NotificationList.jsx";
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
  };
  navigate(paths[screenKey] ?? "/");
}

function ShellRoutes({ activeOrg, profile, user, isFactory }) {
  // listMyOrgs folds the membership role onto the org, and several actions
  // turn on it: awarding a quote, approving a step that releases money, and
  // recording a payment as sent are all owner-only in the database.
  const isOwner = activeOrg.role === "owner";
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
      render: () => (
        <Home org={activeOrg} profile={profile} isFactory={isFactory} user={user} admin={admin} />
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
