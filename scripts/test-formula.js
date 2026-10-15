const assert = require('assert');
(async () => {
  const { createEvaluator, formatValue, colName, colIndex } = await import('../src/lib/formula.mjs');
  assert.strictEqual(colName(0), 'A'); assert.strictEqual(colName(26), 'AA'); assert.strictEqual(colIndex('AB'), 27);
  const sheets = [
    { name: 'Data', rows: [['Item', 'Qty', 'Price', 'Total'], ['Apple', 3, 10, '=B2*C2'], ['Pear', '2', 15, '=B3*C3'], ['', '', '', '=SUM(D2:D3)'], ['=A1&"!"', '=IF(D4>50,"big","small")', '=Other!A1*2', '=D4/0']] },
    { name: 'Other', rows: [[21]] }
  ];
  const ev = createEvaluator(sheets);
  const f = (r, c, s = 0) => formatValue(ev(s, r, c));
  assert.strictEqual(f(1, 3), '30'); assert.strictEqual(f(2, 3), '30'); assert.strictEqual(f(3, 3), '60');
  assert.strictEqual(f(4, 0), 'Item!'); assert.strictEqual(f(4, 1), 'big'); assert.strictEqual(f(4, 2), '42'); assert.strictEqual(f(4, 3), '#DIV/0!');
  const t = (rows) => createEvaluator([{ name: 'S', rows }]);
  assert.strictEqual(formatValue(t([['=1+2*3^2']])(0, 0, 0)), '19');
  assert.strictEqual(formatValue(t([['=(1+2)*3']])(0, 0, 0)), '9');
  assert.strictEqual(formatValue(t([['=50%']])(0, 0, 0)), '0.5');
  assert.strictEqual(formatValue(t([['=-A2'], [4]])(0, 0, 0)), '-4');
  assert.strictEqual(formatValue(t([['=AVERAGE(A2:A4)'], [1], [2], [6]])(0, 0, 0)), '3');
  assert.strictEqual(formatValue(t([['=MAX(1,A2:A3)'], [9], [4]])(0, 0, 0)), '9');
  assert.strictEqual(formatValue(t([['=COUNTIF(A2:A5,">2")'], [1], [3], [5], ['x']])(0, 0, 0)), '2');
  assert.strictEqual(formatValue(t([['=SUMIF(A2:A4,"a",B2:B4)'], ['a', 1], ['b', 5], ['a', 2]])(0, 0, 0)), '3');
  assert.strictEqual(formatValue(t([['=ROUND(2.567,1)']])(0, 0, 0)), '2.6');
  assert.strictEqual(formatValue(t([['=A1']])(0, 0, 0)), '#CYCLE!');
  assert.strictEqual(formatValue(t([['=NOPE(1)']])(0, 0, 0)), '#NAME?');
  assert.strictEqual(formatValue(t([['=IFERROR(1/0,"x")']])(0, 0, 0)), 'x');
  assert.strictEqual(formatValue(t([['=1+']])(0, 0, 0)), '#VALUE!');
  assert.strictEqual(formatValue(t([['=\'S\'!A2'], [7]])(0, 0, 0)), '7');
  console.log('formula: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
