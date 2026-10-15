import React, { useEffect, useState } from 'react';
import Select from './Select.jsx';
import { askConfirm } from '../lib/dialog.js';
import { Icon } from './Icons.jsx';

const api = window.api;
const blank = () => ({ name: '', description: '', body: '', scope: 'user', isNew: true });

function Editor({ skill, projects, onClose, onSaved }) {
  const [s, setS] = useState(skill);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const root = s.projectFolder || '';
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const r = await api.skillsSave({ name: s.name, description: s.description, body: s.body, scope: s.scope }, root);
      if (!r.ok) return setErr(r.error);
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h2>{s.isNew ? 'New skill' : 'Edit skill'}</h2>
        <label className="field"><span>Name</span><input value={s.name} onChange={set('name')} disabled={!s.isNew} placeholder="Weekly report" /></label>
        <label className="field"><span>When should Artemis use it?</span><input value={s.description} onChange={set('description')} placeholder="Use when I ask for the weekly sales report" /><small>One line. It is shown to the assistant in every chat, so keep it short and specific.</small></label>
        <label className="field"><span>Instructions</span><textarea rows={12} value={s.body} onChange={set('body')} placeholder={'1. Open the latest sales sheet\n2. Summarize totals per region\n3. Write 5 bullet points, no more'} spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} /></label>
        {s.isNew && projects.some((p) => p.folder) && (
          <label className="field"><span>Available in</span>
            <Select value={s.projectFolder || ''} onChange={(e) => setS({ ...s, projectFolder: e.target.value, scope: e.target.value ? 'project' : 'user' })}>
              <option value="">Every chat</option>
              {projects.filter((p) => p.folder).map((p) => <option key={p.id} value={p.folder}>Only in project "{p.name}"</option>)}
            </Select>
          </label>
        )}
        {err && <small className="hint err">{err}</small>}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={onClose}>Cancel</button><button className="primary" onClick={save} disabled={busy}>Save</button></div>
      </div>
    </div>
  );
}

function Hub({ onClose, onInstalled }) {
  const [source, setSource] = useState('clawhub');
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState({});
  const [view, setView] = useState(null); // { item, text }
  const [working, setWorking] = useState('');
  const run = async (src, query) => {
    setBusy(true); setErr('');
    const r = await api.skillHubSearch({ source: src, query });
    setBusy(false);
    if (!r.ok) { setItems([]); return setErr(r.error); }
    setItems(r.items);
  };
  useEffect(() => { run(source, ''); api.skillHubInstalled().then(setDone).catch(() => {}); }, [source]);
  const key = (it) => it.source + ':' + it.id;
  const preview = async (it) => { setView({ item: it, text: 'Loading…' }); const r = await api.skillHubPreview({ source: it.source, id: it.id }); setView({ item: it, text: r.ok ? r.text : r.error }); };
  const install = async (it) => {
    setWorking(key(it)); setErr('');
    const r = await api.skillHubInstall(it);
    setWorking('');
    if (!r.ok) return setErr(r.error);
    setDone((d) => ({ ...d, [key(it)]: r.slug }));
    onInstalled(`Installed "${r.name}".`);
  };
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <h2>Find skills</h2>
        <div className="seg" style={{ marginBottom: 10 }}>
          <button className={source === 'clawhub' ? 'on' : ''} onClick={() => setSource('clawhub')}>OpenClaw · ClawHub</button>
          <button className={source === 'hermes' ? 'on' : ''} onClick={() => setSource('hermes')}>Hermes Agent</button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); run(source, q); }} style={{ display: 'flex', gap: 8 }}>
          <input style={{ flex: 1 }} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={source === 'clawhub' ? 'Search ClawHub (for example: calendar, github, notes)' : 'Search Hermes skills (for example: git, research)'} />
          <button className="primary" disabled={busy}>Search</button>
        </form>
        <small className="muted" style={{ display: 'block', margin: '6px 0' }}>{q ? 'Results' : source === 'clawhub' ? 'Trending on ClawHub' : 'Official Hermes skills'}. Skills are instructions written by other people: open Preview and read one before you install it. Scripts inside a skill only run if you approve them.</small>
        {err && <small className="hint err">{err}</small>}
        <div className="sched-list" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {busy && <div className="muted pad">Searching…</div>}
          {!busy && !err && !items.length && <div className="muted pad">Nothing found.</div>}
          {items.map((it) => (
            <div key={key(it)} className="sched-row">
              <div className="sched-main">
                <div className="sched-name">{it.name}{it.version ? <span className="sched-badge">v{it.version}</span> : null}{it.category ? <span className="sched-badge">{it.category}</span> : null}</div>
                <div className="sched-sub">{it.summary || 'No description'}{it.author ? ` · ${it.author}` : ''}</div>
              </div>
              <button onClick={() => preview(it)}>Preview</button>
              {done[key(it)] ? <button disabled>Installed</button> : <button className="primary" disabled={working === key(it)} onClick={() => install(it)}>{working === key(it) ? 'Installing…' : 'Install'}</button>}
            </div>
          ))}
        </div>
        {view && (
          <div style={{ marginTop: 10 }}>
            <b style={{ fontSize: 12 }}>{view.item.name} · SKILL.md</b>
            <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, whiteSpace: 'pre-wrap', margin: '4px 0 0', padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>{view.text}</pre>
          </div>
        )}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

