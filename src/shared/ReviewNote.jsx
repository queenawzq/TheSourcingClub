import { createElement } from "react";
import { noteHasChinese, parseReviewNote } from "./review-note.mjs";

/** A reviewer's note on screen, laid out like the email (review-note.mjs). */
export default function ReviewNote({ note, className = "" }) {
  const blocks = parseReviewNote(note);
  if (!blocks.length) return null;
  return (
    <div className={`tsc-review-note ${className}`.trim()} lang={noteHasChinese(note) ? "zh" : undefined}>
      {blocks.map((block, index) => (
        block.type === "paragraph"
          ? <p key={index}>{block.lines.flatMap((line, at) => (at ? [<br key={at} />, line] : [line]))}</p>
          : createElement(
            block.ordered ? "ol" : "ul",
            { key: index, start: block.ordered && block.start !== 1 ? block.start : undefined },
            block.items.map((item, at) => <li key={at}>{item}</li>),
          )
      ))}
    </div>
  );
}
