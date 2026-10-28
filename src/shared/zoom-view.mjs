/**
 * How big Zoom's meeting view is drawn inside a conversation.
 *
 * The Meeting SDK draws at one fixed size, given when it starts: a 16:9 video
 * plus its own header, row of participants and toolbar around it. Sized from
 * the panel's width alone, a wide window that is not tall (1920 × 822, Oct 27)
 * drew it 707px tall in a 750px conversation that clips what overflows, so the
 * toolbar (mic, camera, leave) and the message box were out of reach: people
 * were in the call and could not unmute or start video. So the view is also
 * kept within the height under the conversation's header.
 */

// Zoom 6.5's header, participant row and toolbar around the video, measured
// in production (707px drawn around a 498px video).
export const ZOOM_VIEW_CHROME = 210;
// Narrower than this, Zoom's toolbar does not fit (the call opens in the app).
export const ZOOM_VIEW_MIN_WIDTH = 360;

/** The view's { width, height } for the room the panel has. */
export function zoomViewSize({ panelWidth, availableHeight }) {
  const fitsHeight = Math.floor(((availableHeight - ZOOM_VIEW_CHROME) * 16) / 9);
  const width = Math.max(ZOOM_VIEW_MIN_WIDTH, Math.min(Math.floor(panelWidth), fitsHeight));
  return { width, height: Math.round((width * 9) / 16) };
}
