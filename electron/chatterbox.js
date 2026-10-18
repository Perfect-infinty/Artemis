// Client for a self-hosted Chatterbox TTS server (devnen/Chatterbox-TTS-Server, default http://localhost:8004).
// The server has its own POST /tts (emotion "exaggeration", cfg_weight, predefined voices) and an OpenAI-compatible
// POST /v1/audio/speech. Its exact fields differ between versions, so the client is defensive:
//  - it reads /openapi.json once (when the server has one) and sends only the fields the schema lists for that endpoint;
//  - it tries /tts first; on 404/405/422 it falls back to /v1/audio/speech (on 422 there, it retries without the extra
//    emotion fields); what worked is remembered for the session and logged once.
// No Electron here (fetch and logger are injected), so it can be tested in Node against a fake server.

const TTS = '/tts';
const V1 = '/v1/audio/speech';
const V1_EXTRAS = ['exaggeration', 'cfg_weight', 'temperature', 'seed'];
const SCHEMA_RETRY_MS = 60000;

/** Follows "$ref": "#/components/schemas/X" inside an OpenAPI document. */
function resolveRef(doc, s, depth = 0) {
  if (!s || typeof s !== 'object' || depth > 8) return s;
  if (typeof s.$ref === 'string' && s.$ref.startsWith('#/')) {
    let o = doc;
    for (const k of s.$ref.slice(2).split('/')) o = o && o[k.replace(/~1/g, '/').replace(/~0/g, '~')];
    return resolveRef(doc, o, depth + 1);
  }
  return s;
}

/** Property names of an endpoint's JSON request body according to the schema, or null when the schema does not say. */
function bodyProps(doc, path) {
  const op = doc && doc.paths && doc.paths[path] && doc.paths[path].post;
  const content = op && op.requestBody && resolveRef(doc, op.requestBody).content;
  if (!content) return null;
  const media = content['application/json'] || Object.values(content)[0];
  const names = new Set();
  const walk = (s, d = 0) => {
    s = resolveRef(doc, s);
    if (!s || typeof s !== 'object' || d > 6) return;
    if (s.properties) for (const k of Object.keys(s.properties)) names.add(k);
    for (const k of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(s[k])) s[k].forEach((x) => walk(x, d + 1));
  };
  walk(media && media.schema);
  return names.size ? [...names] : null;
}
const hasPost = (doc, path) => !!(doc && doc.paths && doc.paths[path] && doc.paths[path].post);

