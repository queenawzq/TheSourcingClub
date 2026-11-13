import { useCallback, useEffect, useRef } from "react";
import { uploadDocument } from "../../lib/domain/documents.js";

/**
 * Onboarding uploads the files on a card when "Next" is pressed. A Next that
 * fails part way (a refused file, a field the server rejects) leaves the card
 * holding every file it was given, so the next Next sent the ones already
 * stored a second time (Nov 13: one product photo stored twice).
 *
 * `upload` sends a file once per visit to a step: a file already stored on
 * this step is skipped. Moving to another step starts afresh, and `forget`
 * (called on a delete) drops the deleted file, so one deleted and chosen
 * again is sent again.
 */
export function useUploadOnce(step) {
  const sent = useRef(new Set());
  useEffect(() => { sent.current = new Set(); }, [step]);

  const upload = useCallback(async ({ orgId, kind, file }) => {
    const key = [kind, file.name, file.size, file.lastModified].join("|");
    if (sent.current.has(key)) return false;
    await uploadDocument({ orgId, kind, file });
    sent.current.add(key);
    return true;
  }, []);

  const forget = useCallback((doc) => {
    const prefix = [doc?.kind, doc?.file_name, doc?.size_bytes].join("|") + "|";
    for (const key of sent.current) if (key.startsWith(prefix)) sent.current.delete(key);
  }, []);

  return { upload, forget };
}
