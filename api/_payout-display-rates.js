// Indicative USD display only. Never used to create transfers or payouts.
// Only public currency codes are sent to the reference-rate provider.
let cached;
export async function payoutDisplayRates(fetcher = fetch) {
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const response = await fetcher('https://api.frankfurter.dev/v2/rates?base=usd&providers=ecb', { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const rates = { USD: 1 };
    const dates = [];
    for (const row of rows) {
      if (row.base?.toUpperCase() !== 'USD' || !(row.rate > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
      // Reject stale reference data rather than silently present old estimates.
      if (Date.now() - Date.parse(`${row.date}T00:00:00Z`) > 7 * 86400000) continue;
      rates[row.quote.toUpperCase()] = 1 / row.rate;
      dates.push(row.date);
    }
    if (!dates.length) return null;
    const value = { rates, date: dates.sort()[0], source: 'ECB reference rates', estimated: true };
    cached = { value, expires: Date.now() + 3600000 };
    return value;
  } catch { return null; }
}
