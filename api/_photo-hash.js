/**
 * Photo fingerprints computed by our own code, no image library (verification
 * v3, outcome 6). Two of them:
 *
 *   sha256  the file itself: the same upload, byte for byte.
 *   dhash   a 64-bit difference hash of the picture: survives resizing,
 *           recompressing and small edits. Two photos within 10 bits are
 *           the same picture.
 *
 * The dhash needs the image's brightness, so we decode just enough of it:
 * a PNG through Node's zlib, a JPEG through its DC coefficients only (one
 * value per 8x8 block, which is the picture at 1/8 scale, with no inverse
 * DCT). Baseline and progressive JPEGs both work. Anything else (WebP, HEIC,
 * an interlaced PNG, a damaged file) gets `dhash: null` and is compared by
 * the sha256 alone.
 */
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export const SIMILAR_BITS = 10;

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The number of bits two 16-hex-character hashes differ in. */
export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let bits = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      bits += x & 1;
      x >>= 1;
    }
  }
  return bits;
}

/** Brightness grid { width, height, pixels } → 16 hex characters. */
export function dhashFromGray({ width, height, pixels }) {
  if (!width || !height) return null;
  const cols = 9;
  const rows = 8;
  const cell = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    const y0 = Math.floor((y * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / rows));
    for (let x = 0; x < cols; x += 1) {
      const x0 = Math.floor((x * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / cols));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < Math.min(y1, height); yy += 1) {
        for (let xx = x0; xx < Math.min(x1, width); xx += 1) {
          sum += pixels[yy * width + xx];
          n += 1;
        }
      }
      cell[y * cols + x] = n ? sum / n : 0;
    }
  }
  let hex = "";
  for (let y = 0; y < rows; y += 1) {
    let byte = 0;
    for (let x = 0; x < 8; x += 1) {
      byte = (byte << 1) | (cell[y * cols + x] < cell[y * cols + x + 1] ? 1 : 0);
    }
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function decodePngGray(bytes) {
  if (!PNG_SIGNATURE.every((value, i) => bytes[i] === value)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  const idat = [];
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || interlace !== 0 || (depth !== 8 && depth !== 16)) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels || (colorType === 3 && (!palette || depth !== 8))) return null;
  if (width * height > 40_000_000) return null;
  const raw = inflateSync(Buffer.concat(idat));
  const sample = depth / 8;
  const bpp = channels * sample;
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) return null;
  const pixels = new Float32Array(width * height);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = previous[i];
      const c = i >= bpp ? previous[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const at = x * bpp;
      let r;
      let g;
      let bl;
      if (colorType === 3) {
        const p = line[at] * 3;
        r = palette[p];
        g = palette[p + 1];
        bl = palette[p + 2];
      } else if (channels <= 2) {
        r = g = bl = line[at];
      } else {
        r = line[at];
        g = line[at + sample];
        bl = line[at + 2 * sample];
      }
      pixels[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * bl;
    }
    previous = line;
  }
  return { width, height, pixels };
}

// ---------------------------------------------------------------------------
// JPEG, DC coefficients of the first component only
// ---------------------------------------------------------------------------

function buildHuffman(counts, symbols) {
  // Canonical codes: map of (length << 16 | code) → symbol.
  const table = new Map();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let i = 0; i < counts[length - 1]; i += 1) {
      table.set((length << 16) | code, symbols[k]);
      code += 1;
      k += 1;
    }
    code <<= 1;
  }
  return table;
}

export function decodeJpegGray(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const huffman = { dc: [], ac: [] };
  let frame = null;
  let restartInterval = 0;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset + 2);
    const data = bytes.subarray(offset + 4, offset + 2 + length);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = data.readUInt16BE(1);
      const width = data.readUInt16BE(3);
      const count = data[5];
      const components = [];
      for (let i = 0; i < count; i += 1) {
        components.push({ id: data[6 + i * 3], h: data[7 + i * 3] >> 4, v: data[7 + i * 3] & 15 });
      }
      frame = { width, height, components, progressive: marker === 0xc2 };
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return null; // lossless or arithmetic coding
    } else if (marker === 0xc4) {
      let at = 0;
      while (at < data.length) {
        const cls = data[at] >> 4;
        const id = data[at] & 15;
        const counts = data.subarray(at + 1, at + 17);
        const total = counts.reduce((sum, n) => sum + n, 0);
        const symbols = data.subarray(at + 17, at + 17 + total);
        (cls === 0 ? huffman.dc : huffman.ac)[id] = buildHuffman(counts, symbols);
        at += 17 + total;
      }
    } else if (marker === 0xdd) {
      restartInterval = data.readUInt16BE(0);
    } else if (marker === 0xda) {
      if (!frame) return null;
      const scanCount = data[0];
      const scan = [];
      for (let i = 0; i < scanCount; i += 1) {
        scan.push({ id: data[1 + i * 2], dc: data[2 + i * 2] >> 4, ac: data[2 + i * 2] & 15 });
      }
      const ss = data[1 + scanCount * 2];
      const ah = data[3 + scanCount * 2] >> 4;
      const al = data[3 + scanCount * 2] & 15;
      const luma = frame.components[0];
      const lumaInScan = scan.some((c) => c.id === luma.id);
      if (lumaInScan && ss === 0 && ah === 0) {
        return decodeDcScan(bytes, offset + 2 + length, frame, scan, huffman, restartInterval, al);
      }
      // Skip this scan's entropy-coded data to the next marker.
      offset += 2 + length;
      while (offset + 1 < bytes.length && !(bytes[offset] === 0xff && bytes[offset + 1] !== 0 && !(bytes[offset + 1] >= 0xd0 && bytes[offset + 1] <= 0xd7))) {
        offset += 1;
      }
      continue;
    }
    offset += 2 + length;
  }
  return null;
}

