// Speaker recognition: does this voice belong to the owner? A small offline model (WeSpeaker CAM++ from sherpa-onnx: Apache-2.0 toolkit, weights CC BY 4.0)
// turns a sentence into a 512-number voice print; the owner's print is the average of a few enrolled sentences, and a new sentence counts as the owner
// when its cosine similarity to that average is high enough. Nothing leaves the computer and no audio is kept.
// The model file is downloaded from Settings → Security (like the Sentinel model); onnxruntime-node runs it in the main process, so the decision
// is never made in the page. Files, the runtime and the encryption are injected, so scripts/test-speaker.js runs without Electron.
const fb = require('./speaker-fbank');

const MODEL_ID = 'wespeaker_en_voxceleb_CAM++';
const MODEL_URLS = ['https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM++.onnx'];
const MODEL_MIN_BYTES = 20 * 1048576;
const MODEL_MAX_BYTES = 120 * 1048576;
const MIN_SECONDS = 1.0; // shorter speech does not carry enough of a voice to decide on
const MIN_ENROLL_SECONDS = 2.0;
const MIN_ENROLL = 3;
const MAX_ENROLL = 12;

function normalize(v) {
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1; const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}
function cosine(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 0;
  let d = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? d / Math.sqrt(x * y) : 0;
}
function meanVector(list) {
  const out = new Float32Array(list[0].length);
  for (const v of list) for (let i = 0; i < out.length; i++) out[i] += v[i] / list.length;
  return out;
}

