import React, { useEffect, useRef, useState } from 'react';
import { setDialogHandler } from '../lib/dialog.js';

export default function DialogHost() {
  const [d, setD] = useState(null);
  const okRef = useRef(null);
  useEffect(() => { setDialogHandler((x) => setD(x)); return () => setDialogHandler(null); }, []);
  const done = (v) => { if (!d) return; d.resolve(v); setD(null); };
  useEffect(() => {
    if (!d) return undefined;
    okRef.current && okRef.current.focus();
    const h = (e) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); done(false); }
      else if (e.key === 'Enter') { e.stopImmediatePropagation(); e.preventDefault(); done(true); }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [d]);
  if (!d) return null;
  return (
    <div className="overlay dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) done(false); }}>
      <div className="modal dialog" role="alertdialog" aria-modal="true">
        {d.title && <h2>{d.title}</h2>}
        <p className="dialog-msg">{d.message}</p>
        <div className="actions-row">
          {d.cancelLabel !== '' && <button onClick={() => done(false)}>{d.cancelLabel || 'Cancel'}</button>}
          <button ref={okRef} className={d.danger ? 'danger-solid' : 'primary'} onClick={() => done(true)}>{d.confirmLabel || 'OK'}</button>
        </div>
      </div>
    </div>
  );
}
