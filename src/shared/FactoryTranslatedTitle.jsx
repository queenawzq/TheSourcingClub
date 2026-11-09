import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase.js";
const CardTranslationContext = createContext(null);
export function FactoryTranslationCard({ children, as: Tag = "article", ...props }) {
  const parent = useContext(CardTranslationContext);
  const [original, setOriginal] = useState(false);
  const [fields, setFields] = useState({});
  const report = useCallback((field, translated) => setFields(current => current[field] === translated ? current : { ...current, [field]: translated }), []);
  if (parent) return <Tag {...props}>{children}</Tag>;
  return <CardTranslationContext.Provider value={{ original, setOriginal, report, translated: Object.values(fields).some(Boolean) }}><Tag {...props}>{children}</Tag></CardTranslationContext.Provider>;
}
const requests = new Map();
async function requestTitle(kind, id, field) {
  const { data: { session } } = await supabase.auth.getSession();
  const key = `${session?.user?.id}:${kind}:${id}:${field}`;
  if (requests.has(key)) return requests.get(key);
  const pending = fetch("/api/factory-title-translation", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` }, body: JSON.stringify({ kind, id, field }) }).then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  });
  requests.set(key, pending);
  try { return await pending; } finally { requests.delete(key); }
}
export default function FactoryTranslatedTitle({ title, id, kind = "rfq", language, field = "title", as: Tag = "h2" }) {
  const [result, setResult] = useState(null);
  const [ownOriginal, setOwnOriginal] = useState(false);
  const card = useContext(CardTranslationContext);
  const original = card ? card.original : ownOriginal;
  const setOriginal = card ? card.setOriginal : setOwnOriginal;
  useEffect(() => {
    let active = true;
    setResult(null); setOwnOriginal(false);
    if (language === "zh" && id && title && title !== "Untitled request") requestTitle(kind, id, field).then(value => { if (active) setResult(value); }).catch(() => {});
    return () => { active = false; };
  }, [title, id, kind, language, field]);
  const translated = language === "zh" && Boolean(result?.translation) && result.source === title;
  const report = card?.report;
  useEffect(() => {
    report?.(field, translated);
    return () => report?.(field, false);
  }, [report, field, translated]);
  const showControl = card ? field === "title" && card.translated : translated;
  if (!title) return null;
  return <div className={`factory-translated-title${field === "title" ? " is-title" : " is-description"}`} data-no-translate>
    <Tag>{translated && !original ? result.translation.replace(/产前样（fit sample）/gi, "试身样（fit sample）") : language === "zh" && title === "Untitled request" ? "未命名询价" : title}</Tag>
    {showControl && <div className="brand-brief-translation-meta list-card-translation-meta"><span>{original ? "原文" : "自动翻译为中文"}</span><button type="button" onClick={() => setOriginal(value => !value)}>{original ? "查看中文翻译" : "查看原文"}</button></div>}
  </div>;
}
