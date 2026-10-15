import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import { registerNoteFlush } from '../lib/noteRegistry.js';

const api = window.api;
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const titleOf = (p) => p.split('/').pop().replace(/\.md$/i, '');
const wiki = (t) => t.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_m, n, label) => `[${label || n}](#note:${encodeURIComponent(n.trim())})`);

/** One open note: a Markdown editor with a live preview. It saves by itself while you type. */
// The view mode is remembered per note (and across restarts), so switching tabs and coming back keeps it.
const MODE_KEY = 'artemis.noteModes';
const modeMemo = new Map();
function getMode(path) {
  if (modeMemo.has(path)) return modeMemo.get(path);
  try { const m = JSON.parse(localStorage.getItem(MODE_KEY) || '{}')[path]; if (m) return m; } catch {}
  return null;
}
function saveMode(path, m) {
  modeMemo.set(path, m);
  try { const all = JSON.parse(localStorage.getItem(MODE_KEY) || '{}'); all[path] = m; localStorage.setItem(MODE_KEY, JSON.stringify(all)); } catch {}
}

export default function NoteEditor({ path, items, narrow, onOpenNote, onCreateNote }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mode, setModeState] = useState(() => getMode(path) || (narrow ? 'edit' : 'split')); // edit | split | preview
  const setMode = (m) => { setModeState(m); saveMode(path, m); };
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const cur = useRef({ path, text, dirty });
  cur.current = { path, text, dirty };

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const { path: p, text: t, dirty: d } = cur.current;
    if (p && d) {
      const r = await api.notesWrite(p, t);
      if (r && !r.ok) setErr(r.error || 'Could not save the note.'); else { setDirty(false); cur.current.dirty = false; }
    }
  }, []);

  useEffect(() => {
    let off = false;
    api.notesRead(path).then((r) => {
      if (off) return;
      if (!r || !r.ok) { setErr((r && r.error) || 'Could not open the note.'); setText(''); } else { setErr(''); setText(r.text); }
      setLoaded(true);
    });
    return () => { off = true; };
  }, [path]);
  useEffect(() => registerNoteFlush(flush), [flush]);
  useEffect(() => () => { flush(); }, [flush]);
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); flush(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [flush]);

  const onEdit = (v) => {
    setText(v); setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 700);
  };
  const onKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.target, s = t.selectionStart, en = t.selectionEnd;
      onEdit(text.slice(0, s) + '  ' + text.slice(en));
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
    }
  };

  const gotoWiki = (name) => {
    const n = decodeURIComponent(name).toLowerCase();
    const hit = (items || []).find((i) => !i.dir && (i.name.toLowerCase() === n || i.path.toLowerCase().replace(/\.md$/, '') === n));
    if (hit) onOpenNote(hit.path); else onCreateNote(decodeURIComponent(name), parentOf(path));
  };
  const onPreviewClick = (e) => {
    const a = e.target.closest && e.target.closest('a'); const href = a && a.getAttribute('href');
    if (href && href.startsWith('#note:')) { e.preventDefault(); e.stopPropagation(); gotoWiki(href.slice(6)); }
  };

  const words = useMemo(() => (text.trim() ? text.trim().split(/\s+/).length : 0), [text]);
  return (
    <section className="notes-main note-editor">
      {err && <div className="notes-err" onClick={() => setErr('')}>{err}</div>}
      <div className="notes-bar">
        <b className="notes-title">{titleOf(path)}</b>
        <span className="muted small">{dirty ? 'Saving…' : 'Saved'} · {words} words</span>
        <span style={{ flex: 1 }} />
        <div className="notes-modes">
          {['edit', 'split', 'preview'].map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
      </div>
      <div className={'notes-panes mode-' + mode}>
        {mode !== 'preview' && <textarea className="notes-editor" value={loaded ? text : ''} disabled={!loaded} onChange={(e) => onEdit(e.target.value)} onKeyDown={onKeyDown} spellCheck placeholder="Write in Markdown. Link notes with [[Note name]]." />}
        {mode !== 'edit' && <div className="notes-preview" onClickCapture={onPreviewClick}><Markdown text={wiki(text)} /></div>}
      </div>
    </section>
  );
}
