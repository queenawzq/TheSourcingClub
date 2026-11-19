import { screenOne } from "./screen-message.js";

/**
 * Messages a closed page left `checking`.
 *
 * Every message is screened on send by the sender's page (api/screen-message),
 * which also asks again while it stays open (src/shared/rescreen.mjs). A page
 * closed before any answer left the message `checking`, unseen by the other
 * side, until the sender next opened Conversations. The daily job
 * (api/cron-daily.js) now screens those, the same way, as the server.
 *
 * - Only messages older than OLDER_THAN_MS, so a sender's page still asking
 *   is left to answer first. If both answer, record_message_screening locks
 *   the row and changes only one still `checking`: one delivery, one notice.
 * - At most MAX_PER_RUN a run, CONCURRENCY at a time, and none started after
 *   BUDGET_MS, so the model's 8 seconds each never eat the job's time for the
 *   emails. What's left waits for the next run.
 * - With no model key, a message the patterns pass is delivered as
 *   `pattern_only`, as on send.
 */
export const OLDER_THAN_MS = 5 * 60_000;
export const MAX_PER_RUN = 25;
export const CONCURRENCY = 5;
export const BUDGET_MS = 20_000;

export async function sweepCheckingMessages(db, {
  screen = screenOne, now = () => Date.now(), budgetMs = BUDGET_MS,
} = {}) {
  const started = now();
  const result = { checked: 0, delivered: 0, blocked: 0, failed: 0, left: 0 };
  const { data: rows, error } = await db
    .from("messages")
    .select("id, thread_id, body, sender_user_id, delivery, documents (file_name)")
    .eq("delivery", "checking")
    .lt("created_at", new Date(started - OLDER_THAN_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) throw new Error(`messages left checking could not be read: ${error.message}`);

  const queue = [...(rows ?? [])];
  async function worker() {
    while (queue.length && now() - started < budgetMs) {
      const message = queue.shift();
      result.checked += 1;
      try {
        const answer = await screen(db, message);
        if (answer?.error) result.failed += 1;
        else if (answer?.delivery === "delivered") result.delivered += 1;
        else if (answer?.delivery === "blocked") result.blocked += 1;
      } catch (failure) {
        result.failed += 1;
        console.error("message sweep", message.id, failure?.message);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  result.left = queue.length;
  return result;
}
