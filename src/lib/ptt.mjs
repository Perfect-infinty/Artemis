// Push-to-talk combination for Sentinel: hold it to speak, let go to send. A combo is "Alt+Space" or "Meta+Shift+KeyK": at least one
// of ⌘ / ⌥ / ⌃ (optionally with ⇧) plus one other key. Older settings may hold a single key ("Space", "F6") or a lone modifier
// ("AltRight"): they keep working, but Settings asks for a combination (see pttComboOk).
const MOD_CODES = /^(Control|Alt|Shift|Meta)(Left|Right)$/;
const MOD_OF = { Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', Meta: 'Meta' };

/** The modifiers held in a keyboard event, in combo order. */
export const heldMods = (e) => [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
const MOD_SYMBOL = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' };
/** "⌥⇧" for the modifiers held while recording. */
export const modsLabel = (mods) => (mods || []).map((m) => MOD_SYMBOL[m] || '').join('');
export const PTT_COMBO_HINT = 'Use a combination, e.g. ⌥ Space';

/** The raw combo of a key press ("Alt+Space", or "AltRight" for a modifier on its own). recordCombo is what Settings uses. */
export function comboFromEvent(e) {
  const code = String(e.code || '');
  if (!code) return '';
  if (MOD_CODES.test(code)) return code; // a modifier on its own (hold Right Option to talk)
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean);
  return [...mods, code].join('+');
}

/**
 * The push-to-talk recorder in Settings: one keydown -> { combo } when it is a valid combination, otherwise { combo: '', mods, error }.
 * A modifier on its own keeps waiting (mods = what is held, shown live); a key without ⌘ / ⌥ / ⌃ is rejected (⇧ + a letter
 * types text), and so is a key that cannot be a global shortcut.
 */
export function recordCombo(e, isMac = true) {
  const code = String(e.code || ''); const mods = heldMods(e);
  if (!code || MOD_CODES.test(code)) return { combo: '', mods, error: '' };
  if (!mods.some((m) => m !== 'Shift')) return { combo: '', mods, error: PTT_COMBO_HINT };
  const combo = [...mods, code].join('+');
  if (!pttAccelerator(combo, isMac)) return { combo: '', mods, error: 'This key cannot be used for push-to-talk. ' + PTT_COMBO_HINT };
  return { combo, mods, error: '' };
}

/** True when the combo is a real combination (⌘ / ⌥ / ⌃ + a key, also usable from other apps); false for a single key or lone modifier. */
export function pttComboOk(combo, isMac = true) {
  const c = String(combo || '');
  if (!c || MOD_CODES.test(c)) return false;
  const parts = c.split('+'); parts.pop();
  return parts.some((m) => m === 'Ctrl' || m === 'Alt' || m === 'Meta') && !!pttAccelerator(c, isMac);
}

/** Keydown that starts the hold: the key of the combo with exactly its modifiers held (key repeat is the caller's business). */
export function pttMatches(combo, e) {
  if (!combo) return false;
  if (MOD_CODES.test(combo)) return e.code === combo;
  const parts = combo.split('+'); const code = parts.pop();
  const want = new Set(parts);
  return e.code === code && !!e.ctrlKey === want.has('Ctrl') && !!e.altKey === want.has('Alt') && !!e.shiftKey === want.has('Shift') && !!e.metaKey === want.has('Meta');
}

/** True when this key-up ends the hold: the main key, or one of the modifiers of the combo, was let go. */
export function pttReleased(combo, e) {
  if (!combo) return false;
  if (MOD_CODES.test(combo)) return e.code === combo;
  const parts = combo.split('+'); const code = parts.pop();
  return e.code === code || parts.some((m) => String(e.code || '').startsWith(MOD_OF[m] || '?'));
}

export function pttLabel(combo) {
  if (!combo) return 'Not set';
  return combo.split('+').map((p) => p.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Meta$/, '⌘').replace(/^Alt$/, '⌥').replace(/^Shift$/, '⇧').replace(/^Ctrl$/, '⌃').replace(/^(Control|Alt|Shift|Meta)(Left|Right)$/, (_, m, s) => `${s} ${{ Control: '⌃', Alt: '⌥', Shift: '⇧', Meta: '⌘' }[m]}`)).join(' ');
}

// Global push-to-talk. Electron's globalShortcut reports only the key press (no release), so from other apps the key works as
// tap-to-talk: press once to talk, again to send. electron/ptt-accel.js has the same rules for the main process (it cannot load
// this ESM file); scripts/test-shortcuts.js checks that both agree.
const KEY_ACCEL = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Escape: 'Escape',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec'
};

/**
 * A push-to-talk combo ("Alt+Space", "Ctrl+Shift+KeyV") as an Electron accelerator ("Alt+Space", "Control+Shift+V").
 * '' when it cannot be a global shortcut: a lone modifier (Electron cannot register one), an unknown key, or a key without
 * Cmd/Ctrl/Alt (it would be taken away from every app while typing; F-keys are allowed).
 */
export function pttAccelerator(combo, isMac = true) {
  const c = String(combo || '').trim();
  if (!c || MOD_CODES.test(c)) return '';
  const parts = c.split('+'); const code = parts.pop();
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = 'num' + code.slice(6);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  else key = KEY_ACCEL[code] || '';
  if (!key || parts.some((m) => !MOD_OF[m])) return '';
  const want = new Set(parts);
  if (!want.has('Ctrl') && !want.has('Alt') && !want.has('Meta') && !/^F\d+$/.test(key)) return '';
  return [want.has('Meta') && (isMac ? 'Command' : 'Super'), want.has('Ctrl') && 'Control', want.has('Alt') && 'Alt', want.has('Shift') && 'Shift', key].filter(Boolean).join('+');
}

/** True when the combo can be registered as a global shortcut (works from any app); every combo pttComboOk accepts can. */
export const pttGlobalOk = (combo, isMac = true) => !!pttAccelerator(combo, isMac);
