// File read/write helpers: text, CSV, Excel, Word, PDF, images.
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const JSZip = require('jszip');

const TEXT_EXT = new Set([
  '.zip',
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.html', '.htm', '.css', '.scss',
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.h',
  '.cpp', '.hpp', '.cs', '.php', '.sh', '.zsh', '.bash', '.yml', '.yaml', '.toml', '.ini', '.env', '.log',
  '.sql', '.svg', '.tex', '.vue', '.svelte', '.gitignore', '.conf', '.cfg'
]);
const SHEET_EXT = new Set(['.xlsx', '.xlsm', '.xls', '.xlsb', '.ods']);
const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_READ_BYTES = 150 * 1024 * 1024;

const isZipBuffer = (buf) => buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5);
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Files we cannot show as text (video, audio, apps, ...): the model still learns the name, size and location. */
function binaryInfo(abs, size, why = 'binary') {
  const name = path.basename(abs);
  return {
    kind: 'binary', size,
    text: `[${why === 'binary' ? 'Binary' : 'Large'} file "${name}", ${fmtSize(size)}, type ${path.extname(name) || 'unknown'}. Its contents cannot be shown as text (${why}). ` +
      `It is located at: ${abs}. If the task needs it, use the terminal tool (e.g. file, ffprobe, unzip) to inspect or convert it.]`
  };
}

const TEXT_IN_ZIP_BUDGET = 300000;
const TEXT_IN_ZIP_PER_FILE = 60000;
const ZIP_LIST_LIMIT = 500;

/** A ZIP: chat exports are converted, anything else is listed and its text files are included. */
async function readZip(buf, abs) {
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new Error(`ZIP file could not be read: ${e.message}`); }
  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX\/|\.DS_Store$)/.test(f.name));
  if (entries.some((f) => /(^|\/)conversations(-\d+)?\.json$/i.test(f.name))) {
    try {
      const { parseExport } = require('./importer');
      const imported = await parseExport(buf, 'imported');
      const text = imported.chats.map((c) => {
        const body = (c.messages || []).map((m) => (m.role === 'user' ? `USER:\n${m.content}` : `ASSISTANT:\n${(m.steps || []).map((s) => s.text).join('\n')}`)).join('\n\n');
        return `# ${c.title}\n\n${body}`;
      }).join('\n\n---\n\n');
      return { kind: 'text', text, size: buf.length, importedChats: imported.chats.length };
    } catch { /* not a readable export: fall through to the generic listing */ }
  }
  const size = (f) => (f._data && f._data.uncompressedSize) || 0;
  const lines = [`ZIP archive ${path.basename(abs)}: ${entries.length} file${entries.length === 1 ? '' : 's'}, ${fmtSize(buf.length)} compressed.`, '', 'Contents:'];
  entries.slice(0, ZIP_LIST_LIMIT).forEach((f) => lines.push(`- ${f.name} (${fmtSize(size(f))})`));
  if (entries.length > ZIP_LIST_LIMIT) lines.push(`… and ${entries.length - ZIP_LIST_LIMIT} more`);
  let budget = TEXT_IN_ZIP_BUDGET;
  const included = [];
  for (const f of entries) {
    const ext = path.extname(f.name).toLowerCase();
    if (budget <= 0) break;
    if (ext === '.zip' || SHEET_EXT.has(ext) || ext === '.docx' || ext === '.pdf' || IMAGE_MIME[ext]) continue;
    if (!(TEXT_EXT.has(ext) || ext === '') || size(f) > 5 * 1024 * 1024) continue;
    const data = await f.async('nodebuffer');
    if (looksBinary(data)) continue;
    const text = data.toString('utf8').slice(0, Math.min(TEXT_IN_ZIP_PER_FILE, budget));
    budget -= text.length;
    included.push(`\n\n=== ${f.name} ===\n${text}${data.length > text.length ? '\n…[truncated]' : ''}`);
  }
  if (included.length) lines.push('', `Text files (${included.length}):`, ...included);
  return { kind: 'archive', text: lines.join('\n'), size: buf.length, entries: entries.length };
}

function kindOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (SHEET_EXT.has(ext)) return 'sheet';
  if (ext === '.docx') return 'docx';
  if (ext === '.pdf') return 'pdf';
  if (IMAGE_MIME[ext]) return 'image';
  if (TEXT_EXT.has(ext) || ext === '') return 'text';
  return 'unknown';
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 4000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function sheetsToText(wb, onlySheet) {
  const names = onlySheet ? [onlySheet] : wb.SheetNames;
  return names.map((n) => {
    const ws = wb.Sheets[n];
    if (!ws) throw new Error(`Sheet not found: ${n}. Available sheets: ${wb.SheetNames.join(', ')}`);
    // show formulas without a cached value as "=formula"
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const c = ws[addr];
      if (c && c.f && (c.t === 'z' || c.v === undefined || c.v === null)) { c.t = 's'; c.v = '=' + c.f; }
    }
    return `## Sheet: ${n} (${ws['!ref'] || 'empty'})\n${XLSX.utils.sheet_to_csv(ws)}`;
  }).join('\n\n');
}

/** Turns a file's content into plain text. Returns a dataUrl for images. */
async function readContent(abs, { sheet } = {}) {
  const kind = kindOf(abs);
  const size = fs.statSync(abs).size;
  if (size > MAX_READ_BYTES && kind !== 'text') return binaryInfo(abs, size, 'too large to read here');
  const buf = fs.readFileSync(abs);
  if (path.extname(abs).toLowerCase() === '.zip' || (kind === 'unknown' && isZipBuffer(buf))) return readZip(buf, abs);
  if (kind === 'image') {
    if (buf.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 8 MB limit.');
    const mime = IMAGE_MIME[path.extname(abs).toLowerCase()];
    return { kind, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size: buf.length };
  }
  if (kind === 'sheet') {
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, sheetStubs: true });
    return { kind, text: sheetsToText(wb, sheet), sheets: wb.SheetNames, size: buf.length };
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer: buf });
    return { kind, text: r.value, size: buf.length };
  }
  if (kind === 'pdf') {
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const r = await pdfParse(buf);
    return { kind, text: r.text, pages: r.numpages, size: buf.length };
  }
  if (looksBinary(buf)) return binaryInfo(abs, buf.length);
  return { kind: 'text', text: buf.toString('utf8'), size: buf.length };
}

/** Prepares an attached file for the chat. */
async function parseAttachment(abs, maxChars = 200000) {
  const name = path.basename(abs);
  try {
    const r = await readContent(abs);
    if (r.kind === 'image') return { name, path: abs, kind: 'image', dataUrl: r.dataUrl, size: r.size };
    let text = r.text || '';
    const truncated = text.length > maxChars;
    if (truncated) text = text.slice(0, maxChars);
    return { name, path: abs, kind: r.kind, text, truncated, size: r.size };
  } catch (err) {
    return { name, path: abs, kind: 'error', error: err.message };
  }
}

