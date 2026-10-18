// Natural pacing for the reading voice (Settings → Voice → Natural pacing). Pure helpers, no browser APIs, so Node tests can import them.
// The speaker leaves a short silence on the audio timeline after each piece, longer after a question or a paragraph than after a
// comma, and varies it a little so it does not sound mechanical. "expressive" also varies the speed per sentence.

export const PACING_MODES = ['off', 'subtle', 'expressive'];
/** The pacing setting, with "subtle" as the default. */
export const pacingMode = (v) => (v === 'off' || v === 'expressive' ? v : 'subtle');

/** Base pause after a piece, by how it ends (ms). */
export const PAUSE_MS = { para: 650, ellipsis: 450, question: 360, exclaim: 300, period: 260, colon: 220, comma: 120 };
/** Extra pause before an emotionally tagged sentence (expressive only). */
export const EMOTION_LEAD_MS = 180;

/** How a piece ends: 'ellipsis' | 'question' | 'exclaim' | 'period' | 'colon' | 'comma' | '' (cut mid-sentence). */
export function endingOf(text) {
  const s = String(text || '').replace(/["”’')\]\s]+$/, '');
  if (/(…|\.\.\.|[—–])$/.test(s)) return 'ellipsis';
  if (/\?$/.test(s)) return 'question';
  if (/!$/.test(s)) return 'exclaim';
  if (/\.$/.test(s)) return 'period';
  if (/[:;]$/.test(s)) return 'colon';
  if (/,$/.test(s)) return 'comma';
  return '';
}

/** ms randomized by ±25%. */
export const jitter = (ms, rnd = Math.random) => Math.round(ms * (0.75 + 0.5 * rnd()));

/** Silence after a piece (ms): 0 when pacing is off. para = the piece ends a paragraph. */
export function pauseAfter(text, { para = false, mode = 'subtle' } = {}, rnd = Math.random) {
  const m = pacingMode(mode);
  if (m === 'off') return 0;
  const base = para ? PAUSE_MS.para : PAUSE_MS[endingOf(text)] || 0;
  return base ? jitter(base * (m === 'expressive' ? 1.5 : 1), rnd) : 0;
}

/** Extra silence before a piece with an emotion tag (expressive only). */
export const pauseBefore = (emotion, mode, rnd = Math.random) => (pacingMode(mode) === 'expressive' && emotion ? jitter(EMOTION_LEAD_MS, rnd) : 0);

/** Expressive: the reading speed varies by ±3% per sentence, never below 0.85 or above 1.15 of the user's speed. */
export function paceRate(userRate, mode, rnd = Math.random) {
  const r = Number(userRate) || 1;
  if (pacingMode(mode) !== 'expressive') return r;
  const v = r * (0.97 + 0.06 * rnd());
  return Math.round(Math.min(r * 1.15, Math.max(r * 0.85, v)) * 1000) / 1000;
}

/** Added to the system prompt when "Thinking out loud" is on and the answer is read aloud. */
export const THINKING_HINT = 'Because your answer is heard, you may sound a little more like natural speech: when a question asks you to reflect or weigh something, you may start with "Hmm," or "Well," and you may use "…" for a brief pause. Do this sparingly, at most once or twice per answer and only where a person would naturally pause; never inside code, lists or tables.';
