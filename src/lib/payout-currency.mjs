/** Prefer withdrawable money over pending money in the default currency. */
export function balanceCurrency(balance) {
  const preferred = balance?.defaultCurrency?.toUpperCase();
  for (const rows of [balance?.available, balance?.pending]) {
    const funded = (rows ?? []).filter(row => row.amount > 0);
    const row = funded.find(row => row.currency?.toUpperCase() === preferred) ?? funded[0];
    if (row) return row.currency.toUpperCase();
  }
  return preferred ?? 'USD';
}
