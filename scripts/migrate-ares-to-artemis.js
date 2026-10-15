#!/usr/bin/env node
// One-off migration: everything that was called "Ares" becomes "Artemis".
//
//   node scripts/migrate-ares-to-artemis.js            dry run: only prints what it would do
//   node scripts/migrate-ares-to-artemis.js --apply    does it
//
// Quit Artemis first. Safe to run more than once. What it moves:
//   ~/.ares                          -> ~/.artemis           (logs, profile picture, project logos, voice model)
//   ~/.ares/logs/ares-*.log          -> artemis-*.log
//   ~/Documents/Ares Notes           -> ~/Documents/Artemis Notes
//   <app data>/Ares                  -> <app data>/Artemis   (only if there is no Artemis folder yet)
//   <project>/.ares                  -> <project>/.artemis   (project skills, agents, themes, logo)
//   settings.json / projects.json    paths and the "ares" theme id are rewritten (a .bak-ares copy is kept)
//
// Options (mostly for testing): --home <dir>  --docs <dir>  --user-data <dir>  --project <dir> (repeatable)

const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const optAll = (n) => argv.reduce((a, v, i) => (v === n && argv[i + 1] ? [...a, argv[i + 1]] : a), []);

const APPLY = flag('--apply');
const HOME = opt('--home') || os.homedir();
const DOCS = opt('--docs') || path.join(HOME, 'Documents');
const APP_DATA = process.platform === 'darwin' ? path.join(HOME, 'Library', 'Application Support')
  : process.platform === 'win32' ? (process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'))
  : (process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'));

let moved = 0, edited = 0, warned = 0;
const say = (m) => console.log((APPLY ? '' : '[dry run] ') + m);
const warn = (m) => { warned++; console.log('! ' + m); };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** Moves src to dst. If dst already exists the two folders are merged and nothing is overwritten. */
function move(src, dst) {
  if (!exists(src)) return;
  if (!exists(dst)) {
    say(`move  ${src}  ->  ${dst}`); moved++;
    if (!APPLY) return;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    try { fs.renameSync(src, dst); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.cpSync(src, dst, { recursive: true }); fs.rmSync(src, { recursive: true, force: true });
    }
    return;
  }
  if (!isDir(src) || !isDir(dst)) { warn(`${dst} already exists, left ${src} where it is`); return; }
  for (const name of fs.readdirSync(src)) move(path.join(src, name), path.join(dst, name));
  if (APPLY) { try { fs.rmdirSync(src); } catch {} }
}

/** Rewrites the strings inside a JSON file. A backup copy is written next to it first. */
function rewriteJson(file, fix) {
  if (!exists(file)) return;
  let raw, data;
  try { raw = fs.readFileSync(file, 'utf8'); data = JSON.parse(raw); } catch (e) { warn(`${file} is not valid JSON, skipped`); return; }
  let changes = 0;
  const walk = (v) => {
    if (typeof v === 'string') { const n = fix(v); if (n !== v) changes++; return n; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  const out = walk(data);
  if (!changes) return;
  say(`edit  ${file}  (${changes} value${changes === 1 ? '' : 's'})`); edited++;
  if (!APPLY) return;
  const bak = file + '.bak-ares';
  if (!exists(bak)) fs.writeFileSync(bak, raw);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
}

const pathFix = (s) => s
  .replace(/([\\/])\.ares(?=[\\/]|$)/g, '$1.artemis')
  .replace(/([\\/])Ares Notes(?=[\\/]|$)/g, '$1Artemis Notes');

// 1) ~/.ares
const oldHome = path.join(HOME, '.ares');
const newHome = path.join(HOME, '.artemis');
move(oldHome, newHome);
const logs = path.join(APPLY ? newHome : oldHome, 'logs');
if (isDir(logs)) for (const f of fs.readdirSync(logs)) if (/^ares-.*\.log$/.test(f)) move(path.join(logs, f), path.join(logs, f.replace(/^ares-/, 'artemis-')));

// 2) notes folder
move(path.join(DOCS, 'Ares Notes'), path.join(DOCS, 'Artemis Notes'));

// 3) app data folder: the app uses the first existing of these (see electron/main.js), so "Ares" only matters when none of them exists
const KNOWN = ['AI Desktop', 'Zero', 'Artemis'];
let userData = opt('--user-data') || KNOWN.map((n) => path.join(APP_DATA, n)).find(isDir);
if (!userData && isDir(path.join(APP_DATA, 'Ares'))) { move(path.join(APP_DATA, 'Ares'), path.join(APP_DATA, 'Artemis')); userData = path.join(APP_DATA, 'Artemis'); }
else if (isDir(path.join(APP_DATA, 'Ares'))) warn(`${path.join(APP_DATA, 'Ares')} exists next to ${userData}: left alone, check it by hand`);

// 4) settings + projects
const folders = new Set(optAll('--project'));
if (userData) {
  say('app data: ' + userData);
  rewriteJson(path.join(userData, 'settings.json'), (s) => (s === 'ares' ? 'artemis' : pathFix(s)));
  const projFile = path.join(userData, 'projects.json');
  if (exists(projFile)) { try { for (const p of JSON.parse(fs.readFileSync(projFile, 'utf8'))) if (p && p.folder) folders.add(p.folder); } catch {} }
  rewriteJson(projFile, pathFix);
} else {
  warn('no Artemis app data folder found (start the app once, or pass --user-data <dir>)');
}

// 5) project folders
for (const f of folders) move(path.join(f, '.ares'), path.join(f, '.artemis'));

console.log(`\n${moved} move${moved === 1 ? '' : 's'}, ${edited} file${edited === 1 ? '' : 's'} edited, ${warned} warning${warned === 1 ? '' : 's'}.`);
if (!APPLY) console.log('Nothing was changed. Run again with --apply to do it.');
else console.log('Done. Start Artemis. Old copies of edited files are kept as *.bak-ares.');