function createSpeaker({ fs, path, dir, safeStorage, fetch: fetchFn = globalThis.fetch, loadOrt = () => require('onnxruntime-node'), log = () => {}, now = Date.now }) {
  const modelFile = () => path.join(dir(), 'model.onnx');
  const printFile = () => path.join(dir(), 'voiceprint.json');
  let sessionP = null; let ort = null; let pending = []; let printCache; let busy = false;

  const modelSize = () => { try { return fs.statSync(modelFile()).size; } catch { return 0; } };
  const modelReady = () => { const n = modelSize(); return n >= MODEL_MIN_BYTES && n <= MODEL_MAX_BYTES; };

  // ---- the saved voice print (encrypted with the system keychain when available) ----
  const seal = (obj) => { const s = JSON.stringify(obj); return safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s).toString('base64') : 'plain:' + s; };
  const unseal = (e) => JSON.parse(String(e).startsWith('plain:') ? String(e).slice(6) : safeStorage.decryptString(Buffer.from(e, 'base64')));
  function loadPrint() {
    if (printCache !== undefined) return printCache;
    printCache = null;
    try {
      const f = JSON.parse(fs.readFileSync(printFile(), 'utf8'));
      const p = unseal(f.enc);
      if (p && p.model === MODEL_ID && Array.isArray(p.embedding) && p.embedding.length) printCache = { embedding: Float32Array.from(p.embedding), n: p.n || 0, createdAt: p.createdAt || 0, spread: p.spread || 0 };
    } catch (e) { if (e && e.code !== 'ENOENT') log('warn', 'The saved voice print could not be read: ' + ((e && e.message) || e)); }
    return printCache;
  }
  function savePrint(embedding, n, spread) {
    fs.mkdirSync(dir(), { recursive: true });
    const createdAt = now();
    const enc = seal({ model: MODEL_ID, embedding: Array.from(embedding), n, createdAt, spread });
    const tmp = printFile() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ enc }), { mode: 0o600 }); fs.renameSync(tmp, printFile());
    printCache = { embedding, n, createdAt, spread };
  }
  const hasPrint = () => !!loadPrint();
  function removePrint() { try { fs.unlinkSync(printFile()); } catch {} printCache = null; pending = []; }

  // ---- the model ----
  function runtime() {
    if (ort) return { ok: true };
    try { ort = loadOrt(); return { ok: true }; } catch (e) {
      return { ok: false, error: 'The speech engine (onnxruntime-node) is not installed. Run "pnpm install" in the Artemis folder once and restart the app. (' + ((e && e.message) || e).toString().split('\n')[0] + ')' };
    }
  }
  function session() {
    if (sessionP) return sessionP;
    const rt = runtime(); if (!rt.ok) return Promise.reject(new Error(rt.error));
    if (!modelReady()) return Promise.reject(new Error('The voice recognition model is not downloaded yet. Download it in Settings → Security.'));
    sessionP = ort.InferenceSession.create(modelFile(), { executionProviders: ['cpu'], intraOpNumThreads: 1, graphOptimizationLevel: 'all' })
      .catch((e) => { sessionP = null; throw new Error('The voice recognition model could not be loaded (' + ((e && e.message) || e) + '). Remove it in Settings → Security and download it again.'); });
    return sessionP;
  }
  function removeModel() { sessionP = null; try { fs.unlinkSync(modelFile()); } catch {} return { ok: true }; }

  /** Downloads the model. onProgress(percent, detail). Returns { ok } or { ok:false, error }. */
  async function download(onProgress = () => {}) {
    if (modelReady()) return { ok: true };
    if (busy) return { ok: false, error: 'The voice recognition model is already downloading.' };
    busy = true; let lastErr = '';
    const file = modelFile(); const tmp = file + '.part';
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      for (const url of MODEL_URLS) {
        try {
          const res = await fetchFn(url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
          if (!res.ok || !res.body) { lastErr = `HTTP ${res.status}`; continue; }
          const total = Number(res.headers.get('content-length')) || 0; const out = fs.createWriteStream(tmp);
          let got = 0; let last = -1; const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            got += value.length; if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
            const pct = total ? Math.round((got / total) * 100) : 0;
            if (pct !== last) { last = pct; onProgress(pct, `${(got / 1048576).toFixed(1)} of ${total ? (total / 1048576).toFixed(1) : '?'} MB`); }
          }
          await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
          if (got < MODEL_MIN_BYTES) { lastErr = 'The download was incomplete.'; continue; }
          fs.renameSync(tmp, file); sessionP = null;
          log('info', `Voice recognition model downloaded (${(got / 1048576).toFixed(1)} MB)`);
          return { ok: true };
        } catch (e) { lastErr = (e && e.message) || String(e); }
      }
      try { fs.unlinkSync(tmp); } catch {}
      return { ok: false, error: 'Could not download the voice recognition model (' + lastErr + '). Check your internet connection and try again.' };
    } finally { busy = false; }
  }

  // ---- embeddings ----
  let chain = Promise.resolve();
  const serial = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  /** The voice print of mono 16 kHz samples. */
  function embedSamples(samples) {
    return serial(async () => {
      const f = fb.fbank(samples);
      if (f.frames < 50) { const e = new Error('Too little speech.'); e.short = true; throw e; }
      const s = await session();
      const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', f.data, [1, f.frames, f.bins]) };
      const out = await s.run(feeds);
      const t = out[s.outputNames[0]];
      return normalize(Float32Array.from(t.data));
    });
  }
  async function embedWav(wav) {
    const w = fb.parseWav(wav);
    const x = fb.resampleLinear(w.samples, w.sampleRate);
    const seconds = x.length / fb.SAMPLE_RATE;
    return { embedding: await embedSamples(x), seconds };
  }
  const secondsOf = (wav) => { const w = fb.parseWav(wav); return w.samples.length / w.sampleRate; };

  /** Adds one enrolment sentence. Returns { ok, count } or { ok:false, error }. */
  async function enrollAdd(wav) {
    try {
      const seconds = secondsOf(wav);
      if (seconds < MIN_ENROLL_SECONDS) return { ok: false, short: true, error: 'That was too short. Read the whole sentence.' };
      if (pending.length >= MAX_ENROLL) return { ok: false, error: `That is enough: ${MAX_ENROLL} sentences. Press Done.` };
      const r = await embedWav(wav); pending.push(r.embedding);
      return { ok: true, count: pending.length, enough: pending.length >= MIN_ENROLL };
    } catch (e) { return { ok: false, short: !!(e && e.short), error: (e && e.short) ? 'Not enough speech was heard. Speak a little louder and try again.' : (e && e.message) || String(e) }; }
  }
  /** Saves the average of the enrolled sentences as the owner's voice print. */
  function enrollFinish() {
    if (pending.length < MIN_ENROLL) return { ok: false, error: `Record at least ${MIN_ENROLL} sentences (you have ${pending.length}).` };
    const centroid = normalize(meanVector(pending));
    const spread = pending.reduce((a, v) => a + cosine(v, centroid), 0) / pending.length; // how alike the sentences are: low means mixed voices or a noisy room
    const n = pending.length; pending = [];
    savePrint(centroid, n, spread);
    return { ok: true, n, spread: Math.round(spread * 100) / 100, weak: spread < 0.6 };
  }
  const enrollReset = () => { pending = []; return { ok: true }; };

  /** How much this sentence sounds like the owner: { ok, score, seconds } or { ok:false, short | error }. */
  async function score(wav) {
    const p = loadPrint();
    if (!p) return { ok: false, notEnrolled: true, error: 'No voice is enrolled yet.' };
    try {
      const seconds = secondsOf(wav);
      if (seconds < MIN_SECONDS) return { ok: false, short: true, seconds, error: 'Too short to recognise a voice.' };
      const r = await embedWav(wav);
      return { ok: true, score: cosine(r.embedding, p.embedding), seconds: r.seconds };
    } catch (e) { return { ok: false, short: !!(e && e.short), error: (e && e.message) || String(e) }; }
  }

  function status() {
    const p = loadPrint(); const rt = runtime();
    return { model: { ready: modelReady(), size: modelSize(), id: MODEL_ID }, runtime: rt, enrolled: p ? { n: p.n, createdAt: p.createdAt, spread: Math.round(p.spread * 100) / 100 } : null, pending: pending.length };
  }
  return { status, download, removeModel, embedWav, embedSamples, enrollAdd, enrollFinish, enrollReset, score, hasPrint, removePrint, modelReady, runtime };
}

module.exports = { createSpeaker, cosine, normalize, meanVector, MODEL_ID, MODEL_URLS, MIN_SECONDS, MIN_ENROLL_SECONDS, MIN_ENROLL, MAX_ENROLL };
