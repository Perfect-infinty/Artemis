// Memory diagnostics: per-process memory of every Electron process (app.getAppMetrics), grouped by what the process is
// (main, the app window's renderer, the Sentinel widget, browser tabs, GPU, utility...), plus the app window's JS heap.
// Electron objects are injected (see agents.md: modules must be testable without Electron).

const KB = 1024;
const fmt = (kb) => (kb >= 1024 * KB ? (kb / KB / KB).toFixed(2) + ' GB' : Math.round(kb / KB) + ' MB');

/** Group process metrics. labelOf(pid) names a renderer ('window' | 'widget' | 'browser' | 'other' | ''). Memory is in KB. */
function groupMetrics(metrics, labelOf = () => '') {
  const groups = new Map();
  const add = (key, label, m) => {
    const g = groups.get(key) || { key, label, count: 0, kb: 0, peakKb: 0, pids: [] };
    const mem = m.memory || {};
    g.count++; g.kb += mem.workingSetSize || 0; g.peakKb += mem.peakWorkingSetSize || 0; g.pids.push(m.pid);
    groups.set(key, g);
  };
  for (const m of metrics || []) {
    const t = String(m.type || '');
    if (t === 'Browser') add('main', 'Main process', m);
    else if (t === 'GPU') add('gpu', 'GPU', m);
    else if (t === 'Tab') {
      const l = labelOf(m.pid);
      if (l === 'window') add('window', 'Renderer (main window)', m);
      else if (l === 'widget') add('widget', 'Sentinel widget', m);
      else if (l === 'browser') add('browser', 'Browser tabs', m);
      else add('other', 'Other windows', m);
    } else if (t === 'Utility') add('utility:' + (m.serviceName || m.name || 'utility'), 'Utility (' + (m.name || m.serviceName || 'service') + ')', m);
    else add('x:' + t, t || 'Other', m);
  }
  const order = ['main', 'window', 'widget', 'browser', 'other', 'gpu'];
  const rank = (k) => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  const list = [...groups.values()].sort((a, b) => rank(a.key) - rank(b.key) || b.kb - a.kb);
  const totalKb = list.reduce((n, g) => n + g.kb, 0);
  return { groups: list, totalKb };
}

/** One line per process group, for the log. heap = the window's performance.memory numbers (bytes), if known. */
function summaryLines(snap) {
  const lines = snap.groups.map((g) => `${g.label}${g.count > 1 ? ' ×' + g.count : ''}: ${fmt(g.kb)}`);
  if (snap.heap && snap.heap.used) lines.push(`Window JS heap: ${fmt(snap.heap.used / 1024)} used of ${fmt(snap.heap.total / 1024)}`);
  const wp = snap.windowProc || {};
  if (wp.private) lines.push(`Window private memory: ${fmt(wp.private)}`);
  if (wp.blinkKb) lines.push(`Window Blink (DOM, images): ${fmt(wp.blinkKb)}`);
  lines.push(`Total: ${fmt(snap.totalKb)}`);
  return lines;
}

/**
 * deps: { app, webContents (electron.webContents), getWin(), getWidgetWin(), browserSession() , logger }
 */
function createMemory({ app, webContents, getWin, getWidgetWin = () => null, browserSession = () => null, logger }) {
  const labelOf = () => {
    const map = new Map();
    let w = null, wd = null, bs = null;
    try { w = getWin(); } catch {}
    try { wd = getWidgetWin(); } catch {}
    try { bs = browserSession(); } catch {}
    for (const wc of (webContents && webContents.getAllWebContents ? webContents.getAllWebContents() : [])) {
      try {
        if (wc.isDestroyed()) continue;
        const pid = wc.getOSProcessId();
        let l = 'other';
        if (w && !w.isDestroyed() && wc === w.webContents) l = 'window';
        else if (wd && !wd.isDestroyed() && wc === wd.webContents) l = 'widget';
        else if (bs && wc.session === bs) l = 'browser';
        if (!map.has(pid) || l === 'window') map.set(pid, l);
      } catch {}
    }
    return (pid) => map.get(pid) || '';
  };
  function snapshot(extra = {}) {
    const snap = groupMetrics(app.getAppMetrics(), labelOf());
    return { ...snap, at: Date.now(), heap: extra.heap || null, windowProc: extra.proc || null };
  }
  function logSnapshot(reason, extra) {
    const snap = snapshot(extra);
    const lines = summaryLines(snap);
    try { logger.info('memory', `Memory (${reason || 'check'}): ` + lines.join(' · ')); } catch {}
    return { ...snap, lines };
  }
  async function free() {
    const done = [];
    try { const bs = browserSession(); if (bs) { await bs.clearCache(); done.push('browser cache cleared'); } } catch {}
    try { const w = getWin(); if (w && !w.isDestroyed()) { await w.webContents.session.clearCache(); done.push('app cache cleared'); } } catch {}
    return done;
  }
  return { snapshot, logSnapshot, free };
}

module.exports = { createMemory, groupMetrics, summaryLines, fmt };
