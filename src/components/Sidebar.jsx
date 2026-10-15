import React, { useEffect, useRef, useState } from 'react';
import { dayGroup } from '../lib/history.js';
import { Icon } from './Icons.jsx';
import ProjectLogo from './ProjectLogo.jsx';
import NotesSection from './NotesSection.jsx';

function ChatRow({ c, active, status, inProject, onSelect, onDelete, onRename, onPin }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(c.title);
  const finish = (ok) => {
    setEditing(false);
    if (ok && val.trim()) onRename(c.id, val.trim().slice(0, 80));
  };
  const icon = status === 'running' ? 'spinner' : status === 'awaiting' ? 'warning' : c.incognito ? 'ghost' : c.sentinel ? 'mic' : inProject ? 'folder' : c.source === 'phone' ? 'phone' : c.source === 'schedule' ? 'clock' : 'chat';
  return (
    <div className={`chat-item ${active ? 'active' : ''} ${status || ''}`} data-chat={c.id} onClick={() => onSelect(c.id)}>
      <Icon name={icon} size={15} className="row-icon" title={status === 'running' ? 'Running' : status === 'awaiting' ? 'Needs your approval' : undefined} />
      {editing ? (
        <input
          className="rename" autoFocus value={val}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }}
        />
      ) : (
        <span className="t" onDoubleClick={(e) => { e.stopPropagation(); setVal(c.title); setEditing(true); }}>{c.title}</span>
      )}
      <button className={`x pin ${c.pinned ? 'on' : ''}`} title={c.pinned ? 'Unpin' : 'Pin'} onClick={(e) => { e.stopPropagation(); onPin(c.id); }}><Icon name="pin" size={14} /></button>
      <button className="x" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}><Icon name="x" size={14} /></button>
    </div>
  );
}

