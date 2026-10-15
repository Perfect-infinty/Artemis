const assert = require('assert');
const { createTerminals } = require('../electron/terminal.js');
const until = async (f, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 40)); } };
(async () => {
  if (process.platform === 'win32') return console.log('terminal: skipped on Windows');
  const ev = [];
  const t = createTerminals({ emit: (c, p) => ev.push([c, p]) });
  const r = t.open({ cols: 100, rows: 30, shell: '/bin/bash', cwd: '/tmp' });
  assert.ok(r.ok, r.error);
  const text = () => ev.filter((e) => e[0] === 'term:data' && e[1].id === r.id).map((e) => e[1].data).join('');
  t.input(r.id, 'echo hello-$((6*7)); pwd\n');
  await until(() => /hello-42/.test(text()) && /\/tmp/.test(text()));
  t.input(r.id, 'stty size\n');
  await until(() => /30 100/.test(text()));
  t.resize(r.id, 120, 40); await new Promise((x) => setTimeout(x, 200));
  t.input(r.id, 'stty size\n');
  await until(() => /40 120/.test(text()));
  t.input(r.id, 'printf "\\303\\274\\n"\n'); await until(() => /ü/.test(text()));
  assert.ok(t.snapshot(r.id).data.includes('hello-42'));
  t.input(r.id, 'exit 3\n');
  await until(() => ev.some((e) => e[0] === 'term:exit' && e[1].id === r.id));
  assert.strictEqual(ev.find((e) => e[0] === 'term:exit')[1].code, 3);
  const w = createTerminals({ emit() {}, platform: 'win32' }).open(); assert.ok(!w.ok);
  const n = createTerminals({ emit() {}, python: '/nonexistent/python' }).open(); // explicit missing python -> spawn error path
  t.closeAll(); await new Promise((x) => setTimeout(x, 100));
  console.log('terminal: all tests passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
