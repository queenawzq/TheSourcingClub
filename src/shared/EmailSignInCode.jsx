import React, { useEffect, useState } from "react";

export function useCodeResendCountdown() {
  const [deadline, setDeadline] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!deadline) return undefined;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [deadline]);

  function startCountdown(wait) {
    setSeconds(wait);
    setDeadline(performance.now() + wait * 1000);
  }

  return { seconds, startCountdown };
}

export function EmailSignInCodeInput() {
  const [value, setValue] = useState("");

  return (
    <input
      type="text"
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder="Enter code"
      value={value}
      onChange={(event) => {
        const entered = event.target.value.trim();
        if (/^[0-9]{0,6}$/.test(entered)) setValue(entered);
      }}
      pattern="[0-9]{6}"
      required
      autoFocus
    />
  );
}
