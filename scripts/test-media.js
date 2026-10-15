const assert = require('assert'), http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const media = require('../electron/media');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(30)]);
let mode = 'b64', last;
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    last = { url: req.url, auth: req.headers.authorization, body };
    if (req.url === '/v1/images/generations' || req.url === '/v1/videos/generations') {
      const video = req.url.includes('videos');
      if (mode === 'bad') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"blocked by policy"}}'); }
      if (mode === 'empty') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[]}'); }
      if (mode === 'url') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${srv.address().port}/file/${video ? 'v' : 'i'}` }] })); }
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [{ b64_json: (video ? MP4 : PNG).toString('base64') }] }));
    }
    if (req.url === '/file/i') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
    if (req.url === '/file/v') { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(MP4); }
    res.writeHead(404); res.end();
  });
});
srv.listen(0, async () => {
  const baseUrl = `http://127.0.0.1:${srv.address().port}`, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  const a = await media.generateImage({ baseUrl, key: 'k', model: 'x/y', prompt: 'a cat', dir });
  assert(a.path.endsWith('.png') && last.auth === 'Bearer k' && JSON.parse(last.body).model === 'x/y');
  const b = await media.generateImage({ baseUrl, key: '', model: 'x/y', prompt: 'a cat & dog', size: '512x768', dir });
  assert(JSON.parse(last.body).size === '512x768' && last.auth === undefined && b.kind === 'image');
  mode = 'url';
  const u = await media.generateImage({ baseUrl, key: 'k', model: 'x/y', prompt: 'p', dir });
  assert(u.kind === 'image');
  mode = 'bad';
  await assert.rejects(media.generateImage({ baseUrl, key: 'k', model: 'x/y', prompt: 'p', dir }), /blocked by policy/);
  mode = 'empty';
  await assert.rejects(media.generateVideo({ baseUrl, key: 'k', model: 'v/m', prompt: 'waves', dir }), /returned no video/);
  mode = 'b64';
  const v = await media.generateVideo({ baseUrl, key: 'k', model: 'v/m', prompt: 'waves', duration: 5, dir });
  assert(v.path.endsWith('.mp4') && JSON.parse(last.body).duration === 5);
  const l = media.load(dir, v.path); assert.strictEqual(l.mime, 'video/mp4');
  assert.throws(() => media.load(dir, '/etc/passwd'));
  console.log('media: all tests passed'); srv.close(); process.exit(0);
});
