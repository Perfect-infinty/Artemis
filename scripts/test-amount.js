const assert = require('assert');
(async () => {
  const { parseTokens, fmtTokens, parseUsd, fmtUsdInput } = await import('../src/lib/amount.mjs');
  assert.strictEqual(parseTokens('500k'), 500000); assert.strictEqual(parseTokens('1.5M'), 1500000); assert.strictEqual(parseTokens(' 2m tokens '), 2000000);
  assert.strictEqual(parseTokens('250000'), 250000); assert.strictEqual(parseTokens('1,000'), 1000); assert.strictEqual(parseTokens(''), 0); assert.strictEqual(parseTokens('abc'), 0); assert.strictEqual(parseTokens('-5'), 0);
  assert.strictEqual(fmtTokens(1500000), '1.5M'); assert.strictEqual(fmtTokens(500000), '500k'); assert.strictEqual(fmtTokens(20000000), '20M'); assert.strictEqual(fmtTokens(0), ''); assert.strictEqual(fmtTokens(950), '950');
  assert.strictEqual(parseTokens(fmtTokens(1234000)), 1234000);
  assert.strictEqual(parseUsd('$5'), 5); assert.strictEqual(parseUsd('0.5'), 0.5); assert.strictEqual(parseUsd('$1,200.50'), 1200.5); assert.strictEqual(parseUsd('x'), 0); assert.strictEqual(parseUsd(''), 0);
  assert.strictEqual(fmtUsdInput(2.5), '2.5'); assert.strictEqual(fmtUsdInput(0), '');
  console.log('amount: all tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
