// Skills: folders with a SKILL.md (frontmatter: name, description; body: instructions), same layout as agentskills.io / Claude skills.
// User skills live in <userData>/skills/<slug>/, project skills in <project folder>/.artemis/skills/<slug>/.
const fs = require('fs');
const path = require('path');

const MAX_BODY = 60000;
const MAX_DESC = 400;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const slugOf = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

function parseSkill(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(s);
  const meta = {};
  let body = s;
  if (m) {
    body = m[2];
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) meta[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: body.trim() };
}

const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function render({ name, description, body, createdBy, created, updated }) {
  const fm = [`name: ${oneLine(name)}`, `description: ${oneLine(description).slice(0, MAX_DESC)}`];
  if (createdBy) fm.push(`created-by: ${createdBy}`);
  if (created) fm.push(`created: ${created}`);
  fm.push(`updated: ${updated}`);
  return `---\n${fm.join('\n')}\n---\n\n${String(body).trim()}\n`;
}

/** deps: { userDir, getDisabled(): string[], setDisabled(list), notify?() } */
function createSkills(deps) {
  const dirs = (root) => [['user', deps.userDir], ...(root ? [['project', path.join(root, '.artemis', 'skills')]] : [])];

  function scan(root) {
    const out = [];
    const disabled = new Set(deps.getDisabled() || []);
    for (const [source, base] of dirs(root)) {
      let entries = [];
      try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const file = path.join(base, e.name, 'SKILL.md');
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const { meta, body } = parseSkill(text);
        const name = meta.name || e.name;
        if (out.some((x) => x.slug === e.name)) continue; // user skills win over project skills with the same folder name
        let updated = 0; try { updated = fs.statSync(file).mtimeMs; } catch {}
        out.push({ name, slug: e.name, description: meta.description || '', source, byAgent: meta['created-by'] === 'agent', enabled: !disabled.has(e.name), dir: path.join(base, e.name), updated, size: body.length });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const find = (name, root) => {
    const q = String(name || '').trim().toLowerCase();
    const list = scan(root);
    return list.find((s) => s.slug === slugOf(q) || s.name.toLowerCase() === q);
  };

  function get(name, root) {
    const s = find(name, root);
    if (!s) return null;
    const { body } = parseSkill(fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'));
    const files = [];
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (files.length >= 30) return;
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r); else if (r !== 'SKILL.md') files.push(r);
      }
    };
    try { walk(s.dir, ''); } catch {}
    return { ...s, body, files };
  }

  /** mode: 'create' fails when the skill exists, 'update' fails when it does not, 'save' = either (UI). */
  function save({ name, description, body, scope = 'user', by = 'user', mode = 'save' }, root) {
    name = oneLine(name);
    const slug = slugOf(name);
    if (!slug) return { ok: false, error: 'Give the skill a name (letters and numbers).' };
    description = oneLine(description);
    body = String(body || '').trim();
    if (!description) return { ok: false, error: 'A skill needs a one-line description that says when to use it.' };
    if (!body) return { ok: false, error: 'The skill has no instructions.' };
    if (body.length > MAX_BODY) return { ok: false, error: `Instructions are too long (${body.length} characters, max ${MAX_BODY}).` };
    const existing = find(name, root);
    if (mode === 'create' && existing) return { ok: false, error: `A skill named "${existing.name}" already exists. Use update_skill to change it.` };
    if (mode === 'update' && !existing) return { ok: false, error: `No skill named "${name}". Use create_skill first.` };
    const useProject = existing ? existing.source === 'project' : scope === 'project' && !!root;
    const base = useProject ? path.join(root, '.artemis', 'skills') : deps.userDir;
    const dir = existing ? existing.dir : path.join(base, slug);
    const file = path.join(dir, 'SKILL.md');
    let prev = {};
    try { prev = parseSkill(fs.readFileSync(file, 'utf8')).meta; } catch {}
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(file, render({ name: existing ? existing.name : name, description, body, createdBy: prev['created-by'] || (by === 'agent' ? 'agent' : ''), created: prev.created || now, updated: now }));
    try { deps.notify && deps.notify(); } catch {}
    return { ok: true, slug: path.basename(dir), name: existing ? existing.name : name, updated: !!existing, source: useProject ? 'project' : 'user' };
  }

  function remove(name, root) {
    const s = find(name, root);
    if (!s) return false;
    fs.rmSync(s.dir, { recursive: true, force: true });
    deps.setDisabled((deps.getDisabled() || []).filter((x) => x !== s.slug));
    try { deps.notify && deps.notify(); } catch {}
    return true;
  }

  function setEnabled(name, on, root) {
    const s = find(name, root);
    if (!s) return false;
    const set = new Set(deps.getDisabled() || []);
    if (on) set.delete(s.slug); else set.add(s.slug);
    deps.setDisabled([...set]);
    try { deps.notify && deps.notify(); } catch {}
    return true;
  }

  /** Short list for the system prompt (enabled skills only). */
  function indexText(root) {
    const list = scan(root).filter((s) => s.enabled && s.description);
    return list.slice(0, 40).map((s) => `- ${s.name}: ${s.description.slice(0, 220)}`).join('\n');
  }

  /** Copy a skill folder (or a single SKILL.md) into the user skills folder. */
  function importFrom(p) {
    let src = String(p || '');
    let st;
    try { st = fs.statSync(src); } catch { return { ok: false, error: 'File not found.' }; }
    if (st.isFile()) {
      if (!/\.md$/i.test(src)) return { ok: false, error: 'Choose a SKILL.md file or a skill folder.' };
      const { meta, body } = parseSkill(fs.readFileSync(src, 'utf8'));
      const name = meta.name || path.basename(path.dirname(src));
      return save({ name, description: meta.description, body, by: 'user' });
    }
    if (!fs.existsSync(path.join(src, 'SKILL.md'))) return { ok: false, error: 'That folder has no SKILL.md.' };
    const { meta } = parseSkill(fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8'));
    const slug = slugOf(meta.name || path.basename(src));
    if (!slug) return { ok: false, error: 'The skill has no name.' };
    const dest = path.join(deps.userDir, slug);
    let total = 0;
    const copy = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
        const a = path.join(from, e.name), b = path.join(to, e.name);
        if (e.isDirectory()) copy(a, b);
        else { total += fs.statSync(a).size; if (total > MAX_IMPORT_BYTES) throw new Error('The skill folder is larger than 5 MB.'); fs.copyFileSync(a, b); }
      }
    };
    try { copy(src, dest); } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); return { ok: false, error: e.message }; }
    try { deps.notify && deps.notify(); } catch {}
    return { ok: true, name: meta.name || slug, slug };
  }

  return { list: scan, get, save, remove, setEnabled, indexText, importFrom, find };
}

module.exports = { createSkills, parseSkill, slugOf, MAX_BODY };
