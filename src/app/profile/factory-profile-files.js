/**
 * The factory profile's file dialogs: profile image, walkthrough video,
 * sample images and verification documents.
 *
 * Files save the moment they are added, replaced or removed, as onboarding's
 * do, through the same document and certification functions. Which bucket a
 * file lands in is decided by its kind in documents.js, never here: the
 * registration and certificates stay private, the rest is what brands see.
 */
import { deleteDocument, updateDocumentDetails, uploadDocument, urlFor } from "../../lib/domain/documents.js";
import { addCertification, attachCertificate, certificationTerm, removeCertification } from "../../lib/domain/certifications.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime"];
const DOCUMENT_TYPES = ["application/pdf", ...IMAGE_TYPES];
const MB = 1024 * 1024;

/**
 * Per dialog: the document kind it edits, what it accepts, the largest file
 * it takes, and whether the profile shows only one (adding then replaces).
 * The public bucket takes 50 MB; images are held to 10 MB, as before, since
 * an image that size is a mistake rather than a better photo.
 */
export const FILE_EDITORS = {
  banner: { kind: "logo", types: IMAGE_TYPES, maxBytes: 10 * MB, single: true },
  walkthrough: { kind: "walkthrough", types: VIDEO_TYPES, maxBytes: 50 * MB, single: true },
  samples: { kind: "product_image", types: IMAGE_TYPES, maxBytes: 10 * MB, single: false },
};
export const DOCUMENT_ACCEPT = DOCUMENT_TYPES.join(",");

const EXTENSION_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", pdf: "application/pdf" };
const typeOf = (file) => (file.type && file.type !== "application/octet-stream" ? file.type : EXTENSION_TYPES[file.name.split(".").pop()?.toLowerCase()] ?? file.type);

/** Refused here with a reason the factory can act on, before any upload. */
export function checkFile(file, types, maxBytes) {
  if (!types.includes(typeOf(file))) {
    const words = types.map((type) => ({ "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WebP", "video/mp4": "MP4", "video/quicktime": "MOV", "application/pdf": "PDF" })[type]);
    throw new Error(`${file.name} can't be used here. Choose a ${[...new Set(words)].join(", ")} file.`);
  }
  if (file.size > maxBytes) {
    throw new Error(`${file.name} is ${Math.ceil(file.size / MB)} MB. The limit is ${maxBytes / MB} MB.`);
  }
}

/** Open a stored file in a new tab; private files get a short-lived link. */
export async function viewDocument(document) {
  // Opened before the link is fetched, or the browser counts the tab as a
  // pop-up nobody asked for.
  const tab = window.open("", "_blank");
  if (!tab) throw new Error("Your browser blocked the new tab. Allow pop-ups for this site to view the file.");
  try {
    const url = await urlFor(document, 300);
    tab.opener = null;
    tab.location.href = url;
  } catch (error) {
    tab?.close();
    throw error;
  }
}

/** Add a file; where the profile shows only one, the new one replaces the old. */
export async function addProfileFile(org, editor, file, details, existing = []) {
  const spec = FILE_EDITORS[editor];
  checkFile(file, spec.types, spec.maxBytes);
  await uploadDocument({ orgId: org.id, kind: spec.kind, file, title: details.title?.trim(), caption: details.caption?.trim() });
  if (spec.single) {
    for (const old of existing) await deleteDocument(old);
  }
}

/** Rename or re-describe a file, replacing the file itself if a new one was chosen. */
export async function editProfileFile(org, editor, document, file, details) {
  const title = details.title?.trim();
  const caption = details.caption?.trim();
  if (!file) {
    await updateDocumentDetails(document.id, { title, caption });
    return;
  }
  const spec = FILE_EDITORS[editor];
  checkFile(file, spec.types, spec.maxBytes);
  await uploadDocument({ orgId: org.id, kind: spec.kind, file, title, caption });
  await deleteDocument(document);
}

export const removeProfileFile = (document) => deleteDocument(document);

/** A business registration goes to TSC's review queue as pending, as onboarding's does. */
export async function uploadRegistration(org, file) {
  checkFile(file, DOCUMENT_TYPES, 50 * MB);
  await uploadDocument({ orgId: org.id, kind: "business_registration", file });
}

export async function claimCertification(org, name, certificationTerms) {
  await addCertification(org.id, name, certificationTerms);
}

export async function uploadCertificate(org, name, file, certifications, certificationTerms) {
  checkFile(file, DOCUMENT_TYPES, 50 * MB);
  const term = certificationTerm(name, certificationTerms);
  if (!term) throw new Error(`${name} is not a certification we recognise.`);
  const previous = certifications.find((cert) => cert.termId === term.id)?.document ?? null;
  await attachCertificate(org.id, term.id, file, previous);
}

export async function withdrawCertification(name, certifications) {
  const certification = certifications.find((cert) => cert.name === name);
  if (certification) await removeCertification(certification);
}
