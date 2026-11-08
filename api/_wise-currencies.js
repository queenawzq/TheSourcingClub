/** The currency a bank account in each country is paid in. A country not listed gets no Wise form. */
const EURO = ["AT", "BE", "BG", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"];
const CURRENCY = {
  ...Object.fromEntries(EURO.map((country) => [country, "EUR"])),
  US: "USD", CA: "CAD", GB: "GBP", CH: "CHF", LI: "CHF", CZ: "CZK", DK: "DKK", HU: "HUF", PL: "PLN", RO: "RON", SE: "SEK", IS: "ISK", NO: "NOK",
  HK: "HKD", VN: "VND", IN: "INR", BD: "BDT", PK: "PKR", TR: "TRY", ID: "IDR", TH: "THB", LK: "LKR", KR: "KRW", JP: "JPY", MX: "MXN", BR: "BRL", MA: "MAD", EG: "EGP",
};

export const wiseCurrencyFor = (country, chinaCurrency) => (country === "CN" ? chinaCurrency : CURRENCY[country] ?? null);
