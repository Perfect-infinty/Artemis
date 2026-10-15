import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

/** Cmd/Ctrl+K: jump to a chat or a note, or run an action. actions: [{id,label,icon,hint?,group?,swatch?,words?,run}] */
export default function CommandPalette({ open, onClose, chats = [], actions = [], onOpenChat, onOpenNote }) {
  const [q, setQ] = useState('');
  const [notes, setNotes] = useState([]);
  const [hits, setHits] = useState([]);
  const [idx, setIdx] = useState(0);
  const input = useRef(null);
  const list = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQ(''); setIdx(0); setHits([]);
    window.api.notesList().then((r) => setNotes(r && r.ok ? r.items.filter((i) => !i.dir) : [])).catch(() => {});
    requestAnimationFrame(() => input.current && input.current.focus());
  }, [open]);

  // full-text matches inside notes (title matches are instant, text matches come from the main process)
  useEffect(() => {
    if (!open || q.trim().length < 3) { setHits([]); return; }
    const t = setTimeout(async () => { const r = await window.api.notesSearch(q); setHits(r && r.ok ? r.results.slice(0, 6) : []); }, 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const terms = s.split(/\s+/).filter(Boolean);
    const match = (...parts) => { const t = parts.filter(Boolean).join(' ').toLowerCase(); return terms.every((w) => t.includes(w)); };
    const A = actions.filter((a) => (s ? match(a.label, a.group, a.words) : !a.onlyTyped)).map((a) => ({ key: 'a' + a.id, section: a.group || 'Actions', icon: a.icon, label: a.label, hint: a.hint, swatch: a.swatch, current: a.current, run: a.run }));
    const C = chats.filter((c) => !c.incognito && (!s || match(c.title))).slice(0, s ? 8 : 5).map((c) => ({ key: 'c' + c.id, section: 'Chats', icon: 'chat', label: c.title || 'New chat', run: () => onOpenChat(c.id) }));
    const seen = new Set();
    const N = [];
    for (const n of notes) if (!s || match(n.name)) { seen.add(n.path); N.push(n); }
    const Nres = N.slice(0, s ? 8 : 4).map((n) => ({ key: 'n' + n.path, section: 'Notes', icon: 'file', label: n.name, hint: n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '', run: () => onOpenNote(n.path) }));
    const H = hits.filter((h) => !seen.has(h.path)).map((h) => ({ key: 'h' + h.path, section: 'Inside notes', icon: 'search', label: h.name, hint: h.snippet, run: () => onOpenNote(h.path) }));
    // typing: actions first (they are the point of the palette), then chats and notes. empty: recent chats first.
    const all = s ? [...A, ...C, ...Nres, ...H] : [...C, ...Nres, ...A];
    const order = []; const by = new Map();
    for (const r of all) { if (!by.has(r.section)) { by.set(r.section, []); order.push(r.section); } by.get(r.section).push(r); }
    return order.flatMap((sec) => by.get(sec));
  }, [q, actions, chats, notes, hits, onOpenChat, onOpenNote]);

  useEffect(() => { setIdx(0); }, [q]);
  useEffect(() => { const el = list.current && list.current.querySelector('[data-i="' + idx + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }, [idx, results]);

  if (!open) return null;
  const go = (r) => { if (!r) return; onClose(); setTimeout(() => r.run(), 0); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (results.length ? (i + 1) % results.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (results.length ? (i - 1 + results.length) % results.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[idx]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  let lastSec = '';
  return (
    <div className="cmdk-back" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-bar">
          <Icon name="search" size={16} />
          <input ref={input} className="cmdk-input" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="Search chats, notes, settings, themes…" spellCheck={false} />
          <kbd className="cmdk-esc">esc</kbd>
        </div>
        <div className="cmdk-list" ref={list}>
          {results.length === 0 ? <div className="cmdk-empty">No matches for “{q}”</div> : results.map((r, i) => {
            const head = r.section !== lastSec ? <div key={'h-' + r.section} className="cmdk-head">{r.section}</div> : null;
            lastSec = r.section;
            return (
              <React.Fragment key={r.key}>
                {head}
                <button type="button" data-i={i} className={'cmdk-item' + (i === idx ? ' on' : '')} onMouseMove={() => i !== idx && setIdx(i)} onClick={() => go(r)}>
                  <span className="cmdk-ic"><Icon name={r.icon || 'chat'} size={15} /></span>
                  <span className="cmdk-label">{r.label}</span>
                  {r.swatch ? <span className="cmdk-sw">{r.swatch.map((c, k) => <i key={k} style={{ background: c }} />)}</span> : null}
                  {r.current ? <span className="cmdk-cur"><Icon name="check" size={13} /></span> : null}
                  {r.hint ? (/^[⌘⇧⌥⌃`]/.test(r.hint) ? <kbd className="cmdk-kbd">{r.hint}</kbd> : <span className="cmdk-hint">{r.hint}</span>) : null}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
      </div>
    </div>
  );
}
