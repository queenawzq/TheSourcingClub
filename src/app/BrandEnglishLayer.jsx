/**
 * A brand reads what a factory typed in Chinese in English: quote notes,
 * answers to its questions, step updates, the vendor's location and intro
 * (src/app/content-translation.js, `useEnglishContent`).
 *
 * The screens draw the text as the factory typed it; this layer swaps each
 * typed Chinese text, wherever a brand screen draws it ("Factory response:
 * 确认样衣…"), for the English the server translated, and puts the vendor
 * page's own control under it (#107: "Automatically translated to English ·
 * See original", `profile-translation-controls` in profile.css), which shows
 * the text as written and back ("See translation"). Text that could not be
 * translated stays as written, with no control. Nothing a person types is
 * touched, and a vendor's company name is not one of these texts:
 * vendor-names.jsx shows it.
 */
import { useEffect } from "react";
import { contentTranslations, useContentTranslations } from "./content-translation.js";
import { needsEnglish } from "../shared/profile-translation.mjs";
import "./profile/profile.css";

const LEAVE_ALONE = "script, style, input, textarea, select, [contenteditable], [contenteditable] *, .message-bubble, .profile-translation-controls";
const OWN_TRANSLATION = ".marketplace-factory-card, .factory-profile-page, .brand-factory-public-profile";
const OWN_CONTROLS = ".vendor-card-translation, .profile-translation-controls";
const FAILED_TITLE = "Couldn't translate this. Shown as written.";
const LABEL = { english: "Automatically translated to English", original: "Original text" };
const BUTTON = { english: "See original", original: "See translation" };

export default function BrandEnglishLayer() {
  const version = useContentTranslations();

  useEffect(() => {
    const content = contentTranslations();
    // The Chinese sources, longest first, so a sentence is replaced before
    // a shorter text it contains.
    const sources = [...content.translations.keys()].filter(needsEnglish).sort((a, b) => b.length - a.length);
    const failed = [...content.failed].filter((source) => typeof source === "string");
    // node → { original, english }
    const swapped = new Map();
    // element whose text was translated → { control, showing }
    const controls = new Map();
    const titled = new Map();

    const english = (text) => {
      let out = text;
      for (const source of sources) if (out.includes(source)) out = out.split(source).join(content.translations.get(source));
      return out;
    };
    const show = (element, showing) => {
      const entry = controls.get(element);
      entry.showing = showing;
      for (const [node, texts] of swapped) {
        if (node.parentElement === element) node.nodeValue = showing === "english" ? texts.english : texts.original;
      }
      entry.label.textContent = LABEL[showing];
      entry.button.textContent = BUTTON[showing];
    };
    // The vendor page's control, right after the translated text's element.
    const addControl = (element) => {
      if (controls.has(element) || !element?.parentNode) return;
      const control = document.createElement("div");
      control.className = "profile-translation-controls";
      control.setAttribute("aria-live", "polite");
      const label = document.createElement("span");
      label.className = "profile-translation-label";
      const button = document.createElement("button");
      button.type = "button";
      control.append(label, button);
      const entry = { control, label, button, showing: "english" };
      controls.set(element, entry);
      button.addEventListener("click", () => show(element, entry.showing === "english" ? "original" : "english"));
      element.after(control);
      show(element, "english");
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
      const element = node.parentElement;
      if (!value || !needsEnglish(value) || element?.closest(LEAVE_ALONE) || ownTranslation(element)) return;
      if (swapped.has(node)) {
        const texts = swapped.get(node);
        if (value === texts.english || value === texts.original) return;
        swapped.delete(node);
      }
      const translated = english(value);
      if (translated !== value) {
        swapped.set(node, { original: value, english: translated });
        if (controls.has(element) && controls.get(element).showing === "original") return;
        node.nodeValue = translated;
        addControl(element);
      } else if (failed.some((source) => value.includes(source))) {
        setTitle(element, FAILED_TITLE);
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
        // A control whose text the screen has since removed goes with it.
        for (const [element, entry] of controls) {
          if (!element.isConnected) { entry.control.remove(); controls.delete(element); }
        }
      });
    });

    if (sources.length || failed.length) {
      walk(document.body);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    }
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      for (const [node, texts] of swapped) if (node.isConnected && node.nodeValue === texts.english) node.nodeValue = texts.original;
      for (const [, entry] of controls) entry.control.remove();
      for (const [element, title] of titled) {
        if (!element.isConnected) continue;
        if (title == null) element.removeAttribute("title"); else element.setAttribute("title", title);
      }
    };
  }, [version]);

  return null;
}
