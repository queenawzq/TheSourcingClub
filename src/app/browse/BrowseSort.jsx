/**
 * Browse vendors' "Sort: …" pill, live. The design draws the pill and nothing
 * behind it; live, it opens a short menu of the orders vendors' profiles can
 * be sorted by (vendor-directory-view.js SORTS).
 */
import React, { useEffect, useRef, useState } from "react";

export default function BrowseSort({ options, value, onChange, ariaLabel = "Sort vendors" }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const current = options.find((option) => option.key === value) ?? options[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => {
      if (!box.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="browse-sort" ref={box}>
      <button
        className="filter-button sort-button"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        Sort: {current.label}
      </button>
      {open && (
        <div className="browse-sort-menu" role="menu" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={option.key === current.key}
              className={option.key === current.key ? "is-selected" : undefined}
              key={option.key}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
