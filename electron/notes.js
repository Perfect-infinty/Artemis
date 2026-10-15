// Markdown notes vault: plain .md files in a folder the user picks (default ~/Documents/Artemis Notes).
// Same idea as Delta: files stay readable by any other editor. All paths are relative to the vault root
// and can never escape it.
const fs = require('fs');
const path = require('path');

const IGNORE = new Set(['.git', '.DS_Store', 'node_modules', '.obsidian', '.trash']);
const MAX_READ = 200 * 1024;

function createNotes({ getRoot }) {
  const root = () => { const r = getRoot(); fs.mkdirSync(r, { recursive: true }); return r; };
  const safe = (rel) => {
    const base = path.resolve(root());
    const abs = path.resolve(base, String(rel || '').replace(/^[/\\]+/, ''));
    if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Path is outside the notes folder.');
    return abs;
  };
  const relOf = (abs) => path.relative(path.resolve(root()), abs).split(path.sep).join('/');
  const isMd = (n) => /\.(md|markdown|txt)$/i.test(n);
  const withExt = (n) => (/\.(md|markdown|txt)$/i.test(n) ? n : n + '.md');
  const cleanName = (n) => String(n || '').replace(/[\\:*?"<>|\x00-\x1f]/g, '').replace(/^\.+/, '').trim().slice(0, 120);

  function walk(dir, out, depth = 0) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const e of ents) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { out.push({ path: relOf(full), name: e.name, dir: true, depth }); if (depth < 8) walk(full, out, depth + 1); }
      else if (isMd(e.name)) {
        let st; try { st = fs.statSync(full); } catch { continue; }
        out.push({ path: relOf(full), name: e.name.replace(/\.(md|markdown|txt)$/i, ''), dir: false, depth, mtime: st.mtimeMs, size: st.size });
      }
    }
  }

  function list() { const out = []; walk(root(), out); return out; }

  function read(rel, { max = MAX_READ } = {}) {
    const abs = safe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('Note not found: ' + rel);
    const text = fs.readFileSync(abs, 'utf8');
    return { path: relOf(abs), text: text.length > max ? text.slice(0, max) : text, truncated: text.length > max, length: text.length, mtime: fs.statSync(abs).mtimeMs };
  }

  function write(rel, text, { append = false } = {}) {
    const abs = safe(withExt(rel));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (append && fs.existsSync(abs)) {
      const cur = fs.readFileSync(abs, 'utf8');
      fs.writeFileSync(abs, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + String(text));
    } else fs.writeFileSync(abs, String(text));
    return { path: relOf(abs), mtime: fs.statSync(abs).mtimeMs };
  }

  function create(name, folder = '', text = '') {
    const dirAbs = safe(folder || '');
    fs.mkdirSync(dirAbs, { recursive: true });
    const base = cleanName(name) || 'Untitled';
    let n = base, i = 2;
    while (fs.existsSync(path.join(dirAbs, withExt(n)))) n = `${base} ${i++}`;
    const abs = path.join(dirAbs, withExt(n));
    fs.writeFileSync(abs, text || `# ${n}\n\n`);
    return { path: relOf(abs) };
  }

  function createFolder(name, parent = '') {
    const abs = path.join(safe(parent || ''), cleanName(name) || 'New folder');
    if (!abs.startsWith(path.resolve(root()) + path.sep)) throw new Error('Bad folder name.');
    fs.mkdirSync(abs, { recursive: true });
    return { path: relOf(abs) };
  }

  function rename(rel, newName) {
    const abs = safe(rel);
    if (!fs.existsSync(abs)) throw new Error('Not found.');
    const isDir = fs.statSync(abs).isDirectory();
    const nm = cleanName(newName); if (!nm) throw new Error('Empty name.');
    const to = path.join(path.dirname(abs), isDir ? nm : withExt(nm));
    if (to !== abs && fs.existsSync(to)) throw new Error('A file with that name already exists.');
    fs.renameSync(abs, to);
    return { path: relOf(to) };
  }

  function move(rel, folder) {
    const abs = safe(rel); const to = path.join(safe(folder || ''), path.basename(abs));
    if (to !== abs && fs.existsSync(to)) throw new Error('A file with that name already exists there.');
    if (to.startsWith(abs + path.sep)) throw new Error('Cannot move a folder into itself.');
    fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(abs, to);
    return { path: relOf(to) };
  }

  function remove(rel) {
    const abs = safe(rel);
    if (abs === path.resolve(root())) throw new Error('Cannot delete the notes folder itself.');
    fs.rmSync(abs, { recursive: true, force: true });
    return true;
  }

  function search(query, { limit = 30 } = {}) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const terms = q.split(/\s+/).filter(Boolean);
    const res = [];
    for (const f of list()) {
      if (f.dir) continue;
      let text = '';
      try { text = fs.readFileSync(safe(f.path), 'utf8'); } catch { continue; }
      const low = text.toLowerCase(), title = f.name.toLowerCase();
      if (!terms.every((t) => low.includes(t) || title.includes(t))) continue;
      let score = 0;
      for (const t of terms) { if (title.includes(t)) score += 10; const m = low.split(t).length - 1; score += Math.min(m, 10); }
      const idx = low.indexOf(terms[0]);
      const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 60), idx + 140).replace(/\s+/g, ' ').trim() : text.slice(0, 160).replace(/\s+/g, ' ');
      res.push({ path: f.path, name: f.name, score, snippet });
    }
    return res.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  return { root, list, read, write, create, createFolder, rename, move, remove, search };
}

module.exports = { createNotes };
