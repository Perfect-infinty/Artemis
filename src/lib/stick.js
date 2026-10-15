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
