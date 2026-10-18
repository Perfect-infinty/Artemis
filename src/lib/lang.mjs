// Spoken-language helpers for the voice features: which language the user spoke or a reply is written in,
// the hidden reply-language instruction, and which voice engine can speak a language. Pure ESM (tested by scripts/test-voice.js).

/** The languages offered in Settings → Voice → Language ('auto' first). Whisper takes these ISO-639-1 codes. */
export const VOICE_LANGS = [
  ['auto', 'Auto-detect (recommended)'], ['en', 'English'], ['tr', 'Turkish'], ['az', 'Azerbaijani'], ['ru', 'Russian'],
  ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'],
  ['pl', 'Polish'], ['uk', 'Ukrainian'], ['ar', 'Arabic'], ['fa', 'Persian'], ['hi', 'Hindi'], ['ja', 'Japanese'],
  ['zh', 'Chinese'], ['ko', 'Korean']
];
const NAMES = Object.fromEntries(VOICE_LANGS.slice(1));
// Extra names for languages the detector knows but Settings does not list.
Object.assign(NAMES, { el: 'Greek', he: 'Hebrew', th: 'Thai', ka: 'Georgian', hy: 'Armenian' });
/** English name of a language code ('' when unknown). */
export const langName = (code) => NAMES[baseLang(code)] || '';
/** 'en-GB' -> 'en', 'TR' -> 'tr'. */
export const baseLang = (code) => String(code || '').trim().toLowerCase().split(/[-_]/)[0];

/** What a speech-to-text server reports ("turkish", "Turkish", "tr", "tr-TR") as a code; '' when unknown or 'auto'. */
export function normLang(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || s === 'auto') return '';
  for (const [code, name] of Object.entries(NAMES)) if (name.toLowerCase() === s) return code;
  const b = baseLang(s);
  return /^[a-z]{2,3}$/.test(b) ? b : '';
}

// ---- guessing the language of a text ----
// Common short words per Latin-script language. A hit counts once per word in the text.
const WORDS = {
  en: 'the and is are you to of it that this what how for with my your can do be have in on not was will please hello yes no i me we they there here thanks',
  tr: 've bir bu şu ne nasıl için ile ben sen biz siz de da mi mı mu mü değil var yok çok gibi ama evet hayır merhaba lütfen neden nerede daha şey bana sana bugün teşekkür ederim olarak bunu şimdi nedir',
  az: 'və bir bu nə necə üçün ilə mən sən biz siz də da deyil var yox çox kimi amma bəli xeyr salam zəhmət niyə harada daha mənə sənə bugün təşəkkür edirəm olaraq bunu indi nədir',
  de: 'der die das und ist nicht ich du sie es ein eine mit auf für wie was sind haben auch aber bitte danke hallo heute ja nein wir ihr mein dein',
  fr: 'le la les et est un une des je tu vous nous il elle pas que qui pour avec dans ce bonjour merci oui non comment quoi très mais aussi',
  es: 'el la los las y es un una que no por para con yo tú usted cómo qué está hola gracias sí muy pero también estoy',
  it: 'il lo gli e è un una che non per con io tu sono come cosa ciao grazie sì molto ma anche questo',
  pt: 'o os as e é um uma que não por para com eu você como está olá obrigado obrigada sim muito mas também isso',
  nl: 'de het een en is niet ik je jij wat hoe met voor van dat die hallo dank ja nee wij zijn',
  pl: 'i w nie to jest się na że z co jak ja ty czy dzień dobry dziękuję tak',
};
const WORDSET = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));
// Letters that point to a language: [regex, { lang: points per occurrence }].
const LETTERS = [
  [/ə/g, { az: 4 }],
  [/[ığş]/g, { tr: 1.5, az: 1 }],
  [/[çöü]/g, { tr: 0.4, az: 0.4, de: 0.3, fr: 0.1, pt: 0.1 }],
  [/ß/g, { de: 3 }], [/ä/g, { de: 1.5 }],
  [/[ñ¿¡]/g, { es: 3 }], [/[áíóú]/g, { es: 0.5, pt: 0.4, it: 0.1 }],
  [/[ãõ]/g, { pt: 3 }], [/[êâô]/g, { pt: 0.5, fr: 0.6 }],
  [/[èàùîûëïœ]/g, { fr: 0.8, it: 0.3 }], [/[ìò]/g, { it: 1 }],
  [/[ąęłńśźż]/g, { pl: 3 }], [/ij/g, { nl: 0.5 }],
];
// Scripts other than Latin: the first that makes up a good part of the letters decides.
const SCRIPTS = [
  [/[Ѐ-ӿ]/g, (t) => (/[іїєґ]/i.test(t) ? 'uk' : 'ru')],
  [/[؀-ۿ]/g, (t) => (/[پچژگ]/.test(t) ? 'fa' : 'ar')],
  [/[぀-ヿ]/g, () => 'ja'],
  [/[가-힯ᄀ-ᇿ]/g, () => 'ko'],
  [/[一-鿿]/g, () => 'zh'],
  [/[ऀ-ॿ]/g, () => 'hi'],
  [/[Ͱ-Ͽ]/g, () => 'el'],
  [/[֐-׿]/g, () => 'he'],
  [/[฀-๿]/g, () => 'th'],
  [/[Ⴀ-ჿ]/g, () => 'ka'],
  [/[԰-֏]/g, () => 'hy'],
];

