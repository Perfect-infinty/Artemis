import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { ContextMenu } from './TabBar.jsx';

const IDEAL = 120; // spring length between linked notes, in px

// Small force-directed layout (Fruchterman-Reingold): nodes push each other away, links pull them together.
function layout(nodes, edges, w, h, prev) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  let seed = nodes.length * 9301 + 49297;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const pos = nodes.map((n) => (prev && prev.get(n.id)) || { x: w / 2 + (rnd() - 0.5) * w * 0.6, y: h / 2 + (rnd() - 0.5) * h * 0.6 });
  const iters = prev && prev.size ? 80 : 300;
  const k = IDEAL;
  for (let it = 0; it < iters; it++) {
    const d = nodes.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, dist = Math.hypot(dx, dy) || 0.01, f = (k * k) / dist;
      d[i].x += (dx / dist) * f; d[i].y += (dy / dist) * f; d[j].x -= (dx / dist) * f; d[j].y -= (dy / dist) * f;
    }
    for (const e of edges) {
      const i = idx.get(e.from), j = idx.get(e.to);
      if (i == null || j == null || i === j) continue;
      const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y, dist = Math.hypot(dx, dy) || 0.01, f = (dist * dist) / k;
      d[i].x -= (dx / dist) * f; d[i].y -= (dy / dist) * f; d[j].x += (dx / dist) * f; d[j].y += (dy / dist) * f;
    }
    const temp = Math.max((w / 10) * (1 - it / iters), 0.5);
    for (let i = 0; i < nodes.length; i++) {
      const dist = Math.hypot(d[i].x, d[i].y) || 0.01, cap = Math.min(dist, temp);
      pos[i].x = Math.min(w - 30, Math.max(30, pos[i].x + (d[i].x / dist) * cap));
      pos[i].y = Math.min(h - 30, Math.max(30, pos[i].y + (d[i].y / dist) * cap));
    }
  }
  return pos;
}

