import React, { useState } from "react";
import "./auth-screen.css";

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.98-.9 6.63-2.37l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.6 0-4.81-1.76-5.6-4.12H3.05v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.4 13.93A6.01 6.01 0 0 1 6.08 12c0-.67.11-1.33.32-1.93V7.45H3.05A10 10 0 0 0 2 12c0 1.63.39 3.17 1.05 4.55l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.82 1.5l2.88-2.87A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.95 5.45l3.35 2.62c.79-2.36 3-4.12 5.6-4.12Z" />
    </svg>
  );
}

/**
 * The login and signup screen for both portals.
 *
 * Mounted twice, like every other designed screen: the prototypes pass nothing
 * and it behaves as it always did — fill anything in, press the button, land
 * on the next screen. app.html passes `onAuthenticate` an async function and
 * the form becomes real, with the submitted values, a busy state and whatever
 * the server said.
 *
 * The fields are uncontrolled and read from the form on submit rather than
 * held in state per keystroke. That keeps the prototype's behaviour identical
 * and the diff small.
 */
export function AuthScreen({
  accountType,
  initialMode = "login",
  onModeChange,
  onAuthenticate,
  onForgotPassword,
  busy = false,
  error = null,
  notice = null,
  googleEnabled = true,
  minPasswordLength = 8,
  // Both links point at the prototypes by default, which is where they lead
  // today. app.html passes its own so the live portals switch to each other
  // rather than dropping a signed-up user into a mock.
  homeHref,
  switchPortalHref,
  // Platform staff. Login only: staff accounts are not self-serve, so the
  // signup toggle and the brand/vendor portal switch are both wrong here, and
  // the screen says whose workspace you are entering so nobody has to guess
  // which account they just used.
  staff = false,
}) {
  const [mode, setMode] = useState(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  // Staff never sign up, so the mode is pinned however the component is driven.
  const isSignup = !staff && mode === "signup";
  const isFactory = accountType === "factory";
  const home = homeHref ?? (isFactory ? "/factory-prototype.html?screen=login" : "/prototype.html?screen=login");
  const otherPortal = switchPortalHref ?? (isFactory ? "/prototype.html?screen=login" : "/factory-prototype.html?screen=login");
  const audience = staff ? "staff" : isFactory ? "factory" : "brand";
  const audienceLabel = staff ? "staff" : isFactory ? "vendor" : "brand";

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setShowPassword(false);
    onModeChange?.(nextMode);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    // Read the values off the form itself. The prototype ignores them, which
    // is why they were never collected before.
    const form = new FormData(event.currentTarget);
    onAuthenticate?.({
      mode,
      accountType,
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      fullName: String(form.get("fullName") ?? ""),
      companyName: String(form.get("companyName") ?? ""),
      keepSignedIn: form.get("keepSignedIn") === "on",
    });
  };

  return (
    <main className={`auth-page auth-page-${audience}`}>
      <section className="auth-story" aria-label={`${audienceLabel} account benefits`}>
        <a className="auth-logo" href={home}>
          <img src="/assets/logo.svg" alt="The Sourcing Club" />
        </a>
        <div className="auth-story-copy">
          <span>{staff ? "The operations workspace" : isFactory ? "The vendor workspace" : "The brand workspace"}</span>
          <h1>{staff ? "Platform staff sign-in." : isFactory ? "Meet serious brands. Grow the right partnerships." : "Find the right factory. Build with confidence."}</h1>
          <p>{staff ? "Review companies, work the verification queue, and confirm payments." : isFactory ? "Manage enquiries, quotes, capacity, and production relationships in one trusted workspace." : "Create clear briefs, compare trusted factories, and keep every production step in one place."}</p>
        </div>
        <div className="auth-story-proof">
          <strong>{staff ? "Internal use only" : isFactory ? "Built for production partners" : "Built for growing brands"}</strong>
          <span>{staff ? "This workspace is restricted to The Sourcing Club staff accounts." : isFactory ? "Show your capabilities and connect with better-fit opportunities." : "Move from idea to production with clearer decisions and fewer surprises."}</span>
        </div>
      </section>

      <section className="auth-workspace">
        <div className="auth-mobile-logo">
          <img src="/assets/logo.svg" alt="The Sourcing Club" />
          <span>{staff ? "Admin portal" : isFactory ? "Vendor portal" : "Brand portal"}</span>
        </div>

        <div className="auth-card">
          <header className="auth-card-header">
            <span className="auth-account-pill">{staff ? "For platform staff" : isFactory ? "For vendors" : "For brands"}</span>
            <h2>{staff ? "Admin sign-in" : isSignup ? `Create your ${audienceLabel} account` : "Welcome back"}</h2>
            <p>{staff ? "Sign in with your staff account to open the operations workspace." : isSignup ? `Set up your ${audienceLabel} workspace and continue to your profile.` : `Log in to continue to your ${audienceLabel} workspace.`}</p>
          </header>

          {googleEnabled && (
            <>
              <button className="auth-google-button" type="button" disabled={busy} onClick={() => onAuthenticate?.({ mode, accountType, provider: "google" })}>
                <GoogleMark />
                Continue with Google
              </button>

              <div className="auth-divider"><span>or continue with email</span></div>
            </>
          )}

          <form className="auth-form" onSubmit={submit}>
            {isSignup && (
              <div className="auth-field-row">
                <label className="auth-field">
                  <span>Your name</span>
                  <input type="text" name="fullName" placeholder="Your full name" autoComplete="name" required />
                </label>
                <label className="auth-field">
                  <span>{isFactory ? "Company name" : "Brand name"}</span>
                  <input type="text" name="companyName" placeholder={isFactory ? "Your company" : "Your brand"} autoComplete="organization" required />
                </label>
              </div>
            )}

            <label className="auth-field">
              <span>Work email</span>
              <input type="email" name="email" placeholder="you@company.com" autoComplete="email" required />
            </label>

            <label className="auth-field">
              <span>Password</span>
              <span className="auth-password-control">
                <input type={showPassword ? "text" : "password"} name="password" placeholder={isSignup ? `At least ${minPasswordLength} characters` : "Enter your password"} minLength={isSignup ? minPasswordLength : undefined} autoComplete={isSignup ? "new-password" : "current-password"} required />
                <button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button>
              </span>
            </label>

            {!isSignup && (
              <div className="auth-form-options">
                <label><input type="checkbox" name="keepSignedIn" defaultChecked /> <span>Keep me logged in</span></label>
                <button type="button" onClick={() => onForgotPassword?.()}>Forgot password?</button>
              </div>
            )}

            {notice && <p className="auth-notice" role="status">{notice}</p>}
            {error && <p className="auth-error" role="alert">{error.message ?? String(error)}</p>}

            <button className="auth-submit" type="submit" disabled={busy}>
              {busy ? (isSignup ? "Creating your account…" : "Logging in…") : isSignup ? "Create account" : "Log in"}
            </button>
          </form>

          {isSignup && <p className="auth-legal">By creating an account, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</p>}

          {!staff && (
            <p className="auth-switch">
              {isSignup ? "Already have an account?" : "New to The Sourcing Club?"}
              <button type="button" onClick={() => changeMode(isSignup ? "login" : "signup")}>{isSignup ? "Log in" : "Create an account"}</button>
            </p>
          )}
        </div>

        {staff ? (
          <a className="auth-portal-switch" href="/app.html">
            Not staff? <strong>Go to the main app</strong>
          </a>
        ) : (
          <a className="auth-portal-switch" href={otherPortal}>
            {isFactory ? "Looking for the brand portal?" : "Are you a factory or trading company?"} <strong>Switch portal</strong>
          </a>
        )}
      </section>
    </main>
  );
}
