// Computer control for macOS: screenshots (screencapture + sips), mouse (JXA / CoreGraphics), keyboard (AppleScript).
// Needs Screen Recording and Accessibility permission for the app that launches it (Terminal / Electron).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn: defaultSpawn } = require('child_process');

const MAX_DIM = 1024;       // small screenshot = fewer tokens
const JPEG_QUALITY = 45;
const UI_MAX = 220;         // at most this many items from the accessibility tree

const KEYCODES = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53,
  arrowleft: 123, arrowright: 124, arrowdown: 125, arrowup: 126, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121, forwarddelete: 117,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111
};
const MODS = {
  cmd: 'command down', command: 'command down', meta: 'command down', super: 'command down',
  ctrl: 'control down', control: 'control down', alt: 'option down', option: 'option down', opt: 'option down', shift: 'shift down'
};
// CoreGraphics event types
const EV = { move: 5, leftDown: 1, leftUp: 2, rightDown: 3, rightUp: 4, leftDrag: 6 };

const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(abortError());
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
});

function defaultExec(cmd, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30000, maxBuffer: 20 * 1024 * 1024, signal }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; err.stdout = stdout; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

const asString = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** "cmd+shift+t" / "Return" -> one System Events line */
function cleanKeys(spec) {
  // Models send keys as "Return", ["enter"], '["cmd","l"]' or "cmd + L": accept all of them
  let v = spec;
  if (typeof v === 'string' && /^\s*\[/.test(v)) { try { v = JSON.parse(v); } catch { v = v.replace(/[\[\]"']/g, '').split(','); } }
  if (Array.isArray(v)) v = v.map((x) => String(x).trim()).filter(Boolean).join('+');
  return String(v || '').replace(/^["'\s]+|["'\s]+$/g, '');
}

function keyLine(spec) {
  const parts = cleanKeys(spec).split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('keys is empty');
  const key = parts.pop();
  const mods = parts.map((m) => {
    const v = MODS[m.toLowerCase()];
    if (!v) throw new Error(`Unknown modifier: ${m}`);
    return v;
  });
  const using = mods.length ? ` using {${mods.join(', ')}}` : '';
  const code = KEYCODES[key.toLowerCase()];
  if (code !== undefined) return `key code ${code}${using}`;
  if ([...key].length === 1) return `keystroke ${asString(key)}${using}`;
  throw new Error(`Unknown key: ${key}`);
}

function typeLines(text) {
  const lines = [];
  for (const seg of String(text).split(/(\n|\t)/)) {
    if (seg === '\n') lines.push('key code 36');
    else if (seg === '\t') lines.push('key code 48');
    else if (seg) for (let i = 0; i < seg.length; i += 200) lines.push(`keystroke ${asString(seg.slice(i, i + 200))}`);
  }
  return lines;
}

const systemEvents = (lines) => ['tell application "System Events"', ...lines.map((l) => '  ' + l), 'end tell'].join('\n');

/** steps: [{t, x, y, b, c, s}] -> JXA script posting CoreGraphics mouse events */
function mouseJxa(steps) {
  const body = steps.map((s) => `ev(${s.t},${s.x},${s.y},${s.b || 0},${s.c || 0},${s.s ?? 0.03});`).join('\n');
  return [
    "ObjC.import('ApplicationServices'); ObjC.import('Foundation');",
    'function ev(t,x,y,b,c,s){var e=$.CGEventCreateMouseEvent(null,t,$.CGPointMake(x,y),b);' +
    'if(c){$.CGEventSetIntegerValueField(e,1,c);}$.CGEventPost(0,e);$.NSThread.sleepForTimeInterval(s);}',
    body
  ].join('\n');
}

function scrollJxa(x, y, dx, dy, times) {
  return [
    "ObjC.import('ApplicationServices'); ObjC.import('Foundation');",
    `var m=$.CGEventCreateMouseEvent(null,${EV.move},$.CGPointMake(${x},${y}),0);$.CGEventPost(0,m);$.NSThread.sleepForTimeInterval(0.05);`,
    `for(var i=0;i<${times};i++){var e=$.CGEventCreateScrollWheelEvent2(null,1,2,${dy},${dx},0);$.CGEventPost(0,e);$.NSThread.sleepForTimeInterval(0.04);}`
  ].join('\n');
}

// System UI processes whose windows float over the front app (the Screenshot toolbar of Cmd+Shift+5, Control Center,
// notification banners, menu bar extras). The Dock is only read when it is asked for by name.
const SYSTEM_UI = ['screencaptureui', 'Control Center', 'NotificationCenter', 'SystemUIServer'];
// Artemis's own processes (main window, Sentinel widget, floating progress panel): never the target unless asked for by name.
const SELF_PROCS = ['Artemis', 'Electron'];
const isSelf = (name) => SELF_PROCS.some((s) => s.toLowerCase() === String(name || '').trim().toLowerCase());

/**
 * Dumps the clickable items of the front app's window (or the named app's window) as JSON, plus "groups": on-screen
 * windows of system UI processes and sheets/dialogs of other visible apps, each as {p: process, w: window title, items}.
 * Artemis's own windows are skipped (info.skipped) unless appName names Artemis.
 */
function uiJxa(appName, max = UI_MAX, { dock = false } = {}) {
  const target = appName ? String(appName) : '';
  const sys = SYSTEM_UI.concat(dock || /^dock$/i.test(target) ? ['Dock'] : []);
  const self = isSelf(target) ? [] : SELF_PROCS;
  return `
var se = Application('System Events');
var MAX = ${max}, OVR = ${Math.min(80, Math.floor(max / 3))}, n = 0;
var SYS = ${JSON.stringify(sys)};
var SELF = ${JSON.stringify(self)};
var DIALOG = {AXSheet:1,AXDialog:1,AXSystemDialog:1};
var KEEP = {AXButton:1,AXTextField:1,AXTextArea:1,AXCheckBox:1,AXRadioButton:1,AXMenuItem:1,AXMenuBarItem:1,AXPopUpButton:1,AXLink:1,AXTab:1,AXTabGroup:0,AXComboBox:1,AXSlider:1,AXStaticText:1,AXImage:0,AXMenuButton:1,AXSearchField:1,AXRow:0,AXCell:0,AXDisclosureTriangle:1,AXSwitch:1};
function nm(k){ var v=''; try{v=k.name()||'';}catch(e){} if(!v){try{v=k.title()||'';}catch(e){}} if(!v){try{v=k.description()||'';}catch(e){}} if(!v){try{var x=k.value(); if(typeof x==='string') v=x;}catch(e){}} return String(v).replace(/\\s+/g,' ').slice(0,80); }
function walk(el, d, out, max){
  if (n >= max || d > 10) return;
  var kids; try { kids = el.uiElements(); } catch(e) { return; }
  for (var i=0;i<kids.length && n<max;i++){
    var k = kids[i], role=''; try{role=k.role();}catch(e){}
    if (KEEP[role]) {
      var name = nm(k);
      if (name || role==='AXTextField' || role==='AXTextArea' || role==='AXSearchField') {
        try { var pos=k.position(), sz=k.size(); if (sz[0]>2 && sz[1]>2) { out.push({r:role.replace('AX',''),n:name,x:Math.round(pos[0]+sz[0]/2),y:Math.round(pos[1]+sz[1]/2),w:Math.round(sz[0]),h:Math.round(sz[1])}); n++; } } catch(e) {}
      }
    }
    walk(k, d+1, out, max);
  }
}
function has(list, v){ for (var i=0;i<list.length;i++) if (list[i]===v) return true; return false; }
function title(w){ var t=''; try{t=w.name()||'';}catch(e){} if(!t){try{t=w.title()||'';}catch(e){}} return String(t||'').slice(0,80); }
function onScreen(w){ try { var s=w.size(); return s[0]>2 && s[1]>2; } catch(e){ return false; } }
var info = {app: '', win: '', items: [], groups: [], apps: []};
var p = null;
try { p = ${target ? `se.processes.byName(${JSON.stringify(target)})` : 'se.processes.whose({frontmost:true})[0]'}; info.app = p.name(); } catch(e) { info.err = String(e); p = null; }
if (p && has(SELF, info.app)) { info.skipped = info.app; p = null; }
if (p) { try { var w = p.windows[0]; info.win = title(w); walk(w, 0, info.items, MAX - OVR); } catch(e) { info.err = String(e); } }
var procs = [];
try { procs = se.processes.whose({_or: [{visible: true}].concat(SYS.map(function(s){ return {name: s}; }))})(); } catch(e) {
  try { procs = se.processes.whose({visible: true})(); } catch(e2) {}
  for (var s=0;s<SYS.length;s++) { try { var sp = se.processes.byName(SYS[s]); sp.name(); procs.push(sp); } catch(e3) {} }
}
var seen = {};
for (var i=0;i<procs.length && n<MAX;i++) {
  var q = procs[i], qn = ''; try { qn = q.name(); } catch(e) { continue; }
  if (seen[qn] || has(SELF, qn) || (qn === 'Dock' && !has(SYS, 'Dock'))) continue;
  seen[qn] = 1;
  var isSys = has(SYS, qn), front = !!p && qn === info.app;
  if (!isSys && !front) info.apps.push(qn);
  var wins = []; try { wins = q.windows(); } catch(e) {}
  for (var j=0;j<wins.length && n<MAX;j++) {
    if (front && j === 0) continue;
    var w2 = wins[j], sr = ''; try { sr = w2.subrole() || ''; } catch(e) {}
    if (isSys || DIALOG[sr]) {
      if (onScreen(w2)) { var g = {p: qn, w: title(w2) || String(sr).replace('AX',''), items: []}; walk(w2, 0, g.items, MAX); if (g.items.length) info.groups.push(g); }
    } else if (!front) {
      try { var sh = w2.sheets(); for (var k=0;k<sh.length && n<MAX;k++) { var g2 = {p: qn, w: (title(w2) || 'window') + ' (sheet)', items: []}; walk(sh[k], 0, g2.items, MAX); if (g2.items.length) info.groups.push(g2); } } catch(e) {}
    }
  }
  if (isSys && qn !== 'screencaptureui' && n < MAX) { try { var g3 = {p: qn, w: 'menu bar extras', items: []}; walk(q.menuBars[0], 0, g3.items, Math.min(MAX, n + 25)); if (g3.items.length) info.groups.push(g3); } catch(e) {} }
}
if (p && n < 30) { try { walk(p.menuBars[0], 0, info.items, MAX); } catch(e) {} }
JSON.stringify(info);`;
}

/** Front window first, then the overlay groups; drops the front group when Artemis itself was skipped and nothing was read. */
function uiGroups(info) {
  const gs = [];
  if (!info.skipped || (info.items && info.items.length)) gs.push({ p: info.app || '?', w: info.win || '', items: info.items || [], front: true });
  for (const g of info.groups || []) gs.push({ p: String(g.p || '?'), w: String(g.w || ''), items: g.items || [], front: false });
  return gs;
}

/** Element search for click_ui: front app first (exact, then partial name), then overlays; app limits it to one process. */
function findUi(info, query, { role = '', app = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const r = String(role || '').toLowerCase().replace(/^ax/, '');
  const a = String(app || '').trim().toLowerCase();
  const tiers = [];
  for (const g of uiGroups(info)) {
    if (a && g.p.toLowerCase() !== a) continue;
    const list = g.items.filter((e) => (!r || String(e.r).toLowerCase() === r) && String(e.n).toLowerCase().includes(q)).map((e) => ({ ...e, p: g.p, win: g.w }));
    tiers.push({ front: g.front, list });
  }
  for (const front of [true, false]) {
    const all = tiers.filter((t) => t.front === front).flatMap((t) => t.list);
    const hit = all.find((e) => e.n.toLowerCase() === q) || all[0];
    if (hit) return hit;
  }
  return null;
}

/** Converts a region given in pixels of the latest screenshot into screen points (clipped to the image). */
function regionToPoints(region, shot) {
  let r = region;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
  if (!r || typeof r !== 'object') throw new Error('region must be an object {x, y, width, height} in pixels of the latest screenshot');
  const x = Number(r.x), y = Number(r.y), width = Number(r.width ?? r.w), height = Number(r.height ?? r.h);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('region needs numbers x, y, width and height (> 0), in pixels of the latest screenshot');
  const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(shot.w, x + width), y1 = Math.min(shot.h, y + height);
  if (x1 - x0 < 1 || y1 - y0 < 1) throw new Error(`region is outside the latest screenshot, which is ${shot.w}x${shot.h} pixels (region coordinates are pixels of that image).`);
  const s = shot.scale;
  return { x: Math.round(x0 * s), y: Math.round(y0 * s), width: Math.max(1, Math.round((x1 - x0) * s)), height: Math.max(1, Math.round((y1 - y0) * s)), clipped: x0 !== x || y0 !== y || x1 !== x + width || y1 !== y + height };
}

/** The screenshot geometry a "screenshot" call would produce for a screen of this size (sips -Z MAX_DIM keeps the aspect). */
function virtualShot(size) {
  const big = Math.max(size.width, size.height);
  const scale = big > MAX_DIM ? big / MAX_DIM : 1;
  return { w: Math.round(size.width / scale), h: Math.round(size.height / scale), scale };
}

const stamp = (d = new Date()) => { const p = (v) => String(v).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} at ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`; };

/** png / jpg for capture_screen, from format or the path's extension. */
function imageFormat(args = {}) {
  const norm = (v) => { const f = String(v || '').toLowerCase().replace(/^\./, ''); return f === 'jpeg' ? 'jpg' : f; };
  const fromPath = args.path ? norm(path.extname(String(args.path))) : '';
  const f = norm(args.format) || (['png', 'jpg'].includes(fromPath) ? fromPath : '') || 'png';
  if (!['png', 'jpg'].includes(f)) throw new Error('format must be png or jpg');
  if (fromPath && ['png', 'jpg'].includes(fromPath) && fromPath !== f) throw new Error(`path ends in .${fromPath} but format is ${f}`);
  return f;
}

/**
 * Where a capture is saved: default ~/Desktop/<base> <date>.<ext>; ~ is expanded, relative paths go to the Desktop,
 * a folder gets the default name, the extension is added when missing, and an existing file is never overwritten.
 */
function outputPath(p, { home = os.homedir(), base, ext, now = new Date(), exists = fs.existsSync, isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } } }) {
  const name = `${base} ${stamp(now)}.${ext}`;
  let f = String(p || '').trim();
  if (!f) f = path.join(home, 'Desktop', name);
  else {
    if (f === '~' || f.startsWith('~/')) f = path.join(home, f.slice(1));
    if (!path.isAbsolute(f)) f = path.join(home, 'Desktop', f);
    if (/[\\/]$/.test(f) || isDir(f)) f = path.join(f, name);
    const e = path.extname(f).toLowerCase().slice(1);
    if (!e) f += '.' + ext;
    else if ((e === 'jpeg' ? 'jpg' : e) !== ext) throw new Error(`path must end in .${ext}`);
  }
  f = path.normalize(f);
  if (!exists(f)) return f;
  const dot = f.length - path.extname(f).length;
  for (let i = 2; i < 1000; i++) { const c = `${f.slice(0, dot)} (${i})${f.slice(dot)}`; if (!exists(c)) return c; }
  throw new Error('Could not find a free file name for ' + f);
}

/** Arguments for the screencapture CLI (no UI, no sound). Region is in screen points. */
function captureArgs({ files, display = 'main', region = null, windowId = null, format = 'png', video = false, audio = false, seconds = 0 }) {
  const a = ['-x'];
  if (video) { a.push('-v'); if (seconds) a.push('-V', String(seconds)); if (audio) a.push('-g'); } else a.push('-t', format);
  if (windowId) a.push('-o', '-l', String(windowId));
  else if (region) a.push('-R', `${region.x},${region.y},${region.width},${region.height}`);
  else if (!video && display !== 'all') a.push('-m');
  return a.concat(files);
}

/** JXA: id of the frontmost normal window (CGWindowList is front to back), skipping Artemis unless asked for; or of the named app. */
function windowIdJxa(appName) {
  const want = appName ? String(appName).toLowerCase() : '';
  return `ObjC.import('CoreGraphics');
var SELF = ${JSON.stringify(isSelf(want) ? [] : SELF_PROCS)}, want = ${JSON.stringify(want)};
var list = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(17, 0))) || [];
var out = null;
for (var i = 0; i < list.length; i++) {
  var w = list[i], o = String(w.kCGWindowOwnerName || ''), b = w.kCGWindowBounds || {};
  if (w.kCGWindowLayer !== 0 || !(b.Width >= 40 && b.Height >= 40)) continue;
  if (want ? o.toLowerCase() !== want : SELF.indexOf(o) >= 0) continue;
  out = {id: w.kCGWindowNumber, app: o, title: String(w.kCGWindowName || '')}; break;
}
JSON.stringify(out);`;
}

function friendly(err) {
  const m = String(err.stderr || err.message || err);
  if (/assistive|-25211|-1719|not allowed/i.test(m)) {
    return 'Accessibility permission is missing. Open System Settings → Privacy & Security → Accessibility and allow the app that runs Artemis (Terminal, iTerm or Electron), then try again.';
  }
  if (!/^No element matching/.test(m) && /screen ?capture(?!ui)|could not create image|cannot run/i.test(m)) { // not the process name screencaptureui
    return 'Screen capture failed. Allow Screen Recording for the app that runs Artemis in System Settings → Privacy & Security → Screen Recording.';
  }
  // node puts the whole command (here a long script) first and the real reason last, so keep the end of it
  if (/^Command failed:/.test(m) && m.length > 400) return '…' + m.trim().slice(-350);
  return m.trim().slice(0, 500) || 'Unknown error';
}

function createComputer({ exec = defaultExec, spawn = defaultSpawn, screenSize, platform = process.platform, tmpDir = os.tmpdir(), home = os.homedir(), avoid, onRecording } = {}) {
  let shot = null; // { w, h, scale }
  let rec = null;  // the screen recording in progress: { child, file, started, ended, exit, max, err }
  let recent = []; // last click-like actions since the latest screenshot: [{ a, ok }]

  // Size of the primary display in points (screencapture -m captures only that one). The injected Electron size is
  // preferred; the Finder desktop bounds span all displays and are only the last resort.
  const valid = (s) => s && Number(s.width) > 0 && Number(s.height) > 0;
  async function logicalSize() {
    if (screenSize) { try { const s = await screenSize(); if (valid(s)) return { width: Number(s.width), height: Number(s.height) }; } catch {} }
    try {
      const { stdout } = await exec('osascript', ['-l', 'JavaScript', '-e', "ObjC.import('AppKit'); const f = $.NSScreen.screens.objectAtIndex(0).frame; JSON.stringify({ width: f.size.width, height: f.size.height })"]);
      const s = JSON.parse(stdout.trim());
      if (valid(s)) return s;
    } catch {}
    const { stdout } = await exec('osascript', ['-e', 'tell application "Finder" to get bounds of window of desktop']);
    const [, , r, b] = stdout.trim().split(/,\s*/).map(Number);
    return { width: r, height: b };
  }

  async function screenshot({ signal } = {}) {
    const file = path.join(tmpDir, `aid-shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`);
    try {
      await exec('screencapture', ['-x', '-m', '-t', 'jpg', file], { signal });
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new Error('screen capture produced no image');
      await exec('sips', ['-Z', String(MAX_DIM), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_QUALITY), file], { signal });
      const { stdout } = await exec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { signal });
      const w = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1]);
      const h = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1]);
      if (!w || !h) throw new Error('could not read screenshot size');
      const size = await logicalSize();
      shot = { w, h, scale: size.width / w };
      const data = fs.readFileSync(file).toString('base64');
      return {
        ok: true,
        text: `Screenshot ${w}x${h} (screen is ${size.width}x${size.height} points). Use pixel coordinates of this image for x/y.`,
        image: `data:image/jpeg;base64,${data}`
      };
    } finally {
      try { fs.unlinkSync(file); } catch {}
    }
  }

  const point = (x, y) => {
    if (!shot) throw new Error('Take a screenshot first (action "screenshot"); coordinates refer to the latest screenshot.');
    const nx = Number(x), ny = Number(y);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new Error('x and y are required numbers');
    if (nx < 0 || ny < 0 || nx >= shot.w || ny >= shot.h) {
      const cx = Math.min(Math.max(Math.round(nx), 0), shot.w - 1), cy = Math.min(Math.max(Math.round(ny), 0), shot.h - 1);
      throw new Error(`Coordinates (${nx}, ${ny}) are outside the latest screenshot, which is ${shot.w}x${shot.h} pixels. x/y are pixels of that screenshot image (x 0-${shot.w - 1}, y 0-${shot.h - 1}), not screen points; the nearest valid point is (${cx}, ${cy}). Do not guess: find the element with ui / click_ui first, or take a new screenshot.`);
    }
    const out = { x: Math.round(nx * shot.scale), y: Math.round(ny * shot.scale) };
    const r = avoid && avoid();
    if (r && out.x >= r.x && out.x <= r.x + r.width && out.y >= r.y && out.y <= r.y + r.height) {
      throw new Error('That spot is covered by the small Artemis control panel (it is hidden from screenshots). Choose a different point, or scroll/move the target app so the control is elsewhere.');
    }
    return out;
  };

  // several chats may use the computer: actions are queued so they never interleave
  let queue = Promise.resolve();
  const run = (args, opts) => { const p = queue.then(() => runNow(args, opts)); queue = p.catch(() => {}); return p; };

  const ACTIONS = 'screenshot, ui, click_ui, open, mouse_move, left_click, double_click, right_click, left_click_drag, scroll, type, key, wait, capture_screen, record_screen_start or record_screen_stop';
  let lastUi = null;   // last ui list (for click_ui)
  let callsSinceShot = 99;
  let lastHash = null; // hash of the last screenshot sent: if the screen did not change we do not send it again

  const fmtUi = (info) => {
    const out = [];
    let i = 0;
    if (info.skipped) out.push(`(${info.skipped} itself is frontmost; its own windows are skipped. Pass app to read another app${info.apps && info.apps.length ? ` (visible apps: ${info.apps.slice(0, 12).join(', ')})` : ''}.)`);
    for (const g of uiGroups(info)) {
      out.push(`[${g.p}${g.w ? ` — ${g.w}` : ''}]${g.front ? ' (front app)' : ''}`);
      if (!g.items.length) out.push('(no accessible elements)');
      for (const e of g.items) out.push(`${++i}. ${e.r} "${e.n}" at (${e.x},${e.y}) ${e.w}x${e.h}`);
    }
    if (!i) out.push('(no accessible elements found; use screenshot)');
    return out.join('\n') + '\nCoordinates are SCREEN points; click_ui {query, app?} clicks an element by name without a screenshot (front app first, then the system toolbars/dialogs listed in [brackets]; app = the process name in brackets).';
  };
  const readUi = async (jxa, app) => {
    const { stdout } = await jxa(uiJxa(app));
    const info = JSON.parse(stdout.trim() || '{}');
    lastUi = { info, t: Date.now(), app: app || '' };
    return info;
  };
  const notFound = (info, query, app) => {
    const names = (items) => [...new Set(items.map((e) => e.n).filter(Boolean))];
    const gs = uiGroups(info);
    const front = gs.find((g) => g.front);
    const frontNames = front ? names(front.items).slice(0, 30) : [];
    const ovr = gs.filter((g) => !g.front && (!app || g.p.toLowerCase() === String(app).toLowerCase())).map((g) => ({ g, n: names(g.items).slice(0, 15) })).filter((x) => x.n.length).slice(0, 6);
    const q = (v) => `"${v}"`;
    let msg = `No element matching "${query}"${app ? ` in ${app}` : ''}.`;
    if (frontNames.length) msg += ` Front window (${front.p}): ${frontNames.map(q).join(', ')}.`;
    else if (info.skipped) msg += ` (${info.skipped} itself is skipped; pass app to target another app.)`;
    else msg += ' The front window shows no accessible elements.';
    msg += ovr.length ? ` System toolbars/dialogs: ${ovr.map((x) => `[${x.g.p}${x.g.w ? ` — ${x.g.w}` : ''}] ${x.n.map(q).join(', ')}`).join('; ')}.` : ' No system toolbars or dialogs are open.';
    return msg + ' Use one of these names (pass app with the process name to target it). Only if none fits, take a screenshot and use its coordinates.';
  };

  const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const displayCount = async (jxa) => { try { const { stdout } = await jxa("ObjC.import('AppKit'); String($.NSScreen.screens.count)"); return Math.min(Math.max(parseInt(stdout, 10) || 1, 1), 8); } catch { return 1; } };
  /** Scaled JPEG preview of a saved capture, as a data URL (null if it cannot be made). */
  async function previewOf(file, signal) {
    const tmp = path.join(tmpDir, `aid-prev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`);
    try {
      await exec('sips', ['-Z', String(MAX_DIM), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(JPEG_QUALITY), file, '--out', tmp], { signal });
      const { stdout } = await exec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', tmp], { signal });
      const w = Number((stdout.match(/pixelWidth:\s*(\d+)/) || [])[1]), h = Number((stdout.match(/pixelHeight:\s*(\d+)/) || [])[1]);
      return { image: 'data:image/jpeg;base64,' + fs.readFileSync(tmp).toString('base64'), w, h };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return null;
    } finally { try { fs.unlinkSync(tmp); } catch {} }
  }

  async function captureScreen(args, jxa, signal) {
    const format = imageFormat(args);
    const display = args.display === 'all' ? 'all' : 'main';
    if (args.region && args.window) throw new Error('Use either region or window, not both.');
    const region = args.region ? regionToPoints(args.region, shot || virtualShot(await logicalSize())) : null;
    let win = null;
    if (args.window) {
      const { stdout } = await jxa(windowIdJxa(typeof args.window === 'string' ? args.window : ''));
      win = JSON.parse(stdout.trim() || 'null');
      if (!win || !win.id) throw new Error(`No on-screen window found${typeof args.window === 'string' ? ` for ${args.window}` : ''}. Capture the screen or a region instead.`);
    }
    const file = outputPath(args.path, { home, base: 'Screenshot', ext: format });
    const files = [file];
    if (display === 'all' && !region && !win) {
      const n = await displayCount(jxa);
      const dot = file.length - path.extname(file).length;
      for (let i = 2; i <= n; i++) files.push(`${file.slice(0, dot)} (display ${i})${file.slice(dot)}`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await exec('screencapture', captureArgs({ files, display, region, windowId: win && win.id, format }), { signal });
    const saved = files.filter((f) => fileSize(f) > 0);
    if (!saved.length) throw new Error('screen capture produced no file (Screen Recording permission?)');
    const prev = await previewOf(saved[0], signal);
    if (prev && prev.w && prev.h && display === 'main' && !region && !win) { // same picture as a screenshot: its pixels become the click coordinates
      const size = await logicalSize();
      shot = { w: prev.w, h: prev.h, scale: size.width / prev.w };
      lastHash = null; callsSinceShot = 0; recent = [];
    }
    const what = win ? `window of ${win.app}${win.title ? ` "${win.title}"` : ''}` : region ? `region ${region.width}x${region.height} points at (${region.x},${region.y})${region.clipped ? ' (clipped to the screen)' : ''}` : display === 'all' ? `${saved.length} display(s)` : 'main display';
    return { text: `Saved full-resolution screenshot (${what}) to ${saved.join(', ')}.${prev ? ' A scaled preview is attached.' : ''}`, image: prev ? prev.image : null };
  }

  async function startRecording(args, signal) {
    if (rec && !rec.ended) throw new Error(`A screen recording is already running (${rec.file}). Stop it with record_screen_stop first.`);
    const max = Math.min(Math.max(Math.round(Number(args.max_seconds) || 300), 1), 3600);
    const region = args.region ? regionToPoints(args.region, shot || virtualShot(await logicalSize())) : null;
    const file = outputPath(args.path, { home, base: 'Screen Recording', ext: 'mov' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const child = spawn('screencapture', captureArgs({ files: [file], region, video: true, audio: args.audio === true, seconds: max }), { stdio: ['pipe', 'ignore', 'pipe'] });
    const r = { child, file, started: Date.now(), ended: 0, code: null, max, err: '' };
    child.stderr?.on?.('data', (d) => { r.err = (r.err + d).slice(-2000); });
    r.exit = new Promise((resolve) => {
      child.once('exit', (code) => { r.ended = Date.now(); r.code = code; resolve(); });
      child.once('error', (e) => { r.ended = Date.now(); r.err += String(e.message || e); resolve(); });
    });
    rec = r;
    await Promise.race([r.exit, delay(800)]); // a recording that cannot start (permission, bad flag) ends at once
    if (r.ended && (r.code !== 0 || !fileSize(file))) { rec = null; throw new Error(`Screen recording did not start${r.err.trim() ? ': ' + r.err.trim().slice(-300) : ''}. It needs Screen Recording permission for Artemis.`); }
    signal?.addEventListener?.('abort', () => { if (rec === r) stopRecording().catch(() => {}); }, { once: true });
    try { onRecording?.({ state: 'started', file, max }); } catch {}
    return `Recording the screen to ${file}${region ? ` (region ${region.width}x${region.height} points)` : ''}${args.audio === true ? ' with microphone audio' : ''}. It stops by itself after ${max} s; call record_screen_stop to finish earlier.`;
  }

  /** Stops the recording (SIGINT lets screencapture finalize the movie) and waits for the file. Null when none runs. */
  async function stopRecording({ wait = 5000 } = {}) {
    const r = rec;
    if (!r) return null;
    rec = null;
    if (!r.ended) {
      try { r.child.kill('SIGINT'); } catch {}
      await Promise.race([r.exit, delay(wait)]);
      if (!r.ended) { try { r.child.stdin?.write('\n'); } catch {} await Promise.race([r.exit, delay(wait)]); } // screencapture -v also stops on a key press
      if (!r.ended) { try { r.child.kill('SIGTERM'); } catch {} await Promise.race([r.exit, delay(1000)]); }
    }
    let size = 0;
    for (let i = 0; i < 25; i++) { const now = fileSize(r.file); if (now > 0 && now === size) break; size = now; await delay(200); }
    const out = { file: r.file, bytes: fileSize(r.file), seconds: Math.round(((r.ended || Date.now()) - r.started) / 100) / 10, err: r.err.trim().slice(-300) };
    try { onRecording?.({ state: 'stopped', ...out }); } catch {}
    return out;
  }

  // the same click twice without looking usually means it did nothing: say so
  const spot = (a) => {
    const n = String(a.action || '');
    if (['left_click', 'double_click', 'right_click'].includes(n)) return { n, x: Number(a.x), y: Number(a.y) };
    if (n === 'click_ui') return { n, q: String(a.query || '').trim().toLowerCase(), app: String(a.app || a.process || '').toLowerCase() };
    return null;
  };
  const sameSpot = (u, v) => u.n === v.n && (u.n === 'click_ui' ? u.q === v.q && u.app === v.app : Math.abs(u.x - v.x) <= 8 && Math.abs(u.y - v.y) <= 8);
  const repeatHint = (a, ok) => {
    const sp = spot(a);
    if (!sp) return '';
    const before = recent.filter((r) => sameSpot(r.sp, sp));
    recent.push({ sp, ok }); recent = recent.slice(-6);
    if (!before.length) return '';
    const failed = before.filter((r) => !r.ok).length + (ok ? 0 : 1);
    return `\n(This is attempt ${before.length + 1} at the same ${sp.n === 'click_ui' ? `element "${sp.q}"` : 'point'}${failed ? `, ${failed} failed` : ''}, without a screenshot in between: take a screenshot to verify before clicking again.)`;
  };

  /** Runs one action; takes no screenshot. Returns a short result text. */
  async function perform(args, signal) {
    const action = String(args.action || '');
    const jxa = (script) => exec('osascript', ['-l', 'JavaScript', '-e', script], { signal });
    const as = (lines) => exec('osascript', ['-e', systemEvents(lines)], { signal });
    switch (action) {
      case 'screenshot': return '';
      case 'ui': {
        const info = await readUi(jxa, args.app);
        return fmtUi(info);
      }
      case 'click_ui': {
        const q = String(args.query || '').trim().toLowerCase();
        if (!q) throw new Error('query is required (part of the element name)');
        const app = String(args.app || args.process || '').trim();
        const opts = { role: args.role, app };
        let info = lastUi && lastUi.app === app && Date.now() - lastUi.t < 8000 ? lastUi.info : await readUi(jxa, app);
        let el = findUi(info, q, opts);
        if (!el) { info = await readUi(jxa, app); el = findUi(info, q, opts); }
        if (!el) throw new Error(notFound(info, args.query, app));
        const r = avoid && avoid();
        if (r && el.x >= r.x && el.x <= r.x + r.width && el.y >= r.y && el.y <= r.y + r.height) throw new Error('That element is under the Artemis control panel; move the target window.');
        const steps = [{ t: EV.move, x: el.x, y: el.y }, { t: EV.leftDown, x: el.x, y: el.y, c: 1 }, { t: EV.leftUp, x: el.x, y: el.y, c: 1 }];
        await jxa(mouseJxa(steps));
        lastUi = null;
        return `Clicked ${el.r} "${el.n}" at (${el.x},${el.y})${info.app && el.p === info.app && !info.skipped ? '' : ` in ${el.p}${el.win ? ` — ${el.win}` : ''}`}.`;
      }
      case 'capture_screen': return captureScreen(args, jxa, signal);
      case 'record_screen_start': return startRecording(args, signal);
      case 'record_screen_stop': {
        if (!rec) throw new Error('No screen recording is running.');
        const o = await stopRecording();
        if (!o.bytes) throw new Error(`The recording stopped but no video was saved at ${o.file}${o.err ? ` (${o.err})` : ''}. Check Screen Recording permission for Artemis.`);
        return `Saved screen recording to ${o.file} (${(o.bytes / 1048576).toFixed(1)} MB, ${o.seconds} s).`;
      }
      case 'open': {
        const target = String(args.url || args.app || '').trim();
        if (!target) throw new Error('url or app is required');
        if (args.url) { if (!/^https?:\/\//i.test(target)) throw new Error('url must start with http:// or https://'); await exec('open', [target], { signal }); return `Opened ${target}.`; }
        await exec('open', ['-a', target], { signal });
        return `Opened ${target}.`;
      }
      case 'mouse_move': {
        const p = point(args.x, args.y);
        await jxa(mouseJxa([{ t: EV.move, x: p.x, y: p.y }]));
        return `Moved mouse to (${args.x}, ${args.y}).`;
      }
      case 'left_click': case 'double_click': case 'right_click': {
        const p = point(args.x, args.y);
        const right = action === 'right_click';
        const down = right ? EV.rightDown : EV.leftDown, up = right ? EV.rightUp : EV.leftUp, b = right ? 1 : 0;
        const steps = [{ t: EV.move, x: p.x, y: p.y }, { t: down, x: p.x, y: p.y, b, c: 1 }, { t: up, x: p.x, y: p.y, b, c: 1 }];
        if (action === 'double_click') steps.push({ t: down, x: p.x, y: p.y, b, c: 2 }, { t: up, x: p.x, y: p.y, b, c: 2 });
        await jxa(mouseJxa(steps));
        lastUi = null;
        return `${action.replace('_', ' ')} at (${args.x}, ${args.y}).`;
      }
      case 'left_click_drag': {
        const a = point(args.x, args.y), z = point(args.end_x, args.end_y);
        const steps = [{ t: EV.move, x: a.x, y: a.y }, { t: EV.leftDown, x: a.x, y: a.y, c: 1, s: 0.08 }];
        for (let i = 1; i <= 8; i++) steps.push({ t: EV.leftDrag, x: Math.round(a.x + (z.x - a.x) * i / 8), y: Math.round(a.y + (z.y - a.y) * i / 8), s: 0.02 });
        steps.push({ t: EV.leftUp, x: z.x, y: z.y, c: 1 });
        await jxa(mouseJxa(steps));
        lastUi = null;
        return `Dragged from (${args.x}, ${args.y}) to (${args.end_x}, ${args.end_y}).`;
      }
      case 'scroll': {
        const p = point(args.x, args.y);
        const dir = String(args.direction || 'down');
        const amount = Math.min(Math.max(Math.round(Number(args.amount) || 5), 1), 50);
        const dy = dir === 'up' ? 3 : dir === 'down' ? -3 : 0, dx = dir === 'left' ? 3 : dir === 'right' ? -3 : 0;
        if (!['up', 'down', 'left', 'right'].includes(dir)) throw new Error('direction must be up, down, left or right');
        await jxa(scrollJxa(p.x, p.y, dx, dy, amount));
        lastUi = null;
        return `Scrolled ${dir} by ${amount}.`;
      }
      case 'type': {
        if (typeof args.text !== 'string' || !args.text) throw new Error('text is required');
        await as(typeLines(args.text));
        return `Typed ${args.text.length} characters.`;
      }
      case 'key': {
        await as([keyLine(args.keys)]);
        lastUi = null;
        return `Pressed ${cleanKeys(args.keys)}.`;
      }
      case 'wait': {
        const ms = Math.min(Math.max(Number(args.ms) || 1000, 100), 10000);
        await sleep(ms, signal);
        return `Waited ${ms} ms.`;
      }
      default:
        throw new Error(`Unknown action: ${action}. Use ${ACTIONS}.`);
    }
  }

  /**
   * Default: NO screenshot is taken after the action (fast and cheap).
   * Pass look:true or call "screenshot" to see the result. "actions" runs several actions in one call.
   */
  async function runNow(args, { signal } = {}) {
    if (platform !== 'darwin') return { ok: false, text: 'Error: computer control is only supported on macOS.' };
    const list = Array.isArray(args.actions) && args.actions.length ? args.actions.slice(0, 15) : [args];
    const done = [];
    let img = null; // a preview from capture_screen
    try {
      let acted = false;
      for (let i = 0; i < list.length; i++) {
        const a = list[i] || {};
        const name = String(a.action || '');
        try {
          const res = await perform(a, signal);
          let t = res && typeof res === 'object' ? res.text : res;
          if (res && typeof res === 'object' && res.image) img = res.image;
          t = (t || '') + repeatHint(a, true);
          if (t) done.push(list.length > 1 ? `${i + 1}. ${t}` : t);
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          return { ok: false, text: `Error${list.length > 1 ? ` in step ${i + 1} (${name})` : ''}: ${friendly(err)}${repeatHint(a, false)}${done.length ? `\nCompleted before the error:\n${done.join('\n')}` : ''}` };
        }
        if (!['screenshot', 'wait', 'ui', 'capture_screen', 'record_screen_start', 'record_screen_stop'].includes(name)) { acted = true; await sleep(i < list.length - 1 ? 250 : 450, signal); }
      }
      const explicit = list.length === 1 && String(list[0].action) === 'screenshot';
      let look = explicit || args.look === true || (list.length > 1 && list[list.length - 1].look === true);
      const text = done.join('\n');
      // A model that asks for a picture after every step makes the task slow: a look:true right after a screenshot is skipped (an explicit "screenshot" action always works).
      callsSinceShot += 1;
      if (img && !explicit) return { ok: true, text, image: img };
      if (look && !explicit && callsSinceShot < 3 && lastHash) return { ok: true, text: (text ? text + '\n' : '') + '(Screenshot skipped to save time: the last one is recent. Use ui / click_ui, or call action "screenshot" if you really must see the screen.)' };
      if (!look) return { ok: true, text: (text ? text + '\n' : '') + (acted ? '(No screenshot taken. Pass look:true, or call "screenshot", when you need to see the result.)' : '') };
      const r = await screenshot({ signal });
      const h = require('crypto').createHash('md5').update(r.image).digest('hex');
      if (!explicit && h === lastHash) return { ok: true, text: (text ? text + '\n' : '') + 'Screen unchanged since the last screenshot.' };
      lastHash = h; callsSinceShot = 0; recent = [];
      return { ...r, text: (text ? text + '\n' : '') + r.text };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, text: 'Error: cancelled.' + (rec && !rec.ended ? ' The screen recording is being stopped.' : '') };
      return { ok: false, text: `Error: ${friendly(err)}` };
    }
  }

  const shotQueued = (opts) => { const p = queue.then(() => screenshot(opts)); queue = p.catch(() => {}); return p; };

  const recording = () => (rec && !rec.ended ? { file: rec.file, started: rec.started, max: rec.max } : null);
  return { run, screenshot: shotQueued, stopRecording, recording, _state: () => shot };
}

module.exports = { createComputer, keyLine, typeLines, mouseJxa, scrollJxa, systemEvents, uiJxa, uiGroups, findUi, regionToPoints, virtualShot, imageFormat, outputPath, captureArgs, windowIdJxa, friendly, KEYCODES, SYSTEM_UI, SELF_PROCS };