/** Points per language for a text (exported for tests and debugging). */
export function langScores(text) {
  const t = String(text || '').toLowerCase();
  const sc = {};
  const add = (l, n) => { sc[l] = (sc[l] || 0) + n; };
  for (const w of t.match(/\p{L}+/gu) || []) for (const l in WORDSET) if (WORDSET[l].has(w)) add(l, 1);
  for (const [re, pts] of LETTERS) { const n = (t.match(re) || []).length; if (n) for (const l in pts) add(l, n * pts[l]); }
  // the Turkish dotless ı / ğ / ş also exist in Azerbaijani: ə (very common there, absent in Turkish) or x / q decide
  if (sc.az && !/ə/.test(t)) sc.az *= 0.5;
  return sc;
}

/**
 * The language a text is written in, as a code ('tr', 'az', 'ru', 'en' …), or '' when it is too short or unclear.
 * A small script / letter / common-word heuristic: good for a spoken sentence or a reply, not for a single word.
 */
export function detectTextLang(text) {
  const t = String(text || '');
  const letters = (t.match(/\p{L}/gu) || []).length;
  if (letters < 2) return '';
  for (const [re, pick] of SCRIPTS) { const n = (t.match(re) || []).length; if (n && n / letters >= 0.3) return pick(t); }
  const sc = langScores(t);
  const ranked = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return '';
  const [best, top] = ranked[0]; const second = ranked[1] ? ranked[1][1] : 0;
  if (top < 1 || top < second * 1.4 || top - second < 0.5) return '';
  return best;
}

/** The hidden instruction for the model when the user spoke a language other than English ('' otherwise). */
export function replyLangHint(code) {
  const n = langName(code);
  if (!n || baseLang(code) === 'en') return '';
  return `The user spoke ${n}; answer in ${n}.`;
}

// ---- which engine speaks a language ----
/** Kokoro voices per language (first letter of a Kokoro voice = its language). English uses the voice chosen in Settings. */
export const KOKORO_VOICES = { en: '', es: 'ef_dora', fr: 'ff_siwis', it: 'if_sara', pt: 'pf_dora', ja: 'jf_alpha', zh: 'zf_xiaobei', hi: 'hf_alpha' };
const KOKORO_PREFIX = { en: 'ab', es: 'e', fr: 'f', it: 'i', pt: 'p', ja: 'j', zh: 'z', hi: 'h' };
const ENGINE_NAME = { openai: 'Kokoro', chatterbox: 'Chatterbox', piper: 'Piper' };
/** True when `voice` is a Kokoro voice for that language (by its first letter). */
export const kokoroVoiceFits = (voice, lang) => { const p = KOKORO_PREFIX[baseLang(lang)]; return !!(p && voice && /^[a-z]{2}_/i.test(voice) && p.includes(voice[0].toLowerCase())); };

