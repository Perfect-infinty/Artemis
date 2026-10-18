const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const files = require('../electron/files.js');
const XLSX = require('xlsx');
const XLSX_cached = (p) => { const wb = XLSX.readFile(p); return wb.Sheets.One.B2.v; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
// CSV (semicolon, quoted, leading zeros kept)
const csv = path.join(dir, 'a.csv');
fs.writeFileSync(csv, '﻿name;code;note\nAlice;007;"a;b"\nBob;12;x\n');
let r = files.loadSheets(csv);
assert.strictEqual(r.delimiter, ';'); assert.deepStrictEqual(r.sheets[0].rows[1], ['Alice', '007', 'a;b']);
r.sheets[0].rows[2][1] = '=B2+1';
files.saveSheets(csv, r.sheets, { delimiter: r.delimiter });
assert.ok(fs.existsSync(csv + '.bak'));
const again = files.loadSheets(csv); assert.strictEqual(again.sheets[0].rows[2][1], '=B2+1'); assert.strictEqual(again.delimiter, ';');
// xlsx round trip with formula + two sheets
for (const ext of ['xlsx', 'xls', 'ods']) {
  const p = path.join(dir, 'b.' + ext);
  files.saveSheets(p, [{ name: 'One', rows: [['a', 1, 2], ['', { f: '=B1+C1', v: 3 }]] }, { name: 'Two', rows: [['x']] }]);
  const l = files.loadSheets(p);
  assert.deepStrictEqual(l.sheets.map((s) => s.name), ['One', 'Two']);
  assert.strictEqual(l.sheets[0].rows[0][1], 1); assert.strictEqual(l.sheets[0].rows[1][1], ext === 'xls' ? 3 : '=B1+C1');
  assert.strictEqual(XLSX_cached(p), 3);
}
assert.throws(() => files.loadSheets(path.join(dir, 'x.txt')));
// update_cells on CSV: one BOM, delimiter and leading zeros kept
const sc = path.join(dir, 'semi.csv');
fs.writeFileSync(sc, '\ufeffname;code\nAlice;007\nBob;12\n');
let u = files.updateCells(sc, null, [{ cell: 'B3', value: '13' }]);
const sct = fs.readFileSync(sc, 'utf8');
assert.strictEqual(u.count, 1);
assert(sct.startsWith('\ufeffname;code') && !sct.startsWith('\ufeff\ufeff') && sct.includes('Alice;007') && sct.includes('Bob;13'), JSON.stringify(sct));
// windows-1254 CSV stays windows-1254
const tc = path.join(dir, 'legacy.csv');
fs.writeFileSync(tc, Buffer.from([0x6e, 0x61, 0x6d, 0x65, 0x3b, 0x63, 0x69, 0x74, 0x79, 0x0a, 0x5a, 0x6f, 0xeb, 0x3b, 0x5a, 0xfc, 0x72, 0x69, 0x63, 0x68, 0x0a])); // name;city / Zoë;Zürich
files.updateCells(tc, null, [{ cell: 'B2', value: 'Genève' }]);
const tb = fs.readFileSync(tc);
assert(tb.includes(Buffer.from([0x47, 0x65, 0x6e, 0xe8, 0x76, 0x65])) && tb.includes(Buffer.from([0x5a, 0x6f, 0xeb, 0x3b])) && tb[0] === 0x6e, tb.toString('latin1'));
assert.strictEqual(files.loadSheets(tc).sheets[0].rows[1][0], 'Zoë');
// update_cells on xlsx: a .bak first, and a note about formatting
const ux = path.join(dir, 'u.xlsx');
files.writeSpreadsheet(ux, [{ name: 'S', rows: [['a', 1]] }]);
u = files.updateCells(ux, 'S', [{ cell: 'B1', value: 2 }]);
assert(fs.existsSync(ux + '.bak') && /formatting/.test(u.note) && XLSX.readFile(ux).Sheets.S.B1.v === 2 && XLSX.readFile(ux + '.bak').Sheets.S.B1.v === 1);
assert(!fs.readdirSync(dir).some((n) => /\.tmp-/.test(n)));
// a sheet that declares a whole-column range only shows the cells it has
const many = {}; for (let r = 0; r < 3000; r++) many[XLSX.utils.encode_cell({ r, c: 0 })] = { t: 'n', v: r };
const cut = files.usedRange(many, 1000); assert(cut && cut.shown === 1000 && many['!ref'] === 'A1:A1000');
(async () => {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['h1', 'h2'], [1, 2]]), 'W');
  const z = await require('jszip').loadAsync(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  z.file('xl/worksheets/sheet1.xml', (await z.file('xl/worksheets/sheet1.xml').async('string')).replace(/<dimension ref="[^"]*"/, '<dimension ref="A1:XFD1048576"'));
  const wp = path.join(dir, 'w.xlsx'); fs.writeFileSync(wp, await z.generateAsync({ type: 'nodebuffer' }));
  assert.strictEqual(XLSX.readFile(wp).Sheets.W['!ref'], 'A1:XFD1048576');
  const t0 = Date.now();
  const rc = await files.readContent(wp);
  assert(/## Sheet: W \(A1:B2\)\nh1,h2\n1,2/.test(rc.text) && Date.now() - t0 < 3000, rc.text.slice(0, 200));
  const ls = files.loadSheets(wp); assert(ls.sheets[0].rows.length === 2 && !ls.truncated);
  console.log('sheet: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
