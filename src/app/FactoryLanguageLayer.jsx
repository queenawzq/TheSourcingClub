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
import { factoryMainZhText, translateFactoryMainText } from "../factory-prototype/main.jsx";
import { supabase } from "../lib/supabase.js";
import { contentTranslations, toggleOriginal, useContentTranslations } from "./content-translation.js";

const ATTRIBUTES = ["placeholder", "aria-label", "title"];
const LEAVE_ALONE = [
  "script", "style", "textarea", "code", "pre",
  // The company's own profile; a brand's profile is read like any other page.
  ".factory-profile-page:not(.brand-profile-page)",
  ".message-bubble > p",
  ".message-attachment-row",
  ".tsc-content-original",
].join(",");
const BRAND_WORDS = "[data-no-translate]";
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

const LATIN_WORD = /[A-Za-z]{3,}/g;

/**
 * The dictionary's Chinese for one text, or the text unchanged. A text the
 * dictionary only partly covers (a brand's sentence in which "Fit sample"
 * happens to appear) is left whole: half a sentence in each language reads
 * worse than English.
 */
export function chineseFor(value, terms = new Map()) {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const term = terms.get(trimmed)
    ?? (trimmed.includes(", ") && trimmed.split(", ").every((part) => terms.has(part))
      ? trimmed.split(", ").map((part) => terms.get(part)).join("、")
      : null);
  if (term) return value.replace(trimmed, term);
  const translated = translateFactoryMainText(value);
  if (translated === value) return value;
  // A whole dictionary entry is the design's own Chinese, trade words included.
  if (Object.hasOwn(factoryMainZhText, trimmed)) return translated;
  // Whole entries and dates come out without English words, and a pattern
  // keeps only the names it carries ("Message Demo Brand..."). A sentence that
  // still has two or more of its ordinary words was only partly covered.
  const ordinary = (translated.match(LATIN_WORD) ?? []).filter((word) => /^[a-z]/.test(word)).length;
  return ordinary >= 2 ? value : translated;
}

/** The design's note and button, saying what is on screen now. */
function noteText(original, { showOriginal, failed, translations }) {
  if (original === "查看英文原文" || original === "查看中文翻译") return showOriginal ? "查看中文翻译" : "查看英文原文";
  if (showOriginal) return "英文原文";
  if (failed && translations.size === 0) return "暂时无法翻译，显示英文原文";
  return "由英文自动翻译";
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
    const skip = (element) => !element || Boolean(element.closest(LEAVE_ALONE));

    const content = contentTranslations();
    const chineseHere = (value, element) => {
      const trimmed = value.trim();
      const translatedContent = !content.showOriginal && content.translations.get(trimmed);
      if (translatedContent) return value.replace(trimmed, translatedContent);
      if (element?.closest(TRANSLATION_NOTE)) return noteText(trimmed, content);
      // Inside a brand's words only the design's own whole entries and
      // staff-written taxonomy labels ("Vendor should source some materials…").
      if (element?.closest(BRAND_WORDS)) {
        const whole = Object.hasOwn(factoryMainZhText, trimmed) ? factoryMainZhText[trimmed] : terms?.get(trimmed);
        return whole ? value.replace(trimmed, whole) : value;
      }
      const whole = chineseFor(value, terms ?? undefined);
      if (whole !== value || !trimmed.includes(" · ")) return whole;
      // "Maple Row Studio · Quote due Nov 24 · Sample before bulk": each part
      // on its own; a name stays as written.
      const parts = trimmed.split(" · ").map((part) => chineseHere(part, element));
      return parts.join(" · ") !== trimmed ? value.replace(trimmed, parts.join(" · ")) : value;
    };
    const swap = (node, attribute, read, write) => {
      const original = read();
      if (!original || !original.trim()) return;
      const mine = written.get(node);
      if (mine && mine[attribute ?? "#text"] === original) return;
      const translated = chineseHere(original, node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
      if (translated === original) return;
      write(translated);
      written.set(node, { ...(mine ?? {}), [attribute ?? "#text"]: translated });
      swapped.push({ node, attribute, original, translated });
    };
    const text = (node) => {
      if (skip(node.parentElement)) return;
      swap(node, null, () => node.nodeValue, (value) => { node.nodeValue = value; });
    };
    const attributes = (element, names = ATTRIBUTES) => {
      if (skip(element)) return;
      for (const name of names) {
        if (!element.hasAttribute(name)) continue;
        swap(element, name, () => element.getAttribute(name), (value) => element.setAttribute(name, value));
      }
    };
    const walk = (start) => {
      if (start.nodeType === Node.TEXT_NODE) { text(start); return; }
      if (start.nodeType !== Node.ELEMENT_NODE) return;
      if (start.closest(LEAVE_ALONE)) return;
      attributes(start);
      const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return node.matches(LEAVE_ALONE) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
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

    walk(document.body);
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