export default function SkillsView({ projects = [] }) {
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);
  const [hub, setHub] = useState(false);
  const [msg, setMsg] = useState('');
  const folders = projects.filter((p) => p.folder);
  const load = async () => {
    try {
      const out = await api.skillsList();
      for (const p of folders) for (const sk of (await api.skillsList(p.folder)) || []) if (sk.source === 'project') out.push({ ...sk, projectFolder: p.folder, projectName: p.name });
      setList(out);
    } catch {}
  };
  useEffect(() => { load(); const off = api.onSkillsChanged(load); return () => off && off(); }, [projects.length]);
  const open = async (sk) => { const full = await api.skillsGet(sk.name, sk.projectFolder); if (full) setEdit({ ...full, scope: full.source, projectFolder: sk.projectFolder }); };
  const doImport = async () => {
    const r = await api.skillsImport();
    if (r.canceled) return;
    setMsg(r.ok ? `Imported "${r.name}".` : r.error);
    load();
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>Skills</h1>
        <div className="row" style={{ gap: 8, flex: 'none' }}>
          <button onClick={() => setHub(true)}>Find skills</button>
          <button onClick={doImport}>Import…</button>
          <button onClick={() => api.skillsReveal()}>Open folder</button>
          <button className="primary-btn" onClick={() => setEdit(blank())}><Icon name="plus" size={15} /> New skill</button>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>Skills are saved instructions for tasks you repeat. Artemis loads one when it fits your request. It can also write and improve skills itself when you teach it a routine (turn this off in Settings → Tools &amp; safety).</p>
      {msg && <small className="hint">{msg}</small>}
      {list.length === 0 ? (
        <div className="empty-card">
          <Icon name="sparkle" size={28} />
          <p>No skills yet. Write one, import a SKILL.md, or just tell Artemis "remember how to do this" after a task.</p>
          <button className="primary-btn" onClick={() => setEdit(blank())}>Create your first skill</button>
        </div>
      ) : (
        <div className="sched-list">
          {list.map((sk) => (
            <div key={sk.slug + sk.source} className={`sched-row ${sk.enabled ? '' : 'off'}`}>
              <div className="sched-main">
                <div className="sched-name">{sk.name}{sk.byAgent && <span className="sched-badge" title="Written by Artemis">learned</span>}{sk.source === 'project' && <span className="sched-badge">{sk.projectName || 'project'}</span>}</div>
                <div className="sched-sub">{sk.description}</div>
              </div>
              <button className="icon-btn" title="Edit" onClick={() => open(sk)}><Icon name="pencil" size={15} /></button>
              <button className="icon-btn" title="Delete" onClick={() => askConfirm({ title: 'Delete skill', message: `Delete the skill "${sk.name}"?`, confirmLabel: 'Delete', danger: true }).then((ok) => ok && api.skillsDelete(sk.name, sk.projectFolder).then(load))}><Icon name="trash" size={15} /></button>
              <label className="switch" title={sk.enabled ? 'Turn off' : 'Turn on'}><input type="checkbox" checked={sk.enabled} onChange={(e) => api.skillsToggle(sk.name, e.target.checked, sk.projectFolder).then(load)} /><i /></label>
            </div>
          ))}
        </div>
      )}
      {hub && <Hub onClose={() => setHub(false)} onInstalled={(m) => { setMsg(m); load(); }} />}
      {edit && <Editor skill={edit} projects={projects} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}
