/**
 * A brand reads what a factory typed in Chinese in English: quote notes,
 * answers to its questions, step updates, the vendor's location and intro
 * (src/app/content-translation.js, `useEnglishContent`).
 *
 * The screens draw the text as the factory typed it; this layer swaps each
 * typed Chinese text, wherever a brand screen draws it ("Factory response:
 * 确认样衣…"), for the English the server translated. Clicking the English
 * shows the text as written, and again shows the English (its tooltip says
 * so). Text that could not be translated stays as written, and its tooltip
 * says that. Nothing a person types is touched, and a vendor's company name
 * is not one of these texts: vendor-names.jsx shows it.
 */
import { useEffect } from "react";
import { contentTranslations, useContentTranslations } from "./content-translation.js";
import { needsEnglish } from "../shared/profile-translation.mjs";

const LEAVE_ALONE = "script, style, input, textarea, select, [contenteditable], [contenteditable] *, .message-bubble";
const OWN_TRANSLATION = ".marketplace-factory-card, .factory-profile-page, .brand-factory-public-profile";
const OWN_CONTROLS = ".vendor-card-translation, .profile-translation-controls";
const TRANSLATED_TITLE = "Translated from Chinese. Click to see it as written.";
const ORIGINAL_TITLE = "As written. Click to see the English.";
const FAILED_TITLE = "Couldn't translate this. Shown as written.";

export default function BrandEnglishLayer() {
  const version = useContentTranslations();

  useEffect(() => {
    const content = contentTranslations();
    // The Chinese sources, longest first, so a sentence is replaced before
    // a shorter text it contains.
    const sources = [...content.translations.keys()].filter(needsEnglish).sort((a, b) => b.length - a.length);
    const failed = [...content.failed].filter((source) => typeof source === "string");
    // node → { original, english, showing: "english" | "original" }
    const swapped = new Map();
    const titled = new Map();

    const english = (text) => {
      let out = text;
      for (const source of sources) if (out.includes(source)) out = out.split(source).join(content.translations.get(source));
      return out;
    };
    const setTitle = (element, title) => {
      if (!element) return;
      if (!titled.has(element)) titled.set(element, element.getAttribute("title"));
      element.setAttribute("title", title);
    };
    // A vendor page or Browse card translates its own words, with its own
    // "See original": left to it, so its original stays original.
    const ownTranslation = (element) => Boolean(element?.closest(OWN_TRANSLATION)?.querySelector(OWN_CONTROLS));
    const visit = (node) => {
      const value = node.nodeValue;
      if (!value || !needsEnglish(value) || node.parentElement?.closest(LEAVE_ALONE) || ownTranslation(node.parentElement)) return;
      if (swapped.has(node)) {
        const entry = swapped.get(node);
        if (value === entry.english || value === entry.original) return;
        swapped.delete(node);
      }
      const translated = english(value);
      if (translated !== value) {
        swapped.set(node, { original: value, english: translated, showing: "english" });
        node.nodeValue = translated;
        setTitle(node.parentElement, TRANSLATED_TITLE);
      } else if (failed.some((source) => value.includes(source))) {
        setTitle(node.parentElement, FAILED_TITLE);
      }
    };
    const walk = (root) => {
      if (root.nodeType === Node.TEXT_NODE) { visit(root); return; }
      if (root.nodeType !== Node.ELEMENT_NODE || root.closest(LEAVE_ALONE)) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) visit(walker.currentNode);
    };

    let frame = 0;
    const pending = new Set();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") record.addedNodes.forEach((node) => pending.add(node));
        else pending.add(record.target);
      }
      if (!frame) frame = window.requestAnimationFrame(() => {
        frame = 0;
        for (const node of pending) if (node.isConnected) walk(node);
        pending.clear();
      });
    });
    // One click shows the text as written; another, the English.
    const onClick = (event) => {
      const element = event.target.closest?.("[title]");
      if (!element || (element.title !== TRANSLATED_TITLE && element.title !== ORIGINAL_TITLE)) return;
      for (const [node, entry] of swapped) {
        if (node.parentElement !== element) continue;
        entry.showing = entry.showing === "english" ? "original" : "english";
        node.nodeValue = entry.showing === "english" ? entry.english : entry.original;
        element.setAttribute("title", entry.showing === "english" ? TRANSLATED_TITLE : ORIGINAL_TITLE);
      }
    };

    if (sources.length || failed.length) {
      walk(document.body);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      document.addEventListener("click", onClick);
    }
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick);
      if (frame) window.cancelAnimationFrame(frame);
      for (const [node, entry] of swapped) if (node.isConnected && node.nodeValue === entry.english) node.nodeValue = entry.original;
      for (const [element, title] of titled) {
        if (!element.isConnected) continue;
        if (title == null) element.removeAttribute("title"); else element.setAttribute("title", title);
      }
    };
  }, [version]);

  return null;
}
