// Sentinel mode: always-on listening for the wake phrase "Wake up".
// The wake word is spotted on this computer by a tiny offline recogniser (Vosk), no AI and no network.
// Only after the wake word is heard does Artemis record your sentence, and only then is it sent to speech-to-text.
import { RATE, GRAMMAR, BARGE_GRAMMAR, hasBarge, hasWake, Segmenter, Ring, concat, encodeWav, rms, trackNoise } from './sentinel-core.mjs';

import { log, progress } from './log.js';
import { openMic } from './audio-devices.js';

const api = window.api;

const within = (p, ms, msg) => { let to; return Promise.race([p, new Promise((_, rej) => { to = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(to)); };
let shared = null; // { model, url }: kept between Sentinel sessions, so the second start is instant
let loading = null;
/** Loads the offline voice model once (read the file, start the engine, load it). Safe to call many times. */
function loadSharedModel() {
  if (shared) return Promise.resolve(shared);
  if (loading) return loading;
  loading = (async () => {
    const vosk = await within(import('vosk-browser'), 60000, 'The speech engine did not load within 60 seconds.');
    const Model = vosk.Model || (vosk.default && vosk.default.Model);
    if (!Model) throw new Error('The speech engine has no Model class (unexpected vosk-browser build).');
    const data = await within(api.sentinelModel(), 60000, 'Reading the voice model file took too long.');
    if (!data || !data.length) throw new Error('The voice model file is empty. Remove it in Settings → Voice and start Sentinel again.');
    log('info', 'sentinel', `Model file read (${(data.length / 1048576).toFixed(1)} MB)`);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/gzip' }));
    const t1 = performance.now();
    const model = new Model(url, 0);
    try {
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('Loading the voice model took longer than 3 minutes and was stopped.')), 180000);
        model.on('load', (m) => { clearTimeout(to); m.result ? resolve() : reject(new Error('The voice model could not be loaded. The file may be damaged: remove it in Settings → Voice and start Sentinel again.')); });
        model.on('error', (m) => { clearTimeout(to); reject(new Error('Voice model error: ' + ((m && m.error) || 'unknown'))); });
        try { model.worker.addEventListener('error', (ev) => { clearTimeout(to); reject(new Error('The speech engine crashed: ' + ((ev && ev.message) || 'unknown error'))); }); } catch {}
      });
    } catch (e) { try { model.terminate(); } catch {} try { URL.revokeObjectURL(url); } catch {} throw e; }
    log('info', 'sentinel', `Voice model loaded in ${((performance.now() - t1) / 1000).toFixed(1)}s`);
    shared = { model, url };
    return shared;
  })().finally(() => { loading = null; });
  return loading;
}
/** Load the model in the background (no microphone) so that turning Sentinel on is instant. */
export async function preloadSentinel() {
  try { const st = await api.sentinelStatus(); if (st && st.ready) await loadSharedModel(); } catch (e) { log('warn', 'sentinel', 'Background model load failed: ' + ((e && e.message) || e)); }
}
export const dropSentinelModel = () => { try { shared && shared.model.terminate(); } catch {} try { shared && URL.revokeObjectURL(shared.url); } catch {} shared = null; };

const SESSION_IDLE_MS = 10000; // silence this long inside a conversation ends it
/** states: loading | idle (waiting for "Wake up") | listening | thinking | speaking | off */
export class Sentinel {
  constructor({ onState, onLevel, onUtterance, onError, onProgress, onBarge, canInterrupt, getMinRms }) {
    Object.assign(this, { onState, onLevel, onUtterance, onError, onProgress, onBarge, canInterrupt, getMinRms });
    this.echo = 0.02; this.loud = 0; this.pre = null; this.tail = []; this.lastReplyEnd = 0; this.utterStart = 0; this.ignored = 0;
    this.state = 'off';
    this.ring = new Ring(1500); // enough audio from before the wake word was recognised, so the name is in the recording
    this.running = false;
  }

  set(state, info) { if (state !== this.state && state !== 'loading') log('info', 'sentinel', `State: ${this.state} → ${state}`); this.state = state;
    // while thinking or speaking, listen for "stop" (or "wake up") so the user can interrupt
    const bargeOn = state === 'speaking' || state === 'thinking';
    if (bargeOn) { this.echo = 0.02; this.loud = 0; this.pre = null; this.tail = []; this.bargeHit = false; }
    if (bargeOn && !this.barge && this.model) { try { this.newBarge(); } catch (e) { log('warn', 'sentinel', 'Could not start the interrupt listener: ' + ((e && e.message) || e)); } }
    if (!bargeOn && this.barge) { try { this.barge.remove(); } catch {} this.barge = null; }
    this.onState?.(state, info);
  }