/** An attachment that has no path on disk (pasted or dragged from an app): save it to a temp folder, then read it like any other file. */
async function parseBuffer(name, bytes, baseDir) {
  const clean = path.basename(String(name || 'file')).replace(/[\u0000-\u001f<>:"|?*\\]/g, '_').slice(0, 120) || 'file';
  const buf = Buffer.from(bytes || []);
  if (!buf.length) return { name: clean, kind: 'error', error: 'The file is empty.' };
  if (buf.length > MAX_READ_BYTES) return { name: clean, kind: 'error', error: 'The file is too large to attach this way (150 MB limit).' };
  const dir = path.join(baseDir || require('os').tmpdir(), 'artemis-attachments', `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  const abs = path.join(dir, clean);
  fs.writeFileSync(abs, buf);
  return parseAttachment(abs);
}

function safeSheetName(name, fallback) {
  const n = String(name || fallback).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31);
  return n || fallback;
}

function buildSheet(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // text starting with "=" is written as a formula
  for (const addr of Object.keys(ws)) {
    if (addr[0] === '!') continue;
    const c = ws[addr];
    if (c && c.t === 's' && typeof c.v === 'string' && c.v.startsWith('=') && c.v.length > 1) {
      ws[addr] = { f: c.v.slice(1) };
    }
  }
  return ws;
}

/** sheets: [{name, rows: any[][]}] — writes xlsx/xls/ods/csv/tsv depending on the extension. */
function writeSpreadsheet(abs, sheets) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('At least one sheet is required: sheets=[{name, rows}]');
  const ext = path.extname(abs).toLowerCase();
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (ext === '.csv' || ext === '.tsv') {
    const ws = XLSX.utils.aoa_to_sheet(sheets[0].rows || []);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ext === '.tsv' ? '\t' : ',' });
    fs.writeFileSync(abs, '﻿' + csv, 'utf8'); // BOM: so Excel opens non-ASCII characters correctly
    return { sheets: 1 };
  }
  if (!SHEET_EXT.has(ext)) throw new Error('Spreadsheet extension must be .xlsx, .xls, .ods, .csv or .tsv.');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  sheets.forEach((s, i) => {
    let name = safeSheetName(s.name, `Sheet${i + 1}`);
    let k = 2; while (used.has(name)) name = safeSheetName(s.name, 'Sheet').slice(0, 28) + k++;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, buildSheet(s.rows || []), name);
  });
  XLSX.writeFile(wb, abs, { bookType: ext === '.xlsm' ? 'xlsx' : ext.slice(1) });
  return { sheets: sheets.length };
}

/** Updates specific cells in an existing sheet. cells: [{cell:'A1', value}] */
function updateCells(abs, sheetName, cells) {
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.csv' || ext === '.tsv') {
    const wb = XLSX.read(fs.readFileSync(abs, 'utf8'), { type: 'string', FS: ext === '.tsv' ? '\t' : undefined });
    const ws = wb.Sheets[wb.SheetNames[0]];
    applyCells(ws, cells);
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ext === '.tsv' ? '\t' : ',' });
    fs.writeFileSync(abs, '﻿' + csv, 'utf8');
    return cells.length;
  }
  const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer', cellDates: true, sheetStubs: true });
  const name = sheetName || wb.SheetNames[0];
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet not found: ${name}. Available sheets: ${wb.SheetNames.join(', ')}`);
  applyCells(ws, cells);
  XLSX.writeFile(wb, abs, { bookType: ext === '.xlsm' ? 'xlsx' : ext.slice(1) });
  return cells.length;
}

function applyCells(ws, cells) {
  if (!Array.isArray(cells) || !cells.length) throw new Error('cells=[{cell:"A1", value:...}] is required');
  for (const { cell, value } of cells) {
    if (!/^[A-Za-z]+[0-9]+$/.test(String(cell))) throw new Error(`Invalid cell address: ${cell}`);
    const addr = String(cell).toUpperCase();
    if (typeof value === 'string' && value.startsWith('=') && value.length > 1) ws[addr] = { f: value.slice(1) };
    else if (typeof value === 'number') ws[addr] = { t: 'n', v: value };
    else if (typeof value === 'boolean') ws[addr] = { t: 'b', v: value };
    else if (value === null || value === undefined || value === '') delete ws[addr];
    else ws[addr] = { t: 's', v: String(value) };
    const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    const c = XLSX.utils.decode_cell(addr);
    if (c.r > ref.e.r) ref.e.r = c.r;
    if (c.c > ref.e.c) ref.e.c = c.c;
    ws['!ref'] = XLSX.utils.encode_range(ref);
  }
}

// ---------- sheet editor ----------
const SHEET_MAX_ROWS = 200000;
const SHEET_MAX_COLS = 700;
const EDIT_EXT = new Set(['.csv', '.tsv', '.tab', '.xlsx', '.xlsm', '.xls', '.xlsb', '.ods']);

function detectFS(text) {
  const lines = text.split(/\r?\n/).slice(0, 5).filter(Boolean);
  const cands = [',', ';', '\t', '|'];
  let best = ',', top = 0;
  for (const c of cands) {
    const n = lines.reduce((t, l) => t + l.split(c).length - 1, 0);
    if (n > top) { top = n; best = c; }
  }
  return best;
}

function cellRaw(c) {
  if (!c) return '';
  if (c.f) return '=' + c.f;
  const v = c.v;
  if (v === undefined || v === null) return '';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (c.t === 'e') return c.w || '#ERR';
  return v;
}

/** Loads the file as an editable cell matrix: {format, delimiter, sheets:[{name, rows}], truncated}. */
function loadSheets(abs) {
  const ext = path.extname(abs).toLowerCase();
  if (!EDIT_EXT.has(ext)) throw new Error('Not a spreadsheet file.');
  const size = fs.statSync(abs).size;
  if (size > MAX_READ_BYTES) throw new Error('File is too large to edit here.');
  let wb, delimiter = null;
  if (ext === '.csv' || ext === '.tsv' || ext === '.tab') {
    let text = fs.readFileSync(abs, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    delimiter = ext === '.csv' ? detectFS(text) : '\t';
    wb = XLSX.read(text, { type: 'string', raw: true, FS: delimiter });
  } else {
    wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer', cellDates: true, sheetStubs: true });
  }
  let truncated = false;
  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name] || {};
    const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    const endR = Math.min(ref.e.r, SHEET_MAX_ROWS - 1), endC = Math.min(ref.e.c, SHEET_MAX_COLS - 1);
    if (ref.e.r > endR || ref.e.c > endC) truncated = true;
    const rows = [];
    for (let r = 0; r <= endR; r++) {
      const row = [];
      let last = -1;
      for (let c = 0; c <= endC; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const v = cellRaw(cell);
        row.push(v);
        if (v !== '') last = c;
      }
      row.length = last + 1;
      rows.push(row);
    }
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return { name, rows };
  });
  return { format: ext.slice(1), delimiter, sheets, truncated, size };
}

