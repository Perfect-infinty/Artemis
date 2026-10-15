// Pure helpers for Sentinel mode (no browser APIs, so they can be unit-tested in Node).
// Wake word detection is done by a small offline recogniser (Vosk) limited to a few words; no AI model or network is involved.

export const RATE = 16000;

// The wake phrase is "Wake up". The offline recogniser is limited to this phrase (and "hey"/"okay" in front of it).
export const WAKE_PHRASE = 'wake up';
export const WAKE_WORDS = ['wake up'];
export const GRAMMAR = JSON.stringify(['wake up', 'hey wake up', 'okay wake up', '[unk]']);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

// While Artemis is thinking or speaking the offline recogniser also listens for a few words that interrupt it.
export const BARGE_GRAMMAR = JSON.stringify(['stop', 'okay stop', 'stop it', 'enough', 'quiet', 'be quiet', 'shut up', 'cancel', 'wake up', 'hey wake up', '[unk]']);
export function hasBarge(text) { const t = norm(text); return !!t && /\b(wake up|stop|enough|quiet|cancel|shut up)\b/.test(t); }

/** True when the recogniser output contains the wake phrase. */
export function hasWake(text) {
  return /\bwake up\b/.test(norm(text));
}

// Talking to Artemis inside a conversation: the sentence starts with his name ("Artemis, open settings", "hey Artemis ...").
// Speech-to-text often spells the name differently, so a few common spellings count.
const NAMES = ['artemis', 'artemus', 'artemas', 'artemes', 'artemiss', 'artimis', 'artemis,', 'art amiss', 'our themis', 'artemist'];
/** Text after the name when the sentence starts with it (or with "Wake up"), otherwise null. */
export function afterName(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  let i = 0;
  if (words.length && ['hey', 'hi', 'ok', 'okay', 'yo'].includes(bare(words[0]))) i = 1;
  if (i < words.length && NAMES.includes(bare(words[i]))) return tidy(words.slice(i + 1));
  const w = matchWake(words);
  return w < 0 ? null : tidy(words.slice(w));
}

// How a speech-to-text model tends to write the spoken phrase "Wake up".
// STRONG spellings are unlikely in ordinary speech; WEAK ones are real English phrases (still only accepted at the very start).
const STRONG = ['wake up', 'wakeup', 'wake op', 'wake app', 'wake ap', 'weyk ap', 'veyk ap', 'weik ap', 'wake upp', 'wakap'];
const WEAK = ['weak up', 'wait up', 'wake of', 'wake a'];
const HEY = ['hey', 'hi', 'ok', 'okay', 'he', 'hee', 'hej'];
const deburr = (w) => w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const bare = (w) => deburr(w).replace(/[^a-z]/g, '');
// Where the phrase ends (index after its last word), or -1. It must be at the very start, or right after "hey" / "okay":
// "wake up" is also an ordinary English phrase, so it never counts later in a sentence.
function matchWake(words) {
  for (let i = 0; i < Math.min(words.length, 2); i++) {
    if (i === 1 && !HEY.includes(bare(words[0]))) break;
    const one = bare(words[i]); const two = i + 1 < words.length ? one + ' ' + bare(words[i + 1]) : '';
    if (two && (STRONG.includes(two) || WEAK.includes(two))) return i + 2;
    if (STRONG.includes(one)) return i + 1;
  }
  return -1;
}
const tidy = (words) => words.join(' ').replace(/^[\s,.:;!?\-\u2013\u2014]+/, '').trim();

/** Remove a leading "Wake up," / "Hey wake up" from a transcript. */
export function stripWake(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const end = matchWake(words);
  return end < 0 ? words.join(' ') : tidy(words.slice(end));
}

// Second check on the transcript of the recording. The offline recogniser only knows a few words and can mistake ordinary
// speech for the wake phrase, so the real speech-to-text must also hear it at the start.
/** Text after the wake phrase, or null when the transcript does not start with it (then the recording is ignored). */
export function afterWake(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const end = matchWake(words);
  return end < 0 ? null : tidy(words.slice(end));
}