/**
 * Which engine and voice read a piece in `lang` ('' = unknown, treated as English).
 * engine: the engine chosen in Settings ('system' | 'openai' (Kokoro) | 'chatterbox' | 'piper'); voice: its voice (Kokoro);
 * voices: the per-language Kokoro voices from Settings. Returns { engine, voice, lang, reason }: engine 'system' = the
 * computer voice for that language (the server cannot speak it; this is not a failure).
 */
export function routeVoice({ lang = '', engine = 'system', voice = '', voices = {} } = {}) {
  const L = baseLang(lang);
  if (engine !== 'openai' && engine !== 'chatterbox' && engine !== 'piper') return { engine: 'system', voice: '', lang: L, reason: '' };
  if (!L || L === 'en') return { engine, voice: engine === 'openai' ? (voice || 'af_heart') : '', lang: L, reason: '' };
  if (engine === 'openai' && L in KOKORO_VOICES) {
    const own = voices && typeof voices[L] === 'string' ? voices[L].trim() : '';
    const v = own || (kokoroVoiceFits(voice, L) ? voice : KOKORO_VOICES[L]);
    return { engine: 'openai', voice: v, lang: L, reason: '' };
  }
  return { engine: 'system', voice: '', lang: L, reason: `${ENGINE_NAME[engine]} has no ${langName(L) || L} voice` };
}

// ---- per-language engine map (Settings → Voice → Voices per language) ----
/** Engines a language can be routed to. 'default' = the main engine chosen in Settings (with the Kokoro voice map above). */
export const LANG_ENGINES = [['default', 'Default (main engine)'], ['openai', 'OpenAI-compatible (Kokoro, Edge TTS…)'], ['piper', 'Piper'], ['chatterbox', 'Chatterbox'], ['system', 'Computer voice']];
const ENGINE_IDS = new Set(LANG_ENGINES.map(([id]) => id));
/** Where a Piper server for another language listens when no address is set (the main Piper server keeps port 5000). */
export const PIPER_LANG_URL = 'http://localhost:5100';
/** The suggested Piper voice per language, shown as a placeholder (official piper-voices names). */
export const PIPER_VOICES = { tr: 'tr_TR-dfki-medium', az: 'tr_TR-dfki-medium', en: 'en_US-lessac-medium', de: 'de_DE-thorsten-medium', ru: 'ru_RU-irina-medium', fr: 'fr_FR-siwis-medium', es: 'es_ES-davefx-medium', it: 'it_IT-riccardo-x_low', pt: 'pt_BR-faber-medium', uk: 'uk_UA-ukrainian_tts-medium', pl: 'pl_PL-gosia-medium', nl: 'nl_NL-mls-medium', fa: 'fa_IR-amir-medium', ar: 'ar_JO-kareem-medium', zh: 'zh_CN-huayan-medium' };
/** Notes shown under a language row (no local voice exists, or what to install). */
export const LANG_NOTES = {
  tr: 'Install Piper with a Turkish voice (e.g. tr_TR-dfki-medium) and choose Piper here.',
  az: 'No local Azerbaijani voice exists; a Turkish voice is the closest. Install Piper with a Turkish voice and choose Piper here.'
};
/** An address the main process accepts: http(s), no spaces. '' when empty or invalid. */
export const okUrl = (u) => { const s = String(u || '').trim().replace(/\/+$/, ''); return /^https?:\/\/[^\s/?#]+(\/[^\s]*)?$/i.test(s) && s.length <= 300 ? s : ''; };
/** A voice name the main process accepts (Kokoro "ef_dora" / "af_heart+af_bella", Piper "tr_TR-dfki-medium", Chatterbox "Emily.wav" / "clone:x.wav"). */
export const okVoiceName = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.+():-]{1,100}$/.test(v.trim()) ? v.trim() : '');

/** One map entry, cleaned: { engine, url, voice }. */
export function normLangEntry(e) {
  const o = e && typeof e === 'object' ? e : {};
  return { engine: ENGINE_IDS.has(o.engine) ? o.engine : 'default', url: String(o.url || '').trim(), voice: String(o.voice || '').trim() };
}
/**
 * The per-language map from the settings: `voiceLangMap` ({ tr: { engine: 'piper', url, voice } }), with the older
 * `ttsVoices` ({ es: 'em_santa' }, Kokoro voices) read as { engine: 'default', voice } for languages the new map does not list.
 */
