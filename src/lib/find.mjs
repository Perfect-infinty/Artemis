// Find in page (⌘F): the pure parts, so the Node tests can import them (scripts/test-find.js).
// The DOM side (walking text nodes, CSS highlights, scrolling) lives in src/components/FindBar.jsx.

/** Lower-cases one character at a time and keeps a character whose lower case has another length (e.g. "İ"), so offsets stay valid. */
export function foldCase(s) {
  const str = String(s || '');
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const l = c.toLowerCase();
    out += l.length === 1 ? l : c;
  }
  return out;
}

/**
 * Case-insensitive matches of query in a list of text segments (e.g. the text nodes of a page, in order).
 * A segment is a string or { text, group }: consecutive segments of the same group (block element) are searched as one string,
 * so a match may span adjacent segments of a group but never two groups. Plain strings are each their own group.
 * Returns [{ node, start, endNode, end }]: node/endNode are segment indexes, start/end offsets in them (end exclusive). Matches do not overlap.
 */
export function findMatches(segments, query) {
  const q = foldCase(query);
  const out = [];
  if (!q || !Array.isArray(segments)) return out;
  const segs = segments.map((s, i) => (typeof s === 'string' || s == null ? { text: String(s ?? ''), group: Symbol(i) } : { text: String(s.text ?? ''), group: s.group }));
  let i = 0;
  while (i < segs.length) {
    // one group: segments i..j-1
    let j = i + 1;
    while (j < segs.length && segs[j].group === segs[i].group) j++;
    const starts = [];
    let text = '';
    for (let k = i; k < j; k++) { starts.push(text.length); text += segs[k].text; }
    const low = foldCase(text);
    // position -> [segment, offset]; for a start the segment that contains the character, for an end the one that contains the last character
    const at = (p, isEnd) => {
      let k = j - 1;
      for (let n = 0; n < starts.length; n++) {
        const s = starts[n], e = s + segs[i + n].text.length;
        if (isEnd ? p > s && p <= e : p >= s && p < e) { k = i + n; break; }
      }
      return [k, p - starts[k - i]];
    };
    let from = 0, p;
    while ((p = low.indexOf(q, from)) !== -1) {
      const [node, start] = at(p, false);
      const [endNode, end] = at(p + q.length, true);
      out.push({ node, start, endNode, end });
      from = p + q.length;
    }
    i = j;
  }
  return out;
}

/** i wrapped into 0..n-1 (0 when there is nothing). */
export function wrapIndex(i, n) {
  if (!n) return 0;
  return ((Math.trunc(i) % n) + n) % n;
}

/** The next (d = 1) or previous (d = -1) match, wrapping around at either end. */
export function stepIndex(i, n, d) {
  return wrapIndex(i + (d < 0 ? -1 : 1), n);
}

/**
 * After the matches were searched again (the page changed), the index of the match that is the same as the old current one
 * (same(m) is true), else the old index clamped to the new count. Keeps the current match stable while a reply streams in.
 */
export function keepIndex(matches, same, oldIndex) {
  const n = matches ? matches.length : 0;
  if (!n) return 0;
  if (typeof same === 'function') {
    const k = matches.findIndex(same);
    if (k !== -1) return k;
  }
  return Math.min(Math.max(0, oldIndex | 0), n - 1);
}

/** "3 of 12", "No results" for a query without matches, '' without a query. */
export function countLabel(i, n, query = 'x') {
  if (!query) return '';
  if (!n) return 'No results';
  return `${wrapIndex(i, n) + 1} of ${n}`;
}

/** True for the find shortcut (⌘F on macOS, Ctrl+F elsewhere), without Shift/Option. */
export function isFindKey(e, isMac = true) {
  if (!e || e.altKey || e.shiftKey) return false;
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  return !!mod && (e.code === 'KeyF' || e.key === 'f' || e.key === 'F');
}

/** 1 for "find next" (⌘G), -1 for "find previous" (⇧⌘G), 0 otherwise. Ctrl+G / Ctrl+Shift+G elsewhere; F3 / Shift+F3 too. */
export function findStepKey(e, isMac = true) {
  if (!e || e.altKey) return 0;
  if (e.key === 'F3' && !e.metaKey && !e.ctrlKey) return e.shiftKey ? -1 : 1;
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (mod && (e.code === 'KeyG' || e.key === 'g' || e.key === 'G')) return e.shiftKey ? -1 : 1;
  return 0;
}
