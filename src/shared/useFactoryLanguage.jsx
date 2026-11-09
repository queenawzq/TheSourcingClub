import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth.jsx";
import { supabase } from "../lib/supabase.js";
import { factoryLanguage } from "./factory-language.mjs";

function legacyLanguage() {
  try { return window.localStorage.getItem("factoryLang"); } catch { return null; }
}

export function useFactoryLanguage() {
  const { user } = useAuth();
  const language = factoryLanguage({ saved: user?.user_metadata?.interface_language, query: new URLSearchParams(window.location.search).get("lang"), legacy: legacyLanguage() });
  return { language, user };
}

export async function saveFactoryLanguage(language) {
  const { error } = await supabase.auth.updateUser({ data: { interface_language: language } });
  if (error) throw error;
  localStorage.setItem("factoryLang", language);
}

export function FactoryLanguageSwitch() {
  const { language, user } = useFactoryLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Preserve existing Chinese registrations the first time the new workspace opens.
  useEffect(() => {
    if (user && !user.user_metadata?.interface_language) saveFactoryLanguage(language).catch(() => {});
  }, [user?.id, language]);
  async function change(event) {
    const next = event.target.value;
    setBusy(true); setError("");
    try {
      await saveFactoryLanguage(next);
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.location.assign(url.href);
    } catch { setError(language === "zh" ? "语言设置未保存，请重试。" : "Language could not be saved. Please try again."); setBusy(false); }
  }
  return <div className="factory-language-control" data-no-translate><label><span>{language === "zh" ? "语言" : "Language"}</span><select aria-label="Language / 语言" value={language} onChange={change} disabled={busy}><option value="en">English</option><option value="zh">中文</option></select></label>{error && <p role="alert">{error}</p>}</div>;
}