/** All notes as dots, joined by their [[links]]. Click a dot to open the note (or create it when it is only linked, not written yet). */
export default function NoteGraph({ rev, onOpen, onCreate }) {
  const [graph, setGraph] = useState({ nodes: [], edges: [] });
  const [pos, setPos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState(null);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(null);
  const wrap = useRef(null), svg = useRef(null), drag = useRef(null), moved = useRef(false), viewRef = useRef(view);
  viewRef.current = view;

  const fit = useCallback((p) => {
    const el = wrap.current;
    if (!el || !p.length) return;
    const r = el.getBoundingClientRect();
    const xs = p.map((a) => a.x), ys = p.map((a) => a.y);
    const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 60;
    const k = Math.min(1.4, Math.max(0.2, Math.min(r.width / (x1 - x0), r.height / (y1 - y0))));
    setView({ k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k });
  }, []);

  const prevPos = useRef(new Map());
  const load = useCallback(async () => {
    const r = await window.api.notesGraph();
    if (!r || !r.ok) { setLoading(false); return; }
    const side = Math.max(500, Math.sqrt(Math.max(r.nodes.length, 1)) * 200);
    const same = r.nodes.length === prevPos.current.size && r.nodes.every((n) => prevPos.current.has(n.id));
    const p = layout(r.nodes, r.edges, side * 1.4, side, same ? prevPos.current : prevPos.current.size ? prevPos.current : null);
    prevPos.current = new Map(r.nodes.map((n, i) => [n.id, p[i]]));
    setGraph({ nodes: r.nodes, edges: r.edges });
    setPos(p);
    setLoading(false);
    if (!same) requestAnimationFrame(() => fit(p));
  }, [fit]);
  useEffect(() => { load(); }, [load, rev]);

  // wheel zoom around the cursor (needs a non-passive listener to stop the page from scrolling)
  useEffect(() => {
    const el = svg.current;
    if (!el) return undefined;
    const wheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect(), v = viewRef.current;
      const k = Math.min(3, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView({ k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k });
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [loading, graph.nodes.length]);

  const index = useMemo(() => new Map(graph.nodes.map((n, i) => [n.id, i])), [graph.nodes]);
  const degree = useMemo(() => { const d = new Map(); for (const e of graph.edges) { d.set(e.from, (d.get(e.from) || 0) + 1); d.set(e.to, (d.get(e.to) || 0) + 1); } return d; }, [graph.edges]);
  const near = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of graph.edges) { if (e.from === hover) s.add(e.to); if (e.to === hover) s.add(e.from); }
    return s;
  }, [hover, graph.edges]);
  const ql = q.trim().toLowerCase();
  const local = (e) => { const r = svg.current.getBoundingClientRect(), v = viewRef.current; return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k }; };

  const down = (e, i) => { if (e.button !== 0) return; e.stopPropagation(); const l = local(e); moved.current = false; drag.current = { t: 'node', i, ox: pos[i].x - l.x, oy: pos[i].y - l.y, sx: e.clientX, sy: e.clientY }; };
  const bgDown = (e) => { if (e.button !== 0) return; drag.current = { t: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.t === 'node') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) moved.current = true;
      const l = local(e);
      setPos((p) => { const n = p.slice(); n[d.i] = { x: l.x + d.ox, y: l.y + d.oy }; return n; });
    } else setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
  };
  const up = () => { const d = drag.current; drag.current = null; if (d && d.t === 'node') prevPos.current = new Map(graph.nodes.map((n, i) => [n.id, pos[i]])); };

  const open = (n, how) => { if (n.exists) onOpen(n.path, how); else if (onCreate) onCreate(n.name); };
  const nodeMenu = (e, n) => {
    e.preventDefault(); e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: n.exists
      ? [{ label: 'Open', onClick: () => onOpen(n.path, 'here') }, { label: 'Open in new tab', hint: '⌘-click', onClick: () => onOpen(n.path, 'tab') }, { label: 'Open in split view', onClick: () => onOpen(n.path, 'split') }]
      : [{ label: `Create “${n.name}”`, onClick: () => onCreate && onCreate(n.name) }] });
  };

  return (
    <div className="graph-page">
      <div className="notes-bar">
        <Icon name="graph" size={16} />
        <b className="notes-title">Graph</b>
        <span className="muted small">{graph.nodes.filter((n) => n.exists).length} notes · {graph.edges.length} links</span>
        <span style={{ flex: 1 }} />
        <input className="graph-filter" placeholder="Filter notes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button title="Reload" aria-label="Reload" onClick={load}><Icon name="refresh" size={14} /></button>
        <button title="Fit to screen" aria-label="Fit to screen" onClick={() => fit(pos)}><Icon name="expand" size={14} /></button>
      </div>
      <div className="graph-wrap" ref={wrap}>
        {loading ? <div className="notes-empty muted">Loading graph…</div>
          : !graph.nodes.length ? <div className="notes-empty"><b>No notes yet</b><span>Write a few notes and link them with [[Note name]] to see them connected here.</span></div>
          : (
            <svg ref={svg} className="graph-svg" onMouseDown={bgDown} onMouseMove={move} onMouseUp={up} onMouseLeave={up}>
              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {graph.edges.map((e, i) => {
                  const a = pos[index.get(e.from)], b = pos[index.get(e.to)];
                  if (!a || !b) return null;
                  const lit = near && (e.from === hover || e.to === hover);
                  return <line key={i} className={'graph-edge' + (lit ? ' lit' : near ? ' dim' : '')} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
                })}
                {graph.nodes.map((n, i) => {
                  const p = pos[i];
                  if (!p) return null;
                  const r = 6 + Math.min((degree.get(n.id) || 0) * 2, 14);
                  const dim = (near && !near.has(n.id)) || (ql && !n.name.toLowerCase().includes(ql));
                  return (
                    <g key={n.id} className={'graph-node' + (n.exists ? '' : ' ghost') + (dim ? ' dim' : '') + (hover === n.id ? ' hot' : '')} transform={`translate(${p.x} ${p.y})`}
                      onMouseDown={(e) => down(e, i)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                      onClick={(e) => { e.stopPropagation(); if (moved.current) { moved.current = false; return; } open(n, e.metaKey || e.ctrlKey ? 'tab' : 'here'); }}
                      onContextMenu={(e) => nodeMenu(e, n)}
                      onAuxClick={(e) => { if (e.button === 1) { e.stopPropagation(); open(n, 'tab'); } }}>
                      <circle r={r} />
                      <text y={r + 14}>{n.name}</text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
