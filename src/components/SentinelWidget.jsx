import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import SentinelPill from './SentinelPill.jsx';
import { applyTextSize, applyTheme, loadThemes } from '../lib/themes.js';

/** Contents of the floating Sentinel window (see electron/sentinel-widget.js). */
export default function SentinelWidget() {
  const api = window.api;
  const [info, setInfo] = useState({ state: 'off' });
  const box = useRef(null);
  const [big, setBig] = useState(() => { try { return localStorage.getItem('sn-big') === '1'; } catch { return false; } });
  const toggle = () => setBig((b) => { try { localStorage.setItem('sn-big', b ? '0' : '1'); } catch {} return !b; });
  useEffect(() => {
    document.documentElement.classList.add('sw-root');
    api.getSettings().then((s) => { applyTextSize(s.textSize); loadThemes(api).then((t) => applyTheme(s.theme, t)); }).catch(() => {});
    api.sentinelCurrent().then((i) => i && setInfo(i)).catch(() => {});
    const o1 = api.onSentinelState((i) => setInfo(i || { state: 'off' }));
    const o2 = api.onSentinelLevel((v) => window.dispatchEvent(new CustomEvent('sentinel-level', { detail: v })));
    return () => { o1 && o1(); o2 && o2(); };
  }, []);
  useLayoutEffect(() => { if (box.current) api.sentinelResize(box.current.offsetHeight + 8, big); }, [info, big]);
  const act = (a) => () => api.sentinelAction(a);
  return (
    <div ref={box} style={{ display: 'inline-block', width: '100%' }}>
      <SentinelPill floating expanded={big} onToggle={toggle} state={info.state} info={info.info} err={info.err} heard={info.heard} said={info.said} onStop={act('stop')} onSkip={act('skip')} onDismiss={act('dismiss')} onSettings={act('settings')} onLogs={act('logs')} />
    </div>
  );
}
