import React, { useEffect, useState } from 'react';

/** Is this provider the Claude subscription (the Claude API preset pointed at a local proxy such as claude-max-api-proxy)? */
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i;
// the Claude subscription: a local server (claude-max-api-proxy listens on port 3456) named after Claude, or running on that port
export const isClaudeProxy = (p) => LOCAL.test(p.baseUrl || '') && (/claude|anthropic/i.test(p.name || '') || /:3456(\/|$)/.test(p.baseUrl || ''));

export const untilText = (iso) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!(ms > 0)) return 'resets now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `resets in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `resets in ${h} h ${m % 60} min`;
  return 'resets ' + new Date(iso).toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

/** How much of the Claude subscription is used (5-hour session and weekly limits), read from Claude Code's saved login. */
export function ClaudeUsage({ compact = false }) {
  const [u, setU] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async (force) => { setBusy(true); try { setU(await window.api.claudeUsage({ force })); } catch (e) { setU({ ok: false, error: String((e && e.message) || e) }); } setBusy(false); };
  useEffect(() => { load(false); }, []);
  return (
    <div className="claude-usage">
      <div className="cu-head"><b>Claude subscription usage</b>{u && u.ok && u.plan ? <span className="muted small">{u.plan}</span> : null}<span style={{ flex: 1 }} /><button onClick={() => load(true)} disabled={busy}>{busy ? 'Checking…' : 'Refresh'}</button></div>
      {u && u.ok && u.rows.map((r) => (
        <div key={r.key} className="cu-row">
          <div className="cu-top"><span>{r.label}</span><span className="muted small">{r.percent}% used{r.resetsAt ? ' · ' + untilText(r.resetsAt) : ''}</span></div>
          <div className="cu-bar"><i className={r.percent >= 90 ? 'hot' : r.percent >= 70 ? 'warm' : ''} style={{ width: r.percent + '%' }} /></div>
        </div>
      ))}
      {u && u.ok && u.extra && u.extra.percent !== null ? <small className="hint">Extra usage: {u.extra.percent}% of the monthly limit{u.extra.used !== null ? ` (${u.extra.used} of ${u.extra.limit})` : ''}.</small> : null}
      {u && !u.ok && <small className="hint" style={{ color: 'var(--danger, #d9534f)' }}>{u.error}</small>}
      {!u && <small className="hint">Checking…</small>}
      {!compact && <small className="hint">Read-only: Artemis uses the login that Claude Code saved on this Mac. macOS may ask once to allow access to “Claude Code-credentials”; choose Always Allow.</small>}
    </div>
  );
}


/** Shows the Claude subscription usage when the chosen model comes from the Claude provider (pass no model to show it whenever such a provider exists). */
export function ClaudeUsageFor({ model, compact = true }) {
  const [list, setList] = useState(null);
  useEffect(() => { window.api.providersList().then((r) => setList(Array.isArray(r) ? r : (r && r.providers) || [])).catch(() => setList([])); }, []);
  if (!list) return null;
  const ids = list.filter(isClaudeProxy).map((p) => p.id);
  if (model) {
    const m = /^prov:([^:]+):(.*)$/.exec(model);
    if (!m) return null;
    const local = list.find((p) => p.id === m[1] && LOCAL.test(p.baseUrl || ''));
    // a Claude model on a local server counts too, whatever the provider is called
    if (!ids.includes(m[1]) && !(local && /claude|sonnet|opus|haiku/i.test(m[2]))) return null;
  } else if (!ids.length) return null;
  return <ClaudeUsage compact={compact} />;
}
