const assert = require('assert');
const { checkLimits } = require('../electron/limits.js');
const now = new Date(2026, 9, 13, 15, 0, 0).getTime();
const at = (d, h) => new Date(2026, 9, d, h).getTime();
const list = [{ t: at(13, 9), prompt: 600, completion: 200 }, { t: at(12, 9), prompt: 5000, completion: 0 }, { t: new Date(2026, 8, 30).getTime(), prompt: 99999, completion: 0 }];
let r = checkLimits(list, {}, now); assert.strictEqual(r.blocked, null); assert.strictEqual(r.day, 800); assert.strictEqual(r.month, 5800);
r = checkLimits(list, { dailyTokenLimit: 1000 }, now); assert.ok(r.warn && !r.blocked);
r = checkLimits(list, { dailyTokenLimit: 800 }, now); assert.ok(/Daily token limit reached/.test(r.blocked));
r = checkLimits(list, { monthlyTokenLimit: 5000 }, now); assert.ok(/Monthly/.test(r.blocked));
r = checkLimits(list, { dailyTokenLimit: 0, monthlyTokenLimit: '' }, now); assert.strictEqual(r.blocked, null);
const sp = [{ t: at(13, 9), model: 'anthropic/claude-opus-5.5', prompt: 1e6, completion: 100000 }, { t: at(13, 10), model: 'unknown/x', prompt: 5e6, completion: 0 }];
r = checkLimits(sp, { dailyUsdLimit: 5 }, now, { 'anthropic/claude-opus-5.5': [4, 20] }); assert.ok(/Daily spending limit reached \(\$6\.00 of \$5\.00\)/.test(r.blocked), r.blocked); // 1M*4 + 0.1M*20 = $6
r = checkLimits(sp, { dailyUsdLimit: 7 }, now, { 'anthropic/claude-opus-5.5': [4, 20] }); assert.ok(r.warn && !r.blocked);
console.log('limits: all tests passed');
