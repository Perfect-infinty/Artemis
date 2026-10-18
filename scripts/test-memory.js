const assert = require('assert');
const tools = require('../electron/tools.js');
(async () => {
  const list = [];
  const key = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const memory = { list: () => list, add: (t) => { const s = list.find((m) => key(m.text) === key(t)); if (s) return { ...s, duplicate: true }; const it = { id: 'i' + list.length, text: t }; list.push(it); return it; }, remove: (id) => { const i = list.findIndex((m) => m.id === id); if (i < 0) return false; list.splice(i, 1); return true; } };
  const ctx = { memory, runState: {} };
  const r1 = await tools.run('memory_save', { text: 'Use X.' }, { ...ctx });
  const r2 = await tools.run('memory_save', { text: 'use x' }, { ...ctx });
  
  assert(/Already in memory/.test(r2.text) && list.length === 1);
  await tools.run('memory_forget', { id: 'i0' }, { ...ctx });
  await tools.run('memory_save', { text: 'b' }, { ...ctx });
  const r5 = await tools.run('memory_save', { text: 'c' }, { ...ctx });
  assert(/already changed 4 times/.test(r5.text));
  console.log('memory: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
