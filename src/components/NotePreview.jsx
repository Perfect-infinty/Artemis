import React, { createContext, useContext, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './Markdown.jsx';
import { WikiTextarea } from './WikiTextarea.jsx';
import { remarkNotes } from '../lib/noteMd.js';

/*
 * Rendered Markdown of a note. With `editable`, clicking a block (paragraph, heading, list, code block, table, ...)
 * turns it into a textarea with its raw Markdown; clicking away puts it back. Clicking the empty space below adds a new block.
 * Task-list checkboxes toggle on click. [[links]] open notes, ![[embeds]] show another note inline, relative images load from the notes folder.
 */
const Ctx = createContext(null);
const REHYPE = [[rehypeHighlight, { detect: false, ignoreMissing: true }]];
const assetCache = new Map();

function grow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

function InlineEdit({ ls, le }) {
  const c = useContext(Ctx);
  const [v, setV] = useState(() => c.lines.slice(ls, le).join('\n'));
  const ref = useRef(null);
  useLayoutEffect(() => { const el = ref.current; if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(v.length, v.length); } }, []);
  useLayoutEffect(() => { if (ref.current) grow(ref.current); }, [v]);
  return (
    <WikiTextarea ref={ref} className="np-inline" rows={1} spellCheck value={v} onValue={setV} titles={c.titles}
      onKeyDown={(e) => { if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) { e.preventDefault(); e.currentTarget.blur(); } }}
      onBlur={() => c.commit(ls, le, v)} />
  );
}

function AppendEdit() {
  const c = useContext(Ctx);
  const [v, setV] = useState('');
  const ref = useRef(null);
  useLayoutEffect(() => { if (ref.current) ref.current.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => { if (ref.current) grow(ref.current); }, [v]);
  return (
    <WikiTextarea ref={ref} className="np-inline np-inline-new" rows={1} spellCheck placeholder="Write something…" value={v} onValue={setV} titles={c.titles}
      onKeyDown={(e) => { if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) { e.preventDefault(); e.currentTarget.blur(); } }}
      onBlur={() => c.append(v)} />
  );
}

const rangeOf = (node) => (node && node.position ? [node.position.start.line - 1, node.position.end.line] : null);
const isEditing = (c, r, tag) => !!(c && c.editable && r && c.editing && !c.editing.append && c.editing.ls === r[0] && c.editing.le === r[1] && c.editing.tag === tag);

function makeBlock(Tag) {
  const Block = ({ node, children, ...rest }) => {
    const c = useContext(Ctx);
    const r = rangeOf(node);
    if (!c || !c.editable || !r) return <Tag {...rest}>{children}</Tag>;
    if (isEditing(c, r, Tag)) return <InlineEdit ls={r[0]} le={r[1]} />;
    return <Tag {...rest} data-ls={r[0]} data-le={r[1]} data-tag={Tag}>{children}</Tag>;
  };
  Block.displayName = 'NoteBlock_' + Tag;
  return Block;
}

function PreBlock({ node, children }) {
  const c = useContext(Ctx);
  const r = rangeOf(node);
  if (!c || !c.editable || !r) return <CodeBlock>{children}</CodeBlock>;
  if (isEditing(c, r, 'pre')) return <InlineEdit ls={r[0]} le={r[1]} />;
  return <div data-ls={r[0]} data-le={r[1]} data-tag="pre"><CodeBlock>{children}</CodeBlock></div>;
}

function TableBlock({ node, children }) {
  const c = useContext(Ctx);
  const r = rangeOf(node);
  if (!c || !c.editable || !r) return <div className="table-wrap"><table>{children}</table></div>;
  if (isEditing(c, r, 'table')) return <InlineEdit ls={r[0]} le={r[1]} />;
  return <div className="table-wrap" data-ls={r[0]} data-le={r[1]} data-tag="table"><table>{children}</table></div>;
}

