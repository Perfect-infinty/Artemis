import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NotePreview from './NotePreview.jsx';
import { WikiTextarea } from './WikiTextarea.jsx';
import { Icon } from './Icons.jsx';
import { registerNoteFlush } from '../lib/noteRegistry.js';
import { findOwner } from './FindBar.jsx';
import { isFindKey, findStepKey, countLabel } from '../lib/find.mjs';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');

const api = window.api;
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const titleOf = (p) => p.split('/').pop().replace(/\.md$/i, '');
const escHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const EMBED_RE = /!\[\[([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;
const IMG_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

// The view mode is remembered per note (and across restarts), so switching tabs and coming back keeps it.
const MODE_KEY = 'artemis.noteModes';
const LAYOUT_KEY = 'artemis.noteLayout'; // how split view lines up: side by side or stacked
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
function getLayout(narrow) {
  try { const v = localStorage.getItem(LAYOUT_KEY); if (v === 'side' || v === 'stack') return v; } catch {}
  return narrow ? 'stack' : 'side';
}
const toBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });

function FindBar({ q, onQ, r, onR, count, idx, onNext, onPrev, onReplace, onReplaceAll, onClose, inputRef }) {
  const keys = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) onPrev(); else onNext(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onNext(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onPrev(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  };
  return (
    <div className="ne-find">
      <input ref={inputRef} autoFocus placeholder="Find" value={q} onChange={(e) => onQ(e.target.value)} onKeyDown={keys} />
      <span className={'ne-find-count' + (q && !count ? ' none' : '')} aria-live="polite">{countLabel(idx, count, q)}</span>
      <button title="Previous (⇧↵)" aria-label="Previous (⇧↵)" disabled={!count} onClick={onPrev}><Icon name="arrowUp" size={13} /></button>
      <button title="Next (↵)" aria-label="Next (↵)" disabled={!count} onClick={onNext}><Icon name="arrowUp" size={13} style={{ transform: 'rotate(180deg)' }} /></button>
      <input placeholder="Replace" value={r} onChange={(e) => onR(e.target.value)} onKeyDown={keys} />
      <button disabled={!count} onClick={onReplace}>Replace</button>
      <button disabled={!count} onClick={onReplaceAll}>Replace all</button>
      <button title="Close (Esc)" aria-label="Close (Esc)" onClick={onClose}><Icon name="x" size={13} /></button>
    </div>
  );
}

/** One open note: a Markdown editor with a live preview. It saves by itself while you type. */
export default function NoteEditor({ path, items, narrow, onOpenNote, onCreateNote, onRename, onDelete }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [mode, setModeState] = useState(() => getMode(path) || (narrow ? 'edit' : 'split')); // edit | split | preview
  const setMode = (m) => { setModeState(m); saveMode(path, m); };
  const [layout, setLayoutState] = useState(() => getLayout(narrow)); // side | stack
  const setLayout = (l) => { setLayoutState(l); try { localStorage.setItem(LAYOUT_KEY, l); } catch {} };
  const [title, setTitle] = useState(titleOf(path));
  const [err, setErr] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [replQ, setReplQ] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [embeds, setEmbeds] = useState(() => new Map());
  const [backlinks, setBacklinks] = useState([]);
  const [blOpen, setBlOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const timer = useRef(null);
  const prevRef = useRef(null), syncLock = useRef(0), rootRef = useRef(null), taRef = useRef(null), hlRef = useRef(null), findRef = useRef(null);
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
  useEffect(() => setTitle(titleOf(path)), [path]);
  useEffect(() => registerNoteFlush(flush), [flush]);
  useEffect(() => () => { flush(); }, [flush]);
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); flush(); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [flush]);

  const titles = useMemo(() => (items || []).filter((i) => !i.dir).map((i) => i.name), [items]);

  const onEdit = (v) => {
    cur.current.text = v;
    setText(v); setDirty(true); cur.current.dirty = true;
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

  // ---- rename from the title field ----
  const commitTitle = async () => {
    const name = title.trim();
    if (!name || name === titleOf(path)) { setTitle(titleOf(path)); return; }
    const dir = parentOf(path);
    saveMode((dir ? dir + '/' : '') + name.replace(/\.md$/i, '') + '.md', mode); // the renamed note keeps its view mode
    if (onRename) await onRename(path, name);
    setTitle(titleOf(path));
  };

  // ---- [[links]]: open the note, or create it when it doesn't exist yet ----
  const gotoWiki = (name, how) => {
    const n = name.toLowerCase().replace(/\.md$/, '');
    const hit = (items || []).find((i) => !i.dir && (i.name.toLowerCase() === n || i.path.toLowerCase().replace(/\.md$/, '') === n));
    if (hit) onOpenNote(hit.path, how); else onCreateNote(name, parentOf(path));
  };

  // ---- ![[embeds]]: load the notes they point to ----
  useEffect(() => {
    if (mode === 'edit') return undefined;
    let off = false;
    const t = setTimeout(async () => {
      const names = new Set(); let m;
      EMBED_RE.lastIndex = 0;
      while ((m = EMBED_RE.exec(text))) { const n = m[1].trim(); if (n && !IMG_EXT.test(n)) names.add(n); }
      const map = new Map();
      for (const n of names) {
        const hit = (items || []).find((i) => !i.dir && i.name.toLowerCase() === n.toLowerCase());
        if (!hit) continue;
        const r = await api.notesRead(hit.path);
        if (r && r.ok) map.set(n.toLowerCase(), r.text);
      }
      if (!off) setEmbeds(map);
    }, 300);
    return () => { off = true; clearTimeout(t); };
  }, [text, mode, items]);

  // ---- backlinks ----
  const loadBacklinks = useCallback(async () => {
    const r = await api.notesGraph();
    if (!r || !r.ok) return;
    const name = new Map(r.nodes.map((n) => [n.id, n]));
    setBacklinks(r.edges.filter((e) => e.to === path).map((e) => name.get(e.from)).filter(Boolean));
  }, [path]);
  useEffect(() => { loadBacklinks(); }, [loadBacklinks, items]);

  // ---- find & replace ----
  const matches = useMemo(() => {
    const q = findQ;
    if (!q) return [];
    const low = text.toLowerCase(), lq = q.toLowerCase(), out = [];
    let from = 0, i;
    while ((i = low.indexOf(lq, from)) !== -1) { out.push({ start: i, end: i + q.length }); from = i + q.length; }
    return out;
  }, [text, findQ]);
  const active = matches.length ? ((matchIdx % matches.length) + matches.length) % matches.length : 0;
  const highlightHtml = useMemo(() => {
    if (!findOpen || !matches.length) return null;
    let out = '', last = 0;
    matches.forEach((m, i) => {
      out += escHtml(text.slice(last, m.start)) + `<mark${i === active ? ' class="on"' : ''}>${escHtml(text.slice(m.start, m.end))}</mark>`;
      last = m.end;
    });
    return out + escHtml(text.slice(last)) + '\n';
  }, [findOpen, matches, active, text]);
  // split view: scrolling one pane moves the other by the same fraction
  const mirror = (from, to) => {
    if (mode !== 'split' || !from || !to) return;
    const fm = from.scrollHeight - from.clientHeight, tm = to.scrollHeight - to.clientHeight;
    if (fm <= 0 || tm <= 0) return;
    const target = Math.round((from.scrollTop / fm) * tm);
    if (Math.abs(to.scrollTop - target) < 2) return;
    from.__driven = false; to.__driven = true; syncLock.current = Date.now() + 60;
    to.scrollTop = target;
  };
  const onEditScroll = () => { const t = taRef.current; if (t && t.__driven) { t.__driven = false; return; } mirror(t, prevRef.current); };
  const onPrevScroll = () => { const v = prevRef.current; if (v && v.__driven) { v.__driven = false; return; } mirror(v, taRef.current); };
  const syncHl = () => { const t = taRef.current, h = hlRef.current; if (t && h) { h.scrollTop = t.scrollTop; h.scrollLeft = t.scrollLeft; } };
  useEffect(() => {
    const t = taRef.current;
    if (!findOpen || !matches.length || !t) return;
    const m = matches[active];
    try { t.setSelectionRange(m.start, m.end); } catch {}
    const mark = hlRef.current && hlRef.current.querySelector('mark.on');
    if (mark) t.scrollTop = Math.max(0, mark.offsetTop - t.clientHeight / 2);
    syncHl();
  }, [findOpen, matches, active]);
  // ⌘F opens find (or selects its text) when this note is the active pane (see findOwner); ⌘G / ⇧⌘G step through the matches
  const stepRef = useRef(null);
  useEffect(() => {
    const k = (e) => {
      if (e.defaultPrevented) return;
      const r = rootRef.current;
      if (!r) return;
      const d = findOpen ? findStepKey(e, IS_MAC) : 0;
      if (d) {
        if (findOwner() !== r && !(findRef.current && document.activeElement === findRef.current)) return;
        e.preventDefault(); if (stepRef.current) stepRef.current(d);
        return;
      }
      if (!isFindKey(e, IS_MAC) || findOwner() !== r) return;
      e.preventDefault();
      const t = taRef.current;
      if (t && document.activeElement === t && t.selectionStart !== t.selectionEnd && t.selectionEnd - t.selectionStart < 80) setFindQ(text.slice(t.selectionStart, t.selectionEnd));
      setFindOpen(true);
      requestAnimationFrame(() => findRef.current && findRef.current.select());
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [text, findOpen]);
  const closeFind = () => { setFindOpen(false); setFindQ(''); setReplQ(''); setMatchIdx(0); if (taRef.current) taRef.current.focus({ preventScroll: true }); };
  const step = (d) => setMatchIdx(active + d);
  stepRef.current = step;
  const replaceOne = () => { if (!matches.length) return; const m = matches[active]; onEdit(text.slice(0, m.start) + replQ + text.slice(m.end)); };
  const replaceAll = () => { if (!matches.length) return; let out = '', last = 0; for (const m of matches) { out += text.slice(last, m.start) + replQ; last = m.end; } onEdit(out + text.slice(last)); };

  // ---- drop / paste files: saved next to the note and linked ----
  const insertAt = (snippet) => {
    const el = taRef.current;
    const s = el ? el.selectionStart : text.length, e = el ? el.selectionEnd : s;
    const next = text.slice(0, s) + snippet + text.slice(e);
    onEdit(next);
    requestAnimationFrame(() => { if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(s + snippet.length, s + snippet.length); } });
  };
  const saveFiles = async (files) => {
    const out = [];
    for (const f of files) {
      try {
        const r = await api.notesSaveAsset(path, f.name || 'file', await toBase64(f));
        if (!r || !r.ok) { setErr((r && r.error) || 'Could not save the file.'); continue; }
        out.push(IMG_EXT.test(r.name) ? `![${r.name}](${r.name})` : `[${r.name}](${r.name})`);
      } catch { setErr('Could not read the file.'); }
    }
    if (out.length) insertAt(out.join('\n\n'));
  };
  const onDrop = (e) => {
    setDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    e.preventDefault();
    if (mode === 'preview') setMode('split');
    saveFiles(files);
  };
  const onPaste = (e) => {
    const its = Array.from(e.clipboardData ? e.clipboardData.items : []);
    if (its.some((i) => i.kind === 'string' && (i.type === 'text/plain' || i.type === 'text/html'))) return;
    const imgs = its.filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
    if (!imgs.length) return;
    e.preventDefault();
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    saveFiles(imgs.map((b, n) => new File([b], `pasted-image-${stamp}${n ? '-' + n : ''}.${(b.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*$/, '')}`, { type: b.type })));
  };

  const words = useMemo(() => (text.trim() ? text.trim().split(/\s+/).length : 0), [text]);
  const crumbs = parentOf(path);
  const find = findOpen && findQ ? { q: findQ, active } : null;
  const showEdit = mode !== 'preview', showPrev = mode !== 'edit';

  return (
    <section className="notes-main note-editor" ref={rootRef} data-find-scope="note">
      {err && <div className="notes-err" onClick={() => setErr('')}>{err}</div>}
      <div className="notes-bar">
        {crumbs && <span className="ne-crumbs muted small" title={crumbs}>{crumbs.split('/').join(' / ')} /</span>}
        <input className="ne-title" value={title} spellCheck={false} title="Click to rename" onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setTitle(titleOf(path)); e.currentTarget.blur(); } }} />
        <span className="muted small ne-meta">{dirty ? 'Saving…' : 'Saved'} · {words} words</span>
        <span style={{ flex: 1 }} />
        <button title="Find & replace (⌘F)" aria-label="Find & replace (⌘F)" className={findOpen ? 'on' : ''} onClick={() => { setFindOpen((o) => !o); requestAnimationFrame(() => findRef.current && findRef.current.select()); }}><Icon name="search" size={14} /></button>
        <button title="Notes that link here" aria-label="Notes that link here" className={blOpen ? 'on' : ''} onClick={() => setBlOpen((o) => !o)}><Icon name="link" size={14} />{backlinks.length || ''}</button>
        {mode === 'split' && (
          <div className="notes-modes" title="Split layout">
            <button className={layout === 'side' ? 'on' : ''} title="Side by side" aria-label="Side by side" onClick={() => setLayout('side')}><Icon name="columns" size={14} /></button>
            <button className={layout === 'stack' ? 'on' : ''} title="Editor above, preview below" aria-label="Editor above, preview below" onClick={() => setLayout('stack')}><Icon name="rows" size={14} /></button>
          </div>
        )}
        <div className="notes-modes">
          {['edit', 'split', 'preview'].map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
        </div>
        {onDelete && <button title="Delete note" aria-label="Delete note" onClick={() => onDelete(path)}><Icon name="trash" size={14} /></button>}
      </div>
      {findOpen && <FindBar q={findQ} onQ={(v) => { setFindQ(v); setMatchIdx(0); }} r={replQ} onR={setReplQ} count={matches.length} idx={active} onNext={() => step(1)} onPrev={() => step(-1)} onReplace={replaceOne} onReplaceAll={replaceAll} onClose={closeFind} inputRef={findRef} />}
      <div className={'notes-panes mode-' + mode + ' ' + layout + (dragging ? ' dragging' : '')}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        {showEdit && (
          <div className="ne-pane">
            {highlightHtml != null && <div className="ne-hl" ref={hlRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightHtml }} />}
            <WikiTextarea ref={taRef} className="notes-editor" value={loaded ? text : ''} disabled={!loaded} onValue={onEdit} titles={titles} onKeyDown={onKeyDown} onPaste={onPaste} onScroll={() => { syncHl(); onEditScroll(); }} spellCheck
              placeholder="Write in Markdown. Link notes with [[Note name]]. Drop or paste images to add them." />
          </div>
        )}
        {showPrev && (
          <div className="ne-pane ne-prev" ref={prevRef} onScroll={onPrevScroll}>
            <NotePreview text={text} notePath={path} embeds={embeds} titles={titles} editable={loaded} onEdit={onEdit} onOpenWiki={gotoWiki} find={find} />
          </div>
        )}
      </div>
      {blOpen && (
        <div className="ne-backlinks">
          <b>Linked from</b>
          {backlinks.length ? backlinks.map((b) => <button key={b.id} onClick={(e) => onOpenNote(b.path, e.metaKey || e.ctrlKey ? 'tab' : 'here')}><Icon name="file" size={13} /> {b.name}</button>) : <span className="muted small">No other note links here yet.</span>}
        </div>
      )}
    </section>
  );
}
