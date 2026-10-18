import { useEffect, useState } from 'react';
import { formatAccelerator } from './shortcuts.mjs';

// The Sentinel on/off shortcut as shown in tooltips (" (⌘⇧A)"), read from settings so it follows a changed shortcut.
const DEFAULT = 'CommandOrControl+Shift+A';
const mac = () => window.api?.platform === 'darwin';
let label = formatAccelerator(DEFAULT, mac());
const subs = new Set();

/** Called by App whenever settings load or change. */
export function setSentinelKey(accel) {
  const next = formatAccelerator(accel ?? DEFAULT, mac());
  if (next === label) return;
  label = next;
  for (const fn of subs) fn(label);
}

/** " (⌘⇧A)" for a tooltip, or '' when the shortcut is off. */
export function useSentinelKey() {
  const [v, setV] = useState(label);
  useEffect(() => {
    subs.add(setV);
    if (!window.__sentinelKeyLoaded && window.api?.getSettings) { // windows without App (the Sentinel widget) read it once themselves
      window.__sentinelKeyLoaded = true;
      window.api.getSettings().then((s) => setSentinelKey(s && s.sentinelShortcut)).catch(() => {});
    }
    return () => { subs.delete(setV); };
  }, []);
  return v ? ` (${v})` : '';
}
