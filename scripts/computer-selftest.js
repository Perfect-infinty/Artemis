// Run on your Mac:  node scripts/computer-selftest.js
// Takes one screenshot, wiggles the mouse slightly, and tells you which permission is missing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createComputer } = require('../electron/computer');

(async () => {
  if (process.platform !== 'darwin') { console.log('This test is for macOS only.'); return; }
  const c = createComputer({});
  let r = await c.run({ action: 'screenshot' });
  console.log('screenshot:', r.ok ? 'OK' : 'FAILED', '-', r.text.split('\n')[0]);
  if (r.ok) {
    const f = path.join(os.tmpdir(), 'aid-selftest.jpg');
    fs.writeFileSync(f, Buffer.from(r.image.split(',')[1], 'base64'));
    console.log('saved to', f, '(open it: it should show your real screen, not just the wallpaper)');
    r = await c.run({ action: 'mouse_move', x: 200, y: 200 });
    console.log('mouse move:', r.ok ? 'OK (the cursor should have jumped)' : 'FAILED - ' + r.text);
  }
})();
