import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The operations inbox: operations@contact.sourcing-club.com.
 *
 * Resend receives mail for contact.sourcing-club.com (an MX record points the
 * subdomain at Resend) and calls this webhook with each message's metadata.
 * Resend has no forwarding rule of its own, so this fetches the message and
 * re-sends it, attachments included, to the people who read the inbox —
 * INBOUND_FORWARD_TO, comma-separated. Reply-To is the original sender, so
 * answering from Gmail goes straight back to the customer.
 *
 * Every email the product sends sets Reply-To to this address, so "reply to
 * this email" arrives here too.
 */
const RESEND = "https://api.resend.com";
// Resend's own limit on a sent message is 40MB; stay clear of it after base64.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** The raw body, byte for byte: the signature is over it, not over parsed JSON. */
async function rawBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  if (chunks.length) return Buffer.concat(chunks).toString("utf8");
  // A runtime that already buffered the stream leaves it here instead.
  if (Buffer.isBuffer(request.body)) return request.body.toString("utf8");
  return typeof request.body === "string" ? request.body : "";
}

/**
 * Svix signature check, as Resend documents it: HMAC-SHA256 over
 * "id.timestamp.body" with the base64 part of the whsec_ secret, compared
 * against any of the space-separated "v1,<sig>" values. Anyone can POST to
 * this URL; without the check they could make us send mail as ourselves.
 */
export function verified(secret, headers, body) {
  const id = headers["svix-id"];
  const timestamp = headers["svix-timestamp"];
  const signatures = headers["svix-signature"];
  if (!id || !timestamp || !signatures) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 5 * 60) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return String(signatures).split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

async function resend(path, key, init = {}) {
  const response = await fetch(`${RESEND}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Resend returned ${response.status} for ${path}`);
  return payload;
}

async function attachmentsOf(emailId, key) {
  const listed = await resend(`/emails/receiving/${emailId}/attachments`, key);
  const attachments = [];
  let total = 0;
  for (const item of listed.data ?? []) {
    const file = await fetch(item.download_url);
    if (!file.ok) throw new Error(`attachment ${item.filename} could not be downloaded`);
    const bytes = Buffer.from(await file.arrayBuffer());
    total += bytes.length;
    if (total > MAX_ATTACHMENT_BYTES) throw new Error("attachments are too large to forward");
    attachments.push({
      filename: item.filename,
      content: bytes.toString("base64"),
      content_type: item.content_type,
      ...(item.content_id ? { content_id: item.content_id } : {}),
    });
  }
  return attachments;
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method not allowed" });
    return;
  }

  const key = process.env.RESEND_API_KEY;
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const from = process.env.RESEND_FROM_EMAIL;
  const forwardTo = String(process.env.INBOUND_FORWARD_TO ?? "").split(",").map((to) => to.trim()).filter(Boolean);
  if (!key || !secret || !from || !forwardTo.length) {
    response.status(503).json({ error: "the inbox is not configured on the server" });
    return;
  }

  const body = await rawBody(request);
  if (!verified(secret, request.headers, body)) {
    response.status(401).json({ error: "invalid signature" });
    return;
  }

  const event = JSON.parse(body);
  if (event.type !== "email.received") {
    response.status(200).json({ ignored: event.type });
    return;
  }

  const emailId = event.data?.email_id;
  try {
    const email = await resend(`/emails/receiving/${emailId}`, key);
    const sender = email.headers?.from ?? email.from ?? event.data.from;
    const senderAddress = String(event.data.from ?? "").toLowerCase();

    // Never forward our own mail back to ourselves: a bounce or auto-reply
    // loop between this inbox and the noreply sender would never end.
    if (senderAddress && from.toLowerCase().includes(senderAddress)) {
      response.status(200).json({ ignored: "own sender" });
      return;
    }

    const recipients = (email.to ?? event.data.to ?? []).join(", ");
    const banner = `Forwarded from ${sender} to ${recipients}. Reply to answer them directly.`;
    const attachments = event.data.attachments?.length ? await attachmentsOf(emailId, key) : [];

    await resend("/emails", key, {
      method: "POST",
      // Resend retries a webhook on failure; the same message must not arrive twice.
      headers: { "Idempotency-Key": `inbound-forward-${emailId}` },
      body: JSON.stringify({
        from,
        to: forwardTo,
        reply_to: sender,
        subject: email.subject || event.data.subject || "(no subject)",
        text: `${banner}\n\n${email.text ?? ""}`,
        html: `<p style="margin:0 0 16px;padding:8px 12px;background:#f3f5f9;border-radius:6px;font:13px/1.4 Arial,sans-serif;color:#44506a;">${escapeHtml(banner)}</p>${email.html ?? `<pre style="white-space:pre-wrap;font:14px/1.5 Arial,sans-serif;">${escapeHtml(email.text ?? "")}</pre>`}`,
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    response.status(200).json({ forwarded: forwardTo.length });
  } catch (error) {
    // A 5xx makes Resend retry later, which is what a transient failure wants.
    response.status(502).json({ error: String(error.message || error).slice(0, 300) });
  }
}
