import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { getCaretCoordinates } from '../lib/caret.js';

const OPEN_RE = /(!)?\[\[([^\]|\n]*)$/; // an unclosed [[ or ![[ right before the caret

/** The suggestion list next to the caret. items: [{ title, isNew }]. top/left are viewport coordinates. */
export function WikiSuggest({ items, index, top, left, lineHeight = 20, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    const list = ref.current; const el = list && list.children[index];
    if (!el) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
  }, [index, items]);
  const flip = top + 230 > window.innerHeight;
  const style = { left: Math.min(left, window.innerWidth - 260), ...(flip ? { bottom: window.innerHeight - top + lineHeight } : { top }) };
  return (
    <div className="wiki-suggest" style={style} ref={ref}>
      {items.map((it, i) => (
        <div key={it.title + (it.isNew ? '+' : '')} className={'wiki-suggest-item' + (i === index ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); onPick(it); }}>
          {it.isNew ? <span>Create note “<b>{it.title}</b>”</span> : <span>{it.title}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * A <textarea> that suggests note names after "[[" (or "![[").
 * value / onValue(next) are plain strings; titles is the list of note names. Other props go to the textarea.
 */
export const WikiTextarea = forwardRef(function WikiTextarea({ value, onValue, titles = [], onKeyDown, onClick, onBlur, ...rest }, ref) {
  const inner = useRef(null);
  const [ac, setAc] = useState(null);
  const setRef = (el) => { inner.current = el; if (typeof ref === 'function') ref(el); else if (ref) ref.current = el; };

  const update = (el) => {
    const cursor = el.selectionStart;
    const m = OPEN_RE.exec(el.value.slice(0, cursor));
    if (!m) { setAc(null); return; }
    const query = m[2], q = query.trim().toLowerCase();
    const found = titles.filter((t) => t.toLowerCase().includes(q)).sort((a, b) => (b.toLowerCase().startsWith(q) - a.toLowerCase().startsWith(q)) || a.localeCompare(b)).slice(0, 50).map((t) => ({ title: t, isNew: false }));
    const exact = titles.some((t) => t.toLowerCase() === q);
    const items = q && !exact ? [...found, { title: query.trim(), isNew: true }] : found;
    if (!items.length) { setAc(null); return; }
    const c = getCaretCoordinates(el, cursor);
    setAc({ start: cursor - query.length, items, index: 0, top: c.top, left: c.left, lineHeight: c.lineHeight });
  };

  const pick = (item) => {
    const el = inner.current;
    if (!item || !ac || !el) return;
    const cursor = el.selectionStart;
    const before = el.value.slice(0, ac.start), after = el.value.slice(cursor);
    const closed = after.startsWith(']]');
    onValue(before + item.title + (closed ? '' : ']]') + after);
    setAc(null);
    const caret = before.length + item.title.length + 2;
    requestAnimationFrame(() => { el.focus({ preventScroll: true }); el.setSelectionRange(caret, caret); });
  };

  const keyDown = (e) => {
    if (ac) {
      const n = ac.items.length;
      if (e.key === 'ArrowDown') { e.preventDefault(); setAc({ ...ac, index: (ac.index + 1) % n }); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...ac, index: (ac.index - 1 + n) % n }); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(ac.items[ac.index]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setAc(null); return; }
    }
    if (onKeyDown) onKeyDown(e);
    const el = e.currentTarget;
    if (!e.defaultPrevented && /^(Arrow|Home|End|Page)/.test(e.key)) requestAnimationFrame(() => update(el));
  };

  return (
    <>
      <textarea ref={setRef} value={value} {...rest}
        onChange={(e) => { onValue(e.target.value); update(e.target); }}
        onKeyDown={keyDown}
        onClick={(e) => { update(e.currentTarget); if (onClick) onClick(e); }}
        onBlur={(e) => { setTimeout(() => setAc(null), 120); if (onBlur) onBlur(e); }} />
      {ac && <WikiSuggest items={ac.items} index={ac.index} top={ac.top} left={ac.left} lineHeight={ac.lineHeight} onPick={pick} />}
    </>
  );
});
