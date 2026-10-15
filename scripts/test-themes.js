const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const themes = require('../electron/themes');

// 1. built-in themes load and every file parses
const builtin = themes.list({});
assert.strictEqual(builtin.errors.length, 0, 'built-in themes must all parse: ' + JSON.stringify(builtin.errors));
const files = fs.readdirSync(themes.builtinDir()).filter((f) => f.endsWith('.json')).sort();
assert.ok(files.length >= 2, 'expected the shipped themes, got ' + files.length);
assert.deepStrictEqual(builtin.themes.map((t) => t.id).sort(), files.map((f) => f.replace('.json', '')).sort(), 'one theme per file');
for (const t of builtin.themes) {
  assert.strictEqual(t.source, 'builtin');
  assert.ok(t.name && t.preview.length === 3, t.id + ' needs a name and 3 preview colours');
  assert.ok(t.vars['--theme-bg'] && t.vars['--theme-accent'], t.id + ' needs at least bg and accent');
}

// 2. "system" is reserved and bad values never reach the stylesheet
assert.strictEqual(themes.parseFile(path.join(themes.builtinDir(), '..', 'package.json')), null, 'a non-theme json must be ignored');
assert.deepStrictEqual(themes.cleanVars({ '--bg': 'red; } body { display:none', '--ok': '#fff', 'not-a-var': '#000' }), { '--ok': '#fff' });
assert.deepStrictEqual(themes.cleanVars({ '--x': 'url(http://evil)' }), {});

// 3. user and project folders: project wins by id, broken files are reported not thrown
const user = fs.mkdtempSync(path.join(os.tmpdir(), 'themes-user-'));
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'themes-project-'));
const write = (dir, name, body) => fs.writeFileSync(path.join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
write(user, 'hack.json', { id: 'hack', name: 'Hack', group: 'Test', preview: ['#000', '#111', '#222'], vars: { '--theme-bg': '#111', '--theme-accent': '#222' } });
write(project, 'hack.json', { id: 'hack', name: 'Hack Project', group: 'Test', preview: ['#333', '#444', '#555'], vars: { '--theme-bg': '#333' } });
write(project, 'system.json', { id: 'system', name: 'Nope', group: 'Test', preview: [], vars: { '--theme-bg': '#000' } });
write(project, 'broken.json', '{ nope');

const merged = themes.list({ user, project });
const hack = merged.themes.find((t) => t.id === 'hack');
assert.strictEqual(hack.name, 'Hack Project', 'project theme overrides the user one');
assert.strictEqual(hack.source, 'project');
assert.deepStrictEqual(merged.errors.map((e) => path.basename(e.file)).sort(), ['broken.json', 'system.json'], 'broken and reserved files are reported, not fatal');
assert.ok(!merged.themes.some((t) => t.id === 'system'), 'system may not be redefined');
assert.strictEqual(merged.count, files.length + 4, 'count covers every json file seen');

// 4. import and delete stay inside our own folders
const pick = path.join(user, 'picked.json');
write(user, 'picked.json', { id: 'picked', name: 'Picked', group: 'Test', preview: ['#000', '#111', '#222'], vars: { '--theme-bg': '#010101' } });
const imported = themes.importFiles([pick], { user, project });
assert.ok(imported.added.includes('picked'), 'import copied the theme');
assert.ok(fs.existsSync(path.join(project, 'picked.json')), 'import prefers the project folder');
assert.throws(() => themes.importFiles([], { user, project }), /No theme/);
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'themes-outside-'));
const stray = path.join(outside, 'stray.json'); fs.writeFileSync(stray, '{}');
assert.throws(() => themes.removeFile(stray, { user, project }), /not inside a themes folder/, 'must not delete outside the theme folders');
assert.ok(themes.removeFile(path.join(project, 'picked.json'), { user, project }).themes.some((t) => t.id === 'picked'), 'delete keeps the user copy');
assert.throws(() => themes.removeFile(path.join(project, 'hack.json'), {}), /not inside a themes folder/);

fs.rmSync(user, { recursive: true, force: true });
fs.rmSync(project, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
console.log('themes: all tests passed');