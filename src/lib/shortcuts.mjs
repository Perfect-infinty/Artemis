// Keyboard shortcuts written as Electron accelerator strings ("CommandOrControl+Shift+Space").
// Used by the renderer to match in-app shortcuts, to record new ones in Settings and to show them as ⌘⇧Space.
// ESM so the Node test scripts can import it (scripts/test-shortcuts.js).

const MODS = {
  command: 'cmd', cmd: 'cmd', super: 'cmd', meta: 'cmd',
  control: 'ctrl', ctrl: 'ctrl',
  commandorcontrol: 'cmdOrCtrl', cmdorctrl: 'cmdOrCtrl',
  alt: 'alt', option: 'alt', altgr: 'alt',
  shift: 'shift'
};

const NAMED = {
  space: 'Space', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
  return: 'Enter', enter: 'Enter', escape: 'Escape', esc: 'Escape', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', plus: 'Plus'
};

// the physical key (KeyboardEvent.code) for each key, so Option or Shift changing the typed character does not matter
const CODES = {
  ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash',
  ';': 'Semicolon', "'": 'Quote', '-': 'Minus', '=': 'Equal', Plus: 'Equal',
  Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Enter: 'Enter', Escape: 'Escape',
  Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown'
};
const CODE_TO_KEY = Object.fromEntries(Object.entries(CODES).filter(([k]) => k !== 'Plus').map(([k, v]) => [v, k]));

function normKey(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  const low = t.toLowerCase();
  if (NAMED[low]) return NAMED[low];
  if (/^f([1-9]|1\d|2[0-4])$/.test(low)) return low.toUpperCase();
  if (/^[a-z0-9]$/.test(low)) return low.toUpperCase();
  if (t.length === 1 && CODES[t]) return t;
  return '';
}

/**
 * Parses an accelerator. Returns { cmd, ctrl, cmdOrCtrl, alt, shift, key } or null when it is not valid
 * (unknown part, no key, two keys). An empty string is "off" and also returns null.
 */
export function parseAccelerator(accel) {
  const s = String(accel || '').trim();
  if (!s) return null;
  // "+" as the key: "Ctrl++" or a trailing "+"
  const parts = s.replace(/\+\+$/, '+Plus').split('+').map((p) => p.trim());
  if (parts.some((p) => !p)) return null;
  const out = { cmd: false, ctrl: false, cmdOrCtrl: false, alt: false, shift: false, key: '' };
  for (const p of parts) {
    const m = MODS[p.toLowerCase()];
    if (m) { out[m] = true; continue; }
    if (out.key) return null;
    const k = normKey(p);
    if (!k) return null;
    out.key = k;
  }
  return out.key ? out : null;
}

/** The modifier keys an accelerator needs on this platform: { meta, ctrl, alt, shift }. */
function needs(p, isMac) {
  return {
    meta: p.cmd || (isMac && p.cmdOrCtrl),
    ctrl: p.ctrl || (!isMac && p.cmdOrCtrl),
    alt: p.alt,
    shift: p.shift
  };
}

/** One canonical form per platform, so "CmdOrCtrl+shift+space" and "Shift+Command+Space" (on a Mac) compare equal. */
export function normalizeAccelerator(accel, isMac = true) {
  const p = parseAccelerator(accel);
  if (!p) return '';
  const n = needs(p, isMac);
  return [n.meta && 'Meta', n.ctrl && 'Ctrl', n.alt && 'Alt', n.shift && 'Shift', p.key].filter(Boolean).join('+');
}

/** True when a keydown event is this accelerator (exact modifiers, physical key or typed character). */
export function matchesAccelerator(accel, e, isMac = true) {
  const p = typeof accel === 'string' ? parseAccelerator(accel) : accel;
  if (!p || !e) return false;
  const n = needs(p, isMac);
  if (!!e.metaKey !== !!n.meta || !!e.ctrlKey !== !!n.ctrl || !!e.altKey !== !!n.alt || !!e.shiftKey !== !!n.shift) return false;
  const k = p.key;
  if (/^[A-Z]$/.test(k)) return e.code === 'Key' + k || (!e.code && String(e.key || '').toUpperCase() === k);
  if (/^[0-9]$/.test(k)) return e.code === 'Digit' + k || e.code === 'Numpad' + k || (!e.code && e.key === k);
  if (/^F\d+$/.test(k)) return e.code === k || e.key === k;
  if (k === 'Plus') return e.key === '+' || (!!p.shift && e.code === 'Equal') || e.code === 'NumpadAdd';
  if (k === 'Enter') return e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter';
  const code = CODES[k];
  return (!!code && e.code === code) || e.key === k;
}

const MAC_KEYS = { Space: 'Space', Up: '↑', Down: '↓', Left: '←', Right: '→', Enter: '↩', Escape: 'Esc', Backspace: '⌫', Delete: '⌦', Tab: '⇥', PageUp: 'PgUp', PageDown: 'PgDn', Plus: '+' };
const PC_KEYS = { Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right', Escape: 'Esc', PageUp: 'PgUp', PageDown: 'PgDn', Plus: '+' };

/** For display: "⌘⇧Space" on a Mac, "Ctrl+Shift+Space" elsewhere. '' for an empty or invalid accelerator. */
export function formatAccelerator(accel, isMac = true) {
  const p = parseAccelerator(accel);
  if (!p) return '';
  const n = needs(p, isMac);
  if (isMac) return (n.meta ? '⌘' : '') + (n.ctrl ? '⌃' : '') + (n.alt ? '⌥' : '') + (n.shift ? '⇧' : '') + (MAC_KEYS[p.key] || p.key);
  return [n.ctrl && 'Ctrl', n.meta && 'Win', n.alt && 'Alt', n.shift && 'Shift', PC_KEYS[p.key] || p.key].filter(Boolean).join('+');
}

/**
 * Turns a keydown into an accelerator for the shortcut recorder in Settings. Cmd on a Mac and Ctrl elsewhere become
 * "CommandOrControl". Returns '' for a lone modifier or a key without Cmd/Ctrl/Alt (those would fire while typing).
 */
export function eventToAccelerator(e, isMac = true) {
  if (!e) return '';
  const c = e.code || '';
  let key = '';
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(c)) key = c;
  else if (CODE_TO_KEY[c]) key = CODE_TO_KEY[c];
  else if (c === 'NumpadEnter') key = 'Enter';
  if (!key) return '';
  const primary = isMac ? e.metaKey : e.ctrlKey;
  const other = isMac ? e.ctrlKey : e.metaKey;
  if (!primary && !other && !e.altKey && !/^F\d+$/.test(key)) return '';
  return [primary && 'CommandOrControl', other && (isMac ? 'Control' : 'Super'), e.altKey && 'Alt', e.shiftKey && 'Shift', key].filter(Boolean).join('+');
}
