/**
 * The factory's screens in Chinese, live: the prototype's own
 * `FactoryMainLanguageLayer`, kept running.
 *
 * The prototype translates its shell once per render with the design's
 * dictionary (`factoryMainZhText`). Live screens draw text later, as their
 * data arrives, and in dialogs mounted outside the shell, so here the same
 * dictionary is applied to everything the page draws, as it is drawn. Words
 * that are not in the dictionary stay as they are: nothing is machine
 * translated here.
 *
 * A brand's own words (requests, its profile) are not dictionary text: the
 * design marks them `data-no-translate`. They get the Chinese the server
 * translated for this person (src/app/content-translation.js), matched by
 * their exact English, and the design's "查看英文原文" shows the English again.
 *
 * Left alone: what people wrote in messages and the company's own profile
 * (which has its own scoped layer). Switching back to English puts every
 * swapped text back.
 */
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { contentTranslations, toggleOriginal, translationDown, useContentTranslations } from "./content-translation.js";
import { chineseText, wholeEntry } from "./live-zh.js";

const ATTRIBUTES = ["placeholder", "aria-label", "title", "data-placeholder"];
const LEAVE_ALONE = [
  "script", "style", "textarea", "code", "pre",
  // What the person types, and what a form reads back: never rewritten
  // ("30 days" stays "30 days", and saves as typed). Their placeholders are
  // attributes and still translated.
  "input", "select", "[contenteditable]", "[contenteditable] *",
  // A field read back by its text; one carrying `data-quote-value` (the date
  // picker) is read by that value, so its label may be translated.
  ".is-editable [data-quote-field]:not([data-quote-value])",
  // The company's own profile; a brand's profile is read like any other page.
  ".factory-profile-page:not(.brand-profile-page)",
  ".message-bubble > p",
  ".message-attachment-row",
  ".tsc-content-original",
].join(",");
const BRAND_WORDS = "[data-no-translate]";
const EDITABLE = "input, textarea, select, [contenteditable]";
// Never touched at all, hints included.
const HARD_SKIP = "script, style, code, pre, .factory-profile-page:not(.brand-profile-page), .message-attachment-row";
// The design's note beside a translated brief, and its "see the English" button.
const TRANSLATION_NOTE = ".brand-brief-translation-meta";

/**
 * Taxonomy terms by their English label, for the Chinese ones staff wrote
 * (`label_zh`). Display only: the screens keep matching on slugs and ids.
 */
async function termLabelsZh() {
  const { data, error } = await supabase.from("taxonomy_terms").select("label_en, label_zh").not("label_zh", "is", null);
  if (error) return new Map();
  return new Map((data ?? []).filter((term) => term.label_en && term.label_zh).map((term) => [term.label_en.trim(), term.label_zh.trim()]));
}

/** The words a note sits beside: its card, or the section around it. */
const noteScope = (note) => note.closest("article, section, .brand-brief-copy, .brand-card-translation") ?? note.parentElement;

/**
 * The design's note and button, for what its own card shows now: translated
 * only when some of that card's words came back in Chinese and none failed.
 */
function noteText(original, note, content, swappedHere) {
  if (original === "查看英文原文" || original === "查看中文翻译") return content.showOriginal ? "查看中文翻译" : "查看英文原文";
  if (content.showOriginal) return "英文原文";
  const scope = noteScope(note);
  const texts = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) texts.push(walker.currentNode);
  const failedHere = texts.some((node) => content.failed.has(node.nodeValue.trim()));
  const translatedHere = texts.some((node) => swappedHere.has(node));
  if (translatedHere && !failedHere) return "由英文自动翻译";
  // Still asking: say nothing new until the answer is in.
  if (!translatedHere && !failedHere && content.pending > 0 && !translationDown()) return original;
  return "暂时无法翻译，显示英文原文";
}