// Speech-to-text often invents a few stock phrases from room noise. Inside a conversation these must not be sent as a message.
const NOISE = new Set(['you', 'thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'okay', 'ok', 'hmm', 'mm', 'uh', 'um', 'ah', 'oh']);
export function looksLikeNoise(text) {
  const t = deburr(String(text || '')).replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length < 2 || NOISE.has(t);
}

export function rms(f32) {
  let s = 0;
  for (let i = 0; i < f32.length; i++) s += f32[i] * f32[i];
  return Math.sqrt(s / (f32.length || 1));
}

/**
 * Decides when an utterance starts and ends from the signal level only.
 * feed(chunk) returns null, or { done: true, reason: 'silence' | 'nospeech' | 'max' } when the recording should stop.
 */
export class Segmenter {
  constructor({ rate = RATE, silenceMs = 850, noSpeechMs = 7000, maxMs = 40000, minRms = 0.012, factor = 3, noise = 0.004 } = {}) {
    Object.assign(this, { rate, silenceMs, noSpeechMs, maxMs, minRms, factor });
    this.noise = noise; this.ms = 0; this.quiet = 0; this.spoke = false; this.speechMs = 0;
  }
  get threshold() { return Math.max(this.minRms, this.noise * this.factor); }
  feed(chunk) {
    const ms = (chunk.length / this.rate) * 1000;
    const level = rms(chunk);
    this.ms += ms;
    this.level = level;
    if (level > this.threshold) { this.spoke = true; this.quiet = 0; this.speechMs += ms; }
    else {
      this.quiet += ms;
      if (!this.spoke || this.quiet > 400) this.noise = this.noise * 0.95 + level * 0.05; // learn the room noise only from silence
    }
    if (this.spoke && this.quiet >= this.silenceMs) return { done: true, reason: 'silence' };
    if (!this.spoke && this.ms >= this.noSpeechMs) return { done: true, reason: 'nospeech' };
    if (this.ms >= this.maxMs) return { done: true, reason: 'max' };
    return null;
  }
  /** Enough real speech to be worth sending to speech-to-text. */
  get hasSpeech() { return this.spoke && this.speechMs >= 250; }
}

/** Keeps the last `ms` of audio so the start of a sentence is not cut off. */
export class Ring {
  constructor(ms = 600, rate = RATE) { this.max = Math.round((ms / 1000) * rate); this.chunks = []; this.len = 0; }
  push(c) {
    this.chunks.push(c); this.len += c.length;
    while (this.chunks.length > 1 && this.len - this.chunks[0].length >= this.max) this.len -= this.chunks.shift().length;
  }
  take() { const out = this.chunks; this.chunks = []; this.len = 0; return out; }
  clear() { this.chunks = []; this.len = 0; }
}

export function concat(chunks) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** 16-bit mono PCM WAV. */
export function encodeWav(f32, rate = RATE) {
  const buf = new ArrayBuffer(44 + f32.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + f32.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, f32.length * 2, true);
  for (let i = 0; i < f32.length; i++) { const s = Math.max(-1, Math.min(1, f32[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Uint8Array(buf);
}

/** Strip Markdown so the voice does not read symbols. */
export function speakable(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' code block. ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/^[#>\-*+\s]+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D\u20E3\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu, '') // emoji are not read out ("smiling face with ...")
    .replace(/\s+/g, ' ').trim();
}

/**
 * Reading a reply while it is still being written. Call it with the whole text so far; it returns the new pieces
 * (whole sentences) that are ready to be spoken. st = { consumed: 0, spoken: 0, n: 0 } is kept between calls.
 * With final=true the rest is returned too. At most `cap` characters are spoken in total (the chat has the full text).
 */
export function takePieces(md, st, final = false, cap = 900) {
  let t = String(md || '');
  if ((t.match(/```/g) || []).length % 2 === 1) t = t.slice(0, t.lastIndexOf('```')); // a code block that is not closed yet
  const view = speakable(t);
  const out = [];
  let rest = view.slice(st.consumed);
  const take = (piece) => { st.consumed += piece.length; const p = piece.trim(); if (!p) return; out.push(p); st.spoken += p.length; st.n++; };
  for (;;) {
    if (st.spoken >= cap) { st.consumed = view.length; break; }
    const min = st.n === 0 ? 18 : 40;
    const re = /[.!?\u2026]+["\u201d')\]]*(\s|$)/g;
    let m; let cut = -1;
    while ((m = re.exec(rest))) {
      const end = m.index + m[0].length;
      if (!final && !/\s$/.test(m[0])) break; // the sentence may still go on ("3.5")
      if (end >= min) { cut = end; break; }
    }
    // The very first piece: do not wait for a full stop in a long opening sentence, start at a comma.
    if (cut < 0 && !final && st.n === 0) { const c = /[,;:\u2014]\s/.exec(rest.slice(26)); if (c) cut = 26 + c.index + 1; }
    if (cut < 0) break;
    take(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  if (final && st.spoken < cap && rest.trim()) take(rest);
  return out;
}

/** Shorten a reply for reading aloud: whole sentences, at most `max` characters. The full text stays in the chat. */
export function spokenPart(text, max = 900) {
  const t = String(text || '').trim();
  if (t.length <= max) return { text: t, cut: false };
  const head = t.slice(0, max);
  const i = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '), head.lastIndexOf('\n'));
  return { text: (i > max * 0.5 ? head.slice(0, i + 1) : head).trim(), cut: true };
}

export const VOICE_HINT = 'The user is talking to you by voice (Sentinel mode) and will hear your answer read aloud as well as read it. Answer in the language they used. Keep it short and natural to listen to: a few sentences, no tables, no long lists, no code unless they ask. If a long result is needed, put it in the chat and give a short spoken summary.';

/** Running estimate of the room noise: drops fast when it gets quieter, rises slowly when it gets louder. */
export function trackNoise(noise, level) {
  return level < noise ? noise * 0.8 + level * 0.2 : noise + (level - noise) * 0.01;
}
