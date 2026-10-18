// Raw PCM helpers for the streamed voice. Pure (no DOM), so the Node tests can import them.

export const PCM_RATE = 24000; // Kokoro sends 16-bit little-endian mono at 24 kHz

const s16 = (lo, hi) => (((lo | (hi << 8)) << 16) >> 16) / 32768;

/**
 * Turns 16-bit little-endian PCM that arrives in chunks of any size into float samples. A chunk that ends in the middle
 * of a sample keeps its last byte for the next one. out(n) returns where to write n samples (e.g. an AudioBuffer's
 * channel data), so nothing is copied twice. feed() returns that array, or null when the chunk held no whole sample.
 */
export function createPcmDecoder() {
  let carry = -1;
  return {
    feed(bytes, out = (n) => new Float32Array(n)) {
      const len = bytes ? bytes.length : 0;
      const n = (len + (carry >= 0 ? 1 : 0)) >> 1;
      if (!n) { if (len) carry = bytes[0]; return null; }
      const f = out(n);
      let i = 0; let p = 0;
      if (carry >= 0) { f[i++] = s16(carry, bytes[0]); p = 1; }
      const rest = n - i; const off = bytes.byteOffset + p;
      if ((off & 1) === 0) { const v = new Int16Array(bytes.buffer, off, rest); for (let k = 0; k < rest; k++) f[i + k] = v[k] / 32768; } // aligned: read it directly (little-endian hosts)
      else for (let k = 0, q = p; k < rest; k++, q += 2) f[i + k] = s16(bytes[q], bytes[q + 1]);
      carry = p + rest * 2 < len ? bytes[len - 1] : -1;
      return f;
    },
    get pending() { return carry >= 0 ? 1 : 0; },
    reset() { carry = -1; }
  };
}

/** A short linear fade at the start (dir 1) or end (dir -1) of a buffer, so a piece never starts or stops with a click. */
export function fade(f, n = 96, dir = 1) {
  const k = Math.min(n, f.length);
  if (dir > 0) for (let i = 0; i < k; i++) f[i] *= i / k;
  else for (let i = 0; i < k; i++) f[f.length - 1 - i] *= i / k;
  return f;
}