export default function FactoryLanguageLayer({ language }) {
  const contentVersion = useContentTranslations();
  const [terms, setTerms] = useState(null);
  useEffect(() => {
    if (language !== "zh" || terms) return undefined;
    let cancelled = false;
    termLabelsZh().then((map) => { if (!cancelled) setTerms(map); }).catch(() => { if (!cancelled) setTerms(new Map()); });
    return () => { cancelled = true; };
  }, [language, terms]);

  useEffect(() => {
    const root = document.documentElement;
    const previousLang = root.lang;
    root.lang = language === "zh" ? "zh-CN" : "en";
    if (language !== "zh") return () => { root.lang = previousLang; };

    const swapped = [];
    const written = new WeakMap();
    // Text nodes now showing the server's Chinese for a brand's words.
    const contentNodes = new WeakSet();
    const notes = new Set();
    const skip = (element) => !element || Boolean(element.closest(LEAVE_ALONE));

    const content = contentTranslations();
    const contentFor = (text) => (content.showOriginal ? null : content.translations.get(text) ?? null);
    const chineseHere = (value, element, node) => {
      const trimmed = value.trim();
      if (element?.closest(TRANSLATION_NOTE)) {
        notes.add(element);
        return value;
      }
      // The date picker's weekday letters ("M T W T F S S"), by position.
      if (element?.parentElement?.matches(".schedule-calendar-weekdays") && /^[MTWFS]$/.test(trimmed)) {
        return "一二三四五六日"[[...element.parentElement.children].indexOf(element)] ?? value;
      }
      const server = contentFor(trimmed);
      if (server) {
        if (node) contentNodes.add(node);
        return value.replace(trimmed, server);
      }
      // Inside a brand's words only the design's own whole entries and
      // staff-written taxonomy labels ("Vendor should source some materials…").
      if (element?.closest(BRAND_WORDS)) {
        const whole = wholeEntry(trimmed, terms ?? undefined);
        if (whole) return value.replace(trimmed, whole);
        // A card's meta line ("Maple Row Studio · Posted 3 days ago") or a
        // label around the brand's words ("Brand asks: …"): the patterns,
        // with names as written and the brand's words as the server gave them.
        const zh = chineseText(trimmed, { terms: terms ?? undefined, content: contentFor });
        return zh ? value.replace(trimmed, zh) : value;
      }
      const zh = chineseText(trimmed, { terms: terms ?? undefined, content: contentFor });
      return zh ? value.replace(trimmed, zh) : value;
    };
    const swap = (node, attribute, read, write) => {
      const original = read();
      if (!original || !original.trim()) return;
      const mine = written.get(node);
      if (mine && mine[attribute ?? "#text"] === original) return;
      const isText = node.nodeType === Node.TEXT_NODE;
      const translated = chineseHere(original, isText ? node.parentElement : node, isText ? node : null);
      if (translated === original) return;
      write(translated);
      written.set(node, { ...(mine ?? {}), [attribute ?? "#text"]: translated });
      swapped.push({ node, attribute, original, translated });
    };
    const text = (node) => {
      if (skip(node.parentElement)) return;
      swap(node, null, () => node.nodeValue, (value) => { node.nodeValue = value; });
    };
    // A field's hints are not its value: an input's or an editable field's
    // placeholder is translated, its text never.
    const fieldHint = (element) => element.matches(EDITABLE) && !element.parentElement?.closest(HARD_SKIP);
    const attributes = (element, names = ATTRIBUTES) => {
      if (skip(element) && !fieldHint(element)) return;
      for (const name of names) {
        if (!element.hasAttribute(name)) continue;
        swap(element, name, () => element.getAttribute(name), (value) => element.setAttribute(name, value));
      }
    };
    const walk = (start) => {
      if (start.nodeType === Node.TEXT_NODE) { text(start); return; }
      if (start.nodeType !== Node.ELEMENT_NODE) return;
      if (start.closest(LEAVE_ALONE)) {
        if (start.nodeType === Node.ELEMENT_NODE && fieldHint(start)) attributes(start);
        return;
      }
      attributes(start);
      const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (!node.matches(LEAVE_ALONE)) return NodeFilter.FILTER_ACCEPT;
            if (fieldHint(node)) attributes(node);
            return NodeFilter.FILTER_REJECT;
          }
          return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
      });
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeType === Node.TEXT_NODE) text(node);
        else attributes(node);
      }
    };

    const pending = new Map();
    let frame = 0;
    const flush = () => {
      frame = 0;
      for (const [node, attribute] of pending) {
        if (!node.isConnected) continue;
        if (attribute) attributes(node, [attribute]);
        else walk(node);
      }
      pending.clear();
      updateNotes();
      if (swapped.length > 4000) {
        const kept = swapped.filter((entry) => entry.node.isConnected);
        swapped.length = 0;
        swapped.push(...kept);
      }
    };
    const queue = (node, attribute = null) => {
      if (!pending.has(node) || !attribute) pending.set(node, attribute);
      if (!frame) frame = window.requestAnimationFrame(flush);
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") record.addedNodes.forEach((node) => queue(node));
        else if (record.type === "characterData") queue(record.target);
        else if (record.type === "attributes") queue(record.target, record.attributeName);
      }
    });

    // Each note says what its own card shows, once the card has been walked.
    const noteNodes = new WeakMap();
    function updateNotes() {
      for (const element of notes) {
        if (!element.isConnected) { notes.delete(element); continue; }
        for (const node of element.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue.trim()) continue;
          const original = noteNodes.get(node) ?? node.nodeValue.trim();
          noteNodes.set(node, original);
          const next = noteText(original, element, content, contentNodes);
          if (node.nodeValue !== next) {
            node.nodeValue = next;
            written.set(node, { "#text": next });
            swapped.push({ node, attribute: null, original, translated: next });
          }
        }
      }
    }

    walk(document.body);
    updateNotes();
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
    const onNoteClick = (event) => {
      if (event.target.closest?.(`${TRANSLATION_NOTE} button`)) toggleOriginal();
    };
    document.addEventListener("click", onNoteClick);

    return () => {
      document.removeEventListener("click", onNoteClick);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      // Back to English: every text this layer changed, unless the screen has
      // since drawn something else there.
      for (const { node, attribute, original, translated } of swapped.reverse()) {
        if (!node.isConnected) continue;
        if (attribute) {
          if (node.getAttribute(attribute) === translated) node.setAttribute(attribute, original);
        } else if (node.nodeValue === translated) {
          node.nodeValue = original;
        }
      }
      root.lang = previousLang;
    };
  }, [language, terms, contentVersion]);

  return null;
}
