import React, { useEffect, useRef } from 'react';
import { Icon } from './Icons.jsx';

/** A small right-click menu. items: [{ label, onClick, danger?, disabled? } | { sep: true }] */
export function ContextMenu({ menu, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => { if (e && e.type === 'mousedown' && ref.current && ref.current.contains(e.target)) return; onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', close); window.addEventListener('blur', close); window.addEventListener('resize', close); window.addEventListener('keydown', key); window.addEventListener('wheel', close, { passive: true });
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('resize', close); window.removeEventListener('keydown', key); window.removeEventListener('wheel', close); };
  }, [menu]);
  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 230), y = Math.min(menu.y, window.innerHeight - (menu.items.length * 30 + 16));
  return (
    <div className="ctx-menu" ref={ref} style={{ left: x, top: y }} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) => it.sep
        ? <div key={i} className="ctx-sep" />
        : <button key={i} className={`ctx-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>{it.label}{it.hint ? <span className="ctx-hint">{it.hint}</span> : null}</button>)}
    </div>
  );
}

/** The row of tabs under the top bar. info(tab) returns { title, icon, running, awaiting }. */
export default function TabBar({ tabs, active, info, onSelect, onClose, onNew, onMenu }) {
  const strip = useRef(null);
  useEffect(() => { const el = strip.current && strip.current.querySelector('.atab.on'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [active, tabs.length]);
  const ordered = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
  return (
    <div className="tabbar nodrag" onContextMenu={(e) => { if (e.target === e.currentTarget || e.target === strip.current) { e.preventDefault(); onMenu(e, null); } }}>
      <div className="atabs" ref={strip} onWheel={(e) => { if (strip.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) strip.current.scrollLeft += e.deltaY; }}>
        {ordered.map((t, i) => {
          const f = info(t);
          return (
            <div key={t.id} className={`atab ${t.id === active ? 'on' : ''} ${t.pinned ? 'pinned' : ''} ${f.awaiting ? 'awaiting' : f.running ? 'running' : ''}`} title={f.title}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(t.id); } }}
              onClick={() => onSelect(t.id)} onContextMenu={(e) => { e.preventDefault(); onMenu(e, t.id); }}>
              <Icon name={f.running ? 'spinner' : f.awaiting ? 'warning' : f.icon} size={14} className="atab-ico" />
              {!t.pinned && <span className="atab-title">{f.title}</span>}
              {t.pinned ? <Icon name="pin" size={10} className="atab-pin" /> : <button className="atab-x" title="Close tab (⌘W)" onClick={(e) => { e.stopPropagation(); onClose(t.id); }}><Icon name="x" size={12} /></button>}
              {i < 9 ? <span className="atab-key">{i + 1}</span> : null}
            </div>
          );
        })}
      </div>
      <button className="atab-new" title="New tab (⌘T)" onClick={onNew}><Icon name="plus" size={15} /></button>
    </div>
  );
}
