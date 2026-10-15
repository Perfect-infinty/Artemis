// Tool layer test (no Electron needed): node scripts/test-tools.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tools = require('../electron/tools');
const files = require('../electron/files');
const XLSX = require('xlsx');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-'));
  const mem = [];
  const ctx = (extra = {}) => ({
    root, autoApprove: false, approve: async () => true,
    memory: {
      list: () => mem,
      add: (text) => { const i = { id: 'm' + mem.length, text }; mem.push(i); return i; },
      remove: (id) => { const n = mem.findIndex((m) => m.id === id); if (n < 0) return false; mem.splice(n, 1); return true; }
    },
    ...extra
  });
  const run = (n, a, c) => tools.run(n, a, c || ctx());

  // write / read / edit
  let r = await run('write_file', { path: 'notes/a.txt', content: 'hello wörld\nsecond line' });
  assert(r.ok, r.text);
  r = await run('read_file', { path: 'notes/a.txt' });
  assert(r.text.includes('hello wörld'));
  // line range: only the asked lines come back, with a hint for the next part
  await run('write_file', { path: 'notes/lines.txt', content: Array.from({ length: 500 }, (_, i) => `row ${i + 1}`).join('\n') });
  r = await run('read_file', { path: 'notes/lines.txt', start_line: 10, end_line: 12 });
  assert(r.ok && r.text.startsWith('row 10\nrow 11\nrow 12') && !r.text.includes('row 13\n') && /lines 10-12 of 500; continue with start_line=13/.test(r.text), r.text);
  r = await run('read_file', { path: 'notes/lines.txt', start_line: 495 });
  assert(r.text.includes('row 500') && /lines 495-500 of 500\]/.test(r.text) && !/continue with/.test(r.text), r.text);
  r = await run('edit_file', { path: 'notes/a.txt', old_string: 'wörld', new_string: 'universe' });
  assert(r.ok && fs.readFileSync(path.join(root, 'notes/a.txt'), 'utf8').includes('hello universe'));
  r = await run('edit_file', { path: 'notes/a.txt', old_string: 'no such text', new_string: 'x' });
  assert(!r.ok);

  // onay reddi
  r = await run('write_file', { path: 'x.txt', content: 'x' }, ctx({ approve: async () => false }));
  assert(r.denied && !fs.existsSync(path.join(root, 'x.txt')));
  // autoApprove (except deleting)
  let asked = 0;
  r = await run('write_file', { path: 'auto.txt', content: 'x' }, ctx({ autoApprove: true, approve: async () => { asked++; return true; } }));
  assert(r.ok && asked === 0);
  r = await run('delete_file', { path: 'auto.txt' }, ctx({ autoApprove: true, approve: async () => { asked++; return true; } }));
  assert(r.ok && asked === 1 && !fs.existsSync(path.join(root, 'auto.txt')));

  // path escape
  for (const p of ['../outside.txt', '/etc/passwd', 'notes/../../x']) {
    r = await run('read_file', { path: p }, ctx({ approve: async () => false }));
    assert(!r.ok && /declined/.test(r.text), p + ' -> ' + r.text);
  }
  // outside the project: read-only, after approval; secrets never; missing things say so
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aid-out-'));
  fs.writeFileSync(path.join(outDir, 'wg.conf'), '[Interface]\nAddress=10.0.0.2');
  let asked2 = 0; const ok2 = ctx({ approve: async () => { asked2++; return true; }, session: new Set() });
  r = await run('read_file', { path: path.join(outDir, 'wg.conf') }, ok2);
  assert(r.ok && /Interface/.test(r.text) && asked2 === 1, r.text);
  r = await run('list_dir', { path: outDir }, ok2);
  assert(r.ok && /wg\.conf/.test(r.text) && asked2 === 1, 'same folder asked once: ' + r.text);
  r = await run('write_file', { path: path.join(outDir, 'x.txt'), content: 'no' }, ok2);
  const outW = r;
  assert(!r.ok && !fs.existsSync(path.join(outDir, 'x.txt')), 'writing outside stays blocked');
  r = await run('read_file', { path: '~/.ssh/id_rsa' }, ok2);
  assert(!r.ok && /not allowed/.test(r.text), r.text);
  // full file access: write and read anywhere, keys included, no outside prompt
  let askedF = 0; const full = ctx({ fullAccess: true, approve: async () => { askedF++; return true; }, session: new Set() });
  r = await run('write_file', { path: path.join(outDir, 'y.txt'), content: 'yes' }, full);
  assert(r.ok && fs.readFileSync(path.join(outDir, 'y.txt'), 'utf8') === 'yes', r.text);
  fs.mkdirSync(path.join(outDir, '.ssh')); fs.writeFileSync(path.join(outDir, '.ssh', 'id_rsa'), 'k');
  r = await run('read_file', { path: path.join(outDir, '.ssh', 'id_rsa') }, full);
  assert(r.ok && /k/.test(r.text), r.text);
  assert(askedF >= 2, 'writing and reading keys outside still ask: ' + askedF);
  r = await run('read_file', { path: path.join(outDir, '.ssh', 'id_rsa') }, ctx({ fullAccess: true, approve: async () => false }));
  assert(!r.ok && /declined/.test(r.text), 'declined key read: ' + r.text);
  r = await run('list_dir', { path: 'Downloads' });
  assert(!r.ok && /Folder not found/.test(r.text) && /project folder/.test(r.text), r.text);
  r = await run('read_file', { path: 'nope.conf' });
  assert(!r.ok && /File not found/.test(r.text), r.text);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'));
  r = await run('write_file', { path: 'link/pwn.txt', content: 'x' });
  assert(!r.ok, 'symlink escape must be blocked');

  // write Excel → read → update cells
  r = await run('write_spreadsheet', {
    path: 'report.xlsx',
    sheets: [{ name: 'Sales', rows: [['Product', 'Qty', 'Price', 'Total'], ['Apple', 3, 10, '=B2*C2'], ['Pear', 2, 15, '=B3*C3']] }, { name: 'Memo', rows: [['Unicode: éüñøç']] }]
  });
  assert(r.ok, r.text);
  const wb = XLSX.readFile(path.join(root, 'report.xlsx'), { sheetStubs: true });
  assert.deepStrictEqual(wb.SheetNames, ['Sales', 'Memo']);
  assert.strictEqual(wb.Sheets['Sales'].D2.f, 'B2*C2');
  r = await run('read_file', { path: 'report.xlsx' });
  assert(r.text.includes('## Sheet: Sales') && r.text.includes('Apple,3,10,=B2*C2') && r.text.includes('éüñøç'), r.text);
  r = await run('read_file', { path: 'report.xlsx', sheet: 'Memo' });
  assert(!r.text.includes('Apple'));
  r = await run('update_cells', { path: 'report.xlsx', sheet: 'Sales', cells: [{ cell: 'B2', value: 5 }, { cell: 'A4', value: 'Banana' }] });
  assert(r.ok, r.text);
  const wb2 = XLSX.readFile(path.join(root, 'report.xlsx'), { sheetStubs: true });
  assert.strictEqual(wb2.Sheets['Sales'].B2.v, 5);
  assert.strictEqual(wb2.Sheets['Sales'].A4.v, 'Banana');
  assert.strictEqual(wb2.Sheets['Sales'].D2.f, 'B2*C2');

  // write/read/update CSV
  r = await run('write_spreadsheet', { path: 'data.csv', sheets: [{ rows: [['name', 'city'], ['Émile', 'Zürich']] }] });
  assert(r.ok, r.text);
  assert(fs.readFileSync(path.join(root, 'data.csv'), 'utf8').startsWith('﻿'));
  r = await run('read_file', { path: 'data.csv' });
  assert(r.text.includes('Émile'));
  r = await run('update_cells', { path: 'data.csv', cells: [{ cell: 'B2', value: 'Geneva' }] });
  assert(r.ok && fs.readFileSync(path.join(root, 'data.csv'), 'utf8').includes('Geneva'));
  const att = await files.parseAttachment(path.join(root, 'report.xlsx'));
  assert(att.kind === 'sheet' && att.text.includes('Sales'));

  // folder tools
  r = await run('list_dir', { recursive: true });
  assert(r.text.includes('notes/') && r.text.includes('report.xlsx'), r.text);
  r = await run('search_files', { query: 'universe' });
  assert(r.text.includes('notes/a.txt:1'), r.text);
  r = await run('search_files', { name: 'report' });
  assert(r.text.includes('report.xlsx'));
  r = await run('move_file', { from: 'data.csv', to: 'archive/data.csv' });
  assert(r.ok && fs.existsSync(path.join(root, 'archive/data.csv')));
  r = await run('delete_file', { path: '.' });
  assert(!r.ok, 'the root cannot be deleted');

  // memory
  r = await run('memory_save', { text: 'User prefers short answers' });
  assert(r.ok && mem.length === 1);
  r = await run('memory_forget', { id: 'm0' });
  assert(r.ok && mem.length === 0);

  // when the folder is missing
  r = await tools.run('list_dir', {}, { root: null });
  assert(!r.ok && /folder/.test(r.text));
  assert.deepStrictEqual(tools.definitions({ hasFolder: false, memoryEnabled: false }).map((d) => d.function.name), ['create_artifact']);

  // long file paging
  fs.writeFileSync(path.join(root, 'uzun.txt'), 'a'.repeat(130000));
  r = await run('read_file', { path: 'uzun.txt' });
  assert(/Too big to send whole/.test(r.text) && /start_line\/end_line/.test(r.text) && r.text.length < 4000, 'a big file comes back as an outline');
  r = await run('read_file', { path: 'uzun.txt', full: true });
  assert(r.text.includes('offset=60000'));
  fs.writeFileSync(path.join(root, 'big.js'), 'const a = 1;\n'.repeat(30) + 'function alpha() {\n  return 1;\n}\n' + 'x();\n'.repeat(4000) + 'export const beta = (v) => v * 2;\n');
  r = await run('read_file', { path: 'big.js' });
  assert(/\d+: function alpha\(\)/.test(r.text) && /\d+: export const beta = /.test(r.text), 'outline lists declarations with line numbers: ' + r.text.slice(0, 300));
  r = await run('read_file', { path: 'uzun.txt', offset: 120000 });
  assert(!r.text.includes('more content'));

  { const evs = []; const r = await tools.run('create_artifact', { title: 'T', type: 'html', content: '<b>x</b>' }, { send: (e) => evs.push(e) });
    assert(r.ok && evs[0].type === 'artifact' && evs[0].kind === 'html' && /^[\w-]+$/.test(evs[0].id));
    const r2 = await tools.run('create_artifact', { title: 'T', type: 'html', content: '' }, { send: () => {} });
    assert(!r2.ok); }
  fs.rmSync(root, { recursive: true, force: true });
  console.log('tools: all tests passed');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });

