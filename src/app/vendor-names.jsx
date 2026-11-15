import React, { useEffect, useReducer } from "react";
import { needsEnglish } from "../shared/profile-translation.mjs";
import { requestVendorNames } from "./profile/profile-translation-client.js";
import { initialsOf } from "./profile/factory-profile-view.js";
import "./vendor-names.css";

/**
 * A vendor's company name as a brand reads it: the English name first, the
 * name as the company wrote it under it. One place for every brand screen
 * (Browse, Saved, the invite step, recommended factories, quotes, orders,
 * conversations, payments), keyed by org id, so one company reads the same
 * everywhere.
 *
 * Never waits: a screen draws the name as written, and redraws when the
 * English arrives. No answer (no model, a timeout, an error) leaves the name
 * as written. Names already in Latin script are never sent. The names on one
 * screen go in one request, at most 50 a request.
 */

const BATCH = 50;
const RETRY_AFTER_MS = 60_000;
// orgId → { source, english } once answered (english null: none).
const answers = new Map();
// orgId → { source, tries, at } for names asked about or failed.
const asked = new Map();
const queue = new Map();
const listeners = new Set();
let flushing = null;

const clean = (name) => String(name ?? "").trim();

function wanted(id, name) {
  if (!id || !needsEnglish(name)) return false;
  const answer = answers.get(id);
  if (answer?.source === name && answer.english) return false;
  const ask = asked.get(id);
  if (!ask || ask.source !== name) return true;
  if (ask.inFlight) return false;
  // A name the server had no English for is asked once more, then left
  // until the page has been open a minute.
  return ask.tries < 2 || Date.now() - ask.at > RETRY_AFTER_MS;
}

function notify() {
  for (const listener of listeners) listener();
}

async function flush() {
  await Promise.resolve();
  while (queue.size) {
    const batch = [...queue].slice(0, BATCH);
    for (const [id] of batch) queue.delete(id);
    for (const [id, name] of batch) {
      const previous = asked.get(id);
      asked.set(id, { source: name, tries: (previous?.source === name ? previous.tries : 0) + 1, at: Date.now(), inFlight: true });
    }
    try {
      const byOrg = await requestVendorNames(batch.map(([id]) => id));
      for (const [id, name] of batch) {
        const answer = byOrg[id];
        // The server read the name from the database: keep its answer only
        // for the name this screen shows.
        if (answer && clean(answer.source) === name) answers.set(id, { source: name, english: clean(answer.english) || null });
      }
    } catch { /* The names stay as written. */ }
    for (const [id] of batch) {
      const ask = asked.get(id);
      if (ask) asked.set(id, { ...ask, inFlight: false, at: Date.now() });
    }
    notify();
  }
  flushing = null;
}

function ask(id, name) {
  queue.set(id, name);
  flushing ??= flush();
}

/** The English name for an org id and the name as written, or null. */
export function englishName(id, name) {
  const source = clean(name);
  const answer = answers.get(id);
  return answer && answer.source === source ? answer.english : null;
}

/** The English name first, the name as written under it, in the card's subtitle style. */
export function VendorName({ id, name, english = englishName(id, name) }) {
  if (!english) return <>{name}</>;
  return <>{english}<span className="tsc-vendor-name-original" lang="zh">{name}</span></>;
}

/**
 * For a brand screen naming vendors: `vendors` is `[{ id, name }]` (org id,
 * the name as written). Returns:
 *   text(id, name)   the English name, or the name as written (for sentences, initials, labels)
 *   node(id, name)   English with the original under it (where a name is drawn on its own)
 *   search(id, name) both, for a search box
 * `enabled` false (the factory's side of a shared screen) answers the name as written.
 */
export function useVendorNames(vendors, { enabled = true } = {}) {
  const [, rerender] = useReducer((count) => count + 1, 0);
  const key = enabled ? (vendors ?? []).map((vendor) => `${vendor?.id}:${clean(vendor?.name)}`).join("|") : "";
  useEffect(() => {
    if (!enabled) return undefined;
    listeners.add(rerender);
    for (const vendor of vendors ?? []) {
      const name = clean(vendor?.name);
      if (wanted(vendor?.id, name)) ask(vendor.id, name);
    }
    return () => { listeners.delete(rerender); };
    // `key` is the vendors' identity; the array itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  const english = (id, name) => (enabled ? englishName(id, name) : null);
  return {
    text: (id, name) => english(id, name) ?? name,
    node: (id, name) => <VendorName id={id} name={name} english={english(id, name)} />,
    search: (id, name) => [english(id, name), name].filter(Boolean).join(" "),
    /** A card `{ id, name, searchText? }`: `name` in English, `nameNode` with the original, search on both. */
    card: (card) => {
      const translated = english(card.id, card.name);
      if (!translated) return card;
      return {
        ...card,
        name: translated,
        // Still found by the name as written (the invite step's search).
        originalName: card.name,
        // The avatar's letters from the English name, as on the vendor's page.
        ...(card.initials != null ? { initials: initialsOf(translated) } : {}),
        nameNode: <VendorName id={card.id} name={card.name} english={translated} />,
        ...(typeof card.searchText === "string" ? { searchText: `${card.searchText} ${translated.toLowerCase()}` } : {}),
      };
    },
  };
}

/**
 * A name that asks for its own English, for a list built outside a component
 * (an adapter's cards). `inline`: in a line of other words ("Name · ORD-12 ·
 * Started"), the English alone, the name as written on hover.
 */
export function LiveVendorName({ id, name, inline = false }) {
  const names = useVendorNames([{ id, name }]);
  const english = englishName(id, name);
  if (!english) return <>{name}</>;
  return inline ? <span title={name}>{english}</span> : names.node(id, name);
}

/** The English name now if it is known, else the name as written: for text built outside a component. */
export const vendorNameText = (id, name) => englishName(id, name) ?? name;

/** For tests: forget every answer. */
export function resetVendorNames() {
  answers.clear(); asked.clear(); queue.clear();
}
