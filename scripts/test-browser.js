// Integrated browser test (no Electron needed): node scripts/test-browser.js
const assert = require('assert');
const { EventEmitter } = require('events');
const b = require('../electron/browser');
const tools = require('../electron/tools');
const { buildSystem } = require('../electron/agent');

(async () => {
  // url handling
  assert.strictEqual(b.toUrl('example.com'), 'https://example.com');
  assert.strictEqual(b.toUrl('localhost:5173/x'), 'http://localhost:5173/x');
  assert.strictEqual(b.toUrl('how tall is everest'), 'https://www.google.com/search?q=how%20tall%20is%20everest');
  assert.strictEqual(b.toUrl('about:blank'), 'about:blank');
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'chrome://settings', 'data:text/html,hi', 'devtools://x']) assert(!b.allowedUrl(b.toUrl(bad)), 'blocked: ' + bad);
  for (const ok of ['https://a.com', 'http://localhost:3000', 'about:blank']) assert(b.allowedUrl(ok), 'allowed: ' + ok);
  assert.strictEqual(b.hostOf('https://www.example.com/a'), 'example.com');
  assert.strictEqual(b.hostOf('about:blank'), '');
  // user agent
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) artemis/1.2.0 Chrome/130.0.6723.191 Electron/33.4.0 Safari/537.36';
  assert.strictEqual(b.cleanUA(ua), 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.191 Safari/537.36');
  // keys
  assert.deepStrictEqual(b.parseKeys('cmd+a Tab', 'darwin'), [{ key: 'a', modifiers: ['meta'] }, { key: 'Tab', modifiers: [] }]);
  assert.deepStrictEqual(b.parseKeys('shift+ArrowDown Escape Enter'), [{ key: 'Down', modifiers: ['shift'] }, { key: 'Escape', modifiers: [] }, { key: 'Enter', modifiers: [] }]);
  assert.deepStrictEqual(b.parseKeys('ctrl++', 'linux'), [{ key: '+', modifiers: ['control'] }]);
  assert.throws(() => b.parseKeys('hyper+x'));
  assert.throws(() => b.parseKeys('Bogus'));
  // jpeg size from SOF0
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x05, 0x00, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepStrictEqual(b.jpegSize(jpg), { width: 1280, height: 600 });
  // the injected page scripts are valid JavaScript
  for (const fn of [b.readPageScript, b.findScript, b.textScript]) new Function('return ' + b.inPage(fn, { query: 'x' })); // eslint-disable-line no-new-func

  // tool definitions sit behind the flag
  const names = (f) => tools.definitions(f).map((d) => d.function.name).filter((n) => n.startsWith('browser_'));
  assert.strictEqual(names({}).length, 0);
  const all = names({ browserEnabled: true });
  for (const n of ['browser_tabs', 'browser_navigate', 'browser_read_page', 'browser_get_text', 'browser_find', 'browser_click', 'browser_type', 'browser_form_input', 'browser_key', 'browser_scroll', 'browser_screenshot', 'browser_javascript', 'browser_console', 'browser_network', 'browser_wait']) {
    assert(all.includes(n), 'definition ' + n);
    assert(tools.summarize(n, {}).startsWith('Browser'), 'summary ' + n);
  }
  // approval categories
  const fakeBr = { host: () => 'shop.example.com' };
  assert.deepStrictEqual(tools.browserApproval('browser_navigate', { url: 'https://www.example.com/x' }, fakeBr).category, 'browser-site:example.com');
  assert.strictEqual(tools.browserApproval('browser_navigate', { url: 'example.com' }, fakeBr).summary.startsWith('Use the browser on example.com'), true);
  assert.strictEqual(tools.browserApproval('browser_navigate', { url: 'back' }, fakeBr), null);
  assert.strictEqual(tools.browserApproval('browser_click', { ref: 'ref_1' }, fakeBr).category, 'browser-site:shop.example.com');
  assert.strictEqual(tools.browserApproval('browser_type', { text: 'x' }, { host: () => '' }), null);
  for (const n of ['browser_read_page', 'browser_get_text', 'browser_find', 'browser_screenshot', 'browser_console', 'browser_network', 'browser_wait']) assert.strictEqual(tools.browserApproval(n, {}, fakeBr), null, n + ' needs no approval');
  assert.strictEqual(tools.browserApproval('browser_tabs', { action: 'list' }, fakeBr), null);
  assert.strictEqual(tools.browserApproval('browser_tabs', { action: 'new', url: 'news.ycombinator.com' }, fakeBr).category, 'browser-site:news.ycombinator.com');
  assert.strictEqual(tools.browserApproval('browser_javascript', { code: '1' }, fakeBr).category, 'browser-js');

  // tools.run: asks once per site per task, autoAll skips, no browser -> error
  let asks = [];
  const ran = [];
  const ctx = { approve: async (i) => { asks.push(i.category); return true; }, browser: { host: () => 'example.com', run: async (n) => { ran.push(n); return { ok: true, text: 'done ' + n }; } } };
  assert.strictEqual((await tools.run('browser_navigate', { url: 'example.com' }, ctx)).text, 'done browser_navigate');
  await tools.run('browser_click', { ref: 'ref_1' }, ctx);
  await tools.run('browser_navigate', { url: 'https://example.com/page2' }, ctx);
  await tools.run('browser_read_page', {}, ctx);
  assert.deepStrictEqual(asks, ['browser-site:example.com']);
  await tools.run('browser_javascript', { code: 'document.title' }, ctx);
  await tools.run('browser_javascript', { code: '1' }, ctx);
  assert.deepStrictEqual(asks, ['browser-site:example.com', 'browser-js']);
  const denied = await tools.run('browser_navigate', { url: 'other.org' }, { ...ctx, session: new Set(), approve: async () => false });
  assert(denied.denied && !ran.includes('x'));
  asks = [];
  await tools.run('browser_navigate', { url: 'third.net' }, { ...ctx, session: new Set(), autoAll: true, approve: async (i) => { asks.push(i); return true; } });
  assert.strictEqual(asks.length, 0, 'auto-allow skips the site prompt');
  const none = await tools.run('browser_navigate', { url: 'example.com' }, { approve: async () => true });
  assert(!none.ok && /not available/.test(none.text));

  // system prompt guidance only with the flag
  assert(/browser_read_page/.test(buildSystem({ hasTools: true, browserEnabled: true })));
  assert(!/browser_read_page/.test(buildSystem({ hasTools: true })));

  // createBrowser with fake Electron objects
  let wcSeq = 0;
  class FakeWC extends EventEmitter {
    constructor() { super(); this.id = ++wcSeq; this.url = ''; this.muted = null; this.closed = false; this.navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} }; }
    setWindowOpenHandler(h) { this.openHandler = h; }
    loadURL(u) { this.url = u; this.emit('did-navigate', {}, u); return Promise.resolve(); }
    getURL() { return this.url; } getTitle() { return 'T' + this.id; } isLoading() { return false; }
    setAudioMuted(m) { this.muted = m; } close() { this.closed = true; } reload() {} stop() {}
    executeJavaScript() { return Promise.resolve('Page: x'); }
  }
  class FakeView { constructor(o) { this.opts = o; this.webContents = new FakeWC(); this.visible = null; this.bounds = null; } setBounds(r) { this.bounds = r; } setVisible(v) { this.visible = v; } getBounds() { return this.bounds; } }
  const children = new Set();
  const win = { isDestroyed: () => false, getContentBounds: () => ({ width: 1200, height: 800 }), contentView: { addChildView: (v) => children.add(v), removeChildView: (v) => children.delete(v) } };
  const events = [];
  const sesCalls = {};
  const fakeSes = {
    getUserAgent: () => ua, setUserAgent: (u) => { sesCalls.ua = u; },
    setPermissionRequestHandler: (h) => { sesCalls.req = h; }, setPermissionCheckHandler: (h) => { sesCalls.check = h; },
    on: () => {}, webRequest: { onCompleted: (f, h) => { sesCalls.done = h; }, onErrorOccurred: () => {} }
  };
  const br = b.createBrowser({ WebContentsView: FakeView, session: { fromPartition: (p) => { sesCalls.partition = p; return fakeSes; } }, getWin: () => win, emit: (ch, p) => events.push([ch, p]) });
  assert.strictEqual(br.state().tabs.length, 0, 'nothing is created before use');
  assert(br.open('example.com'));
  assert.strictEqual(sesCalls.partition, 'persist:artemis-browser');
  assert(!/Electron|artemis/.test(sesCalls.ua));
  let perm = null; sesCalls.req(null, 'media', (v) => { perm = v; }); assert.strictEqual(perm, false, 'camera/mic denied');
  sesCalls.req(null, 'geolocation', (v) => { perm = v; }); assert.strictEqual(perm, false);
  sesCalls.req(null, 'clipboard-sanitized-write', (v) => { perm = v; }); assert.strictEqual(perm, true);
  assert.strictEqual(sesCalls.check(null, 'notifications'), false);
  let st = br.state();
  assert.strictEqual(st.tabs.length, 1); assert.strictEqual(st.tabs[0].url, 'https://example.com');
  const t1 = [...children][0];
  assert.strictEqual(t1.opts.webPreferences.session, fakeSes);
  assert.strictEqual(t1.visible, true); assert.strictEqual(t1.webContents.muted, false);
  // a second open with the same url does not reload
  t1.webContents.loadURL = () => { throw new Error('should not reload'); };
  br.open('https://example.com');
  t1.webContents.loadURL = FakeWC.prototype.loadURL;
  // pop-ups become tabs; file: pop-ups are refused
  assert.deepStrictEqual(t1.webContents.openHandler({ url: 'https://popup.test/', disposition: 'foreground-tab' }), { action: 'deny' });
  t1.webContents.openHandler({ url: 'file:///etc/passwd', disposition: 'foreground-tab' });
  st = br.state();
  assert.strictEqual(st.tabs.length, 2); assert.strictEqual(st.activeId, 2);
  assert.strictEqual(t1.visible, false, 'inactive tab hidden');
  // blocked navigation
  let prevented = false; t1.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'file:///etc/hosts'); assert(prevented);
  prevented = false; t1.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } }, 'https://ok.test/'); assert(!prevented);
  // console and network buffers
  t1.webContents.emit('console-message', {}, 3, 'boom', 7, 'https://example.com/app.js');
  sesCalls.done({ webContentsId: t1.webContents.id, method: 'GET', url: 'https://example.com/api', statusCode: 404, resourceType: 'xhr', responseHeaders: { 'content-length': ['12'] } });
  let r = await br.tool('browser_console', { tabId: 1 });
  assert(/\[error\] boom/.test(r.text) && r.text.startsWith('[Web page content'));
  r = await br.tool('browser_network', { tabId: 1, pattern: 'api', clear: true });
  assert(/GET 404 xhr 12B https:\/\/example.com\/api/.test(r.text), r.text);
  r = await br.tool('browser_network', { tabId: 1 });
  assert(/No network requests/.test(r.text));
  // tabs tool: list / new / select / close
  r = await br.tool('browser_tabs', { action: 'list' });
  assert(/\[1\] T\d+ — https:\/\/example.com/.test(r.text) && /\[2\] \(active\)/.test(r.text), r.text);
  r = await br.tool('browser_tabs', { action: 'new', url: 'wikipedia.org' });
  assert(/Opened tab 3/.test(r.text));
  r = await br.tool('browser_tabs', { action: 'select', tabId: 1 });
  assert.strictEqual(br.state().activeId, 1); assert.strictEqual(t1.visible, true);
  r = await br.tool('browser_tabs', { action: 'close', tabId: 1 });
  assert.strictEqual(br.state().tabs.length, 2); assert(t1.webContents.closed); assert(!children.has(t1));
  assert.strictEqual(br.host(), br.state().tabs.find((t) => t.active).url.includes('popup') ? 'popup.test' : 'wikipedia.org');
  await assert.rejects(br.tool('browser_tabs', { action: 'select', tabId: 99 }));
  await assert.rejects(br.tool('browser_navigate', { url: 'javascript:alert(1)' }));
  // the agent handle turns errors into tool results and reports activity
  const ag = br.agent('req1');
  r = await ag.run('browser_tabs', { action: 'select', tabId: 42 });
  assert(!r.ok && /No tab 42/.test(r.text));
  assert(events.some(([ch, p]) => ch === 'browser:agent' && p.active && p.requestId === 'req1'));
  br.agentDone('req1');
  assert(events.some(([ch, p]) => ch === 'browser:agent' && !p.active && p.requestId === 'req1'));
  // hiding keeps tabs alive but mutes them
  br.hide();
  for (const v of children) { assert.strictEqual(v.visible, false); assert.strictEqual(v.webContents.muted, true); }
  assert.strictEqual(br.state().tabs.length, 2);
  br.open();
  assert([...children].some((v) => v.visible));
  br.destroy();
  assert.strictEqual(br.state().tabs.length, 0);
  await new Promise((res) => setTimeout(res, 60));
  assert(events.some(([ch]) => ch === 'browser:state'));
  console.log('browser tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
