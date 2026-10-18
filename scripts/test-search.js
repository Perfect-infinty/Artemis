// search_files: streamed reads (big files, UTF-8 split across chunks, legacy encoding), size cap and unreadable files
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tools = require('../electron/tools.js');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-search-'));
  try {
    fs.writeFileSync(path.join(dir, 'big.log'), Buffer.concat([Buffer.from('start NEEDLE here\n'), Buffer.alloc(52 * 1024 * 1024, 'x'), Buffer.from('\nend NEEDLE late\n')]));
    fs.writeFileSync(path.join(dir, 'legacy.txt'), Buffer.from('caf\xe9 NEEDLE cr\xe8me\n', 'latin1'));
    const head = Buffer.from(('a'.repeat(99) + '\n').repeat(10485));
    const pad = Buffer.alloc(1024 * 1024 - head.length - 1, 'b'); // "é" starts on the last byte of the first 1 MB chunk
    fs.writeFileSync(path.join(dir, 'split.txt'), Buffer.concat([head, pad, Buffer.from('é NEEDLE\n')]));
    const locked = path.join(dir, 'locked.txt');
    fs.writeFileSync(locked, 'NEEDLE');
    fs.chmodSync(locked, 0);
    const canLock = (() => { try { fs.readFileSync(locked); return false; } catch { return true; } })(); // root can read anything

    const r = await tools.run('search_files', { query: 'needle' }, { root: dir, approve: async () => true });
    const t = r.text;
    assert(/big\.log:1: start NEEDLE/.test(t), 'match at the start of a big file');
    assert(!/end NEEDLE late/.test(t), 'past the per-file cap is not searched');
    assert(/over 50 MB were searched only/.test(t), 'the cut is reported');
    assert(/legacy\.txt:1: café NEEDLE crème/.test(t), 'non-UTF-8 file decoded');
    assert(/split\.txt:10486: b+é NEEDLE/.test(t), 'multibyte character split across chunks, right line number');
    if (canLock) assert(/1 file\(s\) could not be read/.test(t), 'unreadable files are reported');
    console.log('search: all tests passed');
  } finally {
    try { fs.chmodSync(path.join(dir, 'locked.txt'), 0o600); } catch {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
