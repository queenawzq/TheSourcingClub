import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** The same explanation works with a mouse, keyboard, or a tap. */
export default function PaymentHelp({ label, children }) {
  const id = useId();
  const ref = useRef(null);
  const closeTimer = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || focused || pinned;
  const [position, setPosition] = useState({});
  const leave = () => { closeTimer.current = setTimeout(() => setHovered(false), 150); };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  function show() {
    clearTimeout(closeTimer.current);
    const rect = ref.current.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
    setPosition({ width, left: Math.max(12, Math.min(rect.left - width / 2, window.innerWidth - width - 12)),
      ...(rect.bottom + 140 < window.innerHeight ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }) });
  }
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && ref.current?.contains(event.target)) return;
      setHovered(false);
      setFocused(false);
      setPinned(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return <>
    <button ref={ref} className="payment-help" type="button" aria-label={`About ${label}`}
      aria-describedby={open ? id : undefined} aria-expanded={open}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") { show(); setHovered(true); } }}
      onPointerLeave={leave}
      onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) { show(); setFocused(true); } }}
      onBlur={() => { setFocused(false); setPinned(false); }}
      onClick={() => { show(); setPinned((value) => !value); }}>?</button>
    {open ? createPortal(<span id={id} role="tooltip" className="payment-help-tooltip" style={position}
      onPointerEnter={() => { clearTimeout(closeTimer.current); setHovered(true); }} onPointerLeave={leave}>{children}</span>, document.body) : null}
  </>;
}

export const PENDING_HELP = "Pending payments become available to withdraw after processing. No action is needed, and there is no extra platform hold.";