function Anchor({ node, href, children }) {
  const c = useContext(Ctx);
  if (href && href.startsWith('#note:')) {
    let name = href.slice(6); try { name = decodeURIComponent(name); } catch {}
    const ok = c.exists(name);
    return <a className={'wikilink' + (ok ? '' : ' missing')} href={href} title={ok ? name : `Create “${name}”`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); c.openWiki(name, e.metaKey || e.ctrlKey ? 'tab' : 'here'); }}>{children}</a>;
  }
  return <a href={href} onClick={(e) => { if (/^https?:\/\//i.test(href || '')) { e.preventDefault(); window.dispatchEvent(new CustomEvent('aid-browser-open', { detail: href })); } }}>{children}</a>;
}

function NoteImg({ node, src, alt }) {
  const c = useContext(Ctx);
  const direct = !src || /^(https?:|data:|blob:)/i.test(src);
  const key = c.notePath + '\n' + src;
  const [url, setUrl] = useState(() => (direct ? src : assetCache.get(key) || null));
  useEffect(() => {
    if (direct) { setUrl(src); return undefined; }
    if (assetCache.has(key)) { setUrl(assetCache.get(key)); return undefined; }
    let off = false;
    window.api.notesAsset(c.notePath, src).then((r) => { if (r && r.ok) { assetCache.set(key, r.url); if (!off) setUrl(r.url); } });
    return () => { off = true; };
  }, [key]);
  return url ? <img src={url} alt={alt || ''} loading="lazy" /> : <span className="np-img-missing">{alt || src}</span>;
}

function Check({ node, ...p }) {
  const c = useContext(Ctx);
  return <input {...p} disabled={!c.editable} onChange={() => {}} />;
}

function Embed({ node, note, label, children }) {
  const c = useContext(Ctx);
  const name = String(note || '');
  const raw = c.embeds && c.embeds.get(name.toLowerCase());
  const open = (e) => { e.preventDefault(); e.stopPropagation(); c.openWiki(name, e.metaKey || e.ctrlKey ? 'tab' : 'here'); };
  if (!c.embeds || c.depth >= 1) return <a className="wikilink" href="#" onClick={open}>{label || name}</a>;
  if (raw == null) return <div className="wikiembed wikiembed-missing" onClick={open}><div className="wikiembed-header">{label || name}</div><div className="wikiembed-empty">Note not found — click to create</div></div>;
  return (
    <div className="wikiembed">
      <div className="wikiembed-header" onClick={open} title="Open note">{label || name}</div>
      <div className="wikiembed-body"><NotePreview text={raw} notePath={c.notePath} embeds={c.embeds} titles={c.titles} onOpenWiki={c.openWiki} depth={c.depth + 1} /></div>
    </div>
  );
}

const COMPONENTS = {
  p: makeBlock('p'), h1: makeBlock('h1'), h2: makeBlock('h2'), h3: makeBlock('h3'), h4: makeBlock('h4'), h5: makeBlock('h5'), h6: makeBlock('h6'),
  ul: makeBlock('ul'), ol: makeBlock('ol'), li: makeBlock('li'), blockquote: makeBlock('blockquote'),
  pre: PreBlock, table: TableBlock, a: Anchor, img: NoteImg, input: Check, wikiembed: Embed
};

export default function NotePreview({ text, notePath, embeds, titles = [], editable = false, onEdit, onOpenWiki, find, depth = 0 }) {
  const shown = useDeferredValue(text);
  const [editing, setEditing] = useState(null); // { ls, le, tag } | { append: true }
  const box = useRef(null);
  const lastCommit = useRef(0);
  const lines = useMemo(() => (shown || '').split('\n'), [shown]);
  const titleSet = useMemo(() => new Set(titles.map((t) => t.toLowerCase())), [titles]);

  const findQ = find && find.q ? find.q : '';
  const findIdx = find ? find.active || 0 : 0;
  const remark = useMemo(() => [remarkGfm, [remarkNotes, { find: findQ ? { q: findQ, active: findIdx } : null }]], [findQ, findIdx]);

  const done = () => { lastCommit.current = Date.now(); setEditing(null); };
  const ctx = {
    editable, editing, lines, titles, embeds, depth, notePath,
    exists: (name) => titleSet.has(name.toLowerCase().replace(/\.md$/, '')) || titleSet.has(name.toLowerCase().split('/').pop().replace(/\.md$/, '')),
    openWiki: (name, how) => { if (onOpenWiki) onOpenWiki(name, how); },
    commit: (ls, le, val) => {
      done();
      const all = lines.slice();
      if (val === all.slice(ls, le).join('\n')) return;
      all.splice(ls, le - ls, ...val.split('\n'));
      if (onEdit) onEdit(all.join('\n'));
    },
    append: (val) => {
      done();
      if (!val.trim() || !onEdit) return;
      const base = shown || '';
      onEdit(base && !base.endsWith('\n') ? `${base}\n\n${val}` : base ? `${base}\n${val}` : val);
    }
  };

  // keep the active find match in view (scroll only the preview pane)
  useEffect(() => {
    const el = box.current && box.current.querySelector('.md-find-match-active');
    const sc = box.current && box.current.parentElement;
    if (!el || !sc) return;
    sc.scrollTop = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - sc.clientHeight / 2;
  }, [findQ, findIdx, shown]);

  const onClick = (e) => {
    if (!editable) return;
    const t = e.target;
    if (t.closest('a, button, summary')) return;
    if (t.matches && t.matches('input[type="checkbox"]')) {
      const li = t.closest('li[data-ls]');
      if (li && onEdit) {
        e.preventDefault();
        const all = (text || '').split('\n'), i = +li.getAttribute('data-ls');
        all[i] = all[i].replace(/\[( |x|X)\]/, (_m, s) => (s === ' ' ? '[x]' : '[ ]'));
        onEdit(all.join('\n'));
      }
      return;
    }
    if (editing || Date.now() - lastCommit.current < 250) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && String(sel).length > 0) return;
    if (t.closest('.wikiembed')) return;
    const blk = t.closest('[data-ls]');
    if (blk && box.current.contains(blk)) setEditing({ ls: +blk.getAttribute('data-ls'), le: +blk.getAttribute('data-le'), tag: blk.getAttribute('data-tag') });
    else setEditing({ append: true });
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className={'np' + (editable ? ' editable' : '') + (depth ? ' np-embed' : '')} ref={box} onClick={onClick}>
        <div className="md">
          <ReactMarkdown remarkPlugins={remark} rehypePlugins={REHYPE} components={COMPONENTS}>{shown}</ReactMarkdown>
        </div>
        {editable && editing && editing.append && <AppendEdit />}
        {editable && !shown.trim() && !(editing && editing.append) && <div className="np-empty">Click to start writing…</div>}
        {editable && <div className="np-tail" />}
      </div>
    </Ctx.Provider>
  );
}
