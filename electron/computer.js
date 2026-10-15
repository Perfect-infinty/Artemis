// Computer control for macOS: screenshots (screencapture + sips), mouse (JXA / CoreGraphics), keyboard (AppleScript).
// Needs Screen Recording and Accessibility permission for the app that launches it (Terminal / Electron).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const MAX_DIM = 1024;       // small screenshot = fewer tokens
const JPEG_QUALITY = 45;
const UI_MAX = 220;         // at most this many items from the accessibility tree

const KEYCODES = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121, forwarddelete: 117,
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
function keyLine(spec) {
  const parts = String(spec || '').split('+').map((s) => s.trim()).filter(Boolean);
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

/** Dumps the clickable items of the front app's window (or the named app's window) as JSON. */
function uiJxa(appName, max = UI_MAX) {
  return `
var se = Application('System Events');
var p = ${appName ? `se.processes.byName(${JSON.stringify(String(appName))})` : "se.processes.whose({frontmost:true})[0]"};
var out = [], n = 0, MAX = ${max};
var KEEP = {AXButton:1,AXTextField:1,AXTextArea:1,AXCheckBox:1,AXRadioButton:1,AXMenuItem:1,AXMenuBarItem:1,AXPopUpButton:1,AXLink:1,AXTab:1,AXTabGroup:0,AXComboBox:1,AXSlider:1,AXStaticText:1,AXImage:0,AXMenuButton:1,AXSearchField:1,AXRow:0,AXCell:0,AXDisclosureTriangle:1,AXSwitch:1};
function nm(k){ var v=''; try{v=k.name()||'';}catch(e){} if(!v){try{v=k.title()||'';}catch(e){}} if(!v){try{v=k.description()||'';}catch(e){}} if(!v){try{var x=k.value(); if(typeof x==='string') v=x;}catch(e){}} return String(v).replace(/\s+/g,' ').slice(0,80); }
function walk(el, d){
  if (n >= MAX || d > 10) return;
  var kids; try { kids = el.uiElements(); } catch(e) { return; }
  for (var i=0;i<kids.length && n<MAX;i++){
    var k = kids[i], role=''; try{role=k.role();}catch(e){}
    if (KEEP[role]) {
      var name = nm(k);
      if (name || role==='AXTextField' || role==='AXTextArea' || role==='AXSearchField') {
        try { var pos=k.position(), sz=k.size(); if (sz[0]>2 && sz[1]>2) { out.push({r:role.replace('AX',''),n:name,x:Math.round(pos[0]+sz[0]/2),y:Math.round(pos[1]+sz[1]/2),w:Math.round(sz[0]),h:Math.round(sz[1])}); n++; } } catch(e) {}
      }
    }
    walk(k, d+1);
  }
}
var info = {app: '', win: '', items: out};
try { info.app = p.name(); } catch(e) {}
try { var w = p.windows[0]; info.win = w.name() || ''; walk(w, 0); } catch(e) { info.err = String(e); }
try { if (out.length < 30) { var mb = p.menuBars[0]; walk(mb, 0); } } catch(e) {}
JSON.stringify(info);`;
}

function friendly(err) {
  const m = String(err.stderr || err.message || err);
  if (/assistive|-25211|-1719|not allowed/i.test(m)) {
    return 'Accessibility permission is missing. Open System Settings → Privacy & Security → Accessibility and allow the app that runs Artemis (Terminal, iTerm or Electron), then try again.';
  }
  if (/screen ?capture|could not create image|cannot run/i.test(m)) {
    return 'Screen capture failed. Allow Screen Recording for the app that runs Artemis in System Settings → Privacy & Security → Screen Recording.';
  }
  // node puts the whole command (here a long script) first and the real reason last, so keep the end of it
  if (/^Command failed:/.test(m) && m.length > 400) return '…' + m.trim().slice(-350);
  return m.trim().slice(0, 500) || 'Unknown error';
}

function createComputer({ exec = defaultExec, screenSize, platform = process.platform, tmpDir = os.tmpdir(), avoid } = {}) {
  let shot = null; // { w, h, scale }

  async function logicalSize() {
    if (screenSize) return screenSize();
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
    if (nx < 0 || ny < 0 || nx >= shot.w || ny >= shot.h) throw new Error(`Coordinates (${nx}, ${ny}) are outside the screenshot (${shot.w}x${shot.h}).`);
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

  const ACTIONS = 'screenshot, ui, click_ui, open, mouse_move, left_click, double_click, right_click, left_click_drag, scroll, type, key or wait';
  let lastUi = null;   // last ui list (for click_ui)
  let lastHash = null; // hash of the last screenshot sent: if the screen did not change we do not send it again

  const fmtUi = (info) => {
    const lines = (info.items || []).map((e, i) => `${i + 1}. ${e.r} "${e.n}" at (${e.x},${e.y}) ${e.w}x${e.h}`);
    return `App: ${info.app || '?'}${info.win ? ` — window "${info.win}"` : ''}\n` + (lines.join('\n') || '(no accessible elements found; use screenshot)') + `\nCoordinates are SCREEN points; click_ui {query} clicks an element by name without a screenshot.`;
  };
  const readUi = async (jxa, app) => {
    const { stdout } = await jxa(uiJxa(app));
    const info = JSON.parse(stdout.trim() || '{}');
    lastUi = { info, t: Date.now() };
    return info;
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
        let info = lastUi && Date.now() - lastUi.t < 8000 ? lastUi.info : await readUi(jxa, args.app);
        const role = args.role ? String(args.role).toLowerCase().replace(/^ax/, '') : '';
        const find = (inf) => {
          const list = (inf.items || []).filter((e) => (!role || e.r.toLowerCase() === role) && e.n.toLowerCase().includes(q));
          return list.find((e) => e.n.toLowerCase() === q) || list[0];
        };
        let el = find(info);
        if (!el && info !== (lastUi && lastUi.info)) el = null;
        if (!el) { info = await readUi(jxa, args.app); el = find(info); }
        if (!el) throw new Error(`No element matching "${args.query}". Call action "ui" to list elements, or use screenshot.`);
        const r = avoid && avoid();
        if (r && el.x >= r.x && el.x <= r.x + r.width && el.y >= r.y && el.y <= r.y + r.height) throw new Error('That element is under the Artemis control panel; move the target window.');
        const steps = [{ t: EV.move, x: el.x, y: el.y }, { t: EV.leftDown, x: el.x, y: el.y, c: 1 }, { t: EV.leftUp, x: el.x, y: el.y, c: 1 }];
        await jxa(mouseJxa(steps));
        lastUi = null;
        return `Clicked ${el.r} "${el.n}" at (${el.x},${el.y}).`;
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
        return `Pressed ${args.keys}.`;
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
    try {
      let acted = false;
      for (let i = 0; i < list.length; i++) {
        const a = list[i] || {};
        const name = String(a.action || '');
        try {
          const t = await perform(a, signal);
          if (t) done.push(list.length > 1 ? `${i + 1}. ${t}` : t);
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          return { ok: false, text: `Error${list.length > 1 ? ` in step ${i + 1} (${name})` : ''}: ${friendly(err)}${done.length ? `\nCompleted before the error:\n${done.join('\n')}` : ''}` };
        }
        if (name !== 'screenshot' && name !== 'wait' && name !== 'ui') { acted = true; await sleep(i < list.length - 1 ? 250 : 450, signal); }
      }
      const explicit = list.length === 1 && String(list[0].action) === 'screenshot';
      const look = explicit || args.look === true || (list.length > 1 && list[list.length - 1].look === true);
      const text = done.join('\n');
      if (!look) return { ok: true, text: (text ? text + '\n' : '') + (acted ? '(No screenshot taken. Pass look:true, or call "screenshot", when you need to see the result.)' : '') };
      const r = await screenshot({ signal });
      const h = require('crypto').createHash('md5').update(r.image).digest('hex');
      if (!explicit && h === lastHash) return { ok: true, text: (text ? text + '\n' : '') + 'Screen unchanged since the last screenshot.' };
      lastHash = h;
      return { ...r, text: (text ? text + '\n' : '') + r.text };
    } catch (err) {
      if (err.name === 'AbortError') return { ok: false, text: 'Error: cancelled.' };
      return { ok: false, text: `Error: ${friendly(err)}` };
    }
  }

  const shotQueued = (opts) => { const p = queue.then(() => screenshot(opts)); queue = p.catch(() => {}); return p; };

  return { run, screenshot: shotQueued, _state: () => shot };
}

module.exports = { createComputer, keyLine, typeLines, mouseJxa, scrollJxa, systemEvents, uiJxa, friendly, KEYCODES };
