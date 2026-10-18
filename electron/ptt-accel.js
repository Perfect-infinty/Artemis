// The push-to-talk combo from Settings → Voice ("Alt+Space", "Meta+Shift+KeyK"; older settings: "AltRight", "F6") as an Electron accelerator for
// globalShortcut. Same rules as pttAccelerator() in src/lib/ptt.mjs (main cannot load the renderer's ESM; packaging only ships
// electron/**); scripts/test-shortcuts.js checks that both agree. '' = cannot be global (lone modifier, unknown key, no Cmd/Ctrl/Alt).
const MOD_CODES = /^(Control|Alt|Shift|Meta)(Left|Right)$/;
const MODS = new Set(['Ctrl', 'Alt', 'Shift', 'Meta']);
const KEY_ACCEL = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Escape: 'Escape',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Comma: ',', Period: '.', Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Minus: '-', Equal: '=',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec'
};

function pttAccelerator(combo, isMac = process.platform === 'darwin') {
  const c = String(combo || '').trim();
  if (!c || MOD_CODES.test(c)) return '';
  const parts = c.split('+'); const code = parts.pop();
  let key = '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = 'num' + code.slice(6);
  else if (/^F([1-9]|1\d|2[0-4])$/.test(code)) key = code;
  else key = KEY_ACCEL[code] || '';
  if (!key || parts.some((m) => !MODS.has(m))) return '';
  const want = new Set(parts);
  if (!want.has('Ctrl') && !want.has('Alt') && !want.has('Meta') && !/^F\d+$/.test(key)) return '';
  return [want.has('Meta') && (isMac ? 'Command' : 'Super'), want.has('Ctrl') && 'Control', want.has('Alt') && 'Alt', want.has('Shift') && 'Shift', key].filter(Boolean).join('+');
}

module.exports = { pttAccelerator };
