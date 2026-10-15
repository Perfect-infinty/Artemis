// Skill hub: search and install, with a fake network.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { createSkillHub } = require('../electron/skillhub');

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-'));
  const zip = new JSZip();
  zip.file('gifgrep/SKILL.md', '---\nname: gifgrep\n---\n\nFind GIFs.\n');
  zip.file('gifgrep/scripts/run.sh', 'echo hi');
  zip.file('../evil.txt', 'x');
  const zbuf = await zip.generateAsync({ type: 'nodebuffer' });
  const hz = new JSZip(); hz.file('SKILL.md', 'no zip here'); // unused
  const calls = [];
  const resp = (body, type) => ({ ok: true, status: 200, headers: { get: () => type }, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(String(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes('/api/v1/search')) return resp({ results: [{ slug: 'gifgrep', displayName: 'GifGrep', summary: 'Find gifs', version: '1.0.0', ownerHandle: 'steipete' }] }, 'application/json');
    if (url.includes('/api/v1/skills?')) return resp({ items: [{ slug: 'top', displayName: 'Top', summary: 's', ownerHandle: 'a', latestVersion: { version: '2.0.0' } }] }, 'application/json');
    if (url.includes('/api/v1/download')) return resp(zbuf, 'application/zip');
    if (url.includes('/git/trees/')) return resp({ truncated: false, tree: [
      { path: 'optional-skills/productivity/notes/SKILL.md', type: 'blob' }, { path: 'optional-skills/productivity/notes/ref/a.md', type: 'blob' },
      { path: 'skills/dev/git/SKILL.md', type: 'blob' }, { path: 'README.md', type: 'blob' }] }, 'application/json');
    if (url.endsWith('notes/SKILL.md')) return resp('---\nname: notes\ndescription: Take notes\n---\nbody', 'text/plain');
    if (url.endsWith('git/SKILL.md')) return resp('---\nname: git\n---\nbody', 'text/plain');
    if (url.endsWith('notes/ref/a.md')) return resp('ref', 'text/plain');
    return { ok: false, status: 404, headers: { get: () => '' }, text: async () => 'nope', json: async () => ({}) };
  };
  let notified = 0;
  const hub = createSkillHub({ userDir, notify: () => notified++, fetchFn });

  let r = await hub.search({ source: 'clawhub', query: 'gif' });
  assert.ok(r.ok && r.items[0].id === 'gifgrep' && r.items[0].author === 'steipete');
  assert.ok(calls.some((u) => u.includes('nonSuspiciousOnly=true')), 'hides suspicious skills');
  r = await hub.search({ source: 'clawhub', query: '' });
  assert.strictEqual(r.items[0].version, '2.0.0');

  r = await hub.install({ source: 'clawhub', id: 'gifgrep', summary: 'Find gifs for chats' });
  assert.ok(r.ok, r.error); assert.strictEqual(r.slug, 'gifgrep');
  const md = fs.readFileSync(path.join(userDir, 'gifgrep', 'SKILL.md'), 'utf8');
  assert.ok(/description: Find gifs for chats/.test(md), 'adds a description when the skill has none');
  assert.ok(fs.existsSync(path.join(userDir, 'gifgrep', 'scripts', 'run.sh')));
  assert.ok(!fs.existsSync(path.join(userDir, 'evil.txt')) && !fs.existsSync(path.join(path.dirname(userDir), 'evil.txt')), 'no path escape');
  assert.ok(notified >= 1);
  assert.deepStrictEqual(Object.keys(hub.installed()), ['clawhub:gifgrep']);
  assert.ok((await hub.install({ source: 'clawhub', id: 'gifgrep' })).ok, 'reinstall updates');

  r = await hub.search({ source: 'hermes', query: 'note' });
  assert.ok(r.ok && r.items.length === 1 && r.items[0].summary === 'Take notes' && /optional/.test(r.items[0].author));
  r = await hub.search({ source: 'hermes', query: '' });
  assert.strictEqual(r.items.length, 2); assert.ok(r.items[0].id.startsWith('optional-skills'));
  r = await hub.install({ source: 'hermes', id: 'optional-skills/productivity/notes' });
  assert.ok(r.ok, r.error);
  assert.ok(fs.existsSync(path.join(userDir, 'notes', 'ref', 'a.md')));
  assert.ok(!(await hub.install({ source: 'hermes', id: '../etc' })).ok);
  // a folder the user made by hand is never overwritten
  fs.mkdirSync(path.join(userDir, 'git')); fs.writeFileSync(path.join(userDir, 'git', 'SKILL.md'), '---\nname: git\ndescription: mine\n---\nx');
  r = await hub.install({ source: 'hermes', id: 'skills/dev/git' });
  assert.ok(!r.ok && /already exists/.test(r.error));
  console.log('skillhub: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
