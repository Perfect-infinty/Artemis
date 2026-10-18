// Client for a local Piper voice server. Two kinds are in use:
//  - the older custom server: POST <url>/synthesize with JSON { text, length_scale, voice } -> WAV;
//  - the official server from the piper-tts package (python -m piper.http_server): POST <url>/ with the same JSON -> WAV,
//    and GET <url>/voices listing the installed voices.
// /synthesize is tried first; on 404/405 the root path is tried. The path that worked is remembered per address.
// No Electron here (fetch and logger are injected), so it can be tested in Node against a fake server.

const PATHS = ['/synthesize', '/'];

/** A voice list in any of the usual shapes: ["a"], [{ name | id | key }], { voices: [...] }, { "<id>": {...config} }. */
function normPiperVoices(j) {
  let arr = Array.isArray(j) ? j : (j && Array.isArray(j.voices) ? j.voices : null);
  if (!arr && j && typeof j === 'object') arr = Object.keys(j);
  const out = [];
  for (const v of arr || []) {
    const id = typeof v === 'string' ? v : v && (v.name || v.id || v.key || v.voice);
    if (typeof id === 'string' && id.trim() && !out.includes(id.trim())) out.push(id.trim());
  }
  return out;
}

function createPiper({ fetch, logger } = {}) {
  const works = new Map(); // base -> the path that answered
  const post = (base, path, body, signal) => fetch(base + (path === '/' ? '/' : path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  /** One read: resolves to the fetch Response (with .endpoint = the path used). body = { text, length_scale, voice? }. */
  async function speak(base, body, signal) {
    const known = works.get(base);
    const order = known ? [known, ...PATHS.filter((p) => p !== known)] : PATHS;
    let res = null;
    for (const path of order) {
      res = await post(base, path, body, signal);
      if (res.status === 404 || res.status === 405) { await res.arrayBuffer().catch(() => {}); if (known === path) works.delete(base); continue; }
      if (res.ok && works.get(base) !== path) { works.set(base, path); logger && logger.info && logger.info('voice', `Piper server at ${base} answers on ${path === '/' ? '/ (piper.http_server)' : path}`); }
      res.endpoint = path;
      return res;
    }
    res.endpoint = order[order.length - 1];
    return res;
  }
  /** The voices the server lists (official server only): { ok, voices: [name] } or { ok: false, error }. */
  async function voices(base, signal) {
    let res;
    try { res = await fetch(base + '/voices', { signal: signal || AbortSignal.timeout(5000) }); }
    catch (e) { return { ok: false, error: e && e.cause && e.cause.code === 'ECONNREFUSED' ? 'The Piper server is not running at that address.' : ((e && e.message) || String(e)) }; }
    if (!res.ok) { await res.arrayBuffer().catch(() => {}); return { ok: false, error: res.status === 404 ? 'This Piper server does not list its voices.' : `HTTP ${res.status}` }; }
    const list = normPiperVoices(await res.json().catch(() => null));
    return list.length ? { ok: true, voices: list } : { ok: false, error: 'The server did not list any voices.' };
  }
  return { speak, voices, pathOf: (base) => works.get(base) || '' };
}

module.exports = { createPiper, normPiperVoices, PIPER_PATHS: PATHS };
