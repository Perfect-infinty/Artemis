// Tiny event bus so any component can open the file preview.
export const openPreview = (target) => window.dispatchEvent(new CustomEvent('aid-preview', { detail: target }));

/** Minimal CSV parser (quotes, commas, newlines). */
export function parseCsv(text, delim = ',') {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Picks the most likely delimiter of a CSV-like file. */
export function detectDelimiter(text, name = '') {
  if (/\.tsv$|\.tab$/i.test(name)) return '\t';
  const first = String(text || '').split('\n', 3).join('\n');
  let best = ',', n = -1;
  for (const d of [',', ';', '\t', '|']) { const c = first.split(d).length; if (c > n) { n = c; best = d; } }
  return best;
}

/** Splits the "## Sheet: name (A1:C3)\n<csv>" text produced for spreadsheets. */
export function splitSheets(text) {
  const parts = /^## Sheet: /m.test(String(text || '')) ? String(text).split(/^## Sheet: /m).filter(Boolean) : [];
  if (!parts.length) return [{ name: 'Data', rows: parseCsv(text || '') }];
  return parts.map((p) => {
    const nl = p.indexOf('\n');
    const head = p.slice(0, nl < 0 ? p.length : nl).replace(/\s*\([^)]*\)\s*$/, '');
    return { name: head, rows: parseCsv(nl < 0 ? '' : p.slice(nl + 1)) };
  });
}
