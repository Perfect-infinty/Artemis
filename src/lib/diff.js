// Small line diff (LCS) for approval cards: turns two texts into unified-diff rows.
// Returns [{ type: ' ' | '+' | '-', text }]. Large inputs fall back to "all removed, all added" to stay fast.

export function lineDiff(a, b, { max = 1200 } = {}) {
  const A = String(a ?? '').split('\n');
  const B = String(b ?? '').split('\n');
  // trim the common head and tail first: edits are usually small
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const head = A.slice(0, s).map((text) => ({ type: ' ', text }));
  const tail = A.slice(ea).map((text) => ({ type: ' ', text }));
  const a2 = A.slice(s, ea), b2 = B.slice(s, eb);
  let mid;
  if (a2.length * b2.length > max * max) {
    mid = [...a2.map((text) => ({ type: '-', text })), ...b2.map((text) => ({ type: '+', text }))];
  } else {
    const n = a2.length, m = b2.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    mid = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { mid.push({ type: ' ', text: a2[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) mid.push({ type: '-', text: a2[i++] });
      else mid.push({ type: '+', text: b2[j++] });
    }
    while (i < n) mid.push({ type: '-', text: a2[i++] });
    while (j < m) mid.push({ type: '+', text: b2[j++] });
  }
  return [...head, ...mid, ...tail];
}

/** Keeps `context` unchanged lines around each change; long unchanged runs become one '…' row. */
export function withContext(rows, context = 3) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => { if (r.type !== ' ') for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true; });
  const out = [];
  let gap = false;
  rows.forEach((r, i) => {
    if (keep[i]) { out.push(r); gap = false; }
    else if (!gap) { out.push({ type: '…', text: '' }); gap = true; }
  });
  return out;
}
