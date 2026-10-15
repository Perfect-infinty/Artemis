// "Read along": highlights the passage that is being read aloud inside a rendered message.
// Uses the CSS Custom Highlight API (no DOM changes), matching by words so markdown symbols don't matter.
const isWord = /[\p{L}\p{N}]/u;
const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function createFollower(container) {
  if (!container || !window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return { follow() {}, clear() {} };
  let full = ''; const map = []; let lastSpace = true;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && n.parentElement.closest('.actions, .code-head, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (isWord.test(ch)) { full += ch.toLowerCase(); map.push({ n, o: i }); lastSpace = false; }
      else if (!lastSpace) { full += ' '; map.push({ n, o: i }); lastSpace = true; }
    }
  }
  let cursor = 0;
  const clear = () => { try { CSS.highlights.delete('reading'); } catch {} };
  const follow = (chunk) => {
    const words = norm(chunk).split(' ').filter(Boolean);
    if (!words.length) return;
    let head = words.slice(0, 3).join(' '), start = full.indexOf(head, cursor);
    if (start < 0 && words.length > 1) { head = words.slice(0, 2).join(' '); start = full.indexOf(head, cursor); }
    if (start < 0 && words[0].length > 3) { head = words[0]; start = full.indexOf(head, cursor); }
    if (start < 0) return;
    const tail = words.slice(-3).join(' ');
    const tp = full.indexOf(tail, start);
    const end = tp >= 0 && tp - start < norm(chunk).length * 1.6 + 120 ? tp + tail.length : start + head.length;
    const a = map[start], b = map[Math.min(end, map.length) - 1];
    if (!a || !b) return;
    try {
      const r = document.createRange();
      r.setStart(a.n, a.o); r.setEnd(b.n, b.o + 1);
      CSS.highlights.set('reading', new Highlight(r));
      cursor = end;
      const el = a.n.parentElement;
      if (el) { const rect = r.getBoundingClientRect(); if (rect.top < 80 || rect.bottom > window.innerHeight - 180) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    } catch {}
  };
  return { follow, clear };
}
