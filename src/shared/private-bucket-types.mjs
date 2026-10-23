/**
 * What the private bucket (org-private) admits, as migrations 20260901000400
 * and 20260905000300 set it. A file a message carries goes there, so this is
 * also what a message may carry: src/lib/domain/documents.js builds the
 * picker's list and its refusal from it. The smoke test reads the bucket and
 * fails if the two ever differ, because then a file is offered and refused.
 *
 * Here rather than in documents.js so node can import it (see
 * demo-logins.mjs).
 */
export const PRIVATE_BUCKET_TYPES = [
  "image/png", "image/jpeg", "image/webp", "image/heic", "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/zip",
];

export const PRIVATE_BUCKET_LIMIT_MB = 50;
