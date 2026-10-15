import React, { useState } from 'react';
import { openPreview } from '../lib/preview.js';
import { Icon } from './Icons.jsx';

const LABELS = {
  list_dir: ['folderOpen', 'Listed folder'],
  read_file: ['file', 'Read file'],
  search_files: ['search', 'Searched files'],
  write_file: ['pencil', 'Writing file'],
  edit_file: ['edit', 'Editing file'],
  write_spreadsheet: ['sheet', 'Creating spreadsheet'],
  update_cells: ['calc', 'Updating cells'],
  create_folder: ['folderPlus', 'Created folder'],
  move_file: ['move', 'Moving file'],
  delete_file: ['trash', 'Deleting'],
  web_search: ['globe', 'Searched the web'],
  web_fetch: ['globe', 'Read web page'],
  run_command: ['terminal', 'Terminal command'],
  computer: ['monitor', 'Computer'],
  terminal_run: ['terminal', 'Ran in terminal'],
  terminal_read: ['terminal', 'Read terminal'],
  notes_list: ['file', 'Browsed Notes'],
  notes_search: ['search', 'Searched Notes'],
  notes_read: ['file', 'Read a note'],
  notes_write: ['pencil', 'Wrote a note'],
  notes_append: ['pencil', 'Added to a note'],
  send_to_phone: ['phone', 'Sent to phone'],
  schedule_task: ['clock', 'Scheduled a task'],
  list_schedules: ['clock', 'Listed scheduled tasks'],
  delete_schedule: ['trash', 'Deleted a scheduled task'],
  create_artifact: ['artifact', 'Created artifact'],
  generate_image: ['image', 'Generated image'],
  generate_video: ['video', 'Generated video'],
  memory_save: ['bulb', 'Saved to memory'],
  memory_forget: ['bulb', 'Removed from memory'],
  use_skill: ['sparkle', 'Used skill'],
  create_skill: ['sparkle', 'Saved a skill'],
  update_skill: ['sparkle', 'Improved a skill'],
  search_chats: ['search', 'Searched your chats'],
  read_chat: ['file', 'Read a chat'],
  delegate: ['sparkle', 'Agents']
};

export function labelFor(name) {
  if (LABELS[name]) return LABELS[name];
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  if (m) return ['plug', `${m[1].replace(/_/g, ' ')} · ${m[2].replace(/_/g, ' ')}`];
  return ['wrench', name];
}

const FILE_TOOLS = new Set(['write_file', 'edit_file', 'write_spreadsheet', 'update_cells']);

export function target(tc) {
  const a = tc.args || {};
  if (tc.name === 'move_file') return `${a.from} to ${a.to}`;
  if (tc.name === 'memory_save') return a.text;
  if (tc.name === 'memory_forget') return a.id;
  if (tc.name === 'use_skill' || tc.name === 'create_skill' || tc.name === 'update_skill') return a.name || '';
  if (tc.name === 'search_chats') return a.query || '';
  if (tc.name === 'delegate') return (Array.isArray(a.tasks) && a.tasks.length ? a.tasks.map((t) => (typeof t === 'string' ? t : `${t.agent || 'Helper'}: ${t.task}`)).join(' | ') : `${a.agent ? a.agent + ': ' : ''}${a.task || ''}`).slice(0, 100);
  if (tc.name === 'search_files') return [a.query, a.name].filter(Boolean).join(' · ');
  if (tc.name === 'update_cells') return `${a.path} (${(a.cells || []).length} cells)`;
  if (tc.name === 'send_to_phone') return a.file_path || (a.screenshot ? 'screenshot' : a.text || '');
  if (tc.name === 'create_artifact') return a.title || '';
  if (tc.name === 'generate_image' || tc.name === 'generate_video') return String(a.prompt || '').slice(0, 100);
  if (tc.name === 'web_search') return a.query || '';
  if (tc.name === 'web_fetch') return a.url || '';
  if (tc.name === 'run_command') return a.command || '';
  if (tc.name === 'computer') return [a.action, a.text || a.keys || (a.x != null ? `${a.x},${a.y}` : '')].filter(Boolean).join(' ');
  return a.path || '';
}

function Preview({ tc }) {
  const a = tc.args || {};
  const clip = (s, n = 1500) => (s && s.length > n ? s.slice(0, n) + '\n…' : s || '');
  if (tc.name === 'edit_file') {
    return (
      <div className="diff">
        <pre className="del">{clip(a.old_string)}</pre>
        <pre className="add">{clip(a.new_string)}</pre>
      </div>
    );
  }
  if (tc.name === 'write_file') return <pre className="plain">{clip(a.content)}</pre>;
  if (tc.name === 'write_spreadsheet' || tc.name === 'update_cells') {
    return <pre className="plain">{clip(JSON.stringify(tc.name === 'update_cells' ? a.cells : a.sheets, null, 1))}</pre>;
  }
  if (tc.name === 'run_command') return <pre className="plain">{a.command}</pre>;
  return null;
}

