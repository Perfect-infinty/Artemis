// How much of the Claude subscription (Pro / Max) is used: the 5-hour session and the weekly limits, the same numbers Claude Code's /usage shows.
// It reads the login that Claude Code saved on this computer (macOS Keychain "Claude Code-credentials", or ~/.claude/.credentials.json),
// asks Anthropic for the usage and only reads: it never refreshes or rewrites the login, and the token never leaves this process or the log.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const URL_USAGE = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_MS = 60 * 1000;

function readKeychain() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') return resolve('');
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 15000 }, (err, out) => resolve(err ? '' : String(out || '').trim()));
  });
}

/** { accessToken, expiresAt, plan } from Claude Code's saved login, or null. */
async function readLogin({ readKeychainFn = readKeychain, home = os.homedir(), env = process.env } = {}) {
  const sources = [];
  const kc = await readKeychainFn();
  if (kc) sources.push(kc);
  try { sources.push(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), '.credentials.json'), 'utf8')); } catch {}
  for (const raw of sources) {
    try {
      const o = JSON.parse(raw).claudeAiOauth;
      if (o && o.accessToken) return { accessToken: o.accessToken, expiresAt: Number(o.expiresAt) || 0, plan: o.subscriptionType || '' };
    } catch {}
  }
  return null;
}

const pct = (n) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v * 10) / 10)) : null; };
const when = (t) => { if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d.toISOString(); };

/** The response has changed shape before: accept the structured "limits" list and the older flat keys. */
function parseUsage(j) {
  const rows = [];
  const add = (key, label, percent, resetsAt) => { const p = pct(percent); if (p !== null) rows.push({ key, label, percent: p, resetsAt: when(resetsAt) }); };
  if (j && Array.isArray(j.limits) && j.limits.length) {
    for (const l of j.limits) {
      const model = l && l.scope && l.scope.model && l.scope.model.display_name;
      if (l.kind === 'session') add('session', 'Session (5 hours)', l.percent, l.resets_at);
      else if (l.kind === 'weekly_all') add('weekly', 'Weekly (all models)', l.percent, l.resets_at);
      else if (l.kind === 'weekly_scoped') add('weekly:' + (model || ''), 'Weekly' + (model ? ' · ' + model : ''), l.percent, l.resets_at);
    }
  }
  if (!rows.length && j) {
    const flat = (k, key, label) => { const x = j[k]; if (x && typeof x === 'object') add(key, label, x.utilization, x.resets_at); };
    flat('five_hour', 'session', 'Session (5 hours)');
    flat('seven_day', 'weekly', 'Weekly (all models)');
    flat('seven_day_sonnet', 'weekly:sonnet', 'Weekly · Sonnet');
    flat('seven_day_opus', 'weekly:opus', 'Weekly · Opus');
  }
  const ex = j && j.extra_usage && j.extra_usage.is_enabled ? j.extra_usage : null;
  return { rows, extra: ex ? { percent: pct(ex.utilization), used: ex.used_credits ?? null, limit: ex.monthly_limit ?? null } : null };
}

function createClaudeUsage({ fetchFn = (...a) => fetch(...a), login = readLogin, now = () => Date.now() } = {}) {
  let cache = null;
  return async function get({ force = false } = {}) {
    if (!force && cache && now() - cache.at < CACHE_MS) return cache.value;
    const done = (value) => { cache = { at: now(), value }; return value; };
    let lg;
    try { lg = await login(); } catch { lg = null; }
    if (!lg) return { ok: false, kind: 'no-login', error: 'No Claude Code login found on this computer. Sign in once with the claude command.' };
    if (lg.expiresAt && lg.expiresAt < now()) return { ok: false, kind: 'expired', error: 'The Claude login has expired. Run claude once in a terminal (it refreshes the login), then press Refresh.' };
    try {
      const res = await fetchFn(URL_USAGE, { headers: { authorization: `Bearer ${lg.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json', 'user-agent': 'Artemis' }, signal: AbortSignal.timeout(15000) });
      if (res.status === 401 || res.status === 403) return { ok: false, kind: 'expired', error: 'Anthropic rejected the saved login. Run claude once in a terminal to refresh it, then press Refresh.' };
      if (res.status === 429) return cache ? cache.value : { ok: false, kind: 'busy', error: 'Anthropic is rate-limiting usage checks. Try again in a minute.' };
      if (!res.ok) return { ok: false, kind: 'http', error: `Usage check failed (HTTP ${res.status}).` };
      const parsed = parseUsage(await res.json());
      if (!parsed.rows.length) return { ok: false, kind: 'shape', error: 'Anthropic answered, but the usage format was not recognised.' };
      return done({ ok: true, plan: lg.plan || '', ...parsed, fetchedAt: new Date(now()).toISOString() });
    } catch (e) {
      return { ok: false, kind: 'network', error: 'Could not reach Anthropic: ' + ((e && e.message) || e) };
    }
  };
}

module.exports = { createClaudeUsage, parseUsage, readLogin };