/** The request body from the wanted fields: empty values dropped, and with a schema only the fields it lists. */
function buildBody(fields, props) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined || v === null || v === '') continue;
    if (props && !props.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Fields for the server's own /tts endpoint. A voice "clone:<file>" uses a reference audio file instead of a predefined voice. */
function ttsFields(text, p = {}) {
  const voice = String(p.voice || '').trim();
  const clone = /^clone:/i.test(voice);
  const speed = Number(p.speed) || 1;
  return {
    text,
    voice_mode: voice ? (clone ? 'clone' : 'predefined') : undefined,
    predefined_voice_id: voice && !clone ? voice : undefined,
    reference_audio_filename: clone ? voice.slice(6) : undefined,
    output_format: 'wav',
    split_text: text.length > 150,
    chunk_size: 120,
    temperature: p.temperature,
    exaggeration: p.exaggeration,
    cfg_weight: p.cfg_weight,
    seed: p.seed,
    speed_factor: Math.abs(speed - 1) > 0.005 ? speed : undefined,
    language: p.language || 'en'
  };
}

/** Fields for the OpenAI-compatible endpoint (the emotion fields are extras a server may refuse). */
function v1Fields(text, p = {}, plain = false) {
  const voice = String(p.voice || '').trim().replace(/^clone:/i, '');
  const f = { model: p.model || 'chatterbox', input: text, voice: voice || undefined, response_format: 'wav', speed: Number(p.speed) || 1 };
  if (!plain) { f.exaggeration = p.exaggeration; f.cfg_weight = p.cfg_weight; f.temperature = p.temperature; f.seed = p.seed; }
  return f;
}

/** A voice list in any of the usual shapes: ["a.wav"], [{ filename, display_name }], { voices: [...] }, { data: [...] }. */
function normVoices(j) {
  const arr = Array.isArray(j) ? j : (j && (j.voices || j.data || j.predefined_voices || j.items)) || [];
  const out = [];
  for (const v of Array.isArray(arr) ? arr : []) {
    if (typeof v === 'string') { if (v.trim()) out.push({ id: v, label: v }); continue; }
    if (!v || typeof v !== 'object') continue;
    const id = v.filename || v.file || v.voice_id || v.id || v.name;
    if (id) out.push({ id: String(id), label: String(v.display_name || v.name || id) });
  }
  return out;
}

function createChatterbox({ fetch, logger } = {}) {
  const log = (lvl, m) => { try { logger && logger[lvl] && logger[lvl]('voice', m); } catch {} };
  const servers = new Map(); // base URL -> { schema, schemaAt, schemaP, mode, plain, used, voice }
  const srv = (base) => { let s = servers.get(base); if (!s) servers.set(base, (s = { schema: undefined, schemaAt: 0, schemaP: null, mode: '', plain: false, used: '', voice: '' })); return s; };
  const post = (url, body, signal) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'audio/wav, audio/*' }, body: JSON.stringify(body), signal });

  /** The server's OpenAPI document (null when it has none). Not cached while the server is unreachable. */
  async function schemaOf(base) {
    const s = srv(base);
    if (s.schema !== undefined && (s.schema || Date.now() - s.schemaAt < SCHEMA_RETRY_MS)) return s.schema;
    if (!s.schemaP) {
      s.schemaP = (async () => {
        try {
          const r = await fetch(base + '/openapi.json', { signal: AbortSignal.timeout(4000) });
          const j = r.ok ? await r.json().catch(() => null) : null;
          s.schema = j && j.paths ? j : null; s.schemaAt = Date.now();
          if (s.schema) log('info', `Chatterbox schema read: /tts ${hasPost(s.schema, TTS) ? 'found' : 'missing'}, ${V1} ${hasPost(s.schema, V1) ? 'found' : 'missing'}`);
        } catch { /* unreachable: try again next time */ }
        return s.schema || null;
      })().finally(() => { s.schemaP = null; });
    }
    return s.schemaP;
  }

  /** The voices the server offers: [{ id, label }]. */
  async function voices(base) {
    let lastErr = '';
    for (const p of ['/get_predefined_voices', '/v1/audio/voices', '/voices']) {
      try {
        const r = await fetch(base + p, { signal: AbortSignal.timeout(6000) });
        if (!r.ok) { await r.text().catch(() => ''); continue; }
        const list = normVoices(await r.json().catch(() => null));
        if (list.length) return { ok: true, voices: list, source: p };
      } catch (e) {
        if (e && e.cause && e.cause.code === 'ECONNREFUSED') return { ok: false, error: 'The Chatterbox server is not running at that address.' };
        lastErr = (e && e.message) || String(e);
      }
    }
    return { ok: false, error: lastErr || 'The server did not list any voices.' };
  }

  const remember = (s, mode, body, schema) => {
    const used = mode + ':' + Object.keys(body).sort().join(',');
    s.mode = mode;
    if (s.used !== used) { s.used = used; log('info', `Chatterbox: using ${mode === 'tts' ? TTS : V1} with ${Object.keys(body).filter((k) => k !== 'text' && k !== 'input').join(', ')}${schema ? ' (fields from the server schema)' : ''}`); }
  };

  /**
   * Makes one piece of speech. p = { voice, exaggeration, cfg_weight, temperature, speed, seed, language }.
   * Returns the fetch Response (audio when ok; the last failed answer otherwise) with .endpoint set.
   */
  async function speak(base, text, p = {}, signal) {
    const s = srv(base);
    const schema = await schemaOf(base);
    const params = { ...p };
    if (!String(params.voice || '').trim()) { // no voice chosen: the first one the server lists (its predefined mode needs one)
      if (!s.voice) { const v = await voices(base).catch(() => null); if (v && v.ok) s.voice = v.voices[0].id; }
      params.voice = s.voice;
    }
    let order = s.mode === 'v1' ? ['v1', 'tts'] : ['tts', 'v1'];
    if (schema) { const known = order.filter((m) => hasPost(schema, m === 'tts' ? TTS : V1)); if (known.length) order = known; }
    let last = null;
    for (const mode of order) {
      if (mode === 'tts') {
        const body = buildBody(ttsFields(text, params), schema ? bodyProps(schema, TTS) : null);
        const res = await post(base + TTS, body, signal);
        res.endpoint = TTS;
        if (res.ok) { remember(s, 'tts', body, schema); return res; }
        if (![404, 405, 422].includes(res.status)) return res;
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        log('info', `Chatterbox ${TTS} answered HTTP ${res.status}${detail ? ': ' + detail : ''}; trying ${V1}`);
        res.detail = detail; last = res; continue;
      }
      const props = schema ? bodyProps(schema, V1) : null;
      let body = buildBody(v1Fields(text, params, s.plain), props);
      let res = await post(base + V1, body, signal);
      if (res.status === 422 && !props && !s.plain && V1_EXTRAS.some((k) => k in body)) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        log('info', `Chatterbox ${V1} refused the emotion fields (HTTP 422${detail ? ': ' + detail : ''}); retrying without them`);
        s.plain = true;
        body = buildBody(v1Fields(text, params, true), props);
        res = await post(base + V1, body, signal);
      }
      res.endpoint = V1;
      if (res.ok) { remember(s, 'v1', body, schema); return res; }
      return res;
    }
    return last;
  }

  return { speak, voices, schemaOf, state: (base) => srv(base) };
}

module.exports = { createChatterbox, buildBody, bodyProps, ttsFields, v1Fields, normVoices, resolveRef };
