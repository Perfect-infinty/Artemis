import React, { useEffect, useState } from 'react';
import { memoryReport } from '../lib/memory.js';

const fmtKb = (kb) => (kb >= 1048576 ? (kb / 1048576).toFixed(2) + ' GB' : Math.round(kb / 1024) + ' MB');
const fmtB = (b) => fmtKb(b / 1024);

/**
 * Current memory use per Electron process (main, this window's renderer, the Sentinel widget, browser tabs, GPU, utility),
 * with "Free memory" (shrinks old screenshots in chats, clears the browser caches) and "Reload window".
 * The numbers are logged too (Logs page, source "memory").
 */
export default function MemoryPanel({ compact = false }) {
  const [snap, setSnap] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const refresh = async (doLog = false) => {
    try { setSnap(await memoryReport({ log: doLog, reason: 'on demand', chats: window.__artemisChats ? window.__artemisChats() : null })); } catch (e) { setNote('Could not read memory use: ' + ((e && e.message) || e)); }
  };
  useEffect(() => { refresh(true); const t = setInterval(() => refresh(false), 5000); return () => clearInterval(t); }, []);
  const free = async () => {
    setBusy('free'); setNote('');
    try {
      const shrunk = await new Promise((resolve) => { const d = { done: resolve }; window.dispatchEvent(new CustomEvent('artemis:free-memory', { detail: d })); setTimeout(() => resolve(-1), 15000); });
      const done = window.api.memoryFree ? await window.api.memoryFree() : [];
      setNote([shrunk > 0 ? `${shrunk} old screenshot${shrunk === 1 ? '' : 's'} made smaller` : 'No large screenshots to shrink', ...done].join(' · '));
      setTimeout(() => refresh(true), 1500);
    } finally { setBusy(''); }
  };
  const reload = () => {
    setBusy('reload');
    window.dispatchEvent(new CustomEvent('artemis:save-now'));
    setTimeout(() => location.reload(), 600);
  };
  const wp = (snap && snap.windowProc) || {};
  const img = snap && snap.images;
  return (
    <div className={`mem-panel ${compact ? 'compact' : ''}`}>
      {!snap ? <div className="muted">Reading memory use…</div> : (
        <table className="mem-table">
          <tbody>
            {snap.groups.map((g) => (
              <tr key={g.key}><td>{g.label}{g.count > 1 ? ` (${g.count})` : ''}</td><td className="num">{fmtKb(g.kb)}</td></tr>
            ))}
            <tr className="mem-total"><td>Total</td><td className="num">{fmtKb(snap.totalKb)}</td></tr>
            {snap.heap && snap.heap.used ? <tr className="muted"><td>Window JS heap (page only)</td><td className="num">{fmtB(snap.heap.used)}</td></tr> : null}
            {wp.blinkKb ? <tr className="muted"><td>Window DOM and images (Blink)</td><td className="num">{fmtKb(wp.blinkKb)}</td></tr> : null}
            {img ? <tr className="muted"><td>Images in chats ({img.attachN} attachments, {img.shotsN} screenshots)</td><td className="num">{fmtB(img.attach + img.shots)}</td></tr> : null}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={() => refresh(true)} disabled={!!busy}>Refresh</button>
        <button onClick={free} disabled={!!busy}>{busy === 'free' ? 'Freeing…' : 'Free memory'}</button>
        <button onClick={reload} disabled={!!busy} title="Saves your chats, then reloads this window (the renderer starts fresh)">Reload window</button>
      </div>
      {note && <div className="muted" style={{ marginTop: 6 }}>{note}</div>}
      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Memory is logged every 5 minutes (Logs, source "memory"). The window's process also holds the Sentinel speech engine (a background worker), which is not part of the JS heap.</div>
    </div>
  );
}
