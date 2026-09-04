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
]);

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
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
};

function resolveContentType(file) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return EXTENSION_TYPES[extension] ?? file.type ?? "application/octet-stream";
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
export async function uploadDocument({ orgId, kind, file }) {
  const bucket = bucketFor(kind);
  const path = `${orgId}/${kind}/${crypto.randomUUID()}-${safeName(file.name)}`;

  const contentType = resolveContentType(file);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType });

  if (uploadError) {
    throw new Error(`upload ${file.name}: ${uploadError.message}`);
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
          // Documents that get reviewed enter the queue immediately; the rest
          // are never looked at and stay unverified.
          status: PRIVATE_KINDS.has(kind) && kind !== "tech_pack" ? "pending" : "unverified",
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
    .select("id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status, created_at")
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

/** Remove the object first: a dangling row is easier to notice than a dangling file. */
export async function deleteDocument(document) {
  const { error } = await supabase.storage.from(document.bucket).remove([document.storage_path]);
  if (error) throw new Error(`delete ${document.file_name}: ${error.message}`);

  unwrap(
    await supabase.from("documents").delete().eq("id", document.id),
    "remove the file record",
  );
}
