import React, { useEffect, useState } from 'react';
import { askConfirm } from '../../lib/dialog.js';
import { Field } from '../Modals.jsx';
import { ProvSwitch } from './ProvidersTab.jsx';

/** Lets other apps (Claude Code, the Claude proxy, Claude Desktop …) control Artemis through MCP. */
export function McpServerCard() {
  const [i, setI] = useState(null);
  const [port, setPort] = useState('');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  const load = () => window.api.mcpServerInfo().then((x) => { setI(x); setPort(String(x.port)); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const apply = async (o) => { setI(await window.api.mcpServerSet(o)); };
  const url = i ? `http://127.0.0.1:${i.port}/mcp` : '';
  const tok = i && i.token ? i.token : '<token>';
  const cmd = `claude mcp add --transport http --scope user artemis ${url} --header "Authorization: Bearer ${tok}"`;
  const json = JSON.stringify({ mcpServers: { artemis: { type: 'http', url, headers: { Authorization: `Bearer ${tok}` } } } }, null, 2);
  const copy = async (what, text) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch {} };
  return (
    <>
      <h4 className="sub-h">Let other apps control Artemis (MCP server)</h4>
      <div className="prov-card">
        <div className="prov-head"><b>Artemis MCP server</b><span className="muted small">{i && i.running ? `running on 127.0.0.1:${i.port}` : 'off'}</span><span style={{ flex: 1 }} />
          <ProvSwitch on={!!(i && i.enabled)} onClick={() => i && apply({ enabled: !i.enabled })} />
        </div>
        <small className="hint">Claude Code, the Claude proxy or any MCP app can then change the theme and settings, switch providers on or off, use memory and Notes, and run commands in the Artemis terminal. It only listens on this Mac and needs the token below. Permissions that give Artemis more power (terminal, computer control, auto-approve, phone, keys) cannot be changed this way. Running a command or editing a note always asks you first.</small>
        {i && i.error && <small className="hint" style={{ color: 'var(--danger, #d9534f)' }}>{i.error}</small>}
        {i && i.enabled && (
          <>
            <div className="row" style={{ alignItems: 'end' }}>
              <Field label="Port"><input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={() => port && String(i.port) !== port && apply({ port })} /></Field>
              <Field label="Token"><input readOnly type={show ? 'text' : 'password'} value={i.token} onFocus={(e) => e.target.select()} /></Field>
              <button onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
              <button onClick={() => askConfirm({ title: 'Make a new token?', message: 'Apps that use the old token will stop working until you give them the new one.', confirmLabel: 'New token' }).then((ok) => ok && apply({ resetToken: true }))}>New token</button>
            </div>
            <label className="perm-row" style={{ marginTop: 6 }}>
              <div className="perm-main"><b>Don't ask before running commands from outside</b><span className="muted small">Off: Artemis asks (a window appears) each time an outside app wants to run a command or edit a note.</span></div>
              <span className={`perm-state ${i.alwaysAllow ? 'bad' : 'ok'}`}>{i.alwaysAllow ? 'No questions' : 'Asks first'}</span>
              <input type="checkbox" checked={!!i.alwaysAllow} onChange={(e) => apply({ alwaysAllow: e.target.checked })} />
            </label>
            <Field label="Add it to Claude Code (run once in a terminal)"><textarea readOnly rows={3} value={cmd} onFocus={(e) => e.target.select()} /></Field>
            <div className="row"><button onClick={() => copy('cmd', cmd)}>{copied === 'cmd' ? 'Copied' : 'Copy command'}</button><button onClick={() => copy('json', json)}>{copied === 'json' ? 'Copied' : 'Copy JSON config'}</button><button onClick={() => copy('url', url)}>{copied === 'url' ? 'Copied' : 'Copy address'}</button></div>
            <small className="hint">The Claude proxy starts Claude Code, which reads this list, so adding Artemis once makes its tools appear there too (restart the proxy). If it still asks for permission in headless mode, allow <code>mcp__artemis</code> in the Claude Code settings. Tools: artemis_status, set_theme, set_setting, list/set providers, memory, notes, terminal_run …</small>
          </>
        )}
      </div>
    </>
  );
}

export function AccessTab({ s, set, projects = [] }) {
  const [st, setSt] = useState(null);
  const [dirs, setDirs] = useState({ files: '', notes: '' });
  useEffect(() => { Promise.all([window.api.defaultFilesFolder().catch(() => ''), window.api.notesRoot().catch(() => '')]).then(([files, notes]) => setDirs({ files: files || '', notes: (notes && (notes.root || notes)) || '' })); }, []);
  const refresh = () => window.api.permStatus().then(setSt).catch(() => setSt({ supported: false, items: [] }));
  useEffect(() => { refresh(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  const ask = async (id) => { setSt(await window.api.permRequest(id)); };
  const mark = { granted: ['Allowed', 'ok'], denied: ['Not allowed', 'bad'], 'not-determined': ['Not asked yet', 'warn'], unknown: ['Check in System Settings', 'warn'], restricted: ['Restricted', 'bad'] };
  const phoneOn = !!s.telegramEnabled;
  const rows = [
    ['toolsEnabled', 'Files and tools', 'Read and write files in the project folder, create artifacts.', s.toolsEnabled],
    ['shellEnabled', 'Terminal', 'Run commands on this computer, also in the visible terminal panel. Asks once per task.', s.shellEnabled],
    ['notesAi', 'Notes (knowledge base)', 'Let Artemis search and read your Notes. Asks once per task; writing a note asks every time.', s.notesAi !== false],
    ['computerEnabled', 'Computer control', 'See the screen, move the mouse, type. Asks once per task. Emergency stop: Cmd+Shift+Esc.', s.computerEnabled],
    ['webEnabled', 'Internet', 'Search the web and open pages.', s.webEnabled],
    ['memoryEnabled', 'Memory', 'Remember facts about you between chats.', s.memoryEnabled],
    ['connectorsEnabled', 'Connectors', 'Use your connected apps (MCP servers).', s.connectorsEnabled !== false],
    ['skillsEnabled', 'Skills', 'Load your saved instructions.', s.skillsEnabled !== false],
    ['delegateEnabled', 'Agents', 'Hand parts of a task to helper agents.', s.delegateEnabled !== false]
  ];
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>Everything Artemis can reach, in one place. Switch features off here, or open the macOS permission it needs.</p>
      <h4 className="sub-h">macOS permissions</h4>
      {st === null ? <div className="muted">Checking…</div> : !st.supported ? <div className="muted small">macOS permissions are not used on this system.</div> : (
        <div className="perm-list">
          {st.items.map((i) => {
            const [label, tone] = mark[i.status] || mark.unknown;
            return (
              <div key={i.id} className="perm-row">
                <div className="perm-main"><b>{i.title}</b><span className="muted small">{i.why}</span></div>
                <span className={`perm-state ${tone}`}>{label}</span>
                <button type="button" onClick={() => ask(i.id)} disabled={i.status === 'granted'}>{i.status === 'granted' ? 'Done' : i.id === 'notifications' ? 'Test' : 'Allow'}</button>
              </div>
            );
          })}
        </div>
      )}
      <small className="hint">After allowing Screen Recording or Accessibility, macOS may ask you to restart Artemis. If you run Artemis from a terminal, allow the terminal app instead. This list refreshes when you come back from System Settings.</small>
      <h4 className="sub-h">Folders Artemis can reach</h4>
      <div className="perm-list">
        {[
          ['Default files folder', 'Used by chats that have no project. File tools stay inside it.', dirs.files],
          ...projects.filter((p) => p.folder).map((p) => ['Project: ' + p.name, 'File tools stay inside this folder in chats of this project.', p.folder]),
          ['Notes', s.notesAi !== false ? 'Artemis can search and read these notes (asks once per task); writing a note always asks.' : 'Notes access for Artemis is off.', dirs.notes]
        ].filter((r) => r[2]).map(([title, why, dir]) => (
          <div key={title + dir} className="perm-row">
            <div className="perm-main"><b>{title}</b><span className="muted small">{why}</span><code className="prov-url">{dir}</code></div>
            <button type="button" onClick={() => window.api.revealPath(dir)}>Show</button>
          </div>
        ))}
        <div className="perm-row">
          <div className="perm-main"><b>Terminal and computer control</b><span className="muted small">{s.shellEnabled || s.computerEnabled ? 'Not limited to folders: a command can reach anything your Mac user can. Each task asks first.' : 'Off, so no commands run and no folder outside the ones above is reachable.'}</span></div>
          <span className={`perm-state ${s.shellEnabled || s.computerEnabled ? 'warn' : 'ok'}`}>{s.shellEnabled || s.computerEnabled ? 'Any folder' : 'Off'}</span>
        </div>
      </div>
      <small className="hint">macOS may also ask separately the first time a folder such as Documents or Desktop is used. You can review that in System Settings → Privacy &amp; Security → Files and Folders.</small>
      <h4 className="sub-h">What Artemis may use</h4>
      <div className="perm-list">
        {rows.map(([key, title, why, on]) => (
          <label key={key} className="perm-row">
            <div className="perm-main"><b>{title}</b><span className="muted small">{why}</span></div>
            <span className={`perm-state ${on ? 'ok' : 'warn'}`}>{on ? 'On' : 'Off'}</span>
            <input type="checkbox" checked={!!on} onChange={set(key)} />
          </label>
        ))}
        <div className="perm-row">
          <div className="perm-main"><b>Phone (Telegram)</b><span className="muted small">Lets you chat with Artemis from your phone and lets it send you files. Set up in the Phone tab.</span></div>
          <span className={`perm-state ${phoneOn ? 'ok' : 'warn'}`}>{phoneOn ? 'On' : 'Off'}</span>
        </div>
        <label className="perm-row">
          <div className="perm-main"><b>Approve everything in new chats</b><span className="muted small">Off: Artemis asks before edits, the terminal, the computer and scheduled tasks. On: it does not ask.</span></div>
          <span className={`perm-state ${s.autoApproveEdits ? 'bad' : 'ok'}`}>{s.autoApproveEdits ? 'No questions' : 'Asks first'}</span>
          <input type="checkbox" checked={!!s.autoApproveEdits} onChange={set('autoApproveEdits')} />
        </label>
      </div>
      <McpServerCard />
    </>
  );
}