  newBarge() {
    this.barge = new this.model.KaldiRecognizer(RATE, BARGE_GRAMMAR);
    const hit = (t) => {
      if (this.bargeHit || !this.barge || !(this.state === 'speaking' || this.state === 'thinking') || !hasBarge(t)) return;
      this.bargeHit = true;
      log('info', 'sentinel', `Interrupted by voice: "${t}"`);
      this.onBarge?.();
    };
    this.bargeHit = false;
    this.barge.on('result', (m) => hit((m && m.result && m.result.text) || ''));
    this.barge.on('partialresult', (m) => hit((m && m.result && m.result.partial) || ''));
  }

  async start() {
    if (this.running) return;
    this.running = true;
    const t0 = performance.now();
    const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
    const step = (n, text) => { log('info', 'sentinel', `Step ${n}/5: ${text} (${secs()}s)`); progress('sentinel-start', 'Start Sentinel', { pct: Math.round(((n - 1) / 5) * 100), detail: `Step ${n}/5: ${text}` }); this.set('loading', { text, step: n, of: 5 }); };
    const within = (p, ms, msg) => { let to; return Promise.race([p, new Promise((_, rej) => { to = setTimeout(() => rej(new Error(msg)), ms); })]).finally(() => clearTimeout(to)); };
    try {
      progress('sentinel-start', 'Start Sentinel', { pct: 0, detail: 'Starting…' });
      step(1, 'Checking the voice model');
      let st = await api.sentinelStatus();
      log('info', 'sentinel', st.ready ? `Voice model found (${Math.round(st.size / 1048576)} MB)` : 'Voice model not found, downloading');
      if (!st.ready) {
        step(2, 'Downloading the voice model');
        const off = api.onSentinelProgress?.((p) => { if (this.running) this.set('loading', { text: 'Downloading the voice model', progress: p }); });
        const r = await api.sentinelDownload();
        try { off?.(); } catch {}
        if (!r.ok) throw new Error(r.error || 'Could not download the voice model.');
      }
      if (!this.running) return;
      step(3, 'Checking microphone permission');
      if (api.voicePermission) {
        const p = await within(api.voicePermission(), 30000, 'The microphone permission prompt did not answer. Check System Settings → Privacy & Security → Microphone.');
        log('info', 'sentinel', 'Microphone permission: ' + p);
        if (p === 'denied' || p === 'restricted') throw new Error('Microphone access is blocked. Allow Artemis in System Settings → Privacy & Security → Microphone.');
      }
      step(4, 'Opening the microphone');
      this.stream = await within(openMic({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }), 25000, 'The microphone did not respond within 25 seconds. Check System Settings → Privacy & Security → Microphone and that no other app is blocking it.')
        .catch((e) => { throw new Error((e && e.name === 'NotAllowedError') ? 'Microphone access was denied. Allow Artemis in System Settings → Privacy & Security → Microphone.' : (e && e.message) || String(e)); });
      log('info', 'sentinel', 'Microphone open', { tracks: this.stream.getAudioTracks().map((t) => t.label) });
      step(5, shared ? 'Voice model is ready' : loading ? 'Voice model is loading in the background' : 'Loading the voice model (the first time can take up to a minute)');
      const t1 = performance.now();
      const beat = setInterval(() => { const sec = Math.round((performance.now() - t1) / 1000); progress('sentinel-start', 'Start Sentinel', { pct: 90, detail: `Loading the voice model… ${sec}s` }); }, 2000);
      try { this.sharedModel = await loadSharedModel(); } finally { clearInterval(beat); }
      this.model = this.sharedModel.model;
      if (!this.running) { this.stop(); return; }
      this.newRecognizer();
      this.ctx = new AudioContext({ sampleRate: RATE });
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
      this.proc.onaudioprocess = (e) => this.onAudio(new Float32Array(e.inputBuffer.getChannelData(0)));
      const mute = this.ctx.createGain(); mute.gain.value = 0;
      src.connect(this.proc); this.proc.connect(mute); mute.connect(this.ctx.destination);
      progress('sentinel-start', 'Start Sentinel', { pct: 100, state: 'done', detail: `Ready in ${secs()}s. Say "Wake up".` });
      log('info', 'sentinel', `Sentinel ready in ${secs()}s`);
      this.set('idle');
    } catch (e) {
      const msg = (e && e.message) || String(e);
      log('error', 'sentinel', 'Start failed: ' + msg);
      progress('sentinel-start', 'Start Sentinel', { state: 'error', detail: msg });
      this.stop();
      this.onError?.(msg);
    }
  }

  newRecognizer() {
    try { this.rec?.remove(); } catch {}
    this.rec = new this.model.KaldiRecognizer(RATE, GRAMMAR);
    const hit = (m) => {
      const t = (m && m.result && (m.result.text || m.result.partial)) || '';
      if (this.state === 'idle' && hasWake(t)) this.wake();
    };
    this.rec.on('result', hit);
    this.rec.on('partialresult', (m) => { const t = m && m.result && m.result.partial; if (this.state === 'idle' && hasWake(t)) this.wake(); });
  }

