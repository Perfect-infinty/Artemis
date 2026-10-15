// Runs electron/main.js against a fake 'electron' module and checks that settings (incl. secrets) survive repeated saves.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-ud-'));
const handlers = {};
const noop = () => {};
class Win { constructor() { this.webContents = { on: noop, send: noop, setWindowOpenHandler: noop, isLoading: () => false, once: noop, isDestroyed: () => false }; }
  on() {} loadURL() {} loadFile() {} show() {} hide() {} focus() {} isMinimized() { return false; } restore() {} minimize() {} isDestroyed() { return false; } isVisible() { return true; }
  setAlwaysOnTop() {} setVisibleOnAllWorkspaces() {} setContentProtection() {} showInactive() {} close() {} getBounds() { return { x: 0, y: 0, width: 1, height: 1 }; } getSize() { return [1, 1]; } setSize() {} setResizable() {} setPosition() {} once() {} }
Win.getAllWindows = () => [];
const registered = {};
const fake = {
  app: { getPath: () => userData, getVersion: () => '0.0.0-test', whenReady: () => Promise.resolve(), requestSingleInstanceLock: () => true, on: noop, quit: noop, setLoginItemSettings: noop },
  BrowserWindow: Win,
  ipcMain: { handle: (n, fn) => { handlers[n] = fn; }, on: noop, once: noop, removeHandler: noop },
  safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('ENC:' + s), decryptString: (b) => { const t = b.toString(); if (!t.startsWith('ENC:')) throw new Error('bad'); return t.slice(4); } },
  shell: { openExternal: noop, openPath: noop, showItemInFolder: noop },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: noop },
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  dialog: {}, session: { defaultSession: { webRequest: { onHeadersReceived: noop } } },
  screen: { getPrimaryDisplay: () => ({ size: { width: 100, height: 100 }, workArea: { x: 0, y: 0, width: 100, height: 100 } }), getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 100, height: 100 } }) },
  globalShortcut: { register: (a) => { registered[a] = true; return true; }, unregister: (a) => { delete registered[a]; }, unregisterAll: noop },
  Notification: class { show() {} },
  Tray: class { setToolTip() {} on() {} setContextMenu() {} popUpContextMenu() {} },
  nativeImage: { createFromPath: () => ({ setTemplateImage: noop }) }
};
const orig = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? fake : orig.call(this, req, ...rest); };
// main.js installs an uncaughtException handler, so a crash while loading would pass silently: fail loudly instead
try { require(path.join(__dirname, '..', 'electron', 'main.js')); } catch (e) { console.error('main.js failed to load:', e); process.exit(1); }

(async () => {
  await new Promise((r) => setTimeout(r, 300));
  const get = () => handlers['settings:get']();
  let s = await get();
  assert(!s.hasTelegramToken && !s.hasApiKey);

  // First save, exactly like the renderer: public settings (with undefined secret fields) + new token
  const payload = (cur, extra) => { const { hasApiKey, ...p } = cur; return { ...p, ...extra }; };
  s = await handlers['settings:set']({}, payload(s, { telegramEnabled: true, telegramToken: 'TOKEN-1', apiKey: undefined }));
  assert(s.hasTelegramToken, 'token saved on first save');
  // Second save: no token typed
  s = await handlers['settings:set']({}, payload(s, { telegramToken: undefined, apiKey: undefined, theme: 'dark' }));
  assert(s.hasTelegramToken, 'token must survive a second save');
  assert.strictEqual(s.theme, 'dark');
  // Third save with an explicitly empty token field
  s = await handlers['settings:set']({}, payload(s, { telegramToken: '', apiKey: '' }));
  assert(s.hasTelegramToken, 'an empty token field must not delete the saved token');
  const raw = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
  assert(!JSON.stringify(raw).includes('TOKEN-1'), 'token must be encrypted at rest');
  assert(registered['CommandOrControl+Shift+Space'], 'quick chat shortcut is registered');
  // every channel the renderer can invoke must have a handler in main (guards against lost handlers when main.js is split up)
  const pre = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.js'), 'utf8');
  const wanted = [...new Set([...pre.matchAll(/invoke\('([a-zA-Z]+:[a-zA-Z]+)'/g)].map((m) => m[1]))];
  const missing = wanted.filter((c) => !handlers[c]);
  assert(wanted.length > 50, 'preload channel scan found the channels');
  assert(!missing.length, 'missing IPC handlers: ' + missing.join(', '));
  console.log('main: all tests passed');
  process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
