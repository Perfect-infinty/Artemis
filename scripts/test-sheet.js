const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const files = require('../electron/files.js');
const XLSX = require('xlsx');
const XLSX_cached = (p) => { const wb = XLSX.readFile(p); return wb.Sheets.One.B2.v; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-'));
// CSV (semicolon, quoted, leading zeros kept)
const csv = path.join(dir, 'a.csv');
fs.writeFileSync(csv, '﻿name;code;note\nAli;007;"a;b"\nVeli;12;x\n');
let r = files.loadSheets(csv);
assert.strictEqual(r.delimiter, ';'); assert.deepStrictEqual(r.sheets[0].rows[1], ['Ali', '007', 'a;b']);
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
console.log('sheet: all tests passed');
