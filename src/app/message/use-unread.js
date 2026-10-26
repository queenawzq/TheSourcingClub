/**
 * Unread messages for the company, kept current while the page stays open.
 *
 * The sum of each conversation's `unread_count` (message_thread_summary:
 * delivered, from the other company, after this person's last read). It is
 * read again when a message moves (messages are in the Realtime publication,
 * and Realtime applies the read policy per subscriber), when this tab marks a
 * conversation read (`MESSAGES_READ`: message_reads is not published), and
 * when the tab comes back into view. Never throws: a count that cannot be read
 * is no count.
 */
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase.js";
import { listThreads, MESSAGES_READ } from "../../lib/domain/message.js";

/** Calls `onChange` (debounced) whenever the company's unread may have moved. */
export function useMessagesChanged(orgId, onChange) {
  useEffect(() => {
    if (!orgId || !supabase) return undefined;
    let timer = null;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => onChange(), 400);
    };
    const visible = () => document.visibilityState === "visible" && soon();
    const channel = supabase
      .channel(`unread:${orgId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, soon)
      .subscribe();
    window.addEventListener(MESSAGES_READ, soon);
    window.addEventListener("focus", soon);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
      window.removeEventListener(MESSAGES_READ, soon);
      window.removeEventListener("focus", soon);
      document.removeEventListener("visibilitychange", visible);
    };
    // onChange is read through the closure each time; callers pass a fresh one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
}

export function useUnreadMessages(orgId) {
  const [count, setCount] = useState(0);
  const read = async () => {
    try {
      const rows = await listThreads(orgId);
      setCount((rows ?? []).reduce((sum, thread) => sum + (Number(thread.unread_count) || 0), 0));
    } catch {
      // Left as it was.
    }
  };
  useEffect(() => { if (orgId) read(); else setCount(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [orgId]);
  useMessagesChanged(orgId, read);
  return count;
}
