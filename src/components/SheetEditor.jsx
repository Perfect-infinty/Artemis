import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { askConfirm } from '../lib/dialog.js';
import { createEvaluator, formatValue, isErr, colName, cellName } from '../lib/formula.mjs';
import { parseCsv } from '../lib/preview.js';

const api = window.api;
const RH = 26, HH = 26, RNW = 46, DEF_W = 110, MIN_W = 36, EXTRA_ROWS = 30, EXTRA_COLS = 4;
const isFormula = (v) => typeof v === 'string' && v.length > 1 && v[0] === '=';
const coerce = (s) => {
  if (typeof s !== 'string') return s;
  const t = s.trim();
  if (t === '') return '';
  return /^-?(0|[1-9]\d*)(\.\d+)?(e[+-]?\d+)?$/i.test(t) ? Number(t) : s;
};
const rawText = (v) => (v == null ? '' : String(v));

function withCells(rows, changes) {
  const out = rows.slice(); const copied = new Set();
  for (const [r, c, v] of changes) {
    while (out.length <= r) out.push([]);
    if (!copied.has(r)) { out[r] = out[r].slice(); copied.add(r); }
    const row = out[r];
    while (row.length <= c) row.push('');
    row[c] = v;
  }
  return out;
}

export default function SheetEditor({ path, name, onDirty, onSaved }) {
  const [state, setState] = useState({ loading: true });
  const [sheets, setSheets] = useState([]);
  const [si, setSi] = useState(0);
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [rng, setRng] = useState({ r1: 0, c1: 0, r2: 0, c2: 0 });
  const [edit, setEdit] = useState(null); // {r,c,value,from}
  const [widths, setWidths] = useState({}); // `${si}:${c}` -> px
  const [scroll, setScroll] = useState({ top: 0, left: 0, w: 600, h: 400 });
  const [header, setHeader] = useState(true);
  const [q, setQ] = useState('');
  const [hit, setHit] = useState(0);
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const [curPath, setCurPath] = useState(path);
  const [rename, setRename] = useState(null);
  const undo = useRef([]); const redo = useRef([]);
  const box = useRef(null); const dragging = useRef(false); const meta = useRef({});

  // ---- loading
  useEffect(() => {
    let off = false;
    setState({ loading: true }); setDirty(false); setNote(''); setSi(0); setSel({ r: 0, c: 0 }); setRng({ r1: 0, c1: 0, r2: 0, c2: 0 }); setEdit(null); setWidths({});
    undo.current = []; redo.current = []; setCurPath(path);
    api.loadSheet(path).then((r) => {
      if (off) return;
      if (!r.ok) { setState({ error: r.error }); return; }
      meta.current = { delimiter: r.delimiter, truncated: r.truncated, format: r.format };
      setSheets(r.sheets.length ? r.sheets : [{ name: 'Sheet1', rows: [] }]);
      setState({ ok: true });
    });
    return () => { off = true; };
  }, [path]);
  useEffect(() => { onDirty && onDirty(dirty); }, [dirty]);

  const sheet = sheets[si] || { name: '', rows: [] };
  const rows = sheet.rows;
  const nCols = useMemo(() => Math.max(1, rows.reduce((m, r) => Math.max(m, r.length), 0)) + EXTRA_COLS, [rows]);
  const nRows = Math.max(rows.length + EXTRA_ROWS, 60);
  const ev = useMemo(() => createEvaluator(sheets), [sheets]);

  const wOf = useCallback((c) => widths[si + ':' + c] || DEF_W, [widths, si]);
  const offsets = useMemo(() => { const o = [0]; for (let c = 0; c < nCols; c++) o.push(o[c] + (widths[si + ':' + c] || DEF_W)); return o; }, [widths, si, nCols]);
  const totalW = offsets[nCols];

  const raw = (r, c) => { const row = rows[r]; return row ? row[c] : undefined; };
  const shown = (r, c) => {
    const v = raw(r, c);
    if (isFormula(v)) return formatValue(ev(si, r, c));
    return rawText(v);
  };

  // ---- changes / undo
  const apply = useCallback((nextSheets) => {
    undo.current.push(sheets); if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    setSheets(nextSheets); setDirty(true); setNote('');
  }, [sheets]);
  const mutate = useCallback((fn) => apply(sheets.map((s, i) => (i === si ? { ...s, rows: fn(s.rows) } : s))), [apply, sheets, si]);
  const doUndo = () => { const p = undo.current.pop(); if (!p) return; redo.current.push(sheets); setSheets(p); setDirty(true); };
  const doRedo = () => { const p = redo.current.pop(); if (!p) return; undo.current.push(sheets); setSheets(p); setDirty(true); };

  const setCells = (changes) => mutate((rs) => withCells(rs, changes));
  const norm = (rg) => ({ r1: Math.min(rg.r1, rg.r2), r2: Math.max(rg.r1, rg.r2), c1: Math.min(rg.c1, rg.c2), c2: Math.max(rg.c1, rg.c2) });
  const R = norm(rng);

  // ---- scrolling / visibility
  const ensure = (r, c) => {
    const el = box.current; if (!el) return;
    const top = r * RH, bottom = top + RH, left = offsets[c], right = offsets[c + 1];
    const vh = el.clientHeight - HH - (header ? RH : 0), vw = el.clientWidth - RNW;
    if (top < el.scrollTop + (header && r > 0 ? RH : 0)) el.scrollTop = Math.max(0, top - (header && r > 0 ? RH : 0));
    else if (bottom > el.scrollTop + vh) el.scrollTop = bottom - vh;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + vw) el.scrollLeft = right - vw;
  };
  const moveTo = (r, c, extend) => {
    r = Math.max(0, Math.min(nRows - 1, r)); c = Math.max(0, Math.min(nCols - 1, c));
    if (extend) setRng((g) => ({ ...g, r2: r, c2: c })); else { setSel({ r, c }); setRng({ r1: r, c1: c, r2: r, c2: c }); }
    ensure(r, c);
  };

  useEffect(() => {
    const el = box.current; if (!el) return undefined;
    const upd = () => setScroll({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
    upd();
    const ro = new ResizeObserver(upd); ro.observe(el);
    el.addEventListener('scroll', upd, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', upd); };
  }, [state.ok]);
  useEffect(() => { const up = () => { dragging.current = false; }; window.addEventListener('mouseup', up); return () => window.removeEventListener('mouseup', up); }, []);

  // ---- editing
  const startEdit = (r, c, value, from = 'cell') => setEdit({ r, c, value: value ?? rawText(raw(r, c)), from });
  const commit = (move) => {
    if (!edit) return;
    const { r, c, value } = edit;
    setEdit(null);
    const cur = raw(r, c);
    const next = coerce(value);
    if (!(next === cur || (cur === undefined && next === ''))) setCells([[r, c, next]]);
    if (move) moveTo(r + move[0], c + move[1]);
    box.current && box.current.focus({ preventScroll: true });
  };
  const cancel = () => { setEdit(null); box.current && box.current.focus({ preventScroll: true }); };

  // ---- row / column operations
  const insertRows = (at, n = 1) => mutate((rs) => { const o = rs.slice(); while (o.length < at) o.push([]); o.splice(at, 0, ...Array.from({ length: n }, () => [])); return o; });
  const deleteRows = () => mutate((rs) => rs.filter((_, i) => i < R.r1 || i > R.r2));
  const insertCols = (at) => mutate((rs) => rs.map((row) => { if (row.length <= at) return row; const o = row.slice(); o.splice(at, 0, ''); return o; }));
  const deleteCols = () => mutate((rs) => rs.map((row) => row.filter((_, j) => j < R.c1 || j > R.c2)));
  const clearRange = () => { const ch = []; for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) if (raw(r, c) !== undefined && raw(r, c) !== '') ch.push([r, c, '']); if (ch.length) setCells(ch); };
  const fillDown = () => { const ch = []; for (let c = R.c1; c <= R.c2; c++) { const v = raw(R.r1, c); for (let r = R.r1 + 1; r <= R.r2; r++) ch.push([r, c, v === undefined ? '' : v]); } if (ch.length) setCells(ch); };
  const sortBy = (dir) => {
    const c = sel.c; const start = header ? 1 : 0;
    mutate((rs) => {
      const head = rs.slice(0, start), body = rs.slice(start).map((row, i) => ({ row, i }));
      const cmp = (a, b) => {
        const x = a.row[c], y = b.row[c];
        const xe = x === undefined || x === '', ye = y === undefined || y === '';
        if (xe || ye) return xe && ye ? 0 : xe ? 1 : -1; // empty cells always last
        const xn = typeof x === 'number' || (x !== '' && !Number.isNaN(Number(x))), yn = typeof y === 'number' || (y !== '' && !Number.isNaN(Number(y)));
        const d = xn && yn ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
        return d * dir || a.i - b.i;
      };
      return head.concat(body.sort(cmp).map((o) => o.row));
    });
  };

  // ---- panoya
  const rangeText = (fmt) => { const lines = []; for (let r = R.r1; r <= R.r2; r++) { const cells = []; for (let c = R.c1; c <= R.c2; c++) cells.push(fmt(r, c)); lines.push(cells.join('\t')); } return lines.join('\n'); };
  const onCopy = (e) => { if (edit) return; e.preventDefault(); e.clipboardData.setData('text/plain', rangeText((r, c) => { const t = shown(r, c); return /[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; })); };
  const onCut = (e) => { onCopy(e); if (!edit) clearRange(); };
  const onPaste = (e) => {
    if (edit) return;
    const t = e.clipboardData.getData('text/plain'); if (!t) return;
    e.preventDefault();
    const grid = parseCsv(t.replace(/\r\n/g, '\n').replace(/\n$/, ''), '\t');
    const ch = [];
    grid.forEach((row, i) => row.forEach((v, j) => ch.push([R.r1 + i, R.c1 + j, coerce(v)])));
    if (ch.length) { setCells(ch); setRng({ r1: R.r1, c1: R.c1, r2: R.r1 + grid.length - 1, c2: R.c1 + Math.max(...grid.map((g) => g.length)) - 1 }); }
  };

  // ---- klavye
  const onKeyDown = (e) => {
    if (e.target.tagName === 'INPUT') return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); fillDown(); return; }
    if (mod && k.toLowerCase() === 'a') { e.preventDefault(); setRng({ r1: 0, c1: 0, r2: Math.max(rows.length - 1, 0), c2: nCols - 1 - EXTRA_COLS }); return; }
    if (mod) return; // leave c/x/v to the clipboard events
    const ext = e.shiftKey;
    if (k === 'ArrowDown') { e.preventDefault(); moveTo((ext ? R.r2 === rng.r2 ? rng.r2 : rng.r2 : sel.r) + 1, ext ? rng.c2 : sel.c, ext); }
    else if (k === 'ArrowUp') { e.preventDefault(); moveTo((ext ? rng.r2 : sel.r) - 1, ext ? rng.c2 : sel.c, ext); }
    else if (k === 'ArrowRight') { e.preventDefault(); moveTo(ext ? rng.r2 : sel.r, (ext ? rng.c2 : sel.c) + 1, ext); }
    else if (k === 'ArrowLeft') { e.preventDefault(); moveTo(ext ? rng.r2 : sel.r, (ext ? rng.c2 : sel.c) - 1, ext); }
    else if (k === 'Tab') { e.preventDefault(); moveTo(sel.r, sel.c + (ext ? -1 : 1)); }
    else if (k === 'Enter') { e.preventDefault(); if (ext) moveTo(sel.r - 1, sel.c); else startEdit(sel.r, sel.c); }
    else if (k === 'F2') { e.preventDefault(); startEdit(sel.r, sel.c); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearRange(); }
    else if (k === 'Home') { e.preventDefault(); moveTo(sel.r, 0, ext); }
    else if (k === 'PageDown') { e.preventDefault(); moveTo(sel.r + 15, sel.c); }
    else if (k === 'PageUp') { e.preventDefault(); moveTo(sel.r - 15, sel.c); }
    else if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(sel.r, sel.c, k); }
  };
  const onEditKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]); }
    else if (e.key === 'Tab') { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  // ---- fare
  const down = (r, c, e) => {
    if (edit && !(edit.r === r && edit.c === c)) commit(null);
    dragging.current = true;
    if (e.shiftKey) setRng((g) => ({ ...g, r2: r, c2: c })); else { setSel({ r, c }); setRng({ r1: r, c1: c, r2: r, c2: c }); }
    box.current && box.current.focus({ preventScroll: true });
  };
  const over = (r, c) => { if (dragging.current) setRng((g) => ({ ...g, r2: r, c2: c })); };
  const pickCol = (c) => { setSel({ r: 0, c }); setRng({ r1: 0, c1: c, r2: Math.max(rows.length - 1, 0), c2: c }); box.current && box.current.focus({ preventScroll: true }); };
  const pickRow = (r) => { setSel({ r, c: 0 }); setRng({ r1: r, c1: 0, r2: r, c2: Math.max(nCols - 1 - EXTRA_COLS, 0) }); box.current && box.current.focus({ preventScroll: true }); };
  const startResize = (c, e) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = wOf(c), key = si + ':' + c;
    const mv = (ev2) => setWidths((w) => ({ ...w, [key]: Math.max(MIN_W, Math.round(w0 + ev2.clientX - x0)) }));
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  const autofit = (c) => {
    let m = String(colName(c)).length;
    for (let r = 0; r < Math.min(rows.length, 500); r++) m = Math.max(m, shown(r, c).length);
    setWidths((w) => ({ ...w, [si + ':' + c]: Math.max(MIN_W, Math.min(420, m * 7.2 + 18)) }));
  };

  // ---- sayfalar
  const addSheet = () => { let n = sheets.length + 1; while (sheets.some((s) => s.name === 'Sheet' + n)) n++; apply([...sheets, { name: 'Sheet' + n, rows: [] }]); setSi(sheets.length); };
  const delSheet = async (i) => { if (sheets.length < 2 || !(await askConfirm({ title: 'Delete sheet', message: `Delete sheet "${sheets[i].name}"?`, confirmLabel: 'Delete', danger: true }))) return; apply(sheets.filter((_, k) => k !== i)); setSi(Math.max(0, Math.min(si, sheets.length - 2))); };
  const doRename = () => {
    if (!rename) return;
    const nm = rename.value.trim().slice(0, 31);
    if (nm && !sheets.some((s, i) => i !== rename.i && s.name.toLowerCase() === nm.toLowerCase())) apply(sheets.map((s, i) => (i === rename.i ? { ...s, name: nm } : s)));
    setRename(null);
  };
  useEffect(() => { setSel({ r: 0, c: 0 }); setRng({ r1: 0, c1: 0, r2: 0, c2: 0 }); setEdit(null); if (box.current) { box.current.scrollTop = 0; box.current.scrollLeft = 0; } }, [si]);

  // ---- arama
  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return [];
    const out = [];
    for (let r = 0; r < rows.length && out.length < 5000; r++) for (let c = 0; c < rows[r].length; c++) if (shown(r, c).toLowerCase().includes(needle)) out.push([r, c]);
    return out;
  }, [needle, rows, ev]); // eslint-disable-line
  useEffect(() => { setHit(0); }, [needle]);
  const jump = (d) => { if (!matches.length) return; const n = (hit + d + matches.length) % matches.length; setHit(n); moveTo(matches[n][0], matches[n][1]); };

  // ---- save
  const serialize = () => sheets.map((s) => {
    const out = s.rows.map((row, r) => row.map((v, c) => {
      if (!isFormula(v)) return v;
      const val = ev(sheets.indexOf(s), r, c);
      return { f: v, v: isErr(val) ? val.code : val };
    }));
    while (out.length && out[out.length - 1].every((v) => v === '' || v === undefined)) out.pop();
    return { name: s.name, rows: out };
  });
  const save = async () => {
    if (meta.current.truncated) { setNote('This file was too large to load completely, so saving is disabled. Use Save as only for a copy of the visible part.'); return; }
    setNote('Saving…');
    const r = await api.saveSheet(curPath, serialize(), { delimiter: meta.current.delimiter });
    if (r.ok) { setDirty(false); setNote(r.note || 'Saved.'); onSaved && onSaved(curPath); } else setNote(r.error);
  };
  const saveAs = async () => {
    const base = (name || 'table').replace(/\.[^.]+$/, '');
    const r = await api.saveSheetAs(serialize(), base + (meta.current.format === 'csv' ? '.csv' : '.xlsx'), { delimiter: meta.current.delimiter });
    if (r.ok) { setCurPath(r.path); setDirty(false); setNote(`Saved to ${r.path.split(/[\\/]/).pop()}. ${r.note || ''}`); onSaved && onSaved(r.path); } else if (!r.canceled) setNote(r.error);
  };

  // ---- selection summary
  const summary = useMemo(() => {
    let n = 0, sum = 0, cnt = 0;
    const lim = Math.min(R.r2, rows.length - 1);
    for (let r = R.r1; r <= lim; r++) for (let c = R.c1; c <= R.c2; c++) {
      const v = raw(r, c); if (v === undefined || v === '') continue; cnt++;
      const x = isFormula(v) ? ev(si, r, c) : v;
      if (typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(Number(x)))) { n++; sum += Number(x); }
    }
    return { cnt, n, sum };
  }, [rng, rows, ev]); // eslint-disable-line

  if (state.loading) return <div className="muted pad">Loading…</div>;
  if (state.error) return <div className="error">{state.error}</div>;

  // ---- visible range
  const r0 = Math.max(0, Math.floor(scroll.top / RH) - 3), r1 = Math.min(nRows - 1, Math.ceil((scroll.top + scroll.h) / RH) + 3);
  let c0 = 0; while (c0 < nCols - 1 && offsets[c0 + 1] < scroll.left - 80) c0++;
  let c1 = c0; while (c1 < nCols - 1 && offsets[c1] < scroll.left + scroll.w + 80) c1++;
  const visRows = []; for (let r = r0; r <= r1; r++) visRows.push(r);
  const visCols = []; for (let c = c0; c <= c1; c++) visCols.push(c);
  const inRange = (r, c) => r >= R.r1 && r <= R.r2 && c >= R.c1 && c <= R.c2;
  const matchSet = needle ? new Set(matches.map(([r, c]) => r + ':' + c)) : null;

  const cell = (r, c, frozen) => {
    const v = raw(r, c);
    const f = isFormula(v);
    const val = f ? ev(si, r, c) : v;
    const text = f ? formatValue(val) : rawText(v);
    const isNum = typeof val === 'number' || (!f && typeof v === 'string' && v !== '' && /^-?\d+([.,]\d+)?$/.test(v) && !/^0\d/.test(v));
    const cls = ['sh-cell', isNum ? 'num' : '', f && isErr(val) ? 'err' : '', inRange(r, c) ? 'rng' : '', sel.r === r && sel.c === c ? 'sel' : '', matchSet && matchSet.has(r + ':' + c) ? 'hit' : '', header && r === 0 ? 'hd' : ''].filter(Boolean).join(' ');
    return (
      <div key={(frozen ? 'f' : '') + r + ':' + c} className={cls} style={{ left: offsets[c], width: wOf(c), top: frozen ? 0 : r * RH, height: RH }}
        title={text.length > 20 ? text : undefined}
        onMouseDown={(e) => down(r, c, e)} onMouseEnter={() => over(r, c)} onDoubleClick={() => startEdit(r, c)}>
        {text}
      </div>
    );
  };
  const editor = edit && edit.from === 'cell' && (
    <input className="sh-edit" autoFocus value={edit.value} style={{ left: offsets[edit.c], top: edit.r * RH, width: Math.max(wOf(edit.c), 120), height: RH }}
      onChange={(e) => setEdit({ ...edit, value: e.target.value })} onKeyDown={onEditKey} onBlur={() => commit(null)}
      onFocus={(e) => { const l = e.target.value.length; e.target.setSelectionRange(l, l); }} />
  );
  const barValue = edit ? edit.value : rawText(raw(sel.r, sel.c));
  const selLabel = R.r1 === R.r2 && R.c1 === R.c2 ? cellName(sel.r, sel.c) : `${cellName(R.r1, R.c1)}:${cellName(R.r2, R.c2)}`;

  return (
    <div className="sheet">
      <div className="sh-toolbar">
        <button title="Undo (Ctrl+Z)" onClick={doUndo} disabled={!undo.current.length}>↶</button>
        <button title="Redo (Ctrl+Y)" onClick={doRedo} disabled={!redo.current.length}>↷</button>
        <span className="sep" />
        <button title="Insert row above" onClick={() => insertRows(R.r1)}>+ Row</button>
        <button title="Delete selected rows" onClick={deleteRows}>− Row</button>
        <button title="Insert column left" onClick={() => insertCols(R.c1)}>+ Col</button>
        <button title="Delete selected columns" onClick={deleteCols}>− Col</button>
        <span className="sep" />
        <button title="Sort the selected column A→Z" onClick={() => sortBy(1)}>A→Z</button>
        <button title="Sort the selected column Z→A" onClick={() => sortBy(-1)}>Z→A</button>
        <button title="Fill down (Ctrl+D)" onClick={fillDown}>Fill ↓</button>
        <label className="sh-check"><input type="checkbox" checked={header} onChange={(e) => setHeader(e.target.checked)} /> Header row</label>
        <span className="grow" />
        <input type="search" className="sh-find" placeholder="Find" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); jump(e.shiftKey ? -1 : 1); } }} />
        {needle && <span className="sh-hits">{matches.length ? `${hit + 1}/${matches.length}` : '0'}</span>}
        <button className="primary" onClick={save} disabled={!dirty} title="Save (Ctrl+S)">{dirty ? 'Save' : 'Saved'}</button>
        <button onClick={saveAs}>Save as…</button>
      </div>
      <div className="sh-bar">
        <span className="sh-name">{selLabel}</span>
        <span className="sh-fx">fx</span>
        <input value={barValue} placeholder="Value or =formula"
          onChange={(e) => setEdit({ r: sel.r, c: sel.c, value: e.target.value, from: 'bar' })}
          onKeyDown={onEditKey} onBlur={() => edit && edit.from === 'bar' && commit(null)} />
      </div>
      <div className="sh-scroll" ref={box} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste}>
        <div className="sh-head" style={{ width: RNW + totalW, height: HH }}>
          <div className="sh-corner" style={{ width: RNW, height: HH }} onMouseDown={() => { setRng({ r1: 0, c1: 0, r2: Math.max(rows.length - 1, 0), c2: nCols - 1 - EXTRA_COLS }); box.current.focus(); }} />
          <div className="sh-cols" style={{ width: totalW, height: HH }}>
            {visCols.map((c) => (
              <div key={c} className={`sh-ch ${c >= R.c1 && c <= R.c2 ? 'on' : ''}`} style={{ left: offsets[c], width: wOf(c), height: HH }} onMouseDown={() => pickCol(c)}>
                {colName(c)}
                <i className="sh-grip" onMouseDown={(e) => startResize(c, e)} onDoubleClick={(e) => { e.stopPropagation(); autofit(c); }} title="Drag to resize · double-click to fit" />
              </div>
            ))}
          </div>
        </div>
        {header && scroll.top > 0 && (
          <div className="sh-frozen" style={{ top: HH, width: RNW + totalW, height: RH }}>
            <div className="sh-rn on" style={{ width: RNW, height: RH, lineHeight: RH + 'px' }}>1</div>
            <div className="sh-cells" style={{ width: totalW, height: RH }}>{visCols.map((c) => cell(0, c, true))}</div>
          </div>
        )}
        <div className="sh-body" style={{ width: RNW + totalW, height: nRows * RH }}>
          <div className="sh-rns" style={{ width: RNW, height: nRows * RH }}>
            {visRows.map((r) => <div key={r} className={`sh-rn ${r >= R.r1 && r <= R.r2 ? 'on' : ''}`} style={{ top: r * RH, height: RH, lineHeight: RH + 'px' }} onMouseDown={() => pickRow(r)}>{r + 1}</div>)}
          </div>
          <div className="sh-cells" style={{ width: totalW, height: nRows * RH }}>
            {visRows.map((r) => visCols.map((c) => cell(r, c, false)))}
            {editor}
          </div>
        </div>
      </div>
      <div className="sh-foot">
        <div className="sh-tabs">
          {sheets.map((s, i) => (
            rename && rename.i === i
              ? <input key={i} className="sh-rename" autoFocus value={rename.value} onChange={(e) => setRename({ i, value: e.target.value })} onBlur={doRename} onKeyDown={(e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRename(null); }} />
              : <button key={i} className={i === si ? 'active' : ''} onClick={() => setSi(i)} onDoubleClick={() => setRename({ i, value: s.name })} title="Double-click to rename">
                {s.name}{i === si && sheets.length > 1 && <b className="x" onClick={(e) => { e.stopPropagation(); delSheet(i); }} title="Delete sheet">×</b>}
              </button>
          ))}
          <button className="add" onClick={addSheet} title="Add sheet">+</button>
        </div>
        <span className="sh-stat">
          {summary.cnt > 1 ? `Count ${summary.cnt}` : ''}{summary.n > 1 ? ` · Sum ${formatValue(Number(summary.sum.toPrecision(12)))} · Avg ${formatValue(Number((summary.sum / summary.n).toPrecision(8)))}` : ''}
        </span>
      </div>
      {(note || meta.current.truncated) && <small className="hint sh-note">{note || 'Only the first 200,000 rows / 700 columns are loaded.'}</small>}
    </div>
  );
}
