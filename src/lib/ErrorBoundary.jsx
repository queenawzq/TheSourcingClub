/**
 * The last thing between a bug and a blank white page.
 *
 * React 19 unmounts the whole root when an error escapes render, so today a
 * crash leaves someone staring at an empty `<div id="root">` — no message, no
 * reload, no report, and no way for us to know it happened. In a beta with
 * invited companies that means finding out by text message, or not at all.
 *
 * Two properties matter more than the styling:
 *
 *   - **It reports before it renders.** The reference shown on screen is the
 *     one stored in the database, so a person saying "I saw 6F80388B" is
 *     enough to find the stack.
 *   - **Reporting can never make things worse.** Every failure inside the
 *     reporter is swallowed. A reporter that throws inside an error boundary
 *     turns one broken screen into two.
 */
import React from "react";
import { supabase } from "./supabase.js";

async function report(error, info) {
  try {
    const { data } = await supabase.rpc("report_client_error", {
      message: String(error?.message ?? error ?? "unknown error"),
      stack: error?.stack ?? null,
      path: typeof window !== "undefined" ? window.location.pathname + window.location.search : null,
      component_stack: info?.componentStack ?? null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
    return typeof data === "string" && data !== "rate-limited" ? data : null;
  } catch {
    // Deliberately silent. See the note above.
    return null;
  }
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reference: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Console as well as the database: the database needs a network, and the
    // crash may be that there isn't one.
    console.error("[ErrorBoundary]", error, info?.componentStack);
    report(error, info).then((reference) => {
      if (reference) this.setState({ reference });
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { label = "this page" } = this.props;

    return (
      <div className="crash" role="alert">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p className="crash-note">
            {label === "this page"
              ? "This page stopped working. Nothing you had saved is lost — the failure is in the screen, not in your data."
              : `${label} stopped working. Nothing you had saved is lost.`}
          </p>

          {this.state.reference ? (
            <p className="crash-note">
              If you tell us this reference we can see exactly what happened:{" "}
              <code className="crash-ref" data-testid="crash-reference">{this.state.reference}</code>
            </p>
          ) : (
            // No reference means the report itself did not get through, so do
            // not promise one.
            <p className="crash-note">
              We could not send the details automatically. Telling us what you were doing will help.
            </p>
          )}

          <div className="crash-actions">
            <button type="button" className="primary-btn" onClick={() => window.location.reload()}>
              Reload this page
            </button>
            <button
              type="button"
              className="quiet-btn"
              onClick={() => {
                window.location.href = window.location.pathname.startsWith("/app.html")
                  ? "/app.html"
                  : "/";
              }}
            >
              Back to the start
            </button>
          </div>
        </div>
      </div>
    );
  }
}
