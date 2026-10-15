const assert = require('assert');
const { createPermissions } = require('../electron/permissions.js');
(async () => {
  const opened = [];
  const mk = (over = {}) => createPermissions({
    systemPreferences: { getMediaAccessStatus: () => over.screen || 'denied', isTrustedAccessibilityClient: () => !!over.ax },
    desktopCapturer: { getSources: async () => { over.captured = true; return []; } },
    Notification: Object.assign(function () { this.show = () => { over.notified = true; }; }, { isSupported: () => true }),
    shell: { openExternal: async (u) => { opened.push(u); } },
    platform: over.platform || 'darwin',
    run: async () => { if (over.autoDenied) throw Object.assign(new Error('x'), { stderr: 'execution error: Not authorized to send Apple events (-1743)' }); return 'Finder'; }
  });
  assert.deepStrictEqual(await mk({ platform: 'linux' }).status(), { supported: false, items: [] });
  let s = await mk({ screen: 'granted', ax: true }).status();
  assert.ok(s.items.find((i) => i.id === 'screen').status === 'granted' && s.items.find((i) => i.id === 'automation').status === 'granted');
  s = await mk({ autoDenied: true }).status();
  assert.strictEqual(s.items.find((i) => i.id === 'automation').status, 'denied');
  assert.strictEqual(s.items.find((i) => i.id === 'accessibility').status, 'denied');
  const o = { autoDenied: true }; const p = mk(o);
  await p.request('screen'); assert.ok(o.captured && opened.some((u) => /ScreenCapture/.test(u)));
  await p.request('accessibility'); assert.ok(opened.some((u) => /Accessibility/.test(u)));
  await p.request('automation'); assert.ok(opened.some((u) => /Automation/.test(u)));
  await p.request('notifications'); assert.ok(o.notified);
  await p.request('microphone'); assert.ok(opened.some((u) => /Microphone/.test(u)));
  assert.ok((await mk({ screen: 'granted' }).status()).items.find((i) => i.id === 'microphone').status === 'granted');
  console.log('permissions: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
