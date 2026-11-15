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

/** The PDF itself, as bytes. Offsets in the cross-reference table are exact. */
export function invoicePdf(details) {
  let y = 740;
  const content = invoiceLines(details).map(([line, size]) => {
    const text = `BT /F1 ${size} Tf 72 ${y} Td (${pdfText(line)}) Tj ET`;
    y -= size + 10;
    return text;
  }).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
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
