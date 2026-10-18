import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Keep a scroll container pinned to its bottom while its content grows (streaming text, code highlighting, images, late layout).
// stick is a ref whose .current says whether the user is following the end of the conversation. Returns a cleanup function.
export function observeBottom(el, stick) {
  if (!el || typeof ResizeObserver === 'undefined') return () => {};
  let raf = 0;
  const go = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
  };
  const ro = new ResizeObserver(go);
  const watch = () => { for (const c of el.children) ro.observe(c); };
  watch();
  ro.observe(el);
  const mo = new MutationObserver(() => { watch(); go(); });
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); };
}

const NEAR = 4; // px from the bottom that still counts as "at the end"
export const atBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR;

/**
 * Only the user unpins: an upward wheel, a touch drag, PageUp / ArrowUp / Home, or dragging the scrollbar.
 * Growing content never unpins (that was the old "fight": a big chunk arrived, the distance passed a threshold, and following stopped).
 * Scrolling back to within a few px of the bottom pins again. onChange(stuck) is told about every change.
 */
export function watchIntent(el, stick, onChange) {
  if (!el) return () => {};
  const set = (v) => { if (stick.current !== v) { stick.current = v; onChange && onChange(v); } };
  let dragging = false;
  let touchY = null;
  const wheel = (e) => { if (e.deltaY < 0) set(false); };
  const touchstart = (e) => { touchY = e.touches && e.touches[0] ? e.touches[0].clientY : null; };
  const touchmove = (e) => { const y = e.touches && e.touches[0] ? e.touches[0].clientY : null; if (y != null && touchY != null && y > touchY) set(false); touchY = y; };
  const key = (e) => {
    if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'Home') set(false);
  };
  // a press on the scrollbar itself (outside the content box) is the start of a drag
  const down = (e) => { if (e.target === el && e.offsetX >= el.clientWidth) dragging = true; };
  const up = () => { dragging = false; };
  const scroll = () => {
    if (atBottom(el)) set(true);
    else if (dragging) set(false);
  };
  el.addEventListener('wheel', wheel, { passive: true });
  el.addEventListener('touchstart', touchstart, { passive: true });
  el.addEventListener('touchmove', touchmove, { passive: true });
  el.addEventListener('keydown', key);
  el.addEventListener('mousedown', down);
  window.addEventListener('mouseup', up);
  el.addEventListener('scroll', scroll, { passive: true });
  return () => {
    el.removeEventListener('wheel', wheel); el.removeEventListener('touchstart', touchstart); el.removeEventListener('touchmove', touchmove);
    el.removeEventListener('keydown', key); el.removeEventListener('mousedown', down); window.removeEventListener('mouseup', up);
    el.removeEventListener('scroll', scroll);
  };
}

/**
 * Follow the end of a message list. ref: the scroll container, stick: a ref (shared with callers that force following, e.g. on send),
 * resetKey: changes when another chat / tab is shown, content: the current chat's messages (not every chat).
 * Returns { unseen, jump }: unseen is true when new content arrived while the user was reading above.
 */
export function useFollow(ref, stick, resetKey, content) {
  const [unseen, setUnseen] = useState(false);
  const lastKey = useRef(resetKey);
  useLayoutEffect(() => {
    const el = ref.current;
    const switched = lastKey.current !== resetKey; lastKey.current = resetKey;
    if (switched) stick.current = true;
    if (!el) return;
    if (stick.current) { el.scrollTop = el.scrollHeight; setUnseen(false); }
    else if (!switched) setUnseen(true);
  }, [content, resetKey]);
  // (re)attach whenever the container element itself changes: a key change, the list appearing after loading, or an error boundary remount
  const attached = useRef({ el: null, off: null });
  useEffect(() => {
    const el = ref.current; const a = attached.current;
    if (el === a.el) return;
    if (a.off) a.off();
    a.el = el; a.off = null;
    if (!el) return;
    const off1 = observeBottom(el, stick);
    const off2 = watchIntent(el, stick, (v) => { if (v) setUnseen(false); });
    a.off = () => { off1(); off2(); };
  });
  useEffect(() => () => { const a = attached.current; if (a.off) a.off(); a.el = null; a.off = null; }, []);
  const jump = () => {
    const el = ref.current; stick.current = true; setUnseen(false);
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { el.scrollTo({ top: el.scrollHeight, behavior: reduce ? 'auto' : 'smooth' }); } catch { el.scrollTop = el.scrollHeight; }
  };
  return { unseen, jump };
}
