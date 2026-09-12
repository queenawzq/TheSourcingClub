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

export function AuthScreen({ accountType, initialMode = "login", onModeChange, onAuthenticate }) {
  const [mode, setMode] = useState(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const isSignup = mode === "signup";
  const isFactory = accountType === "factory";
  const audience = isFactory ? "factory" : "brand";
  const audienceLabel = isFactory ? "vendor" : "brand";

  const changeMode = (nextMode) => {
    setMode(nextMode);
    setShowPassword(false);
    onModeChange?.(nextMode);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = (event) => {
    event.preventDefault();
    onAuthenticate?.({ mode });
  };

  return (
    <main className={`auth-page auth-page-${audience}`}>
      <section className="auth-story" aria-label={`${audienceLabel} account benefits`}>
        <a className="auth-logo" href={isFactory ? "/factory-prototype.html?screen=login" : "/prototype.html?screen=login"}>
          <img src="/assets/logo.svg" alt="The Sourcing Club" />
        </a>
        <div className="auth-story-copy">
          <span>{isFactory ? "The vendor workspace" : "The brand workspace"}</span>
          <h1>{isFactory ? "Meet serious brands. Grow the right partnerships." : "Find the right factory. Build with confidence."}</h1>
          <p>{isFactory ? "Manage enquiries, quotes, capacity, and production relationships in one trusted workspace." : "Create clear briefs, compare trusted factories, and keep every production step in one place."}</p>
        </div>
        <div className="auth-story-proof">
          <strong>{isFactory ? "Built for production partners" : "Built for growing brands"}</strong>
          <span>{isFactory ? "Show your capabilities and connect with better-fit opportunities." : "Move from idea to production with clearer decisions and fewer surprises."}</span>
        </div>
      </section>

      <section className="auth-workspace">
        <div className="auth-mobile-logo">
          <img src="/assets/logo.svg" alt="The Sourcing Club" />
          <span>{isFactory ? "Vendor portal" : "Brand portal"}</span>
        </div>

        <div className="auth-card">
          <header className="auth-card-header">
            <span className="auth-account-pill">{isFactory ? "For vendors" : "For brands"}</span>
            <h2>{isSignup ? `Create your ${audienceLabel} account` : "Welcome back"}</h2>
            <p>{isSignup ? `Set up your ${audienceLabel} workspace and continue to your profile.` : `Log in to continue to your ${audienceLabel} workspace.`}</p>
          </header>

          <button className="auth-google-button" type="button" onClick={() => onAuthenticate?.({ mode, provider: "google" })}>
            <GoogleMark />
            Continue with Google
          </button>

          <div className="auth-divider"><span>or continue with email</span></div>

          <form className="auth-form" onSubmit={submit}>
            {isSignup && (
              <div className="auth-field-row">
                <label className="auth-field">
                  <span>Your name</span>
                  <input type="text" placeholder="Your full name" autoComplete="name" required />
                </label>
                <label className="auth-field">
                  <span>{isFactory ? "Company name" : "Brand name"}</span>
                  <input type="text" placeholder={isFactory ? "Your company" : "Your brand"} autoComplete="organization" required />
                </label>
              </div>
            )}

            <label className="auth-field">
              <span>Work email</span>
              <input type="email" placeholder="you@company.com" autoComplete="email" required />
            </label>

            <label className="auth-field">
              <span>Password</span>
              <span className="auth-password-control">
                <input type={showPassword ? "text" : "password"} placeholder={isSignup ? "At least 8 characters" : "Enter your password"} minLength={isSignup ? 8 : undefined} autoComplete={isSignup ? "new-password" : "current-password"} required />
                <button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button>
              </span>
            </label>

            {!isSignup && (
              <div className="auth-form-options">
                <label><input type="checkbox" /> <span>Keep me logged in</span></label>
                <button type="button">Forgot password?</button>
              </div>
            )}

            <button className="auth-submit" type="submit">{isSignup ? "Create account" : "Log in"}</button>
          </form>

          {isSignup && <p className="auth-legal">By creating an account, you agree to our <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>.</p>}

          <p className="auth-switch">
            {isSignup ? "Already have an account?" : "New to The Sourcing Club?"}
            <button type="button" onClick={() => changeMode(isSignup ? "login" : "signup")}>{isSignup ? "Log in" : "Create an account"}</button>
          </p>
        </div>

        <a className="auth-portal-switch" href={isFactory ? "/prototype.html?screen=login" : "/factory-prototype.html?screen=login"}>
          {isFactory ? "Looking for the brand portal?" : "Are you a factory or trading company?"} <strong>Switch portal</strong>
        </a>
      </section>
    </main>
  );
}