export function langMapFrom(st) {
  const s = st || {}; const out = {};
  const old = s.ttsVoices && typeof s.ttsVoices === 'object' ? s.ttsVoices : {};
  for (const [l, v] of Object.entries(old)) if (typeof v === 'string' && v.trim()) out[baseLang(l)] = { engine: 'default', url: '', voice: v.trim() };
  const map = s.voiceLangMap && typeof s.voiceLangMap === 'object' ? s.voiceLangMap : {};
  for (const [l, e] of Object.entries(map)) out[baseLang(l)] = normLangEntry(e);
  return out;
}

/**
 * Which engine, server and voice read a piece in `lang`, from the per-language map.
 * main = { engine, voice, voices } (the main engine and its Kokoro voice / old voice map); map = langMapFrom(settings).
 * Returns { engine, url, voice, lang, reason, custom, key }: engine 'system' = the computer voice for that language;
 * url '' = the main engine's own address; custom = a per-language choice (its failure never stops the main server);
 * key = which server it uses (requests are queued and marked failed per key).
 */
export function routeLang({ lang = '', main = {}, map = {} } = {}) {
  const L = baseLang(lang); const ml = L || 'en';
  const mainEngine = main.engine || 'system';
  const e = normLangEntry(map && map[ml]);
  const sys = (reason = '') => ({ engine: 'system', url: '', voice: '', lang: L, reason, custom: e.engine !== 'default', key: 'system' });
  if (e.engine === 'default') {
    const voices = { ...(main.voices || {}) };
    if (e.voice) voices[ml] = e.voice;
    const r = routeVoice({ lang: L, engine: mainEngine, voice: main.voice, voices });
    if (r.engine === 'system') return { ...r, url: '', custom: false, key: 'system' };
    return { ...r, url: '', custom: false, key: 'main' };
  }
  if (e.engine === 'system') return sys();
  const url = okUrl(e.url);
  if (e.url && !url) return sys(`The ${langName(ml) || ml} voice server address is not valid`);
  const voice = okVoiceName(e.voice);
  let out;
  if (e.engine === 'openai') {
    const v = voice || (ml === 'en' ? (main.voice || 'af_heart') : (KOKORO_VOICES[ml] || ''));
    if (!v) return sys(`No Kokoro voice is set for ${langName(ml) || ml}`);
    out = { engine: 'openai', url, voice: v };
  } else if (e.engine === 'piper') {
    out = { engine: 'piper', url: url || (mainEngine === 'piper' ? '' : PIPER_LANG_URL), voice };
  } else out = { engine: 'chatterbox', url, voice };
  // the same engine and address as the main engine: the main server (shares its queue; its failure is the main failure)
  const custom = !(out.engine === mainEngine && !out.url);
  return { ...out, lang: L, reason: '', custom, key: custom ? `${out.engine}|${out.url}` : 'main' };
}

/** Sample text for the per-language voice test in Settings. Data, not UI text: each sentence is in its own language. */
export const VOICE_TEST_SAMPLES = {
  en: 'Hello, this is the English voice test.',
  tr: 'Merhaba, bu Türkçe ses testi.',
  az: 'Salam, bu Azərbaycan dilində səs testidir.',
  ru: 'Привет, это проверка русского голоса.',
  de: 'Hallo, das ist der deutsche Stimmtest.',
  fr: 'Bonjour, ceci est le test de la voix française.',
  es: 'Hola, esta es la prueba de voz en español.',
  it: 'Ciao, questo è il test della voce italiana.',
  pt: 'Olá, este é o teste de voz em português.',
  nl: 'Hallo, dit is de Nederlandse stemtest.',
  pl: 'Cześć, to jest test polskiego głosu.',
  uk: 'Привіт, це перевірка українського голосу.',
  ar: 'مرحبا، هذا اختبار الصوت العربي.',
  fa: 'سلام، این آزمایش صدای فارسی است.',
  hi: 'नमस्ते, यह हिंदी आवाज़ का परीक्षण है।',
  ja: 'こんにちは、これは日本語の音声テストです。',
  zh: '你好，这是中文语音测试。',
  ko: '안녕하세요, 한국어 음성 테스트입니다.'
};