// ---- get_location: saved profile location, approval, IP lookup with fallback
(async () => {
  const assert = require('assert');
  const tools = require('../electron/tools');
  const { buildSystem } = require('../electron/agent');
  assert(tools.definitions({ webEnabled: true }).some((d) => d.function.name === 'get_location'));
  assert(!tools.definitions({ webEnabled: false }).some((d) => d.function.name === 'get_location'));
  // saved location: no network, no approval
  let r = await tools.run('get_location', {}, { userLocation: 'Berlin, Germany', approve: async () => { throw new Error('must not ask'); } });
  assert(r.ok && /Berlin, Germany/.test(r.text));
  // no saved location: asks once per run, declined = nothing is sent
  const realFetch = global.fetch; let calls = 0;
  global.fetch = async () => { calls++; throw new Error('must not fetch when declined'); };
  r = await tools.run('get_location', {}, { session: new Set(), approve: async () => false });
  assert(r.denied && calls === 0 && /Profile/.test(r.text));
  // approved: first service fails, second answers
  global.fetch = async (url) => { calls++; if (/ipwho/.test(url)) return { ok: false, status: 429 }; return { ok: true, json: async () => ({ city: 'Berlin', region: 'Berlin', country_name: 'Germany', latitude: 52.52, longitude: 13.4049, timezone: 'Europe/Berlin' }) }; };
  let asked = 0; const ctx = { session: new Set(), approve: async (i) => { asked++; assert(i.category === 'location' && i.session); return true; } };
  r = await tools.run('get_location', {}, ctx);
  assert(r.ok && /Berlin, Berlin, Germany \(52\.52, 13\.40\), time zone Europe\/Berlin/.test(r.text), r.text);
  await tools.run('get_location', {}, ctx); assert.strictEqual(asked, 1);
  // both services down: a clear error for the model
  global.fetch = async () => { throw new Error('offline'); };
  r = await tools.run('get_location', {}, { session: new Set(['location']) });
  assert(!r.ok && /Ask the user for their city/.test(r.text), r.text);
  global.fetch = realFetch;
  // the saved location reaches the system prompt
  const sys = buildSystem({ userLocation: 'Berlin, Germany', webEnabled: true, hasTools: true });
  assert(/Location: Berlin, Germany/.test(sys) && /get_location/.test(sys));
  assert(!/Location:/.test(buildSystem({ userName: 'U', webEnabled: true, hasTools: true })));
  console.log('tools: get_location ok');
  { // update_schedule changes a task in place instead of creating another one
    const jobs = [{ id: 's1', name: 'Water', prompt: 'Drink water', projectId: null, model: '', repeat: { type: 'daily', at: '09:00' }, enabled: true, allowEdits: false, notifyPhone: false, reminder: true, description: 'daily' }];
    const saves = [];
    const schedule = { list: () => jobs, save: (j) => { saves.push(j); return { ...j, nextRun: null }; } };
    const ctx2 = { schedule, session: new Set(), approve: async () => true };
    const u = await tools.run('update_schedule', { id: 's1', at: '10:30', notify_phone: true }, ctx2);
    assert(u.ok && saves.length === 1 && saves[0].id === 's1' && saves[0].repeat.at === '10:30' && saves[0].repeat.type === 'daily' && saves[0].notifyPhone === true && saves[0].reminder === true && saves[0].prompt === 'Drink water', JSON.stringify(u));
    const bad = await tools.run('update_schedule', { id: 'nope' }, ctx2).catch(() => ({ ok: false }));
    assert(!bad.ok && saves.length === 1);
    console.log('tools: update_schedule ok');
  }
  { // notes_edit replaces one passage in a note instead of rewriting it
    const { createNotes } = require('../electron/notes');
    const nroot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'artemis-notes-'));
    const notes = createNotes({ getRoot: () => nroot });
    notes.write('AI/Guide.md', 'one\ntwo\nthree');
    const nctx = { notes, session: new Set(), approve: async () => true };
    let e = await tools.run('notes_edit', { path: 'AI/Guide.md', old_text: 'two', new_text: '2' }, nctx);
    assert(e.ok && notes.read('AI/Guide.md').text === 'one\n2\nthree', JSON.stringify(e));
    e = await tools.run('notes_edit', { path: 'AI/Guide.md', old_text: 'nope', new_text: 'x' }, nctx).catch(() => ({ ok: false }));
    assert(!e.ok && notes.read('AI/Guide.md').text === 'one\n2\nthree');
    console.log('tools: notes_edit ok');
  }
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
