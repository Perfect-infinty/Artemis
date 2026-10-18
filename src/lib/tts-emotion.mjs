// Emotion tags for the voice ("[warm] I'm glad you asked."). Pure helpers, no browser APIs, so Node tests can import them.
// The model may start an emotionally important sentence with one tag. The tag is never read aloud and never shown in the chat:
// it only changes how that sentence is spoken (Chatterbox: emotion settings; Kokoro: a little slower, after a short pause).

export const EMOTIONS = ['warm', 'soft', 'excited', 'sad', 'serious'];
const NAMES = EMOTIONS.join('|');
/** A tag anywhere in a text (not a Markdown link "[warm](...)" or a link reference "[warm]: ..."). */
export const TAG_RE = new RegExp(`\\[(${NAMES})\\](?![(:])[ \\t]*`, 'gi');
const LEAD_RE = new RegExp(`^\\s*\\[(${NAMES})\\](?![(:])\\s*`, 'i');
// a tag still being written at the very end of a streaming text: "[", "[wa", "[warm"
const PARTIAL_RE = /\[[a-z]{0,7}$/i;

/** Chatterbox settings per emotion: exaggeration (0.25-2), cfg_weight (0-1), optional speed factor. */
export const EMOTION_PARAMS = {
  warm: { exaggeration: 0.9, cfg: 0.4 },
  soft: { exaggeration: 0.8, cfg: 0.35, speed: 0.92 },
  excited: { exaggeration: 1.3, cfg: 0.5 },
  sad: { exaggeration: 0.7, cfg: 0.3, speed: 0.9 },
  serious: { exaggeration: 0.4, cfg: 0.6 }
};

/** Leading tag of a piece: { emotion: 'warm' | '', text } (the text without the tag). */
export function parseTag(text) {
  const s = String(text == null ? '' : text);
  const m = LEAD_RE.exec(s);
  return m ? { emotion: m[1].toLowerCase(), text: s.slice(m[0].length) } : { emotion: '', text: s };
}

/** Removes every tag outside code (fenced blocks and inline code). partial = also a half-written tag at the end (streaming). */
export function stripTags(md, { partial = false } = {}) {
  const s = String(md == null ? '' : md);
  if (!s.includes('[')) return s;
  // fenced code (an unclosed fence runs to the end) and inline code stay as they are
  const parts = s.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/);
  let out = parts.map((p, i) => (i % 2 ? p : p.replace(TAG_RE, ''))).join('');
  if (partial) {
    const m = PARTIAL_RE.exec(out);
    if (m && EMOTIONS.some((e) => ('[' + e).startsWith(m[0].toLowerCase()))) out = out.slice(0, m.index);
  }
  return out;
}

const num = (v, lo, hi, d) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? d : Math.min(hi, Math.max(lo, n)); };

/**
 * Chatterbox request settings for one piece. base = the user's sliders { exaggeration, cfg, temperature, speed };
 * untagged pieces use them as they are, a tag replaces exaggeration / cfg and scales the speed. rate = the app's reading speed.
 */
export function cbParams(emotion, base = {}, rate = 1) {
  const e = EMOTION_PARAMS[emotion] || null;
  const speed = num(base.speed, 0.5, 2, 1) * (e && e.speed ? e.speed : 1) * num(rate, 0.5, 2, 1);
  return {
    exaggeration: e ? e.exaggeration : num(base.exaggeration, 0.25, 2, 0.5),
    cfg_weight: e ? e.cfg : num(base.cfg, 0, 1, 0.5),
    temperature: num(base.temperature, 0.05, 2, 0.8),
    speed: Math.round(num(speed, 0.5, 2, 1) * 100) / 100
  };
}

/** Kokoro (or the computer voice) has no emotion settings: a tagged piece is read a little slower, after a short pause. */
export function plainAdjust(emotion) {
  return emotion && EMOTION_PARAMS[emotion] ? { rate: 0.9, pauseMs: 250 } : { rate: 1, pauseMs: 0 };
}

export const EMOTION_HINT = 'Your answer is read aloud. Where real emotion matters (comfort, good news, sympathy, a serious warning), you may start that one sentence with one tag: [warm], [soft], [excited], [sad] or [serious], e.g. "[soft] I\'m here." Use tags sparingly, at most one per sentence and only for a few sentences; most answers need none. Never explain, mention or put tags inside code.';
