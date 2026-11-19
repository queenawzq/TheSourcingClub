/**
 * Every row of a read filtered by a list of ids, however long the list.
 *
 * An `in.(…)` filter puts every id in the address, about 39 characters per
 * uuid. Past roughly 195 orders the address passed the gateway's 8 KB and
 * the answer was 414: a brand's Payments page and a factory's Earnings
 * failed outright. PostgREST also stops at `max_rows` (1000 here and on a
 * hosted project) with a 200 and no error, so a long read lost rows silently.
 *
 * So the ids go in batches short enough for any address, and each batch is
 * read a page at a time with `range()` until a page comes back short. The
 * caller's query must order by something unique (add `id` last), or a row
 * can move between pages. Batches answer in any order: callers that care
 * sort the result.
 *
 * Batches, not a filter through an embed (`production_orders!inner (…)`):
 * the read policy on order_payments runs per row before such a filter, so it
 * passed over every company's payments, while `in` reads by the index.
 */
import { unwrap } from "./supabase.js";

export const IDS_PER_READ = 100;
// Must not exceed PostgREST's max_rows (supabase/config.toml), or a full
// page would look short and the read would stop early.
export const ROWS_PER_PAGE = 1000;

export async function readByIds(ids, query, context) {
  const unique = [...new Set(ids)];
  const batches = [];
  for (let start = 0; start < unique.length; start += IDS_PER_READ) {
    batches.push(unique.slice(start, start + IDS_PER_READ));
  }
  return (await Promise.all(batches.map((batch) => readEveryPage(() => query(batch), context)))).flat();
}

/**
 * Every row of a read already filtered on the server (a company's orders),
 * a page at a time, for the same max_rows reason. A row added while it reads
 * can push the last row of one page onto the next, so a row read twice is
 * kept once: by `key`, a column name (`id` unless named) or a function of
 * the row for a table with no single-column key.
 */
export async function readEveryPage(query, context, key = "id") {
  const keyOf = typeof key === "function" ? key : (row) => row[key];
  const rows = [];
  const seen = new Set();
  for (let from = 0; ; from += ROWS_PER_PAGE) {
    const page = unwrap(await query().range(from, from + ROWS_PER_PAGE - 1), context);
    for (const row of page) {
      const rowKey = keyOf(row);
      if (rowKey == null || !seen.has(rowKey)) rows.push(row);
      if (rowKey != null) seen.add(rowKey);
    }
    if (page.length < ROWS_PER_PAGE) return rows;
  }
}

/** Oldest first by `created_at`, then `id`, as one ordered read would give. */
export function byCreated(a, b) {
  return String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
}
