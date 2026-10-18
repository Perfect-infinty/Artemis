const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), JSZip = require('jszip');
const files = require('../electron/files');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-'));
  const zip = new JSZip();
  zip.file('src/app.py', 'print("hi")\n'); zip.file('data.csv', 'a,b\n1,2\n'); zip.file('pic.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]));
  zip.file('__MACOSX/._x', 'junk'); zip.file('bin.dat', Buffer.from([1, 2, 0, 3]));
  fs.writeFileSync(path.join(dir, 'proj.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
  let a = await files.parseAttachment(path.join(dir, 'proj.zip'));
  assert.strictEqual(a.kind, 'archive');
  assert(/4 files/.test(a.text) && /src\/app\.py/.test(a.text) && /=== src\/app\.py ===\nprint\("hi"\)/.test(a.text) && /=== data\.csv ===/.test(a.text));
  assert(!/__MACOSX/.test(a.text) && !/=== bin\.dat/.test(a.text));
  // zip with a wrong extension is still read as a zip
  fs.copyFileSync(path.join(dir, 'proj.zip'), path.join(dir, 'proj.bin'));
  a = await files.parseAttachment(path.join(dir, 'proj.bin')); assert.strictEqual(a.kind, 'archive');
  // unknown binary types are attached with info instead of failing
  fs.writeFileSync(path.join(dir, 'clip.mp4'), Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 0, 0]));
  a = await files.parseAttachment(path.join(dir, 'clip.mp4'));
  assert.strictEqual(a.kind, 'binary'); assert(a.text.includes(path.join(dir, 'clip.mp4')) && /clip\.mp4/.test(a.text));
  // unknown extension with text content is read as text
  fs.writeFileSync(path.join(dir, 'notes.xyz'), 'hello world');
  a = await files.parseAttachment(path.join(dir, 'notes.xyz')); assert.strictEqual(a.text, 'hello world');
  // csv stays text
  fs.writeFileSync(path.join(dir, 't.csv'), 'a;b\n1;2\n'); a = await files.parseAttachment(path.join(dir, 't.csv')); assert.strictEqual(a.kind, 'text');
  // jar (a zip with an unknown extension) lists its entries
  fs.copyFileSync(path.join(dir, 'proj.zip'), path.join(dir, 'mod.jar'));
  a = await files.parseAttachment(path.join(dir, 'mod.jar')); assert.strictEqual(a.kind, 'archive');
  // corrupt zip -> error entry, not a crash
  fs.writeFileSync(path.join(dir, 'bad.zip'), Buffer.from('PK\x03\x04garbage'));
  a = await files.parseAttachment(path.join(dir, 'bad.zip')); assert.strictEqual(a.kind, 'error');
  // attachments without a path on disk (pasted / dragged from an app): any file type is accepted
  a = await files.parseBuffer('../../evil name?.mp4', Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 0, 1, 2, 3]), dir);
  assert.strictEqual(a.kind, 'binary'); assert(/evil name_\.mp4/.test(a.name) && a.path.startsWith(dir), a.path);
  a = await files.parseBuffer('note.txt', Buffer.from('hello wörld'), dir); assert.strictEqual(a.kind, 'text'); assert.strictEqual(a.text, 'hello wörld');
  a = await files.parseBuffer('empty.bin', Buffer.alloc(0), dir); assert.strictEqual(a.kind, 'error');
  a = await files.parseBuffer('data.xlsx', fs.readFileSync(path.join(dir, 'bad.zip')), dir); assert.strictEqual(a.kind, 'error'); // a broken file is reported, not thrown
  // UTF-16 (with or without BOM) is text; invalid UTF-8 is read as windows-1254
  fs.writeFileSync(path.join(dir, 'u16.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('café crème', 'utf16le')]));
  a = await files.parseAttachment(path.join(dir, 'u16.txt')); assert.strictEqual(a.kind, 'text'); assert.strictEqual(a.text, 'café crème');
  fs.writeFileSync(path.join(dir, 'u16be.log'), Buffer.from('hello there', 'utf16le').swap16());
  a = await files.parseAttachment(path.join(dir, 'u16be.log')); assert.strictEqual(a.text, 'hello there');
  fs.writeFileSync(path.join(dir, 'legacy.txt'), Buffer.from([0x6e, 0x61, 0xef, 0x76, 0x65]));
  let rc = await files.readContent(path.join(dir, 'legacy.txt')); assert(rc.text === 'naïve' && rc.encoding === 'windows-1254');
  rc = await files.readContent(path.join(dir, 'u16.txt')); assert(rc.encoding === 'utf16le' && rc.bom);
  assert.deepStrictEqual(files.encodeText('Éü', { encoding: 'windows-1254' }).buf, Buffer.from([0xc9, 0xfc]));
  assert(files.encodeText('✓', { encoding: 'windows-1254' }).switched);
  // a big text file is not read whole: only its start comes back, marked large
  const big = path.join(dir, 'big.txt'); fs.writeFileSync(big, 'x'.repeat(21 * 1024 * 1024));
  rc = await files.readContent(big); assert(rc.large && rc.text.length <= 256 * 1024 && rc.size > 20 * 1024 * 1024);
  a = await files.parseAttachment(big); assert(a.truncated && a.kind === 'text');
  const s = await files.streamText(big, { offset: 21 * 1024 * 1024 - 10, maxChars: 100 }); assert(s.text.length === 10 && !s.cut);
  // a big unknown binary is sniffed, not read
  const bin = path.join(dir, 'disk.img'); fs.writeFileSync(bin, Buffer.alloc(30 * 1024 * 1024));
  a = await files.parseAttachment(bin); assert.strictEqual(a.kind, 'binary');
  assert(!files.TEXT_EXT.has('.zip') && files.kindOf('a.zip') === 'archive');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('files: all tests passed'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
