/**
 * File uploads.
 *
 * Two buckets, and which one a file lands in is decided here rather than at
 * each call site — getting it wrong is not recoverable. A business
 * registration that lands in the public bucket may be cached or indexed long
 * after the mistake is noticed, and the factory whose document it is has no
 * way to withdraw it.
 *
 * Storage policies key on the first path segment being an org the caller
 * belongs to, so every path built here starts with the org id.
 */
import { supabase, unwrap } from "../supabase.js";
import { PRIVATE_BUCKET_LIMIT_MB, PRIVATE_BUCKET_TYPES } from "../../shared/private-bucket-types.mjs";

/**
 * Anything commercially sensitive is private. When adding a kind, the question
 * is not "is this convenient to serve publicly" but "would the owner mind this
 * being permanently public".
 */
const PRIVATE_KINDS = new Set([
  "business_registration",
  "certificate",
  "tech_pack",
  "measurement_chart",
  "contract",
  "quote_attachment",
  // Production photographs of a brand's unreleased product. The public bucket
  // is `public: true` — served to anyone with the URL and no sign-in at all —
  // so this is the one kind where the convenient choice is also unrecoverable.
  "milestone_update",
  // Whatever two parties send each other. Private for the same reason.
  "message_attachment",
]);

/**
 * The kinds a platform admin actually reviews.
 *
 * This used to be inferred as "private, except tech packs", which quietly
 * coupled two unrelated questions: adding any private kind also added it to
 * the verification queue. Milestone photos are private and are reviewed by
 * nobody, which is what made the coupling visible.
 */
const REVIEWED_KINDS = new Set(["business_registration", "certificate"]);

export function bucketFor(kind) {
  return PRIVATE_KINDS.has(kind) ? "org-private" : "org-public";
}

/**
 * Browsers do not always know a file's type. Depending on the OS and how the
 * file was picked, a perfectly ordinary PDF can arrive as
 * `application/octet-stream`, which the bucket's allowlist then rejects — the
 * user sees their real PDF refused for no reason they can act on.
 *
 * Fall back to the extension in that case. This does not weaken the allowlist:
 * the bucket still refuses anything whose resolved type is not permitted.
 */
const EXTENSION_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  // What an iPhone shares by default. Note this maps HEIC to its real type
  // rather than relabelling it as JPEG: passing the allowlist by lying about
  // the type would store an object no browser can display, with no error
  // anywhere. The bucket has to admit image/heic for this to help.
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

const KNOWN_TYPES = new Set(Object.values(EXTENSION_TYPES));

/**
 * The browser's type when it is one we know, otherwise the extension's.
 * Windows labels a ZIP `application/x-zip-compressed`, which the allowlist
 * refuses although the file is exactly what it admits.
 */