  onAudio(chunk) {
    if (this.state === 'idle') {
      this.noise = trackNoise(this.noise || 0.004, rms(chunk));
      this.ring.push(chunk);
      try { this.rec.acceptWaveformFloat(chunk, RATE); } catch {}
    } else if (this.state === 'speaking' || this.state === 'thinking') {
      if (this.barge) { try { this.barge.acceptWaveformFloat(chunk, RATE); } catch {} }
      this.energyBarge(chunk);
    } else if (this.state === 'listening') {
      const now = performance.now();
      if (now >= (this.ignoreUntil || 0)) this.buf.push(chunk);
      this.onLevel?.(Math.min(1, (this.seg.level || 0) * 12));
      if (now < (this.ignoreUntil || 0)) return;
      const r = this.seg.feed(chunk);
      this.onLevel?.(Math.min(1, (this.seg.level || 0) * 12));
      if (r) this.finish(r.reason);
    }
  }

  /** Optional (Settings): cut in by simply talking. A sustained voice clearly louder than Artemis' own echo stops the reply and is heard as the next sentence. */
  energyBarge(chunk) {
    this.tail.push(chunk); if (this.tail.length > 4) this.tail.shift();
    if (this.bargeHit || !(this.canInterrupt && this.canInterrupt())) return;
    const level = rms(chunk);
    const limit = Math.max(0.045, this.echo * 2.6);
    if (level > limit) this.loud++;
    else { this.loud = 0; this.echo = this.echo * 0.9 + level * 0.1; }
    if (this.loud >= 2) {
      this.bargeHit = true; this.pre = this.tail.slice();
      log('info', 'sentinel', 'Interrupted by voice (you started talking)');
      this.onBarge?.();
    }
  }

  beep(freq = 880, ms = 110) {
    try {
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.frequency.value = freq; g.gain.value = 0.06; o.connect(g); g.connect(this.ctx.destination);
      o.start(); o.stop(this.ctx.currentTime + ms / 1000);
    } catch {}
  }

  /** Wake word heard: record the sentence that follows. */
  wake() {
    if (this.state !== 'idle') return;
    log('info', 'sentinel', 'Wake word heard');
    this.listen({ pre: this.ring.take(), wake: true });
  }

  /** Start recording a sentence (after the wake word, or right after the reply finished). */
  listen({ pre = [], wake = false, noSpeechMs, quiet = false } = {}) {
    if (!this.running) return;
    this.buf = [...pre];
    this.seg = new Segmenter({ noSpeechMs: noSpeechMs || (wake ? 7000 : 8000), noise: this.noise || 0.004, minRms: (this.getMinRms && this.getMinRms()) || 0.012 });
    this.ignoreUntil = quiet ? 0 : performance.now() + 260;
    if (!this.session && !quiet) this.beep(wake ? 880 : 660); // inside a conversation the pill is the only cue
    this.set('listening', { wake, session: !!this.session });
  }

  finish(reason) {
    const spoke = this.seg.hasSpeech;
    log('info', 'sentinel', `Recording ended (${reason}${spoke ? '' : ', no speech'}, ${(this.seg.ms / 1000).toFixed(1)}s)`);
    this.utterStart = performance.now() - this.seg.ms; // when this sentence began: tells whether it follows the reply closely
    const audio = concat(this.buf);
    this.buf = [];
    if (!spoke || reason === 'nospeech') { if (this.session) log('info', 'sentinel', 'Silent for 10 seconds: back to waiting for the wake phrase'); this.resume(); return; }
    this.set('thinking');
    this.onUtterance?.(encodeWav(audio, RATE));
  }

  /**
   * After a reply: in a conversation (started by the wake phrase) keep listening without it, until "bye bye" or 10 seconds of silence;
   * otherwise go back to waiting for the wake phrase.
   */
  next() {
    if (!this.running || this.state === 'listening') return;
    this.lastReplyEnd = performance.now();
    if (this.pre) { const pre = this.pre; this.pre = null; this.session = true; this.listen({ pre, noSpeechMs: SESSION_IDLE_MS, quiet: true }); return; }
    if (this.session) this.listen({ noSpeechMs: SESSION_IDLE_MS }); else this.resume();
  }

  /** Back to waiting for the wake word (this also ends the conversation). */
  resume() {
    if (!this.running) return;
    this.session = false;
    this.ring.clear();
    try { if (this.model) this.newRecognizer(); } catch {}
    this.set('idle');
  }

  /** The reply is being read aloud: ignore the microphone so Artemis does not hear itself. */
  speaking() { if (this.running) this.set('speaking'); }
  thinking() { if (this.running) this.set('thinking'); }

  stop() {
    this.running = false;
    try { this.proc && (this.proc.onaudioprocess = null, this.proc.disconnect()); } catch {}
    try { this.ctx && this.ctx.close(); } catch {}
    try { this.stream && this.stream.getTracks().forEach((t) => t.stop()); } catch {}
    try { this.rec && this.rec.remove(); } catch {}
    try { this.barge && this.barge.remove(); } catch {}
    this.barge = null;
    this.proc = this.ctx = this.stream = this.rec = this.model = null; // the loaded voice model stays in memory for the next start
    this.ring.clear(); this.buf = [];
    this.set('off');
  }
}