function decodeDcScan(bytes, start, frame, scan, huffman, restartInterval, al) {
  const hMax = Math.max(...frame.components.map((c) => c.h));
  const vMax = Math.max(...frame.components.map((c) => c.v));
  const mcusPerLine = Math.ceil(frame.width / (8 * hMax));
  const mcusPerColumn = Math.ceil(frame.height / (8 * vMax));
  const luma = frame.components[0];
  const lumaBlocksWide = Math.ceil(Math.ceil((frame.width * luma.h) / hMax) / 8);
  const lumaBlocksHigh = Math.ceil(Math.ceil((frame.height * luma.v) / vMax) / 8);
  const scanComponents = scan.map((s) => ({ ...s, frame: frame.components.find((c) => c.id === s.id) }));
  if (scanComponents.some((c) => !c.frame || !huffman.dc[c.dc] || (!frame.progressive && !huffman.ac[c.ac]))) return null;
  const single = scanComponents.length === 1;
  const gridWide = single ? lumaBlocksWide : mcusPerLine * luma.h;
  const gridHigh = single ? lumaBlocksHigh : mcusPerColumn * luma.v;
  const grid = new Float32Array(gridWide * gridHigh);

  let pos = start;
  let bitBuffer = 0;
  let bitCount = 0;
  let ended = false;
  function readBit() {
    if (bitCount === 0) {
      if (pos >= bytes.length) {
        ended = true;
        return 0;
      }
      let byte = bytes[pos];
      if (byte === 0xff) {
        const next = bytes[pos + 1];
        if (next === 0) pos += 2;
        else {
          ended = true; // a marker: no more data in this scan
          return 0;
        }
      } else pos += 1;
      bitBuffer = byte;
      bitCount = 8;
    }
    bitCount -= 1;
    return (bitBuffer >> bitCount) & 1;
  }
  function receive(n) {
    let value = 0;
    for (let i = 0; i < n; i += 1) value = (value << 1) | readBit();
    return value;
  }
  function extend(value, n) {
    return n && value < 1 << (n - 1) ? value - (1 << n) + 1 : value;
  }
  function decodeSymbol(table) {
    let code = 0;
    for (let length = 1; length <= 16; length += 1) {
      code = (code << 1) | readBit();
      const symbol = table.get((length << 16) | code);
      if (symbol !== undefined) return symbol;
    }
    throw new Error("bad huffman code");
  }
  const predictions = new Map();
  function decodeBlock(component) {
    const t = decodeSymbol(huffman.dc[component.dc]);
    const diff = t ? extend(receive(t), t) : 0;
    const value = (predictions.get(component.id) ?? 0) + diff;
    predictions.set(component.id, value);
    if (!frame.progressive) {
      const ac = huffman.ac[component.ac];
      let k = 1;
      while (k < 64) {
        const rs = decodeSymbol(ac);
        const s = rs & 15;
        const r = rs >> 4;
        if (s === 0) {
          if (r === 15) k += 16;
          else break;
        } else {
          k += r;
          receive(s);
          k += 1;
        }
      }
    }
    return value << al;
  }
  function restart() {
    bitCount = 0;
    predictions.clear();
    // Step over the RSTn marker.
    while (pos + 1 < bytes.length && !(bytes[pos] === 0xff && bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7)) pos += 1;
    pos += 2;
  }

  try {
    const total = single ? lumaBlocksWide * lumaBlocksHigh : mcusPerLine * mcusPerColumn;
    for (let n = 0; n < total && !ended; n += 1) {
      if (restartInterval && n > 0 && n % restartInterval === 0) restart();
      if (single) {
        const value = decodeBlock(scanComponents[0]);
        grid[n] = value;
        continue;
      }
      const mcuX = n % mcusPerLine;
      const mcuY = Math.floor(n / mcusPerLine);
      for (const component of scanComponents) {
        for (let by = 0; by < component.frame.v; by += 1) {
          for (let bx = 0; bx < component.frame.h; bx += 1) {
            const value = decodeBlock(component);
            if (component.id === luma.id) {
              grid[(mcuY * luma.v + by) * gridWide + mcuX * luma.h + bx] = value;
            }
          }
        }
      }
    }
  } catch {
    return null;
  }
  // Crop the padding blocks off an interleaved grid.
  if (gridWide === lumaBlocksWide && gridHigh === lumaBlocksHigh) return { width: gridWide, height: gridHigh, pixels: grid };
  const pixels = new Float32Array(lumaBlocksWide * lumaBlocksHigh);
  for (let y = 0; y < lumaBlocksHigh; y += 1) {
    for (let x = 0; x < lumaBlocksWide; x += 1) pixels[y * lumaBlocksWide + x] = grid[y * gridWide + x];
  }
  return { width: lumaBlocksWide, height: lumaBlocksHigh, pixels };
}

/** { sha256, dhash, format } for a file's bytes. dhash is null when we cannot decode it. */
export function fingerprint(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let gray = null;
  let format = "other";
  try {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) {
      format = "png";
      gray = decodePngGray(buffer);
    } else if (buffer[0] === 0xff && buffer[1] === 0xd8) {
      format = "jpeg";
      gray = decodeJpegGray(buffer);
    }
  } catch {
    gray = null;
  }
  return { sha256: sha256Hex(buffer), dhash: gray && gray.width >= 2 && gray.height >= 2 ? dhashFromGray(gray) : null, format };
}