function resolveContentType(file) {
  if (file.type && KNOWN_TYPES.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return EXTENSION_TYPES[extension] ?? (file.type || "application/octet-stream");
}

/** For a file input's `accept`: the extensions of what the private bucket admits. */
export const ATTACHMENT_ACCEPT = Object.entries(EXTENSION_TYPES)
  .filter(([, type]) => PRIVATE_BUCKET_TYPES.includes(type))
  .map(([extension]) => `.${extension}`)
  .join(",");

const ATTACHMENT_KINDS_IN_WORDS = "a PDF, a photo (PNG, JPG, WebP or HEIC), an Excel sheet or a ZIP";

/** Why a file cannot go with a message, in words for its sender, or null when it can. */
export function attachmentRefusal(file) {
  if (!PRIVATE_BUCKET_TYPES.includes(resolveContentType(file))) {
    return `${file.name} can't be attached. Attach ${ATTACHMENT_KINDS_IN_WORDS}.`;
  }
  if (file.size > PRIVATE_BUCKET_LIMIT_MB * 1024 * 1024) {
    return `${file.name} is larger than ${PRIVATE_BUCKET_LIMIT_MB} MB, the most a file can be.`;
  }
  return null;
}

/**
 * Storage's own refusals, in words a person can act on. Its messages
 * ("mime type text/plain is not supported") name internals; the raw text
 * goes to the console for whoever is debugging.
 */
function uploadFailureInWords(file, error) {
  console.error("upload", file.name, error?.message);
  const raw = String(error?.message ?? "");
  if (/mime type|invalid_mime_type/i.test(raw)) return `${file.name} can't be uploaded here: that type of file is not accepted.`;
  if (/maximum allowed size|too large|payload/i.test(raw)) return `${file.name} is too large to upload.`;
  return `${file.name} could not be uploaded. Check your connection and try again.`;
}

/** Strip anything that would make a storage key awkward or ambiguous. */
function safeName(fileName) {
  return fileName
    .normalize("NFKD")
    .replace(/[^\w.\- ]/g, "")
    .replace(/\s+/g, "-")
    .slice(-120);
}

/**
 * Upload a file and record it in `documents`.
 *
 * The storage object and its metadata row are two writes. If the metadata
 * insert fails we remove the uploaded object, so a failed upload cannot leave
 * an orphan sitting in a bucket that nothing references and nobody reviews.
 */
export async function uploadDocument({ orgId, kind, file, scopeId = null, title = null, caption = null }) {
  const bucket = bucketFor(kind);
  // `scopeId` becomes a third path segment. Storage policies can only read the
  // object's name, so a file that has to be readable by someone outside the
  // owning org needs the thing granting that access to be IN the path — here,
  // the order the file belongs to.
  const prefix = scopeId ? `${orgId}/${kind}/${scopeId}` : `${orgId}/${kind}`;
  const path = `${prefix}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const contentType = resolveContentType(file);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType });

  if (uploadError) {
    throw new Error(uploadFailureInWords(file, uploadError));
  }

  try {
    return unwrap(
      await supabase
        .from("documents")
        .insert({
          org_id: orgId,
          kind,
          bucket,
          storage_path: path,
          file_name: file.name,
          mime_type: contentType,
          size_bytes: file.size,
          // A name and a line of description a profile card shows; most
          // uploads have neither.
          title: title || null,
          caption: caption || null,
          // Documents that get reviewed enter the queue immediately; the rest
          // are never looked at and stay unverified.
          status: REVIEWED_KINDS.has(kind) ? "pending" : "unverified",
        })
        .select()
        .single(),
      "record the uploaded file",
    );
  } catch (metadataError) {
    await supabase.storage.from(bucket).remove([path]);
    throw metadataError;
  }
}

export async function listDocuments(orgId, kind) {
  let query = supabase
    .from("documents")
    .select("id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status, title, caption, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (kind) query = query.eq("kind", kind);

  return unwrap(await query, "load your files");
}

/**
 * A URL the browser can actually render.
 *
 * Public-bucket files get a permanent URL. Private files get a short-lived
 * signed one, minted per view — never stored, never shared.
 */
export async function urlFor(document, expiresInSeconds = 300) {
  if (document.bucket === "org-public") {
    const { data } = supabase.storage.from(document.bucket).getPublicUrl(document.storage_path);
    return data.publicUrl;
  }

  const { data, error } = await supabase.storage
    .from(document.bucket)
    .createSignedUrl(document.storage_path, expiresInSeconds);

  if (error) throw new Error(`link to ${document.file_name}: ${error.message}`);
  return data.signedUrl;
}

/** Rename a file, or change its description, without uploading it again. */
export async function updateDocumentDetails(documentId, { title, caption }) {
  return unwrap(
    await supabase
      .from("documents")
      .update({ title: title || null, caption: caption || null })
      .eq("id", documentId)
      .select("id, title, caption")
      .single(),
    "save the file's name and description",
  );
}

/** Remove the object first: a dangling row is easier to notice than a dangling file. */
export async function deleteDocument(document) {
  const { error } = await supabase.storage.from(document.bucket).remove([document.storage_path]);
  if (error) throw new Error(`delete ${document.file_name}: ${error.message}`);

  unwrap(
    await supabase.from("documents").delete().eq("id", document.id),
    "remove the file record",
  );
}

/**
 * The files a brand attached to a request.
 *
 * A vendor reading a request needs the tech pack and the measurement chart to
 * quote it at all, and `documents_read` already answers who may see them —
 * the rfq_id link is what carries that permission.
 */
export async function listRfqDocuments(rfqId) {
  return unwrap(
    await supabase
      .from("documents")
      .select("id, kind, bucket, storage_path, file_name, mime_type, size_bytes, created_at")
      .eq("rfq_id", rfqId)
      .order("created_at"),
    "load the request's attachments",
  );
}
