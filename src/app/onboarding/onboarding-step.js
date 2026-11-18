import { useCallback, useEffect, useState } from "react";

/**
 * The onboarding step a company is on, and the furthest one it has reached.
 *
 * The step dots go back AND forward up to the furthest step, so going back
 * to fix one answer does not lock every later step. Both numbers are kept in
 * this browser per company, so a refresh resumes where the person was rather
 * than at the first card. Only a company still onboarding resumes this way:
 * a finished one (sent back by staff) opens on the step its review chooses.
 *
 * Kept per company id, never per name, so two companies in one browser keep
 * their own place.
 */
const KEY = "tscOnboardingStep:";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function readSaved(orgId, lastStep) {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY + orgId) ?? "null");
    if (!saved || !Number.isInteger(saved.step) || !Number.isInteger(saved.furthest)) return null;
    // Never resume onto the finish card: finishing is what publishes.
    const step = clamp(saved.step, 0, lastStep - 1);
    return { step, furthest: clamp(saved.furthest, step, lastStep - 1) };
  } catch {
    return null;
  }
}

export function forgetOnboardingStep(orgId) {
  try {
    window.localStorage.removeItem(KEY + orgId);
  } catch {
    // Storage blocked: nothing was saved either.
  }
}

/**
 * @param {string} orgId
 * @param {number} initialStep where this mount starts when nothing is saved
 * @param {{ lastStep: number, resume: boolean }} options `resume` is true for
 *   a company still onboarding, false for one sent back by staff.
 * @returns {[number, (next: number | ((current: number) => number)) => void, number, () => void]}
 */
export function useOnboardingStep(orgId, initialStep, { lastStep, resume }) {
  const [state, setState] = useState(() => {
    const saved = resume ? readSaved(orgId, lastStep) : null;
    return saved ?? { step: initialStep, furthest: initialStep };
  });

  const setStep = useCallback((next) => {
    setState((current) => {
      const step = typeof next === "function" ? next(current.step) : next;
      return { step, furthest: Math.max(current.furthest, step) };
    });
  }, []);

  useEffect(() => {
    if (!resume) return;
    if (state.step >= lastStep) {
      forgetOnboardingStep(orgId);
      return;
    }
    try {
      window.localStorage.setItem(KEY + orgId, JSON.stringify(state));
    } catch {
      // Storage blocked: the dots still work, a refresh starts again.
    }
  }, [orgId, resume, lastStep, state]);

  /** The steps ahead no longer apply (the company type changed): only the current one counts as reached. */
  const forgetAhead = useCallback(() => {
    setState((current) => ({ step: current.step, furthest: current.step }));
  }, []);

  return [state.step, setStep, state.furthest, forgetAhead];
}
