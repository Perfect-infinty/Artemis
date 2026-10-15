import React, { useEffect, useState } from 'react';
import { askConfirm } from '../../lib/dialog.js';
import ModelPicker from '../ModelPicker.jsx';

export const AGENT_BLANK = { name: '', role: '', description: '', model: '', tools: ['read'], body: '', isNew: true };

export function AgentsTab({ s, set, chatGroups, showToggles = true }) {
  const api = window.api;
  const [list, setList] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ed, setEd] = useState(null);
  const [err, setErr] = useState('');
  const load = async () => { try { setList(await api.agentsList()); } catch {} };
  useEffect(() => { load(); api.agentsGroups().then(setGroups).catch(() => {}); const off = api.onAgentsChanged && api.onAgentsChanged(load); return () => off && off(); }, []);
  const modelLabel = (id) => { if (!id) return 'Same as chat'; for (const g of chatGroups) for (const [mid, n] of g.items) if (mid === id) return n; return id; };
  const save = async () => {
    setErr('');
    const r = await api.agentsSave({ name: ed.name, role: ed.role, description: ed.description, model: ed.model, tools: ed.tools, body: ed.body });
    if (!r.ok) return setErr(r.error);
    setEd(null); load();
  };
  const remove = async (a) => {
    const reset = !!a.overrides;
    if (!(await askConfirm({ title: reset ? 'Reset agent' : 'Delete agent', message: reset ? `Reset "${a.name}" to its default?` : `Delete the agent "${a.name}"?`, confirmLabel: reset ? 'Reset' : 'Delete', danger: true }))) return;
    await api.agentsDelete(a.name); load();
  };
  if (ed) {
    const toggle = (g) => setEd({ ...ed, tools: ed.tools.includes(g) ? ed.tools.filter((x) => x !== g) : [...ed.tools, g] });
    return (
      <>
        <label className="field"><span>Name</span><input value={ed.name} disabled={!ed.isNew} onChange={(e) => setEd({ ...ed, name: e.target.value })} placeholder="Athena" /></label>
        <label className="field"><span>Role</span><input value={ed.role || ''} onChange={(e) => setEd({ ...ed, role: e.target.value })} placeholder="Researcher" /><small>Optional title. You can ask for the agent by name or by role.</small></label>
        <label className="field"><span>What is it for?</span><input value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} placeholder="Finds and checks facts on the web" /><small>One line. Artemis reads this to decide when to hand work to this agent.</small></label>
        <div className="field"><span>Model</span>
          <ModelPicker value={ed.model} groups={chatGroups} onChange={(m) => setEd({ ...ed, model: m })} emptyLabel="Same as chat" up={false} align="left" className="wide" />
          <small>Put cheap jobs (search, summaries) on a cheap model and hard jobs on a strong one. This is what cuts the cost.</small>
        </div>
        <div><div className="muted small" style={{ margin: '12px 0 4px' }}>Tools</div>
          {groups.map((g) => <label key={g.id} className="check"><input type="checkbox" checked={ed.tools.includes(g.id)} onChange={() => toggle(g.id)} /> <span>{g.label}</span></label>)}
        </div>
        <label className="field"><span>Instructions</span><textarea rows={9} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} /></label>
        {err && <small className="hint err">{err}</small>}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={() => setEd(null)}>Cancel</button><button className="primary" onClick={save}>Save agent</button></div>
      </>
    );
  }
  return (
    <>
      {showToggles && (<>
      <label className="check"><input type="checkbox" checked={s.delegateEnabled !== false} onChange={set('delegateEnabled')} /> <span>Let Artemis use agents<br /><small>Artemis plans the work, hands parts to the agents below (up to 4 at once, one level deep) and merges the results. Add "use the Reviewer" to a request to have the output checked.</small></span></label>
      <label className="check"><input type="checkbox" checked={s.agentWriteApproval !== false} onChange={set('agentWriteApproval')} /> <span>Ask before agents write files<br /><small>On: every write by an agent asks you in the chat ("Coder agent wants to..."). Off: agents write without asking when edits are auto-allowed. Deleting is never available to agents.</small></span></label>
      </>)}
      <div className="agent-rows">
        {list.map((a) => (
          <div key={a.slug + a.source} className="agent-row">
            <div className="agent-row-main">
              <b>{a.name}</b>{a.role ? <span className="muted"> · {a.role}</span> : null} <small className="muted">{a.builtin ? 'built-in' : a.overrides ? 'edited' : a.source}</small>
              <div className="muted">{a.description}</div>
              <div className="agent-chips"><span>{modelLabel(a.model)}</span>{a.tools.map((t) => <span key={t}>{t}</span>)}</div>
            </div>
            <button onClick={() => setEd({ ...a })}>Edit</button>
            {!a.builtin && <button onClick={() => remove(a)}>{a.overrides ? 'Reset' : 'Delete'}</button>}
          </div>
        ))}
      </div>
      <div className="actions-row"><button onClick={() => setEd({ ...AGENT_BLANK })}>+ New agent</button><button onClick={() => api.agentsReveal()}>Open agents folder</button></div>
      <small className="hint">Agents are plain .md files (name, description, model, tools, then instructions), like skills. Per-project agents go in &lt;project&gt;/.ares/agents/.</small>
    </>
  );
}
