// Drag-to-resize helper. onMove receives the pointer's clientX.
export function startDrag(e, onMove, onEnd) {
  e.preventDefault();
  document.body.classList.add('resizing');
  const mv = (ev) => onMove(ev.clientX);
  const up = () => {
    window.removeEventListener('mousemove', mv);
    window.removeEventListener('mouseup', up);
    document.body.classList.remove('resizing');
    onEnd && onEnd();
  };
  window.addEventListener('mousemove', mv);
  window.addEventListener('mouseup', up);
}
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function loadWidth(key, def) { try { const n = Number(localStorage.getItem(key)); return n > 0 ? n : def; } catch { return def; } }
export function saveWidth(key, w) { try { localStorage.setItem(key, String(Math.round(w))); } catch { /* yoksay */ } }
