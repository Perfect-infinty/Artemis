// Memory diagnostics and clean-up for the app window (see electron/memory.js for the per-process numbers).
import { log } from './log.js';

const api = window.api;
const MB = 1048576;

/** Size of the images held in chat state: user attachments and tool screenshots (base64 data URLs). */
export function imageStats(chats) {
  let attach = 0, attachN = 0, shots = 0, shotsN = 0;
  for (const c of chats || []) for (const m of c.messages || []) {
    for (const a of m.attachments || []) if (a && typeof a.dataUrl === 'string') { attach += a.dataUrl.length; attachN++; }
    for (const st of m.steps || []) for (const t of st.toolCalls || []) if (t && typeof t.image === 'string') { shots += t.image.length; shotsN++; }
  }
  return { attach, attachN, shots, shotsN };
}

/** Per-process memory from main, plus this window's JS heap and its own process numbers. log: also write it to the app log. */
export async function memoryReport({ log: doLog = false, reason = 'check', chats = null } = {}) {
  if (!api || !api.memoryGet) return null;
  const pm = performance.memory;
  const heap = pm ? { used: pm.usedJSHeapSize, total: pm.totalJSHeapSize, limit: pm.jsHeapSizeLimit } : null;
  let proc = null; try { proc = api.processMemory ? await api.processMemory() : null; } catch {}
  const snap = await api.memoryGet({ heap, proc, log: doLog, reason });
  if (chats) {
    const s = imageStats(chats);
    snap.images = s;
    if (doLog) log('info', 'memory', `Images in chats: ${s.attachN} attachments ${(s.attach / MB).toFixed(1)} MB, ${s.shotsN} screenshots ${(s.shots / MB).toFixed(1)} MB (base64), ${(chats || []).length} chats, ${(chats || []).reduce((n, c) => n + ((c.messages || []).length), 0)} messages`);
  }
  return snap;
}

/** Logs a memory line every 5 minutes. Returns a stop function. getChats() gives the current chats for the image count. */
export function startMemoryLog(getChats) {
  const run = () => { memoryReport({ log: true, reason: 'every 5 min', chats: getChats ? getChats() : null }).catch(() => {}); };
  const first = setTimeout(run, 60000);
  const t = setInterval(run, 5 * 60000);
  return () => { clearTimeout(first); clearInterval(t); };
}

/** A small JPEG copy of a data-URL image (longest side `max` px). Resolves to '' when it cannot be made. */
export async function thumbnail(dataUrl, max = 480, quality = 0.7) {
  try {
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(dataUrl || ''));
    if (!m) return '';
    const bin = atob(m[2]); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: m[1] }));
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    try { bmp.close(); } catch {}
    const out = await c.convertToBlob({ type: 'image/jpeg', quality });
    const url = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result || '')); fr.onerror = () => res(''); fr.readAsDataURL(out); });
    return url && url.length < dataUrl.length ? url : '';
  } catch { return ''; }
}

export const BIG_SHOT = 120 * 1024; // a screenshot larger than this (base64 chars) is shrunk once it is not among the newest ones

/**
 * Screenshots to shrink: tool-call images larger than BIG_SHOT, except the newest `keep` of each chat and chats in `skip`.
 * Returns [{ chatId, toolId, image }].
 */
export function shotsToShrink(chats, { ids = null, keep = 2, skip = [] } = {}) {
  const out = [];
  for (const c of chats || []) {
    if ((ids && !ids.includes(c.id)) || skip.includes(c.id)) continue;
    const list = [];
    for (const m of c.messages || []) for (const st of m.steps || []) for (const t of st.toolCalls || []) {
      if (t && typeof t.image === 'string' && !t.thumb) list.push({ chatId: c.id, toolId: t.id, image: t.image });
    }
    out.push(...list.slice(0, Math.max(0, list.length - keep)).filter((x) => x.image.length > BIG_SHOT));
  }
  return out;
}

/** Replace the given screenshots with thumbnails in a chats array (pure). map: toolId -> { from, to }. */
export function applyThumbs(chats, map) {
  if (!map.size) return chats;
  return chats.map((c) => {
    let hit = false;
    const messages = (c.messages || []).map((m) => {
      if (!m.steps) return m;
      let mHit = false;
      const steps = m.steps.map((st) => {
        let sHit = false;
        const toolCalls = (st.toolCalls || []).map((t) => { const r = t && map.get(t.id); if (r && t.image === r.from) { sHit = true; return { ...t, image: r.to, thumb: true }; } return t; });
        if (!sHit) return st; mHit = true; return { ...st, toolCalls };
      });
      if (!mHit) return m; hit = true; return { ...m, steps };
    });
    return hit ? { ...c, messages } : c;
  });
}
