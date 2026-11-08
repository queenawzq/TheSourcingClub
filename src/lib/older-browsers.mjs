/**
 * What the app calls that a browser's older engine lacks. Vite lowers syntax to
 * Chromium 87 but adds no functions, and 360 Browser's engine is often behind:
 * Object.hasOwn stopped the order list, crypto.randomUUID every file upload.
 * Each line does nothing where the browser already has it.
 */
export function fillOlderBrowsers(scope = globalThis) {
  const { Object: O, Array: A, String: S, crypto } = scope;
  if (!O.hasOwn) O.hasOwn = (target, key) => O.prototype.hasOwnProperty.call(target, key);
  const at = function at(index) {
    const position = Math.trunc(index) || 0;
    return this[position < 0 ? this.length + position : position];
  };
  if (!A.prototype.at) O.defineProperty(A.prototype, "at", { value: at, writable: true, configurable: true });
  if (!S.prototype.at) O.defineProperty(S.prototype, "at", { value: at, writable: true, configurable: true });
  if (crypto?.getRandomValues && !crypto.randomUUID) {
    crypto.randomUUID = () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
  }
}
