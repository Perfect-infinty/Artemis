// Markdown extras for notes, as a remark plugin:
//   [[Note]] / [[Note|Label]]   -> link to a note (href "#note:<name>")
//   ![[Note]] / ![[Note|Label]] -> embed of another note (<wikiembed>), or an image when the name is an image file
//   find highlights            -> every match of find.q wrapped in <mark>, the find.active one marked as active
const WIKI_RE = /(!)?\[\[([^\]\n]+?)\]\]/g;
const IMG = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
const SKIP = new Set(['code', 'inlineCode', 'link', 'linkReference', 'html', 'definition', 'image']);

function parseInner(inner) {
  const i = inner.indexOf('|');
  if (i < 0) return { title: inner.trim(), label: inner.trim() };
  const title = inner.slice(0, i).trim();
  return { title, label: inner.slice(i + 1).trim() || title };
}

function splitWiki(value) {
  const out = [];
  let last = 0, m;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(value))) {
    const { title, label } = parseInner(m[2]);
    if (!title) continue;
    if (m.index > last) out.push({ type: 'text', value: value.slice(last, m.index) });
    if (m[1]) {
      if (IMG.test(title)) out.push({ type: 'image', url: title, alt: label });
      else out.push({ type: 'emphasis', data: { hName: 'wikiembed', hProperties: { note: title, label } }, children: [{ type: 'text', value: label }] });
    } else out.push({ type: 'link', url: '#note:' + encodeURIComponent(title), children: [{ type: 'text', value: label }] });
    last = m.index + m[0].length;
  }
  if (!out.length) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function convert(node) {
  if (!node.children || SKIP.has(node.type)) return;
  const next = [];
  for (const ch of node.children) {
    if (ch.type === 'text') {
      const parts = splitWiki(ch.value);
      if (parts) { next.push(...parts); continue; }
    } else convert(ch);
    next.push(ch);
  }
  node.children = next;
  if (node.type === 'paragraph') { // a paragraph that is only an embed becomes a block-level embed
    const sig = node.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
    if (sig.length === 1 && sig[0].data && sig[0].data.hName === 'wikiembed') { node.type = 'blockquote'; node.data = sig[0].data; node.children = []; }
  }
}

function markFind(tree, query, active) {
  const q = query.toLowerCase();
  let total = 0;
  const count = (n) => {
    if (n.type === 'text') { const v = n.value.toLowerCase(); let i = 0; while ((i = v.indexOf(q, i)) !== -1) { total++; i += q.length; } }
    else if (n.children) n.children.forEach(count);
  };
  count(tree);
  if (!total) return;
  const act = ((active % total) + total) % total;
  let idx = 0;
  const walk = (node) => {
    if (!node.children) return;
    const next = [];
    for (const ch of node.children) {
      if (ch.type !== 'text') { walk(ch); next.push(ch); continue; }
      const v = ch.value, low = v.toLowerCase();
      let from = 0, hit;
      const parts = [];
      while ((hit = low.indexOf(q, from)) !== -1) {
        if (hit > from) parts.push({ type: 'text', value: v.slice(from, hit) });
        parts.push({ type: 'strong', data: { hName: 'mark', hProperties: { className: idx === act ? ['md-find-match', 'md-find-match-active'] : ['md-find-match'] } }, children: [{ type: 'text', value: v.slice(hit, hit + q.length) }] });
        idx++; from = hit + q.length;
      }
      if (!parts.length) { next.push(ch); continue; }
      if (from < v.length) parts.push({ type: 'text', value: v.slice(from) });
      next.push(...parts);
    }
    node.children = next;
  };
  walk(tree);
}

export function remarkNotes(opts = {}) {
  return (tree) => {
    convert(tree);
    if (opts.find && opts.find.q) markFind(tree, opts.find.q, opts.find.active || 0);
  };
}
