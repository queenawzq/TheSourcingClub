/**
 * The one-page document a Tazapay payout carries. A payout for "advance payment
 * for goods" (PYR031) needs one: Tazapay refuses it without (400 20283) and
 * downloads it when the payout is made.
 *
 * Built here, with no library: a PDF with one page of Helvetica text. Helvetica
 * has no Chinese, so it names the account holder by the English name the bank
 * has (always set, and checked to be Latin) and drops any other character it
 * cannot draw rather than printing boxes. Nothing on it is a bank number.
 *
 * A copy is kept in the private bucket. Every policy there reads the path's
 * first folder as the owning company's id (storage_path_org()), so TSC's own
 * files go under the nil id, which no company has: no policy lets anyone but the
 * server read them, and the cast to uuid every policy makes still holds.
 */

export const INVOICE_BUCKET = "org-private";
export const TSC_FOLDER = "00000000-0000-0000-0000-000000000000";
export const invoicePath = (paymentId, attemptKey) => `${TSC_FOLDER}/tazapay-invoices/${paymentId}/${attemptKey}.pdf`;

/** Printable ASCII only, and PDF's three special characters escaped. */
export function pdfText(value) {
  return String(value ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ").trim()
    .replace(/[\\()]/g, (ch) => `\\${ch}`)
    .slice(0, 110);
}

const money = (minor, currency) => `${currency} ${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The lines on the page, in order. Exported for the check. */
export function invoiceLines({ reference, issuedOn, payeeName, orderNumber, stepTitle, amountMinor, currency, payoutMinor, payoutCurrency, rate }) {
  return [
    ["The Sourcing Club", 18],
    ["Payment advice: advance payment for goods", 13],
    ["", 11],
    [`Reference: ${reference}`, 11],
    [`Date: ${issuedOn}`, 11],
    ["", 11],
    ["Payer: The Sourcing Club, on behalf of the buyer of this order", 11],
    [`Payee: ${payeeName}`, 11],
    ["", 11],
    [`Production order: ${orderNumber}`, 11],
    [`Production step: ${stepTitle || "Production payment"}`, 11],
    [`Amount: ${money(amountMinor, currency)}`, 11],
    payoutMinor != null ? [`Paid as: ${money(payoutMinor, payoutCurrency)}${rate ? ` (rate ${Number(rate).toFixed(4)})` : ""}`, 11] : ["", 11],
    ["", 11],
    ["Purpose: advance payment for goods under the production order above.", 10],
    ["This payment is made through Tazapay.", 10],
  ];
}

/**
 * A withdrawal's invoice: one payout covering several production steps, each
 * line an order number, the step and what this withdrawal takes from it; the
 * lines add up to the withdrawal. Exported for the check.
 */
export function withdrawalInvoiceLines({ reference, issuedOn, payeeName, steps, amountMinor, currency, payoutMinor, payoutCurrency, rate }) {
  return [
    ["The Sourcing Club", 18],
    ["Payment advice: advance payment for goods", 13],
    ["", 11],
    [`Reference: ${reference}`, 11],
    [`Date: ${issuedOn}`, 11],
    ["", 11],
    ["Payer: The Sourcing Club, on behalf of the buyers of these orders", 11],
    [`Payee: ${payeeName}`, 11],
    ["", 11],
    ["Production order / step / amount", 11],
    ...steps.map((s) => [`${s.orderNumber} / ${s.stepTitle || "Production payment"} / ${money(s.amountMinor, currency)}`, 10]),
    ["", 11],
    [`Total: ${money(amountMinor, currency)}`, 11],
    payoutMinor != null ? [`Paid as: ${money(payoutMinor, payoutCurrency)}${rate ? ` (rate ${Number(rate).toFixed(4)})` : ""}`, 11] : ["", 11],
    ["", 11],
    ["Purpose: advance payment for goods under the production orders above.", 10],
    ["This payment is made through Tazapay.", 10],
  ];
}

export const withdrawalInvoicePath = (withdrawalId, attemptKey) => `${TSC_FOLDER}/tazapay-invoices/withdrawals/${withdrawalId}/${attemptKey}.pdf`;

/**
 * Which steps a withdrawal pays, and how much of each. Withdrawals take from
 * the factory's balance steps oldest first (withdrawn_by_payment() and
 * release_withdrawn_payments() in the database): this one starts where the
 * withdrawals before it end (`offset`). `pool` is the steps in that order.
 * Null when the steps don't cover it.
 */
export function withdrawalSteps(pool, offset, amount) {
  let skip = Number(offset);
  let left = Number(amount);
  const steps = [];
  for (const step of pool) {
    if (left <= 0) break;
    const size = Number(step.amountMinor);
    if (skip >= size) { skip -= size; continue; }
    const take = Math.min(size - skip, left);
    skip = 0;
    left -= take;
    steps.push({ ...step, amountMinor: take });
  }
  return left > 0 ? null : steps;
}

/** The PDF itself, as bytes, one page per 30 lines. Offsets in the cross-reference table are exact. */
export function invoicePdf(details) {
  return pdfFromLines(invoiceLines(details));
}
export function withdrawalInvoicePdf(details) {
  return pdfFromLines(withdrawalInvoiceLines(details));
}

const PER_PAGE = 30;
export function pdfFromLines(lines) {
  const pages = [];
  for (let i = 0; i < lines.length; i += PER_PAGE) pages.push(lines.slice(i, i + PER_PAGE));
  const contents = pages.map((page) => {
    let y = 740;
    return page.map(([line, size]) => {
      const text = `BT /F1 ${size} Tf 72 ${y} Td (${pdfText(line)}) Tj ET`;
      y -= size + 10;
      return text;
    }).join("\n");
  });
  // 1 catalog, 2 pages, 3 font, then a page and its content per page.
  const pageIds = contents.map((_, i) => 4 + i * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ...contents.flatMap((content, i) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    ]),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
