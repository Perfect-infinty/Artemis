import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { askConfirm } from '../../lib/dialog.js';
import ModelPicker from '../ModelPicker.jsx';
import { Group, Row, Note, Buttons } from './ui.jsx';

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
        <Group title={ed.name}>
          <Row label="Name"><input value={ed.name} disabled /></Row>
          <Row label="Role"><input value={ed.role || ''} onChange={(e) => setEd({ ...ed, role: e.target.value })} /></Row>
          <Row stacked label="What is it good at?" description="The council reads this line when it decides who should answer."><input value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} /></Row>
          <Row label="Model" description="This brain answers with this model, whatever model the chat uses.">
            <ModelPicker value={ed.model} groups={chatGroups} onChange={(m) => setEd({ ...ed, model: m })} emptyLabel="Same as chat" up={false} align="right" />
          </Row>
        </Group>
        <Group title="Personality">
          <Row stacked><textarea rows={8} className="mono" aria-label="Personality" value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} spellCheck={false} /></Row>
        </Group>
        {err && <Note tone="err">{err}</Note>}
        <Buttons end><button type="button" className="pref-btn" onClick={() => setEd(null)}>Cancel</button><button type="button" className="pref-btn primary" onClick={save}>Save brain</button></Buttons>
      </>
    );
  }
  return (
    <>
      <Note>Three brains with their own personality and model. In a chat, pick one from the brain menu next to the model, or pick Council: the three vote on who answers and which skills and agents to use (a vote costs a few thousand tokens). The council's choice sticks for the chat until you press Re-vote.</Note>
      <Group>
        <Row label="Default brain for new chats" description="Council is never the default unless you choose it here. Telegram and scheduled tasks use this brain too (Council only works in the app).">
          <Select value={s.defaultBrain || ''} onChange={(e) => setS((x) => ({ ...x, defaultBrain: e.target.value }))}>
            <option value="">No brain (plain Artemis)</option>
            <option value="council">Council (vote)</option>
            {list.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </Select>
        </Row>
      </Group>
      <Group title="Brains">
        {list.map((b) => (
          <Row key={b.slug} label={<>{b.name}{b.role ? <span className="pref-dim"> · {b.role}</span> : null} <span className="pref-tag">{b.overrides ? 'edited' : 'built-in'}</span></>}
            description={<>{b.description}<span className="agent-chips"><span>{modelLabel(b.model)}</span></span></>}>
            <div className="pref-inline">
              <button type="button" className="pref-btn" onClick={() => setEd({ ...b })} aria-label={'Edit ' + b.name}>Edit…</button>
              {b.overrides && <button type="button" className="pref-btn" onClick={() => reset(b)}>Reset</button>}
            </div>
          </Row>
        ))}
      </Group>
    </>
  );
}
