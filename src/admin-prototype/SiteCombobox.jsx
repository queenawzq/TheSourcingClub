import { useEffect, useRef, useState } from "react";

/**
 * "Where you checked" (Nov 26): the product's combobox (factory onboarding's
 * certification picker), not the browser's autocomplete. Typing filters the
 * known sites; any other site can still be typed. Company details' Country
 * uses the same list (U7), with the countries as its options.
 *
 *   sites: [{ key, name, label? }]
 *   toggleLabel: the arrow button's name for a screen reader
 */
export function SiteCombobox({ id, value, sites, placeholder, onFocus, onChange, toggleLabel = "Show known sites" }) {
  const [open, setOpen] = useState(false);
  // The option the arrow keys are on (R10): Up/Down move, Enter picks, Escape closes the list only.
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const menuRef = useRef(null);
  const listId = `${id}-sites`;
  const query = (value ?? "").trim().toLowerCase();
  // A site already chosen shows every known site; typing something new filters them.
  const chosen = sites.some((item) => item.name.toLowerCase() === query);
  const shown = chosen ? sites : sites.filter((item) => !query || `${item.name} ${item.label ?? ""}`.toLowerCase().includes(query));
  const options = shown.length ? shown : sites;
  const optionId = (index) => `${listId}-${index}`;
  useEffect(() => {
    if (!open) return undefined;
    const away = (event) => { if (!boxRef.current?.contains(event.target)) setOpen(false); };
    const key = (event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key, true); };
  }, [open]);
  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const pick = (item) => { onChange(item.name); setOpen(false); setActive(-1); };
  const onKeyDown = (event) => {
    if (!sites.length) return;
    const selected = options.findIndex((item) => item.name === value);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const down = event.key === "ArrowDown";
      if (!open) {
        setOpen(true);
        setActive(selected >= 0 ? selected : down ? 0 : options.length - 1);
      } else {
        setActive((current) => (current < 0 ? (down ? 0 : options.length - 1) : Math.min(Math.max(current + (down ? 1 : -1), 0), options.length - 1)));
      }
    } else if (event.key === "Enter" && open && options[active]) {
      event.preventDefault();
      pick(options[active]);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };
  return (
    <div className="vr-combobox" ref={boxRef}>
      <input
        id={id}
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? optionId(active) : undefined}
        onFocus={(event) => { onFocus?.(event); if (sites.length) setOpen(true); }}
        onChange={(event) => { onChange(event.target.value); setActive(-1); if (sites.length) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {sites.length > 0 && (
        <button className="vr-combobox-toggle" type="button" tabIndex={-1} aria-label={toggleLabel} onClick={() => setOpen((current) => !current)}>
          <img src="/assets/prototype-icons/dropdown.svg" alt="" />
        </button>
      )}
      {open && sites.length > 0 && (
        <div className="vr-combobox-menu" id={listId} role="listbox" ref={menuRef}>
          {options.map((item, index) => (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={optionId(index)}
              data-index={index}
              className={index === active ? "is-active" : undefined}
              aria-selected={value === item.name}
              key={item.key}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(item)}
            >
              <strong>{item.name}</strong>
              {item.label && item.label !== item.name && <small>{item.label}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
