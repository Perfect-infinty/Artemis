import React, { useState } from 'react';
import Select from '../Select.jsx';
import { askConfirm } from '../../lib/dialog.js';
import { Field } from '../Modals.jsx';

export const MAKE_ZONES = ['eu1.make.com', 'eu2.make.com', 'us1.make.com', 'us2.make.com', 'eu1.make.celonis.com', 'eu2.make.celonis.com', 'us1.make.celonis.com'];

export function MakeTab({ s, setS }) {
  const [zone, setZone] = useState(s.makeZone || 'eu1.make.com');
  const [token, setToken] = useState('');
  const [has, setHas] = useState(!!s.hasMakeToken);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const custom = !MAKE_ZONES.includes(zone);
  const run = async () => {
    setBusy(true); setRes(null);
    try {
      const saved = await window.api.makeSave({ zone, token });
      if (!saved.ok) { setRes({ ok: false, error: saved.error }); return; }
      setHas(saved.hasToken); setS((x) => ({ ...x, makeZone: saved.zone, hasMakeToken: saved.hasToken })); setToken('');
      setRes(await window.api.makeTest({ zone: saved.zone }));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await askConfirm({ title: 'Disconnect Make', message: 'Remove the saved Make API token from this computer?', confirmLabel: 'Remove', danger: true }))) return;
    await window.api.makeClear(); setHas(false); setRes(null); setS((x) => ({ ...x, hasMakeToken: false }));
  };
  return (
    <>
      <p className="muted small">Lets Artemis list, read, create, change, switch on/off and run your Make scenarios when you ask. Creating, changing and running always ask for approval first.</p>
      <label className="check"><input type="checkbox" checked={s.makeEnabled !== false} onChange={(e) => setS((x) => ({ ...x, makeEnabled: e.target.checked }))} /> <span>Use Make in chats</span></label>
      <Field label="Zone" hint="The address you see when you are logged in to Make, e.g. eu1.make.com.">
        <div className="row">
          <Select value={custom ? '__custom' : zone} onChange={(e) => setZone(e.target.value === '__custom' ? '' : e.target.value)}>
            {MAKE_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            <option value="__custom">Other…</option>
          </Select>
          {custom && <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="eu1.make.com" />}
        </div>
      </Field>
      <Field label="API token" hint={has ? 'A token is saved. Paste a new one to replace it.' : 'Make → your profile → API → Add token. Give it the scopes Artemis should use (scenarios: read, write, run; connections: read; teams and organizations: read). Needs a paid Make plan for most endpoints.'}>
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={has ? '••••••••••••' : 'Paste token'} />
      </Field>
      <div className="row">
        <button className="primary" onClick={run} disabled={busy || (!token.trim() && !has)}>{busy ? 'Testing…' : 'Save & test'}</button>
        {has && <button className="danger" onClick={remove}>Remove token</button>}
      </div>
      {res && !res.ok && <div className="error">{res.error}</div>}
      {res && res.ok && (
        <div className="make-res">
          <strong>Connected.</strong>{!res.orgs.length && ' No organizations were returned for this token.'}
          {res.orgs.map((o) => (
            <div key={o.id} className="make-org"><b>{o.name}</b> <span className="muted small">(organization {o.id})</span>
              {o.teams.map((t) => <div key={t.id} className="muted small">Team: {t.name} · id {t.id}</div>)}
            </div>
          ))}
        </div>
      )}
      <small className="hint">The token is stored encrypted on this computer and is never written to chats or files.</small>
    </>
  );
}
