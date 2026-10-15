import React, { useEffect, useMemo, useRef, useState } from 'react';
import Select from './Select.jsx';
import { Icon } from './Icons.jsx';

const LEVELS = ['all', 'info', 'warn', 'error'];
const rank = { debug: 0, info: 1, warn: 2, error: 3 };
const time = (t) => new Date(t).toLocaleTimeString([], { hour12: false });
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };

/** Everything the app does, live: running jobs with progress, and the full log (also written to a file). */
export default function LogsView() {
  const api = window.api;
  const [entries, setEntries] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [file, setFile] = useState('');
  const [level, setLevel] = useState('all');
  const [source, setSource] = useState('all');
  const [debug, setDebug] = useState(false);
  const [q, setQ] = useState('');
  const [follow, setFollow] = useState(true);
  const [open, setOpen] = useState({});
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    api.logsGet(1500).then((r) => { if (alive && r) { setEntries(r.entries || []); setTasks(r.tasks || []); setFile(r.file || ''); } }).catch(() => {});
    const o1 = api.onLogEntry((e) => setEntries((l) => [...l.slice(-1499), e]));
    const o2 = api.onLogProgress((t) => setTasks(t));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; o1 && o1(); o2 && o2(); clearInterval(tick); };
  }, []);

  const sources = useMemo(() => ['all', ...[...new Set(entries.map((e) => e.source))].sort()], [entries]);
  const shown = useMemo(() => entries.filter((e) => (debug || e.level !== 'debug')
    && (level === 'all' || rank[e.level] >= rank[level])
    && (source === 'all' || e.source === source)
    && (!q || (e.message + ' ' + e.source + ' ' + (e.data ? JSON.stringify(e.data) : '')).toLowerCase().includes(q.toLowerCase()))), [entries, level, source, debug, q]);

  useEffect(() => { if (follow && box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown, follow]);
  const onScroll = () => { const el = box.current; if (el) setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40); };

  const text = () => shown.map((e) => `${new Date(e.t).toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}${e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''}`).join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(text()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} };
  const clear = async () => { await api.logsClear(); setEntries([]); setTasks((t) => t.filter((x) => x.state === 'running')); };
  const running = tasks.filter((t) => t.state === 'running');
  const recent = tasks.filter((t) => t.state !== 'running').sort((a, b) => b.updated - a.updated).slice(0, 4);

  return (
    <div className="logs">
      <div className="logs-bar">
        <div className="seg">{LEVELS.map((l) => <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l === 'all' ? 'All' : l[0].toUpperCase() + l.slice(1)}</button>)}</div>
        <Select value={source} onChange={(e) => setSource(e.target.value)} title="Source">{sources.map((s) => <option key={s} value={s}>{s === 'all' ? 'All sources' : s}</option>)}</Select>
        <input className="logs-search" placeholder="Search logs…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check inline"><input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> <span>Debug</span></label>
        <span style={{ flex: 1 }} />
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button onClick={() => api.logsReveal()} title={file}>Open log file</button>
        <button onClick={clear}>Clear</button>
      </div>

      {(running.length > 0 || recent.length > 0) && (
        <div className="logs-tasks">
          {running.map((t) => (
            <div key={t.id} className="task running">
              <div className="task-head"><Icon name="spinner" size={13} /><b>{t.label}</b><span className="muted">{dur(now - t.since)}</span></div>
              <div className={`task-bar ${t.pct == null || t.pct >= 100 ? 'indet' : ''}`}><i style={{ width: `${t.pct == null ? 40 : t.pct}%` }} /></div>
              <div className="muted small">{t.pct != null ? `${t.pct}% · ` : ''}{t.detail}</div>
            </div>
          ))}
          {recent.map((t) => (
            <div key={t.id} className={`task ${t.state}`}>
              <div className="task-head"><Icon name={t.state === 'done' ? 'check' : 'warning'} size={13} /><b>{t.label}</b><span className="muted">{t.state === 'done' ? 'done' : 'failed'}</span></div>
              {t.detail && <div className="muted small">{t.detail}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="logs-list" ref={box} onScroll={onScroll}>
        {shown.length === 0 && <div className="muted" style={{ padding: 20 }}>Nothing here yet. Messages, tool calls, voice, downloads and errors show up as they happen.</div>}
        {shown.map((e) => (
          <div key={e.id} className={`log-row r-${e.level}`} onClick={() => e.data !== undefined && setOpen((o) => ({ ...o, [e.id]: !o[e.id] }))}>
            <span className="log-t">{time(e.t)}</span>
            <span className={`log-lv lv-${e.level}`}>{e.level}</span>
            <span className="log-src">{e.source}</span>
            <span className="log-msg">{e.message}{e.data !== undefined && <i className="muted"> {open[e.id] ? '▾' : '▸'}</i>}</span>
            {open[e.id] && <pre className="log-data">{JSON.stringify(e.data, null, 2)}</pre>}
          </div>
        ))}
      </div>
      <div className="logs-foot muted small">{shown.length} of {entries.length} entries · saved to {file || '~/.artemis/logs'} (kept 14 days, keys and tokens are masked){!follow && <> · <button className="link" onClick={() => setFollow(true)}>Jump to latest</button></>}</div>
    </div>
  );
}
