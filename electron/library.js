// The Files library: every file you attach to a chat is kept here (a plain folder, default Documents/Artemis/Files),
// so it can be found again, opened, edited in place and handed to a chat or to the assistant without uploading it every time.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILE = 150 * 1024 * 1024;
const MAX_SEARCH_BYTES = 2 * 1024 * 1024;
const IGNORE = new Set(['.DS_Store', 'Thumbs.db']);

function createLibrary({ getRoot, files }) {
  const textExts = new Set([...files.TEXT_EXT].filter((e) => e !== '.zip'));
  const root = () => { const r = getRoot(); fs.mkdirSync(r, { recursive: true }); return r; };
  const safe = (rel) => {
    const base = path.resolve(root());
    const abs = path.resolve(base, String(rel || '').replace(/^[/\\]+/, ''));
    if (abs === base || !abs.startsWith(base + path.sep)) throw new Error('Path is outside the Files folder.');
    return abs;
  };
  const relOf = (abs) => path.relative(path.resolve(root()), abs).split(path.sep).join('/');
  const cleanName = (n) => path.basename(String(n || 'file')).replace(/[\\:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 140) || 'file';
  const isTextName = (n) => { const e = path.extname(n).toLowerCase(); return textExts.has(e) || e === ''; };
  const hashOf = (abs) => crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
  const uniqueIn = (dir, name) => {
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    let n = name, i = 2;
    while (fs.existsSync(path.join(dir, n))) n = `${stem} (${i++})${ext}`;
    return n;
  };

  function describe(abs) {
    const st = fs.statSync(abs);
    const name = path.basename(abs);
    return { path: relOf(abs), name, ext: path.extname(name).slice(1).toLowerCase(), size: st.size, mtime: st.mtimeMs, kind: files.kindOf(name), text: isTextName(name) };
  }

  function walk(dir, out, depth = 0) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (IGNORE.has(e.name) || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 6) walk(full, out, depth + 1); }
      else { try { out.push(describe(full)); } catch {} }
    }
  }

  function list() { const out = []; walk(root(), out); return out.sort((a, b) => b.mtime - a.mtime); }

  /** Copies a file from anywhere into the library (or recognises it when it is already there or already stored). Returns { path, abs, name, size, existed }. */
  function ingest(srcAbs) {
    const src = path.resolve(srcAbs);
    const st = fs.statSync(src);
    if (!st.isFile()) throw new Error('Not a file.');
    if (st.size > MAX_FILE) throw new Error('The file is too large (150 MB limit).');
    const base = path.resolve(root());
    if (src.startsWith(base + path.sep)) return { path: relOf(src), abs: src, name: path.basename(src), size: st.size, existed: true };
    const name = cleanName(path.basename(src));
    const same = path.join(base, name);
    if (fs.existsSync(same) && fs.statSync(same).size === st.size && hashOf(same) === hashOf(src)) return { path: relOf(same), abs: same, name, size: st.size, existed: true };
    const finalName = uniqueIn(base, name);
    const dest = path.join(base, finalName);
    fs.copyFileSync(src, dest);
    return { path: relOf(dest), abs: dest, name: finalName, size: st.size, existed: false };
  }

  function addBuffer(name, bytes) {
    const buf = Buffer.from(bytes || []);
    if (!buf.length) throw new Error('The file is empty.');
    if (buf.length > MAX_FILE) throw new Error('The file is too large (150 MB limit).');
    const base = path.resolve(root());
    const finalName = uniqueIn(base, cleanName(name));
    const dest = path.join(base, finalName);
    fs.writeFileSync(dest, buf);
    return describe(dest);
  }

  function read(rel, { max = 200000 } = {}) {
    const abs = safe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('File not found: ' + rel);
    const info = describe(abs);
    if (!info.text) throw new Error(`"${info.name}" is not a plain text file. It can be opened in the viewer or attached to a chat.`);
    const text = fs.readFileSync(abs, 'utf8');
    return { ...info, text: text.length > max ? text.slice(0, max) : text, truncated: text.length > max, length: text.length };
  }

  function write(rel, text) {
    const abs = safe(rel);
    if (!isTextName(abs)) throw new Error('Only text files can be written here.');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(text));
    return describe(abs);
  }

  /** Replaces the content of a file with another file from disk, keeping its name and place. */
  function replace(rel, srcAbs) {
    const abs = safe(rel);
    if (!fs.existsSync(abs)) throw new Error('File not found: ' + rel);
    if (fs.statSync(srcAbs).size > MAX_FILE) throw new Error('The file is too large (150 MB limit).');
    fs.copyFileSync(srcAbs, abs);
    return describe(abs);
  }

  function rename(rel, newName) {
    const abs = safe(rel);
    if (!fs.existsSync(abs)) throw new Error('File not found.');
    const nm = cleanName(newName);
    const to = path.join(path.dirname(abs), path.extname(nm) || !path.extname(abs) ? nm : nm + path.extname(abs));
    if (to !== abs && fs.existsSync(to)) throw new Error('A file with that name already exists.');
    fs.renameSync(abs, to);
    return describe(to);
  }

  function remove(rel) { fs.rmSync(safe(rel), { force: true }); return true; }

  /** Deletes a file, or a folder (only when empty unless recursive). Throws when it does not exist. */
  function del(rel, { recursive = false } = {}) {
    const abs = safe(rel);
    if (!fs.existsSync(abs)) throw new Error('Not found in the Files library: ' + rel);
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) {
      if (!recursive && fs.readdirSync(abs).length) throw new Error(`"${rel}" is a folder that is not empty. Pass recursive=true to delete it with everything inside.`);
      fs.rmSync(abs, { recursive: true, force: true });
    } else fs.rmSync(abs, { force: true });
    return { path: relOf(abs), dir: st.isDirectory() };
  }

  function search(query, { limit = 30 } = {}) {
    const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const res = [];
    for (const f of list()) {
      const name = f.name.toLowerCase();
      let body = '';
      if (f.text && f.size <= MAX_SEARCH_BYTES) { try { body = fs.readFileSync(safe(f.path), 'utf8').toLowerCase(); } catch {} }
      if (!terms.every((t) => name.includes(t) || body.includes(t))) continue;
      let score = 0;
      for (const t of terms) { if (name.includes(t)) score += 10; if (body) score += Math.min(body.split(t).length - 1, 10); }
      let snippet = '';
      const at = body ? body.indexOf(terms.find((t) => body.includes(t)) || '') : -1;
      if (at >= 0) { const raw = fs.readFileSync(safe(f.path), 'utf8'); snippet = raw.slice(Math.max(0, at - 50), at + 120).replace(/\s+/g, ' ').trim(); }
      res.push({ ...f, score, snippet });
    }
    return res.sort((a, b) => b.score - a.score || b.mtime - a.mtime).slice(0, limit);
  }

  return { root, abs: safe, list, ingest, addBuffer, read, write, replace, rename, remove, del, search, describe };
}

module.exports = { createLibrary };
