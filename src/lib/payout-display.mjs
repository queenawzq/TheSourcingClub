// Display estimates only: payment amounts and payout requests keep their
// original minor units and currency throughout the rest of the app.
const ZERO_DECIMAL = new Set(['BIF','CLP','DJF','GNF','JPY','KMF','KRW','MGA','PYG','RWF','VND','VUV','XAF','XOF','XPF']);
export function payoutUsdMinor(amount, currency, fx) {
  const code = currency.toUpperCase();
  if (code === 'USD') return amount;
  const rate = fx?.rates?.[code];
  if (!(rate > 0) || !Number.isFinite(rate)) return null;
  return Math.round(amount / (ZERO_DECIMAL.has(code) ? 1 : 100) * rate * 100);
}
export function payoutUsdTotal(rows, fx) {
  let amount = 0;
  for (const row of rows) {
    const converted = payoutUsdMinor(row.amount, row.currency, fx);
    if (converted === null) return null;
    amount += converted;
  }
  return amount;
}
