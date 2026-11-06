import ReviewNote from "../../shared/ReviewNote.jsx";

const TITLE = { en: "What we asked for", zh: "我们需要的信息" };

/**
 * Staff's request, kept on screen while the company updates its profile, so
 * it does not have to remember it. The designs draw the finish card only; this
 * is the same words in the same place on every step.
 */
export default function ReviewRequestPanel({ note, language = "en" }) {
  return (
    <aside className="tsc-review-request" aria-label={TITLE[language] ?? TITLE.en}>
      <strong>{TITLE[language] ?? TITLE.en}</strong>
      <ReviewNote note={note} />
    </aside>
  );
}
