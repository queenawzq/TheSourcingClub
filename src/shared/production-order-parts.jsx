/**
 * Pieces of the production order list that both designed apps draw the same
 * way: the brand's ProjectsScreen and the factory's FactoryProjectsPage.
 * They live here so a live fix lands on both sides at once.
 */
import React, { useEffect, useRef, useState } from "react";

/**
 * Search, vendor, date range and sort over live order cards. The cards carry
 * `factory` (the other company, whichever side is looking), `orderNumber`,
 * `createdAt` and `nextDueOn`.
 */
export function filterOrders(rows, { search, vendor, dateRange, sortBy }) {
  const needle = search.trim().toLowerCase();
  const since = dateRange === "any" ? null : Date.now() - Number(dateRange) * 86400000;
  const filtered = rows.filter((project) => {
    if (vendor !== "all" && project.factory !== vendor) return false;
    if (since && project.createdAt && new Date(project.createdAt).getTime() < since) return false;
    if (!needle) return true;
    return [project.title, project.orderNumber, project.factory]
      .some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
  const time = (value, missing) => (value ? new Date(value).getTime() : missing);
  if (sortBy === "due") {
    return [...filtered].sort((a, b) => time(a.nextDueOn, Infinity) - time(b.nextDueOn, Infinity));
  }
  if (sortBy === "factory") {
    return [...filtered].sort((a, b) => String(a.factory ?? "").localeCompare(String(b.factory ?? "")));
  }
  return [...filtered].sort((a, b) => time(b.createdAt, 0) - time(a.createdAt, 0));
}

/**
 * Which orders a tab shows. Active and Closed split on the order's state; a
 * custom tab shows the orders filed in it, open or closed. `membership` (tab
 * key → Set of order ids) comes from the live store; the prototype has none,
 * so there a custom tab keeps showing what it always did.
 */
export function rowsForTab(rows, tabKey, membership = null) {
  const isClosed = (project) => project.state === "completed" || project.state === "cancelled";
  if (membership && tabKey !== "active" && tabKey !== "closed") {
    const filed = membership.get(tabKey);
    return rows.filter((project) => filed?.has(project.id));
  }
  return rows.filter((project) => (tabKey === "closed" ? isClosed(project) : !isClosed(project)));
}

/**
 * The "..." menu on an order card, with "Add to › <tab>".
 *
 * The brand card drew it; the factory card's "..." had nothing behind it, so
 * both use this one. In the prototype the tabs are local and a click only
 * closes the menu. Live passes `onToggleTab`: the tabs the order is already in
 * carry a ✓, and choosing one again takes the order out. `children(close)`
 * adds the card's other items.
 */
export function OrderCardMenu({ customTabs = [], isFiled = null, onToggleTab = null, children = null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (menuRef.current?.contains(event.target)) return;
      setMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuOpen]);

  const close = () => setMenuOpen(false);
  // Live, a company with no tabs of its own would get an empty "Add to" panel.
  const showAddTo = !onToggleTab || customTabs.length > 0;
  if (!showAddTo && !children) {
    return <button className="rfq-more" type="button" aria-label="More order actions">...</button>;
  }

  return (
    <div className="project-overflow" ref={menuRef}>
      <button className="rfq-more" type="button" aria-label="More order actions" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>...</button>
      {menuOpen && (
        <div className="project-overflow-menu" role="menu">
          {showAddTo && (
            <div className="project-overflow-submenu">
              <button type="button" role="menuitem">Add to</button>
              <div className="project-overflow-submenu-panel">
                {customTabs.map((tab) => {
                  const filed = Boolean(isFiled?.(tab));
                  return (
                    <button
                      type="button"
                      role={onToggleTab ? "menuitemcheckbox" : "menuitem"}
                      aria-checked={onToggleTab ? filed : undefined}
                      key={tab.key}
                      onClick={() => {
                        close();
                        onToggleTab?.(tab);
                      }}
                    >
                      {filed ? "✓ " : ""}{tab.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {children?.(close)}
        </div>
      )}
    </div>
  );
}

/**
 * The same rail, drawn from real steps: `[{ id, label, done, current, needsFunding }]`.
 * At most five are shown, a window around the current step, because the
 * design's rail has room for five.
 */
export function ProjectStepRail({ steps }) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.current));
  const start = Math.max(0, Math.min(currentIndex - 2, steps.length - 5));
  const visible = steps.slice(start, start + 5);
  const doneCount = visible.filter((step) => step.done).length;
  const progressPercent = visible.length <= 1 ? 0 : (doneCount / (visible.length - 1)) * 100;

  return (
    <div className="project-progress" style={{ "--project-progress": `${Math.min(progressPercent, 100)}%` }}>
      <div className="project-progress-line" aria-hidden="true" />
      {visible.map((step, index) => (
        <div
          className={step.done ? "project-progress-step complete" : step.current ? "project-progress-step current" : "project-progress-step"}
          key={step.id ?? `${start + index}-${step.label}`}
        >
          <span>{step.done ? "✓" : start + index + 1}</span>
          <small>{step.needsFunding ? "Need funding" : step.label}</small>
        </div>
      ))}
    </div>
  );
}
