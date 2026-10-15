import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { askConfirm } from '../../lib/dialog.js';
import ModelPicker from '../ModelPicker.jsx';
import { Field } from '../Modals.jsx';

export function BrainsTab({ s, setS, chatGroups }) {
  const api = window.api;
  const [list, setList] = useState([]);
  const [ed, setEd] = useState(null);
  const [err, setErr] = useState('');
  const load = async () => { try { setList(await api.brainsList()); } catch {} };
  useEffect(() => { load(); const off = api.onBrainsChanged && api.onBrainsChanged(load); return () => off && off(); }, []);
  const modelLabel = (id) => { if (!id) return 'Same as chat'; for (const g of chatGroups) for (const [mid, n] of g.items) if (mid === id) return n; return id; };
  const save = async () => { setErr(''); const r = await api.brainsSave({ name: ed.name, role: ed.role, description: ed.description, model: ed.model, body: ed.body }); if (!r.ok) return setErr(r.error); setEd(null); load(); };
  const reset = async (b) => { if (!(await askConfirm({ title: 'Reset brain', message: `Reset "${b.name}" to its default personality and model?`, confirmLabel: 'Reset', danger: true }))) return; await api.brainsDelete(b.name); load(); };
  if (ed) {
    return (
      <>
        <label className="field"><span>Name</span><input value={ed.name} disabled /></label>
        <label className="field"><span>Role</span><input value={ed.role || ''} onChange={(e) => setEd({ ...ed, role: e.target.value })} /></label>
        <label className="field"><span>What is it good at?</span><input value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} /><small>The council reads this line when it decides who should answer.</small></label>
        <div className="field"><span>Model</span>
          <ModelPicker value={ed.model} groups={chatGroups} onChange={(m) => setEd({ ...ed, model: m })} emptyLabel="Same as chat" up={false} align="left" className="wide" />
          <small>This brain answers with this model, whatever model the chat uses.</small>
        </div>
        <label className="field"><span>Personality</span><textarea rows={8} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} /></label>
        {err && <small className="hint err">{err}</small>}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={() => setEd(null)}>Cancel</button><button className="primary" onClick={save}>Save brain</button></div>
      </>
    );
  }
  return (
    <>
      <p className="muted small">Three brains with their own personality and model. In a chat, pick one from the brain menu next to the model, or pick Council: the three vote on who answers and which skills and agents to use (a vote costs a few thousand tokens). The council's choice sticks for the chat until you press Re-vote.</p>
      <Field label="Default brain for new chats" hint="Council is never the default unless you choose it here. Telegram and scheduled tasks use this brain too (Council only works in the app).">
        <Select value={s.defaultBrain || ''} onChange={(e) => setS((x) => ({ ...x, defaultBrain: e.target.value }))}>
          <option value="">No brain (plain Artemis)</option>
          <option value="council">Council (vote)</option>
          {list.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </Select>
      </Field>
      <div className="agent-rows">
        {list.map((b) => (
          <div key={b.slug} className="agent-row">
            <div className="agent-row-main">
              <b>{b.name}</b>{b.role ? <span className="muted"> · {b.role}</span> : null} <small className="muted">{b.overrides ? 'edited' : 'built-in'}</small>
              <div className="muted">{b.description}</div>
              <div className="agent-chips"><span>{modelLabel(b.model)}</span></div>
            </div>
            <button onClick={() => setEd({ ...b })}>Edit</button>
            {b.overrides && <button onClick={() => reset(b)}>Reset</button>}
          </div>
        ))}
      </div>
    </>
  );
}