/** A cell {f, v} is written as formula + cached value (the value is required for xls/ods). */
function buildEditedSheet(rows) {
  const objs = [];
  const plain = rows.map((row, r) => row.map((c, j) => {
    if (c && typeof c === 'object') { objs.push([r, j, c]); return c.v === undefined ? '' : c.v; }
    return c;
  }));
  const ws = buildSheet(plain);
  for (const [r, j, c] of objs) {
    const addr = XLSX.utils.encode_cell({ r, c: j });
    const v = c.v;
    const cell = { f: String(c.f).replace(/^=/, '') };
    if (typeof v === 'number') { cell.t = 'n'; cell.v = v; }
    else if (typeof v === 'boolean') { cell.t = 'b'; cell.v = v; }
    else { cell.t = 's'; cell.v = v == null ? '' : String(v); }
    ws[addr] = cell;
    const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    if (r > ref.e.r) ref.e.r = r; if (j > ref.e.c) ref.e.c = j;
    ws['!ref'] = XLSX.utils.encode_range(ref);
  }
  return ws;
}

const flatRows = (rows) => (rows || []).map((row) => row.map((c) => (c && typeof c === 'object' ? (c.f ? '=' + String(c.f).replace(/^=/, '') : c.v === undefined ? '' : c.v) : c)));

/** Writes the edited matrix to disk. When writing to the same path it makes a .bak backup the first time. */
function saveSheets(abs, sheets, { delimiter, backup = true } = {}) {
  const ext = path.extname(abs).toLowerCase();
  if (!EDIT_EXT.has(ext)) throw new Error('Choose a .csv, .tsv, .xlsx, .xls, .xlsb, .xlsm or .ods file name.');
  if (backup && fs.existsSync(abs) && !fs.existsSync(abs + '.bak')) fs.copyFileSync(abs, abs + '.bak');
  if (ext === '.csv' || ext === '.tsv' || ext === '.tab') {
    const fs_ = ext === '.csv' ? (delimiter || ',') : '\t';
    const ws = XLSX.utils.aoa_to_sheet((sheets[0] && sheets[0].rows) || []);
    fs.writeFileSync(abs, '﻿' + XLSX.utils.sheet_to_csv(ws, { FS: fs_ }), 'utf8');
    return { sheets: 1, note: sheets.length > 1 ? 'Only the first sheet can be saved to a text file.' : '' };
  }
  const wb = XLSX.utils.book_new();
  const used = new Set();
  sheets.forEach((s, i) => {
    let name = safeSheetName(s.name, `Sheet${i + 1}`);
    let k = 2; while (used.has(name)) name = safeSheetName(s.name, 'Sheet').slice(0, 28) + k++;
    used.add(name);
    XLSX.utils.book_append_sheet(wb, buildEditedSheet(s.rows || []), name);
  });
  XLSX.writeFile(wb, abs, { bookType: ext === '.xlsm' ? 'xlsx' : ext.slice(1) });
  return { sheets: sheets.length, note: ext === '.xls' ? 'Old .xls files keep formula results only. Use .xlsx to keep formulas.' : ext === '.xlsm' ? 'Saved as a plain workbook (macros are not kept).' : '' };
}

module.exports = { kindOf, readContent, parseAttachment, parseBuffer, writeSpreadsheet, updateCells, loadSheets, saveSheets, EDIT_EXT, TEXT_EXT, SHEET_EXT };
