// IPC: voice
module.exports = function registerVoiceIpc(deps) {
  const { ipcMain, getSettings, logger, providersLib, systemPreferences, transcribeAudio, fs, path, crypto, cacheDir } = deps;
  const streams = new Map(); // id -> AbortController of a running streamed read
  const chatterbox = require('../chatterbox').createChatterbox({ fetch: (...a) => fetch(...a), logger });
  const piper = require('../piper').createPiper({ fetch: (...a) => fetch(...a), logger });
  const num = (v, lo, hi, d) => { const n = Number(v); return v === '' || v == null || !Number.isFinite(n) ? d : Math.min(hi, Math.max(lo, n)); };
  const cbBase = (st, url) => {
    const base = String(url || st.cbUrl || 'http://localhost:8004').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('The Chatterbox address must start with http:// or https://');
    return base;
  };
  // Chatterbox settings for one piece: what the renderer sent (an emotion tag's values), else the saved sliders.
  const cbOpts = (st, cb, rate) => {
    const c = cb && typeof cb === 'object' ? cb : {};
    return {
      voice: String(st.cbVoice || '').trim(),
      exaggeration: num(c.exaggeration ?? st.cbExaggeration, 0.25, 2, 0.5),
      cfg_weight: num(c.cfg_weight ?? st.cbCfg, 0, 1, 0.5),
      temperature: num(c.temperature ?? st.cbTemperature, 0.05, 2, 0.8),
      speed: num(c.speed ?? (num(st.cbSpeed, 0.5, 2, 1) * rate), 0.5, 2, 1)
    };
  };
  // a voice name sent by the renderer for one piece (Kokoro "ef_dora" / "af_heart+af_bella", Piper "tr_TR-dfki-medium",
  // Chatterbox "Emily.wav" / "clone:x.wav"); anything else is ignored
  const okVoice = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.+():-]{1,100}$/.test(v) ? v : '');
  const ENGINES = ['openai', 'piper', 'chatterbox'];
  const mainEngine = (st) => (st.ttsEngine === 'chatterbox' ? 'chatterbox' : st.ttsEngine === 'piper' ? 'piper' : 'openai');
  // a server address sent by the renderer for one piece (Settings → Voice → Voices per language): http(s) only
  const pieceUrl = (u) => {
    if (u == null || u === '') return '';
    const s = String(u).trim().replace(/\/+$/, '');
    if (s.length > 300 || !/^https?:\/\/[^\s/?#]+(\/[^\s]*)?$/i.test(s)) throw new Error('The voice server address must start with http:// or https://');
    return s;
  };
  /**
   * The engine, address and voice for one piece. opt.engine / opt.url / opt.voice come from the renderer's per-language
   * routing and win over the saved main-engine settings for that piece only.
   */
  const pieceCfg = (st, opt = {}) => {
    const engine = ENGINES.includes(opt.engine) ? opt.engine : mainEngine(st);
    const url = pieceUrl(opt.url);
    const main = engine === mainEngine(st) && !url; // the main engine's own server and settings
    if (engine === 'chatterbox') return { engine, base: cbBase(st, url), voice: okVoice(opt.voice), main };
    const def = engine === 'piper' ? (main ? 'http://localhost:5000' : 'http://localhost:5100') : 'http://localhost:8880';
    const base = String(url || (engine === mainEngine(st) ? st.ttsUrl : '') || def).trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) throw new Error('The voice server address must start with http:// or https://');
    const voice = okVoice(opt.voice) || (engine === 'piper' ? (main ? (st.ttsVoiceEn || st.ttsVoice || '') : '') : (st.ttsVoice || 'af_heart'));
    return { engine, base, voice, main };
  };
  // hybrid: Kokoro reads, Chatterbox makes the emotionally tagged pieces
  const hybridOn = (st) => st.ttsEngine === 'openai' && !!st.cbHybrid && !!String(st.cbUrl || '').trim();
  const CACHE_MAX_CHARS = 80; // short fixed phrases ("Sentinel mode activated.") are kept on disk and played at once
  /** The one place that builds the voice-server request. stream = raw 24 kHz PCM that arrives while it is still being made. */
  // Node's fetch keeps the connection open between requests (no 'connection: close'), so the next piece skips the handshake.
  // opt.engine asks that engine whatever the main engine is (hybrid pieces, per-language engines); opt.url / opt.voice: that
  // piece's server and voice (pieceCfg); opt.cb = Chatterbox settings for this piece.
  const ttsFetch = (st, input, rate, stream, signal, opt = {}) => {
    const c = pieceCfg(st, opt);
    if (c.engine === 'chatterbox') {
      const o = cbOpts(st, opt.cb, rate); if (c.voice) o.voice = c.voice;
      return chatterbox.speak(c.base, input, o, signal || AbortSignal.timeout(60000));
    }
    const base = c.base;
    if (c.engine === 'piper') {
      // the older custom server (/synthesize) and the official piper.http_server (/) take the same JSON
      const body = { text: input, length_scale: Number((1 / rate).toFixed(2)) };
      if (c.voice) body.voice = c.voice;
      return piper.speak(base, body, signal || AbortSignal.timeout(60000));
    }
    // c.voice: the voice for this piece's language (a Spanish reply gets ef_dora); Kokoro picks the language from the voice's first letter
    const body = { model: st.ttsModel || 'kokoro', input, voice: c.voice, response_format: stream ? 'pcm' : 'wav', speed: rate };
    if (stream) body.stream = true;
    return fetch(providersLib.joinUrl(base, 'audio/speech'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: signal || AbortSignal.timeout(60000) });
  };
  const cacheFile = (st, input, rate, c) => {
    const key = crypto.createHash('sha1').update([c.base, st.ttsModel, c.voice, rate, input].join('\u0001')).digest('hex');
    return path.join(cacheDir(), key + '.pcm');
  };
  const rateOf = (speed) => Math.min(1.6, Math.max(0.6, Number(speed) || 1));
  const friendly = (e) => (e && e.cause && e.cause.code === 'ECONNREFUSED') ? 'The voice server is not running at that address.' : ((e && e.message) || String(e));
  // Streamed read: audio chunks are pushed to the window as they are made, so playback starts after the first one.
  // The first bytes go out at once; after that small chunks are merged (at least 2 KB per message) to keep IPC cheap.
  // Time limits: no first audio within 15 s, or no new audio for 20 s, stops it (a long text may take longer in total).
  const FIRST_BYTE_MS = 15000; const IDLE_MS = 20000; const MIN_SEND = 2048;
  ipcMain.handle('voice:stream', async (e, { id, text, speed, voice, engine, url } = {}) => {
    const ac = new AbortController(); streams.set(id, ac);
    let timedOut = '';
    let to = setTimeout(() => { timedOut = 'The voice server sent no audio within 15 s.'; ac.abort(); }, FIRST_BYTE_MS);
    const idle = () => { clearTimeout(to); to = setTimeout(() => { timedOut = 'The voice server stopped sending audio.'; ac.abort(); }, IDLE_MS); };
    let pend = []; let pendN = 0; let flushT = null;
    const send = (data) => { if (!e.sender.isDestroyed()) e.sender.send('voice:pcm', { id, data }); };
    // Sent on the audio channel after the last chunk: the invoke reply travels on another channel and can arrive before the last audio.
    const sendEnd = (bytes) => { if (!e.sender.isDestroyed()) e.sender.send('voice:pcm', { id, end: true, bytes }); };
    const flush = () => {
      if (flushT) { clearTimeout(flushT); flushT = null; }
      if (!pendN) return;
      const out = new Uint8Array(pendN); let o = 0; // a fresh array: a view into a larger buffer would send the whole buffer
      for (const b of pend) { out.set(b, o); o += b.length; }
      pend = []; pendN = 0; send(out);
    };
    try {
      const st = getSettings();
      const opt = { voice, engine, url };
      const c = pieceCfg(st, opt);
      if (c.engine !== 'openai') return { ok: false, error: 'Streaming needs an OpenAI-compatible voice server (Kokoro).' };
      const input = String(text || '').slice(0, 1500);
      if (!input.trim()) return { ok: false, error: 'Nothing to read.' };
      const rate = rateOf(speed);
      const cf = input.length <= CACHE_MAX_CHARS ? cacheFile(st, input, rate, c) : null;
      if (cf) { try { const b = fs.readFileSync(cf); if (b.length) { send(new Uint8Array(b)); sendEnd(b.length); return { ok: true, cached: true, firstMs: 0, bytes: b.length }; } } catch {} }
      const t0 = Date.now();
      const res = await ttsFetch(st, input, rate, true, ac.signal, opt);
      if (!res.ok || !res.body) { const t = (await res.text().catch(() => '')).slice(0, 200); logger.error('voice', `Text-to-speech failed HTTP ${res.status}`, { detail: t }); return { ok: false, status: res.status, error: `Voice server answered HTTP ${res.status}: ${t || res.statusText}` }; }
      const keep = []; let first = 0; let n = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        idle();
        n += value.length; if (cf) keep.push(Buffer.from(value));
        pend.push(value); pendN += value.length;
        if (!first) { first = Date.now() - t0; flush(); } // the first audio goes out at once
        else if (pendN >= MIN_SEND) flush();
        else if (!flushT) flushT = setTimeout(flush, 15);
      }
      flush(); sendEnd(n);
      if (cf && n) { try { fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(cf, Buffer.concat(keep)); } catch {} }
      logger.info('voice', `Text-to-speech stream${c.main ? '' : ' (' + c.base + ')'}: first audio after ${(first / 1000).toFixed(2)}s, ${Math.round(n / 1024)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s (${input.length} chars)`);
      return { ok: n > 0, firstMs: first, bytes: n, error: n ? undefined : 'The voice server sent no audio.' };
    } catch (err) {
      if (timedOut) { logger.error('voice', 'Text-to-speech failed: ' + timedOut); return { ok: false, error: timedOut }; }
      if (ac.signal.aborted) return { ok: false, aborted: true, error: 'Stopped.' };
      const m = friendly(err); logger.error('voice', 'Text-to-speech failed: ' + m); return { ok: false, error: m };
    } finally { clearTimeout(to); if (flushT) clearTimeout(flushT); streams.delete(id); }
  });
  ipcMain.handle('voice:stream-cancel', (_e, id) => { const ac = streams.get(id); if (ac) { streams.delete(id); ac.abort(); } return true; }); // deleted first: voice:speak tells a stop from its 60 s timeout by that
  // Wakes the voice server (loads the model, first run is slow; opens a connection that the next read reuses) with a
  // tiny read nobody hears. Called at start-up, when Sentinel starts and when a question is sent; at most once per 30 s.
  let warming = null; let warmAt = 0;
  ipcMain.handle('voice:warm', () => {
    if (warming) return warming;
    if (Date.now() - warmAt < 30000) return { ok: true, recent: true };
    warming = (async () => {
      try {
        const st = getSettings();
        if (!['openai', 'piper', 'chatterbox'].includes(st.ttsEngine)) return { ok: false };
        // Chatterbox loads a bigger model and makes whole files: a longer limit; with the hybrid option both servers are woken
        const one = async (engine) => {
          const t0 = Date.now(); const cb = engine === 'chatterbox';
          try {
            const res = await ttsFetch(st, 'Ready.', 1, engine === 'openai', AbortSignal.timeout(cb ? 90000 : 30000), cb ? { engine } : {});
            await res.arrayBuffer().catch(() => {});
            logger.info('voice', `Voice server warm-up (${cb ? 'Chatterbox' : engine}): HTTP ${res.status} in ${((Date.now() - t0) / 1000).toFixed(2)}s${res.endpoint ? ' via ' + res.endpoint : ''}`);
            return res.ok;
          } catch (err) { logger.info('voice', `Voice server warm-up (${cb ? 'Chatterbox' : engine}) skipped: ` + friendly(err)); return false; }
        };
        const [ok] = await Promise.all([one(st.ttsEngine), hybridOn(st) ? one('chatterbox') : Promise.resolve(true)]);
        if (ok) warmAt = Date.now();
        return { ok };
      } catch (err) { logger.info('voice', 'Voice server warm-up skipped: ' + friendly(err)); return { ok: false }; }
      finally { warming = null; }
    })();
    return warming;
  });
  // The voices a Chatterbox server offers (for the Settings dropdown). url = the address typed in Settings (may not be saved yet).
  ipcMain.handle('voice:cbVoices', async (_e, url) => {
    try { return await chatterbox.voices(cbBase(getSettings(), url)); }
    catch (err) { return { ok: false, error: friendly(err) }; }
  });
  // The voices a Piper server lists (official piper.http_server: GET /voices). Optional: older servers have no list.
  ipcMain.handle('voice:piperVoices', async (_e, url) => {
    try { return await piper.voices(pieceUrl(url) || 'http://localhost:5100'); }
    catch (err) { return { ok: false, error: friendly(err) }; }
  });
  ipcMain.handle('voice:permission', async () => {
    if (process.platform !== 'darwin') return 'granted';
    try {
      const st = systemPreferences.getMediaAccessStatus('microphone');
      if (st === 'not-determined') return (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied';
      return st;
    } catch { return 'granted'; }
  });
  ipcMain.handle('voice:transcribe', (_e, a) => transcribeAudio(a || {}));
  // A whole file per piece: for servers without streaming (Piper), or when streaming failed. id makes it stoppable (voice:stream-cancel).
  // engine: 'chatterbox' for a hybrid piece (Kokoro is the main engine); cb = Chatterbox settings for this piece (an emotion tag).
  // Chatterbox makes the whole file before it answers: at most 30 s until the answer starts, then 60 s for the audio.
  ipcMain.handle('voice:speak', async (_e, { id, text, speed, engine: want, cb, voice, url } = {}) => {
    const ac = new AbortController(); if (id) streams.set(id, ac);
    let limit = 60;
    let to = setTimeout(() => ac.abort(), 60000);
    try {
      const st = getSettings();
      const opt = { engine: want, url, voice, cb };
      const c = pieceCfg(st, opt); const engine = c.engine;
      if (engine === 'chatterbox') { clearTimeout(to); limit = 30; to = setTimeout(() => ac.abort(), 30000); }
      const input = String(text || '').slice(0, 1500);
      if (!input.trim()) return { ok: false, error: 'Nothing to read.' };
      const t0 = Date.now();
      const res = await ttsFetch(st, input, rateOf(speed), false, ac.signal, opt);
      if (engine === 'chatterbox') { clearTimeout(to); limit = 60; to = setTimeout(() => ac.abort(), 60000); }
      if (!res.ok) { const t = (res.detail || await res.text().catch(() => '')).slice(0, 200); logger.error('voice', `Text-to-speech (${engine}) failed HTTP ${res.status}${res.endpoint ? ' at ' + res.endpoint : ''}`, { detail: t }); return { ok: false, status: res.status, error: `${engine === 'chatterbox' ? 'Chatterbox' : 'Voice server'} answered HTTP ${res.status}: ${t || res.statusText}` }; }
      const buf = Buffer.from(await res.arrayBuffer());
      logger.info('voice', `Text-to-speech ${engine}${c.main ? '' : ' at ' + c.base}${res.endpoint ? ' ' + res.endpoint : ''}: ${Math.round(buf.length / 1024)} KB in ${((Date.now() - t0) / 1000).toFixed(2)}s (${input.length} chars)`);
      return { ok: true, audio: new Uint8Array(buf), mime: res.headers.get('content-type') || 'audio/wav', engine };
    } catch (e) {
      if (ac.signal.aborted && id && !streams.has(id)) return { ok: false, aborted: true, error: 'Stopped.' };
      const m = ac.signal.aborted ? `The voice server did not answer within ${limit} s.` : friendly(e);
      logger.error('voice', 'Text-to-speech failed: ' + m);
      return { ok: false, error: m };
    } finally { clearTimeout(to); if (id) streams.delete(id); }
  });
};
