// Skill hubs: search ClawHub (OpenClaw) and the Hermes Agent skill repository from inside Artemis, and install a skill with one click.
// Both use the same SKILL.md folder layout Artemis already reads (agentskills.io), so an install is just "copy the folder into the skills folder".
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { parseSkill, slugOf } = require('./skills');

const CLAW = 'https://clawhub.ai';
const HERMES = { repo: 'NousResearch/hermes-agent', branch: 'main', dirs: ['optional-skills', 'skills'] };
const MAX_FILES = 200, MAX_TOTAL = 8 * 1024 * 1024, MARK = '.hub.json';
const UA = { 'user-agent': 'Artemis-skill-hub', accept: 'application/json' };

const safeRel = (p) => {
  const r = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r || r.split('/').some((s) => s === '..' || s === '') || /^[a-z]:/i.test(r)) return null;
  return r;
};

function createSkillHub({ userDir, notify, fetchFn }) {
  const f = fetchFn || ((...a) => fetch(...a));
  const getJson = async (url) => {
    const res = await f(url, { headers: UA, signal: AbortSignal.timeout(20000) });
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(res.status === 429 ? 'The hub is rate-limiting requests. Try again in a minute.' : `HTTP ${res.status} from ${new URL(url).host}${t ? ': ' + t.slice(0, 120) : ''}`); }
    return res.json();
  };
  const getBuf = async (url, headers) => {
    const res = await f(url, { headers: headers || { 'user-agent': UA['user-agent'] }, signal: AbortSignal.timeout(60000), redirect: 'follow' });
    if (!res.ok) {
      let t = ''; try { const raw = await res.text(); try { const j = JSON.parse(raw); t = String(j.error || j.message || raw); } catch { t = raw; } } catch {}
      t = t.replace(/\s+/g, ' ').trim().slice(0, 200);
      const e = new Error(`HTTP ${res.status} from ${new URL(url).host}${t ? ': ' + t : ''}`); e.status = res.status; throw e;
    }
    return { buf: Buffer.from(await res.arrayBuffer()), type: String(res.headers.get('content-type') || '') };
  };

  // ---------- Hermes (GitHub repo tree, cached) ----------
  let tree = null; let treeAt = 0; const descs = new Map();
  async function hermesTree() {
    if (tree && Date.now() - treeAt < 3600e3) return tree;
    const j = await getJson(`https://api.github.com/repos/${HERMES.repo}/git/trees/${HERMES.branch}?recursive=1`);
    if (j.truncated) throw new Error('The Hermes repository listing is too large to read.');
    tree = j.tree || []; treeAt = Date.now();
    return tree;
  }
  const raw = (p) => `https://raw.githubusercontent.com/${HERMES.repo}/${HERMES.branch}/${p.split('/').map(encodeURIComponent).join('/')}`;
  async function hermesDesc(dir) {
    if (descs.has(dir)) return descs.get(dir);
    let d = '';
    try { const { buf } = await getBuf(raw(dir + '/SKILL.md')); d = parseSkill(buf.toString('utf8')).meta.description || ''; } catch {}
    descs.set(dir, d); return d;
  }
  async function searchHermes(query) {
    const t = await hermesTree();
    const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    let dirs = t.filter((e) => e.type === 'blob' && /\/SKILL\.md$/.test(e.path) && HERMES.dirs.some((d) => e.path.startsWith(d + '/'))).map((e) => e.path.replace(/\/SKILL\.md$/, ''));
    dirs = dirs.filter((d) => q.every((w) => d.toLowerCase().includes(w)));
    dirs.sort((a, b) => (a.startsWith('optional-skills') ? 0 : 1) - (b.startsWith('optional-skills') ? 0 : 1) || a.localeCompare(b));
    const total = dirs.length; dirs = dirs.slice(0, 30);
    const out = await Promise.all(dirs.map(async (d) => {
      const parts = d.split('/');
      return { source: 'hermes', id: d, name: parts[parts.length - 1], summary: await hermesDesc(d), author: parts[0] === 'skills' ? 'Hermes (bundled)' : 'Hermes (optional)', category: parts.slice(1, -1).join(' / ') };
    }));
    return { ok: true, items: out, total };
  }

  // ---------- ClawHub ----------
  async function searchClaw(query) {
    const q = String(query || '').trim();
    if (q) {
      const j = await getJson(`${CLAW}/api/v1/search?q=${encodeURIComponent(q)}&limit=30&nonSuspiciousOnly=true`);
      return { ok: true, items: (j.results || []).map((r) => ({ source: 'clawhub', id: r.slug, name: r.displayName || r.slug, summary: r.summary || '', author: r.ownerHandle || '', version: r.version || '' })) };
    }
    const j = await getJson(`${CLAW}/api/v1/skills?sort=trending&limit=30&nonSuspiciousOnly=true`);
    return { ok: true, items: (j.items || []).map((r) => ({ source: 'clawhub', id: r.slug, name: r.displayName || r.slug, summary: r.summary || '', author: r.ownerHandle || '', version: (r.latestVersion && r.latestVersion.version) || '' })) };
  }

  async function search({ source, query } = {}) {
    try { return source === 'hermes' ? await searchHermes(query) : await searchClaw(query); }
    catch (e) { return { ok: false, error: e.message || String(e) }; }
  }

  async function preview({ source, id } = {}) {
    try {
      if (source === 'hermes') {
        if (!/^(optional-skills|skills)\//.test(id) || id.includes('..')) throw new Error('Unknown skill.');
        const { buf } = await getBuf(raw(id + '/SKILL.md'));
        return { ok: true, text: buf.toString('utf8').slice(0, 8000) };
      }
      const { buf } = await getBuf(`${CLAW}/api/v1/skills/${encodeURIComponent(id)}/file?path=SKILL.md&preview=1`);
      return { ok: true, text: buf.toString('utf8').slice(0, 8000) };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  }

  // ---------- install ----------
  /** files: [{ rel, data: Buffer }] with SKILL.md somewhere; writes the folder under userDir. */
  function writeSkill(files, hint, meta) {
    if (!files.length) throw new Error('The skill has no files.');
    if (files.length > MAX_FILES) throw new Error('The skill has too many files.');
    if (files.reduce((n, x) => n + x.data.length, 0) > MAX_TOTAL) throw new Error('The skill is larger than 8 MB.');
    const md = files.filter((x) => /(^|\/)SKILL\.md$/i.test(x.rel)).sort((a, b) => a.rel.split('/').length - b.rel.split('/').length)[0];
    if (!md) throw new Error('This package has no SKILL.md, so it is not a skill Artemis can use.');
    const base = md.rel.includes('/') ? md.rel.slice(0, md.rel.lastIndexOf('/') + 1) : '';
    const inner = files.filter((x) => x.rel.startsWith(base)).map((x) => ({ rel: safeRel(x.rel.slice(base.length)), data: x.data })).filter((x) => x.rel);
    const parsed = parseSkill(md.data.toString('utf8'));
    const slug = slugOf(parsed.meta.name || hint);
    if (!slug) throw new Error('The skill has no usable name.');
    const dir = path.join(userDir, slug);
    if (fs.existsSync(dir) && !fs.existsSync(path.join(dir, MARK))) throw new Error(`A skill called "${slug}" already exists and was not installed from a hub. Rename or delete it first.`);
    const tmp = dir + '.installing';
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const x of inner) {
      const p = path.join(tmp, x.rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (x.rel === 'SKILL.md' && !parsed.meta.description && meta.summary) {
        const oneLine = String(meta.summary).replace(/\s+/g, ' ').trim().slice(0, 400);
        fs.writeFileSync(p, `---\nname: ${parsed.meta.name || hint}\ndescription: ${oneLine}\n---\n\n${parsed.body}\n`);
      } else fs.writeFileSync(p, x.data);
    }
    fs.writeFileSync(path.join(tmp, MARK), JSON.stringify({ source: meta.source, id: meta.id, version: meta.version || '', installed: new Date().toISOString() }));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(userDir, { recursive: true });
    fs.renameSync(tmp, dir);
    try { notify && notify(); } catch {}
    return { ok: true, name: parsed.meta.name || slug, slug };
  }

  async function zipFiles(buf, prefix) {
    const zip = await JSZip.loadAsync(buf);
    const out = [];
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const rel = safeRel(name);
      if (!rel || (prefix && !rel.includes(prefix))) continue;
      out.push({ rel, data: await entry.async('nodebuffer') });
      if (out.length > MAX_FILES + 50) break;
    }
    return out;
  }

  async function installClaw(item) {
    try { return await installClawZip(item); }
    catch (e) {
      // The package download can be refused (HTTP 409 and others) while the skill text is still readable: install SKILL.md alone.
      if (!e.status || e.status === 429 || e.status >= 500) throw e;
      let md;
      try { md = (await getBuf(`${CLAW}/api/v1/skills/${encodeURIComponent(item.id)}/file?path=SKILL.md`)).buf; }
      catch { throw e; }
      return writeSkill([{ rel: 'SKILL.md', data: md }], item.id, item);
    }
  }

  async function installClawZip(item) {
    const url = `${CLAW}/api/v1/download?slug=${encodeURIComponent(item.id)}`;
    const { buf, type } = await getBuf(url);
    if (/json/i.test(type)) {
      // a skill that lives on GitHub: the registry hands over where it is
      const h = JSON.parse(buf.toString('utf8'));
      if (!h.archiveUrl) throw new Error('The registry did not return a download for this skill.');
      const arch = await getBuf(h.archiveUrl);
      const sub = h.path ? safeRel(h.path) : '';
      const all = await zipFiles(arch.buf, '');
      const files = all.map((x) => { const i = x.rel.indexOf('/'); return { rel: i >= 0 ? x.rel.slice(i + 1) : x.rel, data: x.data }; }).filter((x) => !sub || x.rel === sub || x.rel.startsWith(sub + '/'));
      return writeSkill(files, item.id, item);
    }
    return writeSkill(await zipFiles(buf, ''), item.id, item);
  }

  async function installHermes(item) {
    const id = String(item.id || '');
    if (!/^(optional-skills|skills)\//.test(id) || id.includes('..')) throw new Error('Unknown skill.');
    const t = await hermesTree();
    const blobs = t.filter((e) => e.type === 'blob' && e.path.startsWith(id + '/'));
    if (!blobs.length) throw new Error('That skill is no longer in the repository.');
    if (blobs.length > MAX_FILES) throw new Error('The skill has too many files.');
    const files = [];
    for (const b of blobs) files.push({ rel: b.path, data: (await getBuf(raw(b.path))).buf });
    return writeSkill(files, id.split('/').pop(), item);
  }

  async function install(item = {}) {
    try {
      if (!item.id) throw new Error('Nothing to install.');
      return item.source === 'hermes' ? await installHermes(item) : await installClaw(item);
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  }

  /** Slugs installed from a hub, to show "Installed" on the search results. */
  function installed() {
    const out = {};
    try {
      for (const e of fs.readdirSync(userDir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        try { const m = JSON.parse(fs.readFileSync(path.join(userDir, e.name, MARK), 'utf8')); out[m.source + ':' + m.id] = e.name; } catch {}
      }
    } catch {}
    return out;
  }

  return { search, preview, install, installed };
}

module.exports = { createSkillHub };