const kTok = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n || 0));

function AgentCard({ a, onDecide }) {
  const [open, setOpen] = useState(a.status === 'running');
  const waiting = (a.tools || []).some((t) => t.status === 'awaiting');
  const badge = { running: waiting ? 'waiting for you' : 'working…', done: 'done', error: 'failed', cancelled: 'stopped' }[a.status] || '';
  const last = (a.tools || []).slice(-1)[0];
  return (
    <div className={`agent-card ${a.status}`}>
      <button className="agent-head" onClick={() => setOpen(!open)}>
        <span className="agent-name">{a.name || 'Agent'}</span>{a.role && <span className="agent-role">{a.role}</span>}
        <span className="agent-model">{a.model || ''}</span>
        <span className="agent-stat">{(a.tools || []).length} {(a.tools || []).length === 1 ? "tool" : "tools"} · {kTok((a.prompt || 0) + (a.completion || 0))} tokens</span>
        <span className={`badge ${a.status}`}>{badge}</span>
        <span className="chev"><Icon name={open || waiting ? 'chevronDown' : 'chevronRight'} size={14} /></span>
      </button>
      <div className="agent-task">{a.task}</div>
      {(open || waiting) && (
        <div className="agent-body">
          {(a.tools || []).map((t) => <ToolCard key={t.id} tc={t} onDecide={onDecide} />)}
          {a.status === 'running' && !waiting && a.text && <div className="agent-live">{a.text}</div>}
          {a.error && <div className="agent-err">{a.error}</div>}
        </div>
      )}
      {!open && !waiting && a.status === 'running' && last && <div className="agent-last">{labelFor(last.name)[1]} {target(last)}</div>}
    </div>
  );
}

export default function ToolCard({ tc, onDecide }) {
  const [open, setOpen] = useState(false);
  const [icon, label] = labelFor(tc.name);
  const status = tc.status;
  const awaiting = status === 'awaiting';
  const badge = {
    running: 'running…', awaiting: 'awaiting approval', done: '', error: 'error', denied: 'denied', cancelled: 'cancelled'
  }[status] || '';

  return (
    <div className={`tool ${status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-icon"><Icon name={icon} size={15} /></span>
        <span className="tool-label">{label}</span>
        <span className="tool-target">{target(tc)}</span>
        {badge && <span className={`badge ${status}`}>{badge}</span>}
        <span className="chev"><Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} /></span>
      </button>
      {tc.agents && tc.agents.length > 0 && <div className="agent-list">{tc.agents.filter(Boolean).map((a, i) => <AgentCard key={i} a={a} onDecide={onDecide} />)}</div>}
      {awaiting && (
        <div className="approve">
          {tc.agent && <div className="approve-who">{tc.agent} agent wants to: {tc.summary || labelFor(tc.name)[1]}</div>}
          <Preview tc={tc} />
          {tc.session && <small className="hint">{tc.category === 'computer' ? 'The assistant will see your screen and control the mouse and keyboard until this task ends. Stop any time with Cmd/Ctrl+Shift+Esc or the Stop button.' : tc.category === 'media' ? 'The assistant can generate images and videos until this task ends. This uses credits on your image/video provider.' : tc.category === 'phone' ? 'The assistant can send messages, files and screenshots to your phone until this task ends.' : String(tc.category || '').startsWith('mcp:') ? 'The assistant can use this connector\'s tools until this task ends.' : 'The assistant will run terminal commands on your machine until this task ends.'}</small>}
          <div className="approve-actions">
            <button className="primary" onClick={() => onDecide(tc.id, true)}>{tc.session ? 'Allow for this task' : 'Allow'}</button>
            <button onClick={() => onDecide(tc.id, false)}>Deny</button>
          </div>
        </div>
      )}
      {tc.status === 'done' && FILE_TOOLS.has(tc.name) && tc.args?.path && (
        <div className="file-actions">
          <button onClick={() => openPreview({ project: true, path: tc.args.path })}>Preview</button>
          <button onClick={() => openPreview({ project: true, path: tc.args.path, action: 'open' })}>Open</button>
          <button onClick={() => openPreview({ project: true, path: tc.args.path, action: 'phone' })}>Send to phone</button>
        </div>
      )}
      {open && !awaiting && (
        <div className="tool-body">
          <Preview tc={tc} />
          {tc.image && <img className="shot" src={tc.image} alt="screenshot" />}
          {tc.result != null && <pre className="plain">{tc.result.length > 4000 ? tc.result.slice(0, 4000) + '\n…' : tc.result}</pre>}
        </div>
      )}
    </div>
  );
}
