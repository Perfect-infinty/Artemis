// One-off maintenance helper: turns the palettes in src/styles.css into theme JSON files.
// Run with: node scripts/themes-from-css.js   (writes electron/themes and .ares/themes)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cssPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'src', 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');

// names and groups: keep the list from an older src/lib/themes.js when there is one, otherwise derive
const NAMES = { 'notion-dark': 'Notion Dark' };
const GROUPS = { system: 'Basic', light: 'Basic', dark: 'Basic', notion: 'Basic', 'notion-dark': 'Basic', ares: 'Gods', artemis: 'Gods', hermes: 'Gods' };
const titleOf = (id) => NAMES[id] || id.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const info = {};
try {
  const meta = fs.readFileSync(path.join(root, 'src', 'lib', 'themes.js'), 'utf8');
  for (const m of meta.matchAll(/\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',\s*group:\s*'([^']+)',\s*preview:\s*\[([^\]]+)\]/g)) {
    info[m[1]] = { name: m[2], group: m[3], preview: m[4].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) };
  }
} catch {}

// boot palettes: the base :root block is Light, the media/attribute dark block is Dark
const baseLight = /:root \{([\s\S]*?)\}/.exec(css);
const darkBlock = /:root\[data-theme="dark"\] \{([\s\S]*?)\}/.exec(css);
const fromBlock = (block) => {
  let vars = {};
  for (const line of block.split('\n')) {
    for (const m of line.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  }
  delete vars['--fs'];
  // the renderer reads a theme as CSS variables: --bg in a file becomes --theme-<id>-bg
  vars = Object.fromEntries(Object.entries(vars).filter(([k]) => k !== 'color-scheme').map(([k, v]) => ['--theme-' + k.slice(2), v]));
  return vars;
};

const themes = {};
if (baseLight) themes.light = fromBlock(baseLight[1]);
if (darkBlock) themes.dark = fromBlock(darkBlock[1]);

for (const m of css.matchAll(/:root\[data-theme="([^"]+)"\] \{([^}]*)\}/g)) {
  const id = m[1];
  if (id === 'system') continue;
  themes[id] = { ...(themes[id] || {}), ...fromBlock(m[2]) };
}

// which palettes are dark: anything that is not the two light ones (the CSS color-scheme line is
// dropped from the vars on purpose, the renderer sets documentElement.style.colorScheme instead)
const LIGHT_IDS = new Set(['light', 'notion']);
const targets = [path.join(root, 'electron', 'themes'), path.join(root, '.ares', 'themes')];
let written = 0;
for (const [id, vars] of Object.entries(themes)) {
  const m = info[id] || { name: NAMES[id] || titleOf(id), group: GROUPS[id] || 'My themes' };
  const preview = m.preview && m.preview.length === 3 ? m.preview : [vars['--theme-bg'], vars['--theme-accent'], vars['--theme-panel'] || vars['--theme-side']];
  const theme = {
    id,
    name: m.name,
    group: m.group,
    dark: !LIGHT_IDS.has(id),
    preview,
    vars,
  };
  for (const dir of targets) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(theme, null, 2) + '\n');
    written++;
  }
}
console.log(`wrote ${written} files for ${Object.keys(themes).length} themes:`, Object.keys(themes).join(', '));