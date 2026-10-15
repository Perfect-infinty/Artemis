// Voice helpers for the renderer: record from the microphone, send to speech-to-text, read replies aloud.
import { speakable } from './sentinel-core.mjs';
import { openMic, routeOutput } from './audio-devices.js';
const api = window.api;

export const LANGS = [['auto', 'Auto-detect'], ['en', 'English']];

/** Records the microphone. Returns { stop() -> Blob, cancel(), stream } */
export async function startRecording() {
  if (api.voicePermission) {
    const st = await api.voicePermission();
    if (st === 'denied' || st === 'restricted') throw new Error('Microphone access is blocked. Allow Artemis in System Settings → Privacy & Security → Microphone, then try again.');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This computer has no microphone available to Artemis.');
  let stream;
  try { stream = await openMic({ echoCancellation: true, noiseSuppression: true }); }
  catch (e) { throw new Error(/denied|permission/i.test(String(e && e.message)) || (e && e.name === 'NotAllowedError') ? 'Microphone access was denied. Allow Artemis in System Settings → Privacy & Security → Microphone.' : 'Could not open the microphone: ' + ((e && e.message) || e)); }
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  rec.start(250);
  return {
    stream,
    stop: () => new Promise((resolve) => { rec.onstop = () => { release(); resolve(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' })); }; try { rec.stop(); } catch { release(); resolve(new Blob([])); } }),
    cancel: () => { rec.onstop = null; try { rec.stop(); } catch {} release(); }
  };
}

export async function transcribe(blob, language) {
  if (!blob || blob.size < 800) return { ok: false, error: 'Nothing was recorded. Hold on a little longer and speak closer to the microphone.' };
  const audio = new Uint8Array(await blob.arrayBuffer());
  return api.voiceTranscribe({ audio, mime: blob.type, language: language && language !== 'auto' ? language : '' });
}

// ---- read aloud (system voices, works offline) ----
export const detectLang = () => 'en';
const LOCALE = { en: ['en'] };
const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|agnes|princess|bruce|hysterical|pipe organ)\b/i;
/** Higher is nicer: premium/enhanced/natural voices first, novelty voices last. */
export function rankVoice(v) {
  const n = String(v.name || '');
  let r = 0;
  if (/premium/i.test(n)) r += 60;
  if (/enhanced|improved/i.test(n)) r += 45;
  if (/siri|natural|neural|online/i.test(n)) r += 35;
  if (v.localService) r += 8;
  if (NOVELTY.test(n)) r -= 200;
  return r;
}
export const listVoices = () => ((window.speechSynthesis && speechSynthesis.getVoices()) || []).slice().sort((a, b) => a.lang.localeCompare(b.lang) || rankVoice(b) - rankVoice(a) || a.name.localeCompare(b.name));
export function pickVoice(lang) {
  const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  const chosen = window.__voiceName && voices.find((x) => x.name === window.__voiceName);
  if (chosen) return chosen;
  for (const l of LOCALE[lang] || ['en']) {
    const best = voices.filter((x) => x.lang && x.lang.toLowerCase().startsWith(l)).sort((a, b) => rankVoice(b) - rankVoice(a))[0];
    if (best) return best;
  }
  return null;
}
export { speakable };
let current = null;
let audioEl = null; let serverRun = 0;
export function stopSpeaking() {
  serverRun++;
  try { speechSynthesis.cancel(); } catch {}
  if (audioEl) { try { audioEl.pause(); } catch {} try { URL.revokeObjectURL(audioEl.src); } catch {} audioEl = null; }
  if (current) { const c = current; current = null; c.onend?.(); }
}
const useServer = () => { const t = window.__tts || {}; return t.engine === 'openai' || t.engine === 'piper'; };
/** Split into pieces the server can answer quickly, at sentence ends. */
export function chunkText(text, max = 380) {
  const out = []; let rest = String(text || '').trim();
  while (rest.length > max) {
    const head = rest.slice(0, max);
    const i = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('; '), head.lastIndexOf(', '));
    const cut = i > max * 0.4 ? i + 1 : head.lastIndexOf(' ') > 0 ? head.lastIndexOf(' ') : max;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
function speakServer(clean, { language, onEnd, onFail, onChunk }) {
  const run = ++serverRun;
  const pieces = chunkText(clean);
  const rate = Math.min(1.6, Math.max(0.6, Number(window.__voiceRate) || 1));
  const fixed = language && language !== 'auto' ? language : '';
  const fetchPiece = (t) => api.voiceSpeak({ text: t, speed: rate, lang: fixed || detectLang(t) });
  // fetch AND prepare (blob + audio element + output device) the next piece while the current one plays, so there is no gap
  const make = (t) => fetchPiece(t).then(async (r) => {
    if (!r || !r.ok) return { fail: (r && r.error) || 'The voice server failed.' };
    const url = URL.createObjectURL(new Blob([r.audio], { type: r.mime || 'audio/wav' }));
    const el = new Audio(url); el.preload = 'auto'; await routeOutput(el);
    return { el, url };
  }).catch((e) => ({ fail: (e && e.message) || String(e) }));
  const token = { onend: () => { onEnd?.(); } };
  current = token;
  const finish = () => { if (current === token) { current = null; onEnd?.(); } };
  (async () => {
    let next = make(pieces[0]);
    for (let i = 0; i < pieces.length; i++) {
      const item = await next;
      if (run !== serverRun) { if (item.url) try { URL.revokeObjectURL(item.url); } catch {} return; }
      if (item.fail) { if (i === 0) { current = null; onFail?.(item.fail); } else finish(); return; }
      if (i + 1 < pieces.length) next = make(pieces[i + 1]);
      audioEl = item.el;
      onChunk?.(pieces[i]);
      await new Promise((resolve) => { item.el.onended = resolve; item.el.onerror = resolve; item.el.play().catch(resolve); });
      try { URL.revokeObjectURL(item.url); } catch {}
      if (run !== serverRun) return;
    }
    audioEl = null; finish();
  })();
  return true;
}
function speakSystem(clean, { language, onEnd, onChunk }) {
  if (!window.speechSynthesis) { onEnd?.(); return false; }
  const run = ++serverRun;
  const lang = language && language !== 'auto' ? language : detectLang(clean);
  const v = pickVoice(lang);
  // One long utterance stutters or stops on some voices, so speak it sentence by sentence.
  const pieces = chunkText(clean, 220);
  const token = { onend: () => { onEnd?.(); } };
  current = token;
  let i = 0;
  const step = () => {
    if (run !== serverRun) return;
    if (i >= pieces.length) { if (current === token) { current = null; onEnd?.(); } return; }
    const text = pieces[i];
    const u = new SpeechSynthesisUtterance(text);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = Math.min(1.6, Math.max(0.6, Number(window.__voiceRate) || 1));
    u.onstart = () => { if (run === serverRun) onChunk?.(text); };
    u.onend = () => { i++; step(); };
    u.onerror = () => { if (run !== serverRun) return; i++; step(); };
    speechSynthesis.speak(u);
  };
  step();
  return true;
}
export function speak(text, { language = 'auto', onEnd, onError, onChunk } = {}) {
  stopSpeaking();
  const clean = speakable(text).slice(0, 6000);
  if (!clean) { onEnd?.(); return false; }
  if (useServer()) {
    // If the voice server is down, fall back to the computer's own voice so the answer is never silent.
    return speakServer(clean, { language, onEnd, onChunk, onFail: (err) => { onError?.(err); speakSystem(clean, { language, onEnd, onChunk }); } });
  }
  return speakSystem(clean, { language, onEnd, onChunk });
}
export const isSpeaking = () => !!current;

/**
 * Reads text as it arrives: push() pieces while the reply is still being written, end() when it is finished.
 * Pieces are played one after another; with a voice server the next piece is already being made while one plays.
 * onIdle fires once, after everything has been read (or when it is stopped).
 */
export function createSpeaker({ language = 'auto', onIdle, onStart } = {}) {
  stopSpeaking();
  const run = ++serverRun;
  const items = []; let playing = false; let ended = false; let idled = false; let started = false;
  const idle = () => { if (idled) return; idled = true; if (current === token) current = null; onIdle?.(); };
  const token = { onend: idle };
  current = token;
  const sys = (text) => new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const lang = language && language !== 'auto' ? language : detectLang(text);
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(lang);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = Math.min(1.6, Math.max(0.6, Number(window.__voiceRate) || 1));
    u.onend = resolve; u.onerror = resolve;
    speechSynthesis.speak(u);
  });
  const rate = () => Math.min(1.6, Math.max(0.6, Number(window.__voiceRate) || 1));
  const pump = async () => {
    if (playing) return;
    playing = true;
    while (items.length) {
      if (run !== serverRun) { playing = false; return; }
      const it = items.shift();
      if (!started) { started = true; onStart?.(); }
      let r = null;
      if (it.req) r = await it.req;
      if (run !== serverRun) { playing = false; return; }
      if (r && r.ok) {
        const url = URL.createObjectURL(new Blob([r.audio], { type: r.mime || 'audio/wav' }));
        const el = new Audio(url); audioEl = el; await routeOutput(el);
        await new Promise((resolve) => { el.onended = resolve; el.onerror = resolve; el.play().catch(resolve); });
        try { URL.revokeObjectURL(url); } catch {}
      } else await sys(it.text); // no server, or it failed: the computer voice, so the answer is never silent
    }
    playing = false;
    if (ended && run === serverRun) idle();
  };
  return {
    push(text) {
      const clean = speakable(text);
      if (!clean || run !== serverRun) return;
      const fixed = language && language !== 'auto' ? language : '';
      items.push({ text: clean, req: useServer() ? api.voiceSpeak({ text: clean, speed: rate(), lang: fixed || detectLang(clean) }) : null });
      pump();
    },
    end() { ended = true; if (!playing && !items.length) { if (run === serverRun) idle(); } else pump(); },
    get started() { return started; }
  };
}
