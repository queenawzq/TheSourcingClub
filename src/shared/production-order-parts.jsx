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

const isClosedOrder = (project) => project.state === "completed" || project.state === "cancelled";

/**
 * Which orders a tab shows. Active and Closed split on the order's state; a
 * custom tab shows the orders filed in it, open or closed. `membership` (tab
 * key → Set of order ids) comes from the live store; the prototype has none,
 * so there a custom tab keeps showing what it always did.
 *
 * `archived` (a Set of order ids, live only) is the company's archive: those
 * orders show under "archived" and in no other tab, custom ones included.
 * Their filing is kept, so unarchiving puts them back where they were.
 */
export function rowsForTab(rows, tabKey, membership = null, archived = null) {
  if (tabKey === "archived") return rows.filter((project) => archived?.has(project.id));
  const kept = archived?.size ? rows.filter((project) => !archived.has(project.id)) : rows;
  if (membership && tabKey !== "active" && tabKey !== "closed") {
    const filed = membership.get(tabKey);
    return kept.filter((project) => filed?.has(project.id));
  }
  return kept.filter((project) => (tabKey === "closed" ? isClosedOrder(project) : !isClosedOrder(project)));
}

/**
 * The tab strip as drawn, plus "Archived" at the end while the company has
 * archived something. It is not one of the company's saved tabs, so it never
 * reaches "Manage tabs" and cannot be renamed or moved.
 */
export function withArchivedTab(tabs, rows, archived) {
  return rowsForTab(rows, "archived", null, archived).length
    ? [...tabs, { key: "archived", label: "Archived", locked: true }]
    : tabs;
}

/**
 * The card menu's archive item, live. `undefined` without a store, so the
 * prototype keeps the design's own item; `null` on an open order, which has
 * nothing to archive.
 */
export function archiveActionFor(store, project) {
  if (!store) return undefined;
  if (store.archived.has(project.id)) {
    return { label: "Unarchive order", run: () => store.unarchive(project.id) };
  }
  if (isClosedOrder(project)) return { label: "Archive order", run: () => store.archive(project.id) };
  return null;
}

/**
 * The card menu's cancel item, live. The design draws none, so without a
 * store there is nothing; a closed order has nothing to cancel either. An
 * open proposal changes the item: its proposer may withdraw it, and the other
 * side is sent to the order, where the banner asks before anything closes.
 * `reload` refreshes the list the card is on.
 */
export function cancelActionFor(store, project, reload) {
  if (!store || isClosedOrder(project) || !project.id) return null;
  const proposal = project.cancelProposal;
  if (!proposal) {
    return {
      label: "Cancel order",
      run: () => store.propose({ id: project.id, title: project.title, counterparty: project.factory, onDone: reload }),
    };
  }
  if (proposal.mine) {
    return { label: "Withdraw cancellation", run: async () => { if (await store.withdraw(project.id)) reload?.(); } };
  }
  return store.view ? { label: "Review cancellation", run: () => store.view(project) } : null;
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
