// App log: everything important is written to ~/.artemis/logs/artemis-YYYY-MM-DD.log and kept in memory for the Logs page.
// Secrets (keys, tokens, bearer headers) are masked before anything is stored.
const fs = require('fs');
const path = require('path');

const SECRET_KEY = /key|token|secret|authorization|password|cookie/i;
const MAX_DATA = 1800;
const KEEP_DAYS = 14;

function redactString(s) {
  return String(s)
    .replace(/Bearer\s+[A-Za-z0-9._\-~+/=]{8,}/gi, 'Bearer ***')
    .replace(/\b(sk|pk|rk|gsk|xai|hf)[-_][A-Za-z0-9_\-]{12,}/g, '$1-***')
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, '***:***')
    .replace(/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, '$1_***')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_***')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***')
    .replace(/\bAIza[0-9A-Za-z_-]{35}/g, 'AIza***')
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{8,}/g, 'xox*-***')
    .replace(/\b(x-api-key|api-key|x-goog-api-key)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1$2***');
}
function clean(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'string') return redactString(v).slice(0, 600);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Error) return { name: v.name, message: redactString(v.message), stack: redactString(String(v.stack || '').split('\n').slice(0, 4).join('\n')) };
  if (depth > 3) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 30)) o[k] = SECRET_KEY.test(k) ? '***' : clean(x, depth + 1);
    return o;
  }
  return String(v);
}

function createLogger({ dir, onEntry, onProgress, max = 1500 }) {
  let seq = 0;
  const ring = [];
  const tasks = new Map(); // id -> { id, label, pct, state, detail, since, updated }
  let writable = true;

  const fileFor = (d = new Date()) => path.join(dir, `artemis-${d.toISOString().slice(0, 10)}.log`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    for (const f of fs.readdirSync(dir)) { if (/^artemis-.*\.log$/.test(f)) { try { if (fs.statSync(path.join(dir, f)).mtimeMs < cutoff) fs.unlinkSync(path.join(dir, f)); } catch {} } }
  } catch { writable = false; }

  function log(level, source, message, data) {
    const lv = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
    let d;
    if (data !== undefined) { try { d = clean(data); const s = JSON.stringify(d); if (s && s.length > MAX_DATA) d = { truncated: s.slice(0, MAX_DATA) }; } catch { d = undefined; } }
    const e = { id: ++seq, t: Date.now(), level: lv, source: String(source || 'app').slice(0, 24), message: redactString(String(message ?? '')).slice(0, 1200), data: d };
    ring.push(e); if (ring.length > max) ring.shift();
    if (writable) { try { fs.appendFileSync(fileFor(), `${new Date(e.t).toISOString()} ${lv.toUpperCase().padEnd(5)} [${e.source}] ${e.message}${d !== undefined ? ' ' + JSON.stringify(d) : ''}\n`); } catch { writable = false; } }
    try { onEntry && onEntry(e); } catch {}
    return e;
  }

  /** A long job with a label and optional percent, shown at the top of the Logs page. state: running | done | error */
  function progress(id, label, { pct, state = 'running', detail = '' } = {}) {
    const prev = tasks.get(id);
    const now = Date.now();
    const t = { id, label: label || (prev && prev.label) || id, pct: typeof pct === 'number' ? Math.max(0, Math.min(100, pct)) : (state === 'done' ? 100 : prev ? prev.pct : null), state, detail: redactString(detail).slice(0, 300), since: prev && prev.state === 'running' && state === 'running' ? prev.since : now, updated: now };
    tasks.set(id, t);
    if (tasks.size > 30) { for (const [k, v] of tasks) { if (v.state !== 'running') { tasks.delete(k); break; } } }
    try { onProgress && onProgress([...tasks.values()]); } catch {}
    return t;
  }

  return {
    log, progress,
    debug: (s, m, d) => log('debug', s, m, d), info: (s, m, d) => log('info', s, m, d), warn: (s, m, d) => log('warn', s, m, d), error: (s, m, d) => log('error', s, m, d),
    recent: (n = 1000) => ring.slice(-n),
    tasks: () => [...tasks.values()],
    clear: () => { ring.length = 0; for (const [k, v] of tasks) if (v.state !== 'running') tasks.delete(k); return true; },
    file: () => fileFor(), dir
  };
}

module.exports = { createLogger, clean, redactString };
