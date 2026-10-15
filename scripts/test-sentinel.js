// Tests for the pure parts of Sentinel mode: wake word matching, speech start/end detection, WAV encoding.
const assert = require('assert');
(async () => {
  const c = await import('../src/lib/sentinel-core.mjs');
  // wake phrase
  assert(c.hasWake('wake up')); assert(c.hasWake('hey wake up')); assert(c.hasWake('Wake-up!')); assert(!c.hasWake('hello there')); assert(!c.hasWake('wake')); assert(!c.hasWake(''));
  assert(JSON.parse(c.GRAMMAR).includes('[unk]')); assert(JSON.parse(c.GRAMMAR).includes('wake up'));
  // transcript check: only a recording that really starts with the phrase is accepted
  assert.strictEqual(c.afterWake('Wake up, what time is it'), 'what time is it');
  assert.strictEqual(c.afterWake('Hey wake up what time is it'), 'what time is it');
  assert.strictEqual(c.afterWake('Wake up, what is the weather today?'), 'what is the weather today?');
  assert.strictEqual(c.afterWake('Wakeup ask me something'), 'ask me something');
  assert.strictEqual(c.afterWake('Weyk ap, hello'), 'hello');
  assert.strictEqual(c.afterWake('Wake up'), '');
  assert.strictEqual(c.afterWake('Weak up, new chat'), 'new chat');           // weak spelling, first words
  assert.strictEqual(c.afterWake('so anyway the plan is to wake up early'), null); // later in a sentence: ignored
  assert.strictEqual(c.afterWake('Artemis, what time is it'), null);               // the old name no longer works
  assert.strictEqual(c.afterWake('I wake up at seven every day and go to work'), null);
  assert.strictEqual(c.afterWake('wake'), null);
  assert.strictEqual(c.afterWake(''), null);
  assert.strictEqual(c.stripWake('Wake up, what is the weather today?'), 'what is the weather today?');
  assert.strictEqual(c.stripWake('Hey wake up what time is it'), 'what time is it');
  assert.strictEqual(c.stripWake('Wake up'), '');
  assert.strictEqual(c.stripWake('what time is it'), 'what time is it');
  assert.strictEqual(c.stripWake('I wake up early'), 'I wake up early');
  assert(c.looksLikeNoise('Thank you.')); assert(c.looksLikeNoise('...')); assert(!c.looksLikeNoise('what is the weather today'));
  assert(c.hasBarge('stop')); assert(c.hasBarge('okay stop')); assert(c.hasBarge('wake up')); assert(!c.hasBarge('hello there')); assert(!c.hasBarge(''));
  assert(JSON.parse(c.BARGE_GRAMMAR).includes('stop'));
  assert.strictEqual(c.speakable('Hello 😀 there! 👍🏽 Ready 🇦🇿 to go ❤️'), 'Hello there! Ready to go');
  // segmenter: 1s silence, 1s tone, 2s silence -> ends by silence
  const mk = (ms, amp) => { const n = Math.round(c.RATE * ms / 1000); const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = amp * Math.sin(i / 8) * (amp ? 1 : 0); return f; };
  const run = (parts, opt) => { const s = new c.Segmenter(opt); let r = null; for (const p of parts) for (let i = 0; i < p.length; i += 4096) { r = s.feed(p.subarray(i, i + 4096)); if (r) return { r, s }; } return { r, s }; };
  let o = run([mk(1000, 0.002), mk(1000, 0.3), mk(2500, 0.002)]);
  assert.strictEqual(o.r && o.r.reason, 'silence'); assert(o.s.hasSpeech);
  o = run([mk(9000, 0.002)], { noSpeechMs: 3000 });
  assert.strictEqual(o.r.reason, 'nospeech'); assert(!o.s.hasSpeech);
  o = run([mk(300, 0.3), mk(2500, 0.001)]);
  assert.strictEqual(o.r.reason, 'silence'); assert(o.s.hasSpeech);
  o = run([mk(100, 0.3), mk(2500, 0.001)]);
  assert(!o.s.hasSpeech, 'a click is not speech');
  // noisy room: constant noise at 0.02 never counts as speech
  o = run([mk(4000, 0.02)], { noSpeechMs: 3000, noise: 0.014 });
  assert.strictEqual(o.r.reason, 'nospeech');
  assert(c.trackNoise(0.01, 0.002) < 0.01 && c.trackNoise(0.01, 0.1) > 0.01 && c.trackNoise(0.01, 0.1) < 0.012);
  // ring buffer keeps ~600ms
  const ring = new c.Ring(600); for (let i = 0; i < 20; i++) ring.push(mk(256, 0.1));
  const kept = c.concat(ring.take()).length; assert(kept >= 9600 && kept <= 9600 + 4096, 'ring ' + kept);
  // wav
  const w = c.encodeWav(mk(500, 0.5)); const dv = new DataView(w.buffer);
  assert.strictEqual(String.fromCharCode(...w.slice(0, 4)), 'RIFF'); assert.strictEqual(dv.getUint32(24, true), 16000); assert.strictEqual(dv.getUint32(40, true), 16000 / 2 * 2);
  // spoken part
  // reading while the reply is still being written
  { const st = { consumed: 0, spoken: 0, n: 0 }; let full = ''; const feed = (t, f) => { full += t; return c.takePieces(full, st, !!f); };
    assert.deepStrictEqual(feed('Hello the'), []);
    assert.deepStrictEqual(feed('re. How are'), []);
    assert.deepStrictEqual(feed(' you today? I am fine. Version 3.'), ['Hello there. How are you today?']);
    assert.deepStrictEqual(feed('5 is out.\n\n```js\nconst a'), []);
    assert.deepStrictEqual(feed(' = 1;\n```\nDone now'), ['I am fine. Version 3.5 is out. code block.']);
    assert.deepStrictEqual(feed('', true), ['Done now']); }
  { const st = { consumed: 0, spoken: 0, n: 0 }; const long = 'This is one more sentence for the test. '.repeat(60);
    const a = c.takePieces(long, st, true); assert(a.join(' ').length <= 1000 && a.join(' ').length >= 800, 'spoken text is capped'); assert.deepStrictEqual(c.takePieces(long, st, true), []); }
  assert.deepStrictEqual(c.spokenPart('Short.'), { text: 'Short.', cut: false });
  const long = ('This is a sentence. ').repeat(200); const sp = c.spokenPart(long, 900);
  assert(sp.cut && sp.text.length <= 900 && sp.text.endsWith('.'));
  console.log('sentinel tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
