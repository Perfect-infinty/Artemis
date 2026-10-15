import React, { useEffect, useState } from 'react';
import { Icon } from './Icons.jsx';
import Composer from './Composer.jsx';
import { dayGroup } from '../lib/history.js';
import { costOf, fmtUsd } from '../lib/cost.js';

const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const when = (t) => { if (!t) return ''; const d = new Date(t); const same = d.toDateString() === new Date().toDateString(); return (same ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };

function Widget({ title, icon, action, onAction, children, wide }) {
  return (
    <section className={'hw' + (wide ? ' wide' : '')}>
      <header className="hw-head"><Icon name={icon} size={15} /> <span>{title}</span>{action && <button className="link-btn hw-act" onClick={onAction}>{action}</button>}</header>
      <div className="hw-body">{children}</div>
    </section>
  );
}

// The Home page: a chat box plus small widgets for everything in the app.
export default function HomeView({ chats, projects, notes, settings, memoryCount, connectorCount, sentinel, agentCount, statusOf, onSend, onOpenChat, onOpenProject, onOpenNote, onGo, composerProps }) {
  const [jobs, setJobs] = useState([]);
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      Promise.resolve(window.api.scheduleList && window.api.scheduleList()).then((j) => live && setJobs(Array.isArray(j) ? j : [])).catch(() => {});
      Promise.resolve(window.api.usageGet && window.api.usageGet()).then((r) => live && setUsage(Array.isArray(r) ? r : [])).catch(() => live && setUsage([]));
    };
    load(); const id = setInterval(load, 30000);
    return () => { live = false; clearInterval(id); };
  }, []);

  const recent = chats.filter((c) => c.messages.length && !c.incognito).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const pinnedProjects = projects.filter((p) => p.pinned);
  const shownProjects = (pinnedProjects.length ? pinnedProjects : projects).slice(0, 5);
  const recentNotes = (notes.items || []).filter((i) => !i.dir).sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 5);
  const upcoming = jobs.filter((j) => j.enabled && j.nextRun).sort((a, b) => a.nextRun - b.nextRun).slice(0, 4);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sum = (since) => (usage || []).filter((r) => r.t >= since).reduce((a, r) => ({ tok: a.tok + (r.prompt || 0) + (r.completion || 0), cost: a.cost + costOf(r) }), { tok: 0, cost: 0 });
  const dayU = sum(today.getTime()); const monthU = sum(Date.now() - 30 * 864e5);
  const running = chats.filter((c) => statusOf(c) === 'running');
  const name = (settings.profileName || '').split(' ')[0];

  return (
    <div className="page home-page">
      <h1 className="home-title">{greet()}{name ? ', ' + name : ''}</h1>
      <div className="home-compose">
        <Composer key="home" streaming={false} onStop={() => {}} onSend={onSend} placeholder="Ask anything, start a new chat…" {...composerProps} />
      </div>

      <div className="hw-grid">
        <Widget title="Recent chats" icon="chat" action="New chat" onAction={() => onGo('newchat')} wide>
          {recent.length === 0 ? <div className="muted small">No chats yet. Type above to start one.</div> : recent.map((c) => {
            const st = statusOf(c);
            return (
              <button key={c.id} className="hw-row" onClick={() => onOpenChat(c.id)}>
                <Icon name={st === 'running' ? 'spinner' : st === 'awaiting' ? 'warning' : 'chat'} size={14} />
                <span className="t">{c.title}</span><span className="muted small">{dayGroup(c.updatedAt)}</span>
              </button>
            );
          })}
          {running.length > 0 && <div className="muted small hw-note">{running.length} running right now</div>}
        </Widget>

        <Widget title={pinnedProjects.length ? 'Pinned projects' : 'Projects'} icon="folders" action="All" onAction={() => onGo('projects')}>
          {shownProjects.length === 0 ? <div className="muted small">No projects yet.</div> : shownProjects.map((p) => (
            <button key={p.id} className="hw-row" onClick={() => onOpenProject(p.id)}><Icon name="folder" size={14} /><span className="t">{p.name}</span><span className="muted small">{chats.filter((c) => c.projectId === p.id).length}</span></button>
          ))}
        </Widget>

        <Widget title="Notes" icon="file" action="New note" onAction={() => onGo('newnote')}>
          {recentNotes.length === 0 ? <div className="muted small">No notes yet.</div> : recentNotes.map((n) => (
            <button key={n.path} className="hw-row" onClick={() => onOpenNote(n.path)}><Icon name="file" size={14} /><span className="t">{n.name}</span></button>
          ))}
        </Widget>

        <Widget title="Coming up" icon="clock" action="Scheduled" onAction={() => onGo('schedule')}>
          {upcoming.length === 0 ? <div className="muted small">Nothing scheduled.</div> : upcoming.map((j) => (
            <button key={j.id} className="hw-row" onClick={() => onGo('schedule')}><Icon name="clock" size={14} /><span className="t">{j.name}</span><span className="muted small">{when(j.nextRun)}</span></button>
          ))}
        </Widget>

        <Widget title="Usage" icon="chart" action="Details" onAction={() => onGo('usage')}>
          {usage === null ? <div className="muted small">Loading…</div> : (
            <div className="hw-stats">
              <div><b>{fmtTok(dayU.tok)}</b><span>tokens today</span></div>
              <div><b>{fmtUsd(dayU.cost)}</b><span>cost today</span></div>
              <div><b>{fmtTok(monthU.tok)}</b><span>tokens, 30 days</span></div>
              <div><b>{fmtUsd(monthU.cost)}</b><span>cost, 30 days</span></div>
            </div>
          )}
        </Widget>

        <Widget title="Shortcuts" icon="bolt" wide>
          <div className="hw-tiles">
            <button onClick={() => onGo('sentinel')}><Icon name="mic" size={16} /> Sentinel <span className="muted small">{sentinel === 'off' ? 'Off' : 'On'}</span></button>
            <button onClick={() => onGo('agents')}><Icon name="user" size={16} /> Agents{agentCount ? <span className="count">{agentCount} running</span> : null}</button>
            <button onClick={() => onGo('skills')}><Icon name="sparkle" size={16} /> Skills</button>
            <button onClick={() => onGo('automations')}><Icon name="bolt" size={16} /> Automations</button>
            <button onClick={() => onGo('memory')}><Icon name="bulb" size={16} /> Memory{memoryCount ? <span className="count">{memoryCount}</span> : null}</button>
            <button onClick={() => onGo('connectors')}><Icon name="plug" size={16} /> Connectors{connectorCount ? <span className="count">{connectorCount}</span> : null}</button>
            <button onClick={() => onGo('browser')}><Icon name="globe" size={16} /> Browser</button>
            <button onClick={() => onGo('terminal')}><Icon name="terminal" size={16} /> Terminal</button>
            <button onClick={() => onGo('logs')}><Icon name="code" size={16} /> Logs</button>
            <button onClick={() => onGo('settings')}><Icon name="sliders" size={16} /> Settings</button>
          </div>
        </Widget>
      </div>
    </div>
  );
}
