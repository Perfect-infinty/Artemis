// Audio front end of the speaker model: WAV reading and Kaldi-style log mel filter banks (what WeSpeaker models are trained on).
// 80 mel bins, 25 ms Hamming window every 10 ms, DC removal, 0.97 pre-emphasis, 512-point power spectrum, mel scale 1127·ln(1+f/700) from 20 Hz
// to the Nyquist frequency, log with a float-epsilon floor, then the mean of every bin over the sentence subtracted. Samples are scaled
// by 32768 first, like WeSpeaker's own code. Pure JavaScript, so the main process needs no extra package and tests can run it anywhere.

const SAMPLE_RATE = 16000;
const FRAME_LEN = 400; // 25 ms
const FRAME_SHIFT = 160; // 10 ms
const NFFT = 512;
const NUM_BINS = 80;
const LOW_FREQ = 20;
const PREEMPH = 0.97;
const EPS = 1.1920928955078125e-7; // float32 epsilon, Kaldi's floor before the log
const WAVE_SCALE = 32768;
const MAX_SECONDS = 25;

/** A 16-bit PCM WAV (as Sentinel records it) as mono floats in [-1, 1]. Throws on anything else. */
function parseWav(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : input);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file.');
  let pos = 12; let fmt = null; let data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4); let size = b.readUInt32LE(pos + 4); const start = pos + 8;
    if (start + size > b.length) size = b.length - start; // a streamed file can claim more than it has
    if (id === 'fmt ' && size >= 16) fmt = { format: b.readUInt16LE(start), channels: b.readUInt16LE(start + 2), rate: b.readUInt32LE(start + 4), bits: b.readUInt16LE(start + 14) };
    else if (id === 'data') { data = b.subarray(start, start + size); break; }
    pos = start + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('The WAV file has no audio.');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error('Only 16-bit PCM WAV is supported.');
  const ch = Math.max(1, fmt.channels); const n = Math.floor(data.length / (2 * ch));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) s += data.readInt16LE((i * ch + c) * 2); out[i] = s / ch / 32768; }
  return { sampleRate: fmt.rate, samples: out };
}

/** Linear-interpolation resampling to 16 kHz (the recordings already are 16 kHz; this is only a safety net). */
function resampleLinear(x, from, to = SAMPLE_RATE) {
  if (from === to || !x.length) return x;
  const n = Math.max(1, Math.floor((x.length * to) / from)); const out = new Float32Array(n); const r = from / to;
  for (let i = 0; i < n; i++) { const p = i * r; const i0 = Math.floor(p); const i1 = Math.min(x.length - 1, i0 + 1); const f = p - i0; out[i] = x[i0] * (1 - f) + x[i1] * f; }
  return out;
}

// ---- 512-point FFT (radix 2), tables built once ----
const COS = new Float64Array(NFFT / 2); const SIN = new Float64Array(NFFT / 2);
for (let i = 0; i < NFFT / 2; i++) { COS[i] = Math.cos((2 * Math.PI * i) / NFFT); SIN[i] = -Math.sin((2 * Math.PI * i) / NFFT); }
const REV = new Uint16Array(NFFT);
for (let i = 0, bits = Math.log2(NFFT); i < NFFT; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); REV[i] = r; }
function fft(re, im) {
  for (let i = 0; i < NFFT; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= NFFT; size <<= 1) {
    const half = size >> 1; const step = NFFT / size;
    for (let start = 0; start < NFFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = COS[k * step]; const s = SIN[k * step]; const a = start + k; const bI = a + half;
        const tr = re[bI] * c - im[bI] * s; const ti = re[bI] * s + im[bI] * c;
        re[bI] = re[a] - tr; im[bI] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

const mel = (f) => 1127 * Math.log(1 + f / 700);
const WINDOW = new Float64Array(FRAME_LEN); for (let i = 0; i < FRAME_LEN; i++) WINDOW[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LEN - 1));
// Triangular filters over FFT bins 0..255, as Kaldi builds them: [first bin, weights] per mel bin
const BANKS = (() => {
  const nyquist = SAMPLE_RATE / 2; const binWidth = SAMPLE_RATE / NFFT; const nFft = NFFT / 2;
  const lo = mel(LOW_FREQ); const hi = mel(nyquist); const delta = (hi - lo) / (NUM_BINS + 1); const out = [];
  for (let b = 0; b < NUM_BINS; b++) {
    const left = lo + b * delta; const center = lo + (b + 1) * delta; const right = lo + (b + 2) * delta; let first = -1; const w = [];
    for (let i = 0; i < nFft; i++) {
      const m = mel(binWidth * i);
      if (m > left && m < right) { if (first < 0) first = i; w.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center)); }
    }
    out.push({ first: Math.max(0, first), w: Float64Array.from(w) });
  }
  return out;
})();

/**
 * Log mel filter banks of mono 16 kHz samples in [-1, 1]. Returns { data: Float32Array(frames * 80), frames, bins }, mean-normalised per bin
 * (pass cmn:false for the raw values). Fewer than 25 ms of audio gives zero frames.
 */
function fbank(samples, { cmn = true } = {}) {
  const x = samples.length > MAX_SECONDS * SAMPLE_RATE ? samples.subarray(0, MAX_SECONDS * SAMPLE_RATE) : samples;
  const frames = x.length < FRAME_LEN ? 0 : 1 + Math.floor((x.length - FRAME_LEN) / FRAME_SHIFT);
  const data = new Float32Array(frames * NUM_BINS);
  const re = new Float64Array(NFFT); const im = new Float64Array(NFFT); const frame = new Float64Array(FRAME_LEN);
  for (let f = 0; f < frames; f++) {
    const off = f * FRAME_SHIFT; let mean = 0;
    for (let i = 0; i < FRAME_LEN; i++) { frame[i] = x[off + i] * WAVE_SCALE; mean += frame[i]; }
    mean /= FRAME_LEN;
    for (let i = 0; i < FRAME_LEN; i++) frame[i] -= mean;
    for (let i = FRAME_LEN - 1; i > 0; i--) frame[i] -= PREEMPH * frame[i - 1];
    frame[0] -= PREEMPH * frame[0];
    re.fill(0); im.fill(0);
    for (let i = 0; i < FRAME_LEN; i++) re[i] = frame[i] * WINDOW[i];
    fft(re, im);
    for (let b = 0; b < NUM_BINS; b++) {
      const { first, w } = BANKS[b]; let e = 0;
      for (let k = 0; k < w.length; k++) { const i = first + k; e += w[k] * (re[i] * re[i] + im[i] * im[i]); }
      data[f * NUM_BINS + b] = Math.log(Math.max(e, EPS));
    }
  }
  if (cmn && frames > 0) {
    for (let b = 0; b < NUM_BINS; b++) {
      let m = 0; for (let f = 0; f < frames; f++) m += data[f * NUM_BINS + b];
      m /= frames; for (let f = 0; f < frames; f++) data[f * NUM_BINS + b] -= m;
    }
  }
  return { data, frames, bins: NUM_BINS };
}

module.exports = { parseWav, resampleLinear, fbank, fft, SAMPLE_RATE, FRAME_LEN, FRAME_SHIFT, NFFT, NUM_BINS, BANKS };
