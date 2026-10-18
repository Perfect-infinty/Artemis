import React, { useState } from 'react';
import Select from '../Select.jsx';
import { askConfirm } from '../../lib/dialog.js';
import { Group, Row, SwitchRow, Note } from './ui.jsx';

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
      <Note>Lets Artemis list, read, create, change, switch on/off and run your Make scenarios when you ask. Creating, changing and running always ask for approval first.</Note>
      <Group>
        <SwitchRow label="Use Make in chats" checked={s.makeEnabled !== false} onChange={(v) => setS((x) => ({ ...x, makeEnabled: v }))} />
      </Group>
      <Group title="Connection" footer="The token is stored encrypted on this computer and is never written to chats or files. Zone and token are saved with Save & test.">
        <Row label="Zone" description="The address you see when you are logged in to Make, e.g. eu1.make.com.">
          <div className="pref-inline">
            <Select value={custom ? '__custom' : zone} onChange={(e) => setZone(e.target.value === '__custom' ? '' : e.target.value)} aria-label="Make zone">
              {MAKE_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
              <option value="__custom">Other…</option>
            </Select>
            {custom && <input className="pref-input" value={zone} onChange={(e) => setZone(e.target.value)} placeholder="eu1.make.com" aria-label="Custom Make zone" spellCheck={false} />}
          </div>
        </Row>
        <Row stacked label="API token" description={has ? 'A token is saved. Paste a new one to replace it.' : 'Make → your profile → API → Add token. Give it the scopes Artemis should use (scenarios: read, write, run; connections: read; teams and organizations: read). Needs a paid Make plan for most endpoints.'}>
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy && (token.trim() || has)) run(); }} placeholder={has ? '••••••••••••' : 'Paste token'} />
        </Row>
        <Row label={res && res.ok ? 'Connected' : 'Test'} error={res && !res.ok ? res.error : ''}
          description={res && res.ok ? (res.orgs.length ? res.orgs.map((o) => <span key={o.id} className="make-org"><b>{o.name}</b> (organization {o.id}){o.teams.map((t) => <span key={t.id}> · Team: {t.name} · id {t.id}</span>)}</span>) : 'No organizations were returned for this token.') : 'Saves the zone and token, then checks them.'}>
          <div className="pref-inline">
            {has && <button type="button" className="pref-btn danger" onClick={remove}>Remove token</button>}
            <button type="button" className="pref-btn primary" onClick={run} disabled={busy || (!token.trim() && !has)}>{busy ? 'Testing…' : 'Save & test'}</button>
          </div>
        </Row>
      </Group>
    </>
  );
}
