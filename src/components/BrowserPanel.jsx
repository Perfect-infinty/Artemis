import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';

const api = window.api;

/** Turns what the user typed into a URL (adds https://, or searches when it is not a link). */
export function toUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(t) || /^localhost(:\d+)?(\/.*)?$/.test(t)) return 'https://' + t;
  return 'https://www.google.com/search?q=' + encodeURIComponent(t);
}

export default function BrowserPanel({ url, onUrl, onClose, full = false }) {
  const body = useRef(null);
  const [text, setText] = useState(url);
  useEffect(() => { setText(url); }, [url]);

  // the native web view is laid over this empty box, so keep its bounds in sync
  useEffect(() => {
    const send = () => {
      const el = body.current; if (!el) return;
      const r = el.getBoundingClientRect();
      api.browserBounds({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(body.current);
    window.addEventListener('resize', send);
    const t = setTimeout(send, 60);
    const off = api.onBrowserUrl((u) => { onUrl(u); });
    return () => { ro.disconnect(); window.removeEventListener('resize', send); clearTimeout(t); off?.(); };
  }, []);

  const go = () => { const u = toUrl(text); if (u) { onUrl(u); api.browserNavigate(u); } };
  return (
    <aside className={`browser-panel ${full ? 'full' : ''}`}>
      <div className="bp-bar">
        <button className="icon-btn" title="Back" onClick={() => api.browserNav('back')}><Icon name="arrowRight" size={16} style={{ transform: 'scaleX(-1)' }} /></button>
        <button className="icon-btn" title="Forward" onClick={() => api.browserNav('forward')}><Icon name="arrowRight" size={16} /></button>
        <button className="icon-btn" title="Reload" onClick={() => api.browserNav('reload')}><Icon name="refresh" size={15} /></button>
        <input className="bp-url" value={text} spellCheck={false} placeholder="Search or enter address" onChange={(e) => setText(e.target.value)} onFocus={(e) => e.target.select()} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} />
        <button className="icon-btn" title="Open in your browser" onClick={() => api.openExternalUrl(toUrl(text))}><Icon name="external" size={15} /></button>
        <button className="icon-btn" title="Close" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>
      <div className="bp-body" ref={body} />
    </aside>
  );
}
