// Appearance themes. The palettes live in JSON files (electron/themes built in, plus <userData>/themes
// and <project>/.ares/themes), so a new theme never needs a rebuild: main reads them and hands the list
// to the renderer, drop a .json in the folder and press Refresh in Settings.
// Light/Dark stay in styles.css (they carry the @media (prefers-color-scheme: dark) fallback).
export const SYSTEM_THEME = { id: 'system', name: 'System', group: 'Basic', preview: ['#faf9f5', '#c96442', '#262624'] };

export const TEXT_SIZES = [['small', 'Small', 13], ['medium', 'Medium', 14], ['large', 'Large', 16]];

/** Theme ids seen so far (from main); a check against something unknown falls back to System. */
let known = new Set([SYSTEM_THEME.id]);

export function setKnownThemes(list) {
  known = new Set((list || []).map((t) => t && t.id).filter(Boolean));
  known.add(SYSTEM_THEME.id);
}

export const isKnownTheme = (id) => !!id && known.has(id);

const clearVars = (el) => {
  for (let i = el.style.length - 1; i >= 0; i--) {
    const prop = el.style[i];
    if (prop.startsWith('--theme-')) el.style.removeProperty(prop);
  }
};

/** Switches on the var() mapping in styles.css; the active palette's values are set in applyTheme. */
export function applyThemeVars() {
  document.documentElement.dataset.vars = '1';
}

/** Paints the active theme (its --theme-* values go on the root); System follows the OS. */
export function applyTheme(id, themes = []) {
  const el = document.documentElement;
  clearVars(el);
  if (!id || id === SYSTEM_THEME.id || !isKnownTheme(id)) {
    delete el.dataset.theme;
    el.style.colorScheme = '';
    return;
  }
  el.dataset.theme = id;
  const t = (themes || []).find((x) => x && x.id === id);
  if (t && t.vars) {
    for (const [k, v] of Object.entries(t.vars)) {
      if (typeof k === 'string' && k.startsWith('--theme-') && typeof v === 'string' && v) el.style.setProperty(k, v);
    }
  }
  el.style.colorScheme = t ? (t.dark === false ? 'light' : 'dark') : '';
}

/** Loads the palettes from main; on failure the boot values in styles.css stay in place. */
export async function loadThemes(api, dir) {
  if (!api || !api.themesList) return [];
  try {
    const r = await api.themesList(dir);
    const themes = (r && r.themes) || [];
    setKnownThemes(themes);
    applyThemeVars();
    return themes.map(({ file, ...t }) => t);
  } catch { return []; }
}

export function applyTextSize(size) {
  const found = TEXT_SIZES.find(([id]) => id === size) || TEXT_SIZES[1];
  document.documentElement.style.setProperty('--fs', found[2] + 'px');
}