export default function Sidebar({
  chats, projects = [], currentId, view, statusOf, onNewChat, onNewIncognito, onSelect, onDelete, onRename, onPinChat, onPinProject, onOpenProject,
  onProjects, onConnectors, onSettings, onMemory, onUsage, onBrowser, onTerminal, notes, onSchedule, onSkills, onAgents, onAutomations, onSentinel, sentinel = 'off', onLogs, agentCount = 0, onPermissions, onProfile, profile = {}, view_, memoryCount, connectorCount, hidden, onResizeStart
}) {
  const [q, setQ] = useState('');
  const navRef = useRef(null);
  const [navH, setNavH] = useState(() => { try { const v = parseInt(localStorage.getItem('ares-nav-h'), 10); return v > 60 ? v : null; } catch { return null; } });
  const startSplit = (e) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = navRef.current ? navRef.current.offsetHeight : 200;
    const max = () => Math.max(100, (navRef.current?.closest('.sidebar')?.clientHeight || 700) - 230);
    let cur = h0;
    const mv = (ev) => { cur = Math.round(Math.max(60, Math.min(max(), h0 + ev.clientY - y0))); setNavH(cur); };
    const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); document.body.style.cursor = ''; try { localStorage.setItem('ares-nav-h', String(cur)); } catch {} };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
  };
  const resetSplit = () => { setNavH(null); try { localStorage.removeItem('ares-nav-h'); } catch {} };
  const [more, setMore] = useState(() => { try { return localStorage.getItem('zero-more') === '1'; } catch { return false; } });
  const toggleMore = () => setMore((m) => { try { localStorage.setItem('zero-more', m ? '0' : '1'); } catch {} return !m; });
  const [openProjects, setOpenProjects] = useState(() => {
    try { return JSON.parse(localStorage.getItem('zero-open-projects') || '{}'); } catch { return {}; }
  });
  const mac = window.api.platform === 'darwin';
  const toggleProject = (id) => setOpenProjects((old) => {
    const next = { ...old, [id]: old[id] === undefined ? false : !old[id] };
    localStorage.setItem('zero-open-projects', JSON.stringify(next));
    return next;
  });
  useEffect(() => {
    // Keep newly created/imported projects visible without forcing old sections open.
    setOpenProjects((old) => {
      const next = { ...old };
      projects.forEach((p) => { if (next[p.id] === undefined) next[p.id] = true; });
      return next;
    });
  }, [projects.length]);
  const ql = q.trim().toLowerCase();
  const visible = chats
    .filter((c) => !ql || c.title.toLowerCase().includes(ql) ||
      c.messages.some((m) => (m.content || '').toLowerCase().includes(ql) || (m.steps || []).some((s) => (s.text || '').toLowerCase().includes(ql))))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const rows = [];
  const pinnedChats = visible.filter((c) => c.pinned);
  const pinnedProjects = ql ? [] : projects.filter((p) => p.pinned);
  if (pinnedChats.length || pinnedProjects.length) {
    rows.push(<div key="pinned" className="group-label">Pinned</div>);
    for (const p of pinnedProjects) {
      rows.push(
        <div key={'p' + p.id} className="chat-item" data-project={p.id} onClick={() => onOpenProject(p.id)}>
          <ProjectLogo logo={p.logo} size={15} />
          <span className="t">{p.name}</span>
          <button className="x pin on" title="Unpin" onClick={(e) => { e.stopPropagation(); onPinProject(p.id); }}><Icon name="pin" size={14} /></button>
        </div>
      );
    }
    for (const c of pinnedChats) {
      rows.push(
        <ChatRow key={c.id} c={c} active={view === 'chat' && c.id === currentId} status={statusOf(c)} inProject={!!c.projectId}
          onSelect={onSelect} onDelete={onDelete} onRename={onRename} onPin={onPinChat} />
      );
    }
  }
  const unassigned = visible.filter((x) => !x.pinned && !x.projectId);
  const projectList = projects.filter((p) => visible.some((c) => !c.pinned && c.projectId === p.id));
  for (const p of projectList) {
    const items = visible.filter((c) => !c.pinned && c.projectId === p.id);
    const isOpen = ql || openProjects[p.id] !== false;
    rows.push(
      <div key={'pg' + p.id} className={`project-group ${isOpen ? 'open' : 'closed'}`}>
        <div className="project-group-head" data-project={p.id} onClick={() => toggleProject(p.id)}>
          <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} size={13} className="project-chevron" />
          <ProjectLogo logo={p.logo} size={15} />
          <span className="t" onDoubleClick={(e) => { e.stopPropagation(); onOpenProject(p.id); }}>{p.name}</span>
          <button className="project-open" title="Open project" onClick={(e) => { e.stopPropagation(); onOpenProject(p.id); }}><Icon name="external" size={13} /></button>
        </div>
        {isOpen && <div className="project-submenu">
          {items.map((c) => <ChatRow key={c.id} c={c} active={view === 'chat' && c.id === currentId} status={statusOf(c)} inProject
            onSelect={onSelect} onDelete={onDelete} onRename={onRename} onPin={onPinChat} />)}
        </div>}
      </div>
    );
  }
  let last = '';
  for (const c of unassigned) {
    const g = dayGroup(c.updatedAt);
    if (g !== last) { rows.push(<div key={'g' + g} className="group-label">{g}</div>); last = g; }
    rows.push(<ChatRow key={c.id} c={c} active={view === 'chat' && c.id === currentId} status={statusOf(c)} inProject={false}
      onSelect={onSelect} onDelete={onDelete} onRename={onRename} onPin={onPinChat} />);
  }

  return (
    <aside className={`sidebar ${hidden ? 'hidden' : ''}`}>
      {!hidden && <div className="resize-grip right" onMouseDown={onResizeStart} title="Drag to resize" />}
      <div className="drag" style={{ height: mac ? 34 : 6 }} />
      <div className="side-search"><Icon name="search" size={16} /><input type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <nav className="side-nav" ref={navRef} style={navH ? { height: navH, maxHeight: 'none', flex: 'none' } : undefined}>
        <button className="nav-item" onClick={onNewChat}><span className="nav-ico new"><Icon name="plus" size={15} /></span> New</button>
        {onSentinel && (
          <button className={`nav-item sn-nav ${sentinel !== 'off' ? 'on' : ''}`} onClick={onSentinel} title={sentinel === 'off' ? 'Start Sentinel: talk to Artemis hands-free (⇧⌘A)' : 'Turn Sentinel off (⇧⌘A)'}>
            <Icon name="mic" size={18} /> Sentinel
            <span className={`count sn-state ${sentinel}`}>{sentinel === 'off' ? 'Off' : sentinel === 'loading' ? 'Starting…' : sentinel === 'idle' ? 'Say “Wake up”' : sentinel === 'listening' ? 'Listening' : sentinel === 'thinking' ? 'Thinking' : 'Speaking'}</span>
          </button>
        )}
        <button className={`nav-item ${view === 'other' ? '' : ''}`} data-nav="projects" onClick={onProjects}><Icon name="folders" size={18} /> Projects</button>
        <button className="nav-item" data-nav="schedule" onClick={onSchedule}><Icon name="clock" size={18} /> Scheduled</button>
        <button className="nav-item muted-item" onClick={toggleMore}><Icon name={more ? 'chevronDown' : 'chevronRight'} size={18} /> More</button>
        {more && (
          
          <div className="nav-more">
               <button className="nav-item" data-nav="skills" onClick={onSkills}><Icon name="sparkle" size={18} /> Skills</button>
        <button className="nav-item" data-nav="agents" onClick={onAgents}><Icon name="user" size={18} /> Agents{agentCount ? <span className="count">{agentCount} running</span> : null}</button>
     
              {onAutomations && <button className="nav-item" data-nav="automations" onClick={onAutomations}><Icon name="bolt" size={18} /> Automations</button>}
        {onLogs && <button className="nav-item" data-nav="logs" onClick={onLogs}><Icon name="terminal" size={18} /> Logs</button>}

            <button className="nav-item sub" onClick={onNewIncognito} title="A chat that is not saved and doesn't use memory"><Icon name="ghost" size={17} /> Incognito chat</button>
            <button className="nav-item sub" data-nav="browser" onClick={onBrowser}><Icon name="globe" size={17} /> Browser</button>
            {onTerminal && <button className="nav-item sub" data-nav="terminal" onClick={onTerminal} title="Ctrl/Cmd + `"><Icon name="terminal" size={17} /> Terminal</button>}
            <button className="nav-item sub" data-nav="connectors" onClick={onConnectors}><Icon name="plug" size={17} /> Connectors{connectorCount ? <span className="count">{connectorCount}</span> : null}</button>
            <button className="nav-item sub" data-nav="memory" onClick={onMemory}><Icon name="bulb" size={17} /> Memory{memoryCount ? <span className="count">{memoryCount}</span> : null}</button>
            <button className="nav-item sub" data-nav="usage" onClick={onUsage}><Icon name="chart" size={17} /> Usage</button>
            <button className="nav-item sub" onClick={onPermissions}><Icon name="shield" size={17} /> Permissions</button>
          </div>
        )}
      </nav>
      <div className="nav-split" onMouseDown={startSplit} onDoubleClick={resetSplit} title="Drag to resize the menu and the chat list. Double-click to reset."><span /></div>
      <div className="chat-list">
        {notes && <NotesSection {...notes} />}
        {rows.length ? rows : <div className="muted pad">No chats</div>}
      </div>
      <div className="side-foot">
        <button className="profile-btn" title="Your profile" onClick={onProfile}>
          {profile.avatar ? <img className="avatar" src={profile.avatar} alt="" /> : <span className="avatar">{(profile.name || '').trim().slice(0, 1).toUpperCase() || <Icon name="user" size={15} />}</span>}
          <span className="side-user">{profile.name || 'Set up profile'}</span>
        </button>
        <span style={{ flex: 1 }} />
        <button className="icon-btn" title="Usage" data-nav="usage" onClick={onUsage}><Icon name="chart" size={17} /></button>
        <button className="icon-btn" title="Settings" data-nav="settings" onClick={onSettings}><Icon name="sliders" size={17} /></button>
      </div>
    </aside>
  );
}
