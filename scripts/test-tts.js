// Tests for the Chatterbox voice: emotion tags (parsing, stripping, settings per tag) and the Chatterbox client
// (request body from the server's OpenAPI schema, /tts -> /v1/audio/speech fallback) against small fake servers.
const assert = require('assert');
const http = require('http');
const { createChatterbox, buildBody, bodyProps, ttsFields, v1Fields, normVoices } = require('../electron/chatterbox');

// A fake server: routes = { 'POST /tts': (body) => [status, payload] }. Records every request.
function fake(routes) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const key = req.method + ' ' + req.url;
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch {}
      seen.push({ key, body });
      const h = routes[key];
      if (!h) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"detail":"Not Found"}'); return; }
      const [status, payload, type] = h(body);
      res.writeHead(status, { 'content-type': type || (Buffer.isBuffer(payload) ? 'audio/wav' : 'application/json') });
      res.end(Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
    });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${srv.address().port}`, seen, close: () => new Promise((r) => srv.close(r)) })));
}
const WAV = Buffer.from('RIFF....WAVEfmt fake');
const logs = [];
const logger = { info: (_c, m) => logs.push(m), warn: (_c, m) => logs.push(m), error: (_c, m) => logs.push(m) };

(async () => {
  const e = await import('../src/lib/tts-emotion.mjs');

  // ---- tags ----
  assert.deepStrictEqual(e.parseTag('[warm] I am glad.'), { emotion: 'warm', text: 'I am glad.' });
  assert.deepStrictEqual(e.parseTag('  [Soft]  I am here.'), { emotion: 'soft', text: 'I am here.' });
  assert.deepStrictEqual(e.parseTag('No tag here.'), { emotion: '', text: 'No tag here.' });
  assert.deepStrictEqual(e.parseTag('[angry] Unknown.'), { emotion: '', text: '[angry] Unknown.' });
  assert.strictEqual(e.parseTag('[warm](https://x.y) link').emotion, '', 'a Markdown link is not a tag');
  assert.strictEqual(e.stripTags('Okay. [soft] I am here.\n\n[excited] Great news!'), 'Okay. I am here.\n\nGreat news!');
  assert.strictEqual(e.stripTags('- [warm] item'), '- item');
  assert.strictEqual(e.stripTags('Use `[warm]` like this:\n```\n[sad] x\n```\n[sad] Done.'), 'Use `[warm]` like this:\n```\n[sad] x\n```\nDone.', 'code is left alone');
  assert.strictEqual(e.stripTags('See [warm](https://a.b) and [x]'), 'See [warm](https://a.b) and [x]');
  assert.strictEqual(e.stripTags('Hello. [wa', { partial: true }), 'Hello. ', 'a half-written tag is hidden while streaming');
  assert.strictEqual(e.stripTags('Hello [x', { partial: true }), 'Hello [x');
  assert.strictEqual(e.stripTags('Hello. [wa'), 'Hello. [wa');

  // ---- settings per tag ----
  assert.deepStrictEqual(e.cbParams('', {}), { exaggeration: 0.5, cfg_weight: 0.5, temperature: 0.8, speed: 1 });
  assert.deepStrictEqual(e.cbParams('', { exaggeration: 0.7, cfg: 0.3, temperature: 0.6, speed: 1.1 }), { exaggeration: 0.7, cfg_weight: 0.3, temperature: 0.6, speed: 1.1 });
  assert.deepStrictEqual(e.cbParams('warm', { exaggeration: 0.7 }), { exaggeration: 0.9, cfg_weight: 0.4, temperature: 0.8, speed: 1 });
  assert.deepStrictEqual(e.cbParams('soft', {}), { exaggeration: 0.8, cfg_weight: 0.35, temperature: 0.8, speed: 0.92 });
  assert.deepStrictEqual(e.cbParams('sad', {}, 1.1), { exaggeration: 0.7, cfg_weight: 0.3, temperature: 0.8, speed: 0.99 });
  assert.strictEqual(e.cbParams('excited', {}).exaggeration, 1.3);
  assert.strictEqual(e.cbParams('serious', {}).cfg_weight, 0.6);
  assert.strictEqual(e.cbParams('', { exaggeration: 9, cfg: -1 }).exaggeration, 2, 'clamped');
  assert.strictEqual(e.cbParams('', { exaggeration: 9, cfg: -1 }).cfg_weight, 0);
  assert.deepStrictEqual(e.plainAdjust('warm'), { rate: 0.9, pauseMs: 250 });
  assert.deepStrictEqual(e.plainAdjust(''), { rate: 1, pauseMs: 0 });
  assert(/\[warm\]/.test(e.EMOTION_HINT) && /sparingly/.test(e.EMOTION_HINT));

  // ---- request body from an OpenAPI schema ----
  const schema = {
    paths: {
      '/tts': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/CustomTTSRequest' } } } } } },
      '/v1/audio/speech': { post: { requestBody: { content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/OpenAI' }] } } } } } }
    },
    components: { schemas: {
      CustomTTSRequest: { properties: { text: {}, voice_mode: {}, predefined_voice_id: {}, output_format: {}, temperature: {}, exaggeration: {}, cfg_weight: {}, split_text: {}, chunk_size: {} } },
      OpenAI: { properties: { model: {}, input: {}, voice: {}, response_format: {}, speed: {} } }
    } }
  };
  assert.deepStrictEqual(bodyProps(schema, '/v1/audio/speech'), ['model', 'input', 'voice', 'response_format', 'speed']);
  assert.strictEqual(bodyProps(schema, '/nope'), null);
  const p = { voice: 'Emily.wav', exaggeration: 0.9, cfg_weight: 0.4, temperature: 0.8, speed: 1 };
  const tb = buildBody(ttsFields('Hello there.', p), bodyProps(schema, '/tts'));
  assert.deepStrictEqual(tb, { text: 'Hello there.', voice_mode: 'predefined', predefined_voice_id: 'Emily.wav', output_format: 'wav', split_text: false, chunk_size: 120, temperature: 0.8, exaggeration: 0.9, cfg_weight: 0.4 }, 'only the schema fields (no language, no speed_factor of 1)');
  assert.strictEqual(buildBody(ttsFields('Hi.', { ...p, speed: 0.9 })).speed_factor, 0.9);
  assert.strictEqual(buildBody(ttsFields('Hi.', { voice: 'clone:me.wav' })).reference_audio_filename, 'me.wav');
  assert.strictEqual(buildBody(ttsFields('Hi.', { voice: 'clone:me.wav' })).voice_mode, 'clone');
  assert.deepStrictEqual(buildBody(v1Fields('Hi.', p), bodyProps(schema, '/v1/audio/speech')), { model: 'chatterbox', input: 'Hi.', voice: 'Emily.wav', response_format: 'wav', speed: 1 });
  assert.deepStrictEqual(Object.keys(buildBody(v1Fields('Hi.', p, true))).sort(), ['input', 'model', 'response_format', 'speed', 'voice']);
  assert.deepStrictEqual(normVoices([{ filename: 'Emily.wav', display_name: 'Emily' }]), [{ id: 'Emily.wav', label: 'Emily' }]);
  assert.deepStrictEqual(normVoices({ voices: ['a.wav', ''] }), [{ id: 'a.wav', label: 'a.wav' }]);
  assert.deepStrictEqual(normVoices({ data: [{ id: 'x', name: 'X' }] }), [{ id: 'x', label: 'X' }]);
  assert.deepStrictEqual(normVoices(null), []);

  // ---- a server with /tts and a schema: /tts with the schema's fields ----
  { const s = await fake({ 'GET /openapi.json': () => [200, schema], 'POST /tts': () => [200, WAV] });
    const cb = createChatterbox({ fetch, logger });
    const res = await cb.speak(s.base, 'Hello there.', p);
    assert(res.ok && res.endpoint === '/tts');
    assert.strictEqual(Buffer.from(await res.arrayBuffer()).toString(), WAV.toString());
    const sent = s.seen.find((x) => x.key === 'POST /tts').body;
    assert(!('language' in sent) && sent.exaggeration === 0.9);
    await cb.speak(s.base, 'Again.', p);
    assert.strictEqual(s.seen.filter((x) => x.key === 'GET /openapi.json').length, 1, 'the schema is read once');
    assert(logs.some((m) => /using \/tts/.test(m)));
    await s.close(); }

  // ---- no /tts (404), no schema: falls back to /v1/audio/speech with the extras, and remembers it ----
  { const s = await fake({ 'POST /v1/audio/speech': (b) => [200, WAV] });
    const cb = createChatterbox({ fetch, logger });
    const res = await cb.speak(s.base, 'Hello.', p);
    assert(res.ok && res.endpoint === '/v1/audio/speech');
    const v1 = s.seen.find((x) => x.key === 'POST /v1/audio/speech').body;
    assert.strictEqual(v1.response_format, 'wav'); assert.strictEqual(v1.exaggeration, 0.9); assert.strictEqual(v1.input, 'Hello.');
    s.seen.length = 0;
    await cb.speak(s.base, 'Next.', p);
    assert.deepStrictEqual(s.seen.map((x) => x.key), ['POST /v1/audio/speech'], 'remembered: /v1 straight away');
    await s.close(); }

  // ---- /tts answers 422, /v1 refuses the extras with 422: retried without them ----
  { const s = await fake({
      'POST /tts': () => [422, { detail: 'bad' }],
      'POST /v1/audio/speech': (b) => ('exaggeration' in b ? [422, { detail: [{ msg: 'extra fields not permitted' }] }] : [200, WAV])
    });
    const cb = createChatterbox({ fetch, logger });
    const res = await cb.speak(s.base, 'Hello.', p);
    assert(res.ok && res.endpoint === '/v1/audio/speech');
    assert.deepStrictEqual(s.seen.filter((x) => x.key.startsWith('POST')).map((x) => x.key), ['POST /tts', 'POST /v1/audio/speech', 'POST /v1/audio/speech']);
    s.seen.length = 0;
    await cb.speak(s.base, 'Next.', p);
    const posts = s.seen.filter((x) => x.key.startsWith('POST'));
    assert.strictEqual(posts.length, 1); assert(!('exaggeration' in posts[0].body), 'remembers to leave the extras out');
    await s.close(); }

  // ---- other errors are reported, not hidden by a fallback; no voice chosen: the first listed voice ----
  { const s = await fake({ 'POST /tts': () => [500, { detail: 'CUDA out of memory' }], 'GET /get_predefined_voices': () => [200, [{ filename: 'Abigail.wav', display_name: 'Abigail' }]] });
    const cb = createChatterbox({ fetch, logger });
    const res = await cb.speak(s.base, 'Hello.', { ...p, voice: '' });
    assert.strictEqual(res.status, 500);
    assert.strictEqual(s.seen.find((x) => x.key === 'POST /tts').body.predefined_voice_id, 'Abigail.wav');
    assert.deepStrictEqual(await cb.voices(s.base), { ok: true, voices: [{ id: 'Abigail.wav', label: 'Abigail' }], source: '/get_predefined_voices' });
    await s.close(); }
  { const s = await fake({ 'GET /v1/audio/voices': () => [200, { voices: [{ id: 'Emily.wav', name: 'Emily' }] }] });
    assert.deepStrictEqual((await createChatterbox({ fetch, logger }).voices(s.base)).voices, [{ id: 'Emily.wav', label: 'Emily' }]);
    await s.close(); }
  // ---- a server that is not running ----
  { const cb = createChatterbox({ fetch, logger });
    const r = await cb.voices('http://127.0.0.1:9');
    assert.strictEqual(r.ok, false);
    await assert.rejects(() => cb.speak('http://127.0.0.1:9', 'Hi.', p)); }

  console.log('tts tests passed');
})().catch((err) => { console.error(err); process.exit(1); });
