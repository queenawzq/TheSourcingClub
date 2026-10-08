/**
 * Pieces of the production order list that both designed apps draw the same
 * way: the brand's ProjectsScreen and the factory's FactoryProjectsPage.
 * They live here so a live fix lands on both sides at once.
 */
import React from "react";

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
