/**
 * What a dashboard draws under its header until its layout is known: the line
 * Orders and Requests already draw while they load, or what went wrong and a
 * way back. Never a shape of either layout, which would be a guess.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import "./home-holding.css";

export default function HomeHolding({ failed = false, onRetry }) {
  if (!failed) return <p className="projects-empty" role="status">Loading your dashboard…</p>;
  return (
    <div className="projects-empty projects-error home-holding-failed" role="alert">
      <span>We couldn't load your dashboard. Check your connection and try again.</span>
      <button className="secondary-btn compact-btn" type="button" onClick={onRetry}>Try again</button>
    </div>
  );
}

/**
 * What a notice says, gone after a while: it is about one attempt, and must
 * not outlive it. `[text, say]`.
 */
export function useHomeNotice(ms = 10000) {
  const [text, setText] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const say = useCallback((next) => {
    clearTimeout(timer.current);
    setText(next);
    if (next) timer.current = setTimeout(() => setText(null), ms);
  }, [ms]);
  return [text, say];
}

/** Something later on a dashboard that is already drawn did not go through. */
export function HomeNotice({ text }) {
  return text ? <p className="projects-empty projects-error home-holding-notice" role="alert">{text}</p> : null;
}
