import React, { useEffect, useState } from 'react';
import Select from './Select.jsx';
import PERSONALITIES from '../../electron/personality.json';
import { SYSTEM_THEME, TEXT_SIZES } from '../lib/themes.js';
import { Modal, Field, ImportRow, PhoneSettings } from './Modals.jsx';
import { ProvidersTab } from './settings/ProvidersTab.jsx';
import { LimitsTab } from './settings/LimitsTab.jsx';
import { AccessTab } from './settings/AccessTab.jsx';
import { VoiceTab } from './settings/VoiceTab.jsx';
import { MakeTab } from './settings/MakeTab.jsx';
import { AgentsTab } from './settings/AgentsTab.jsx';
import { BrainsTab } from './settings/BrainsTab.jsx';

const TABS = [
  ['general', 'General'],
  ['providers', 'Providers'],
  ['tools', 'Tools & safety'],
  ['access', 'Access'],
  ['agents', 'Agents'],
  ['brains', 'Brains'],
  ['limits', 'Usage limits'],
  ['voice', 'Voice'],
  ['make', 'Make'],
  ['phone', 'Phone']
];

export function SettingsModal({ settings, groups = [], projects = [], providers = [], onProviders = () => {}, onApply = () => {}, onSave, onClose, onNewTab, initialTab = 'general' }) {
  const [tab, setTab] = useState(initialTab);
  const [s, setS] = useState({ ...settings });
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const chatGroups = groups;
  // Themes come from main: built-in JSON plus <userData>/themes and <project>/.artemis/themes, refreshed here.
  const projectFolder = (projects.find((p) => p.id === (settings.activeProjectId || (settings.projectId || ''))) || {}).folder || (projects[0] || {}).folder || '';
  const [themeInfo, setThemeInfo] = useState({ themes: [], folder: '' });
  const [themeMsg, setThemeMsg] = useState('');
  const [themeBusy, setThemeBusy] = useState(false);
  const refreshThemes = async () => {
    try {
      const r = await api.themesList(projectFolder);
      if (r) setThemeInfo({ themes: r.themes || [], folder: (r.folders && r.folders.project) || (r.folders && r.folders.user) || '' });
    } catch {}
  };
  const importThemes = async () => {
    setThemeBusy(true);
    try {
      const r = await api.themesImport(projectFolder);
      if (r) setThemeMsg(r.added ? `Imported: ${r.added.join(', ')}` : '');
      await refreshThemes(); onApply({});
    } catch (e) { setThemeMsg(String((e && e.message) || e)); }
    setThemeBusy(false);
  };
  useEffect(() => { refreshThemes(); }, []);
  useEffect(() => api.onThemeChanged ? api.onThemeChanged(() => refreshThemes()) : undefined, []);
  const themeList = [SYSTEM_THEME, ...themeInfo.themes];
  const mediaGroups = providers.filter((p) => p.enabled !== false && (p.models || []).length).map((p) => <optgroup key={p.id} label={p.name}>{p.models.map((m) => <option key={m.id} value={`prov:${p.id}:${m.id}`}>{m.name || m.id}</option>)}</optgroup>);
  const known = !s.model || chatGroups.some((g) => g.items.some(([id]) => id === s.model));
  const save = () => onSave({
    ...s,
    telegramToken: s.telegramToken ? s.telegramToken.trim() : undefined,
    maxTokens: Math.max(256, parseInt(s.maxTokens, 10) || 8192),
    dailyTokenLimit: Math.max(0, parseInt(s.dailyTokenLimit, 10) || 0),
    monthlyTokenLimit: Math.max(0, parseInt(s.monthlyTokenLimit, 10) || 0),
    dailyUsdLimit: Math.max(0, parseFloat(s.dailyUsdLimit) || 0),
    monthlyUsdLimit: Math.max(0, parseFloat(s.monthlyUsdLimit) || 0)
  });
  return (
    <Modal onClose={onClose} cls="settings" bare>
      <div className="settings-nav">
        <h2>Settings</h2>
        {TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
        {onNewTab && <button className="nav-newtab" title="Move Settings into its own tab" onClick={() => onNewTab(tab)}>Open in new tab ↗</button>}
      </div>
      <div className="settings-main">
        <div className="settings-body">
          <h3>{TABS.find(([id]) => id === tab)[1]}</h3>
          {tab === 'general' && (
            <>
              <div className="field"><span>Theme</span>
                <div className="theme-grid">
                  {themeList.map((t) => (
                    <button key={t.id} type="button" className={`theme-sw ${s.theme === t.id ? 'on' : ''}`} onClick={() => { setS({ ...s, theme: t.id }); onApply({ theme: t.id }); }} title={t.source === 'builtin' ? t.name : `${t.name} (${t.source})`}>
                      <i style={{ background: t.id === 'system' ? `linear-gradient(135deg, ${t.preview[0]} 50%, ${t.preview[2]} 50%)` : t.preview[0] }}><b style={{ background: t.preview[1] }} /><b style={{ background: t.preview[2] }} /></i>
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
                <div className="row" style={{ alignItems: 'center', marginTop: 8 }}>
                  <button type="button" onClick={refreshThemes} disabled={themeBusy}>{themeBusy ? 'Refreshing…' : 'Refresh'}</button>
                  <button type="button" onClick={() => api.themesOpen('project').then(refreshThemes).catch(() => {})}>Open folder</button>
                  <button type="button" onClick={importThemes} disabled={themeBusy}>Import .json</button>
                  <span className="hint">{themeMsg || `${themeList.length} themes · ${themeInfo.folder || ''}`}</span>
                </div>
                <div className="hint">Drop a theme .json in that folder and press Refresh — no rebuild. A file is <code>{'{ "id": "my-theme", "name": "My theme", "group": "Gods", "dark": true, "preview": ["#130808","#c9923a","#8c1c1c"], "vars": { "--theme-bg": "#130808", "…": "…" } }'}</code>. The project’s .artemis/themes wins over the user folder.</div>
              </div>
              <Field label="Text size" hint="Size of the text across the whole app.">
                <Select value={s.textSize || 'medium'} onChange={(e) => { setS({ ...s, textSize: e.target.value }); onApply({ textSize: e.target.value }); }}>{TEXT_SIZES.map(([id, n, px]) => <option key={id} value={id}>{n} ({px}px)</option>)}</Select>
              </Field>
              <Field label="Default model" hint="Used for new chats. Add more models in Providers.">
                <Select value={s.model} onChange={set('model')}>
                  {!s.model && <option value="">First model of the first provider</option>}
                  {!known && <option value={s.model}>{s.model}</option>}
                  {chatGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
                </Select>
              </Field>
              <Field label="Reasoning level" hint="How hard the model thinks before it answers: low is faster and cheaper, high thinks harder. Auto leaves it to the model. Used for new chats; change it per chat at the top. Models that do not support it ignore it.">
                <Select value={s.reasoningEffort || 'auto'} onChange={(e) => setS({ ...s, reasoningEffort: e.target.value === 'auto' ? '' : e.target.value })}>
                  <option value="auto">Auto</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              </Field>
              <div className="row">
                <Field label="Image model" hint="Needs a provider whose endpoint supports /images/generations. Off = no image generation.">
                  <Select value={s.imageModel || ''} onChange={set('imageModel')}><option value="">Off</option>{mediaGroups}</Select>
                </Field>
                <Field label="Video model" hint="Needs a provider whose endpoint supports /videos/generations. Off = no video generation.">
                  <Select value={s.videoModel || ''} onChange={set('videoModel')}><option value="">Off</option>{mediaGroups}</Select>
                </Field>
              </div>
              <Field label="Personality" hint={(PERSONALITIES.find((p) => p.id === (s.personality || '')) || {}).hint || ''}>
                <Select value={s.personality || ''} onChange={set('personality')}>
                  {PERSONALITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Personality notes (optional)" hint="Your own words, e.g. “Talk like a sarcastic best friend”. Added to the preset above."><textarea rows={2} value={s.personalityCustom || ''} onChange={set('personalityCustom')} placeholder="How should Artemis talk to you?" /></Field>
              <Field label="Custom instructions (system prompt)"><textarea rows={4} value={s.systemPrompt} onChange={set('systemPrompt')} placeholder="e.g. Keep answers short and direct." /></Field>
              <Field label="Quick chat shortcut" hint={settings.shortcutError || 'Opens the floating chat from anywhere. Example: CommandOrControl+Shift+Space'}>
                <input value={s.quickChatShortcut || ''} onChange={set('quickChatShortcut')} placeholder="CommandOrControl+Shift+Space" />
              </Field>
              <Field label="Command palette shortcut" hint="Opens Artemis and its command palette from any app, even when it is minimized. Leave empty to turn off. Example: CommandOrControl+K">
                <input value={s.paletteShortcut || ''} onChange={set('paletteShortcut')} placeholder="CommandOrControl+K" />
              </Field>
              <label className="check"><input type="checkbox" checked={s.closeToTray !== false} onChange={set('closeToTray')} /> <span>Closing the window keeps Artemis running in the background<br /><small>Needed for the phone bot and scheduled tasks. Artemis stays in the Dock; quit it from the Artemis menu (Cmd+Q) or the menu bar icon.</small></span></label>
              <label className="check"><input type="checkbox" checked={!!s.launchAtLogin} onChange={set('launchAtLogin')} /> Start Artemis when I log in</label>
              <ImportRow />
            </>
          )}
          {tab === 'providers' && <ProvidersTab s={s} set={set} settings={settings} providers={providers} onProviders={onProviders} onApply={onApply} />}
          {tab === 'tools' && (
            <>
              <label className="check"><input type="checkbox" checked={s.toolsEnabled} onChange={set('toolsEnabled')} /> Tools on by default in new chats (files, memory, notes, web, terminal)<br /><small className="muted">You can switch tools on or off per chat with the “Tools” pill next to the model picker. Off sends much smaller requests, which small local models and free tiers need.</small></label>
              <label className="check"><input type="checkbox" checked={s.autoApproveEdits} onChange={set('autoApproveEdits')} /> <span>Auto-allow all in new chats<br /><small>Off by default: every action asks. On: file edits, agent file writes, web, terminal, computer control, Make and connectors run without asking. Deleting files always asks. Each chat can switch to "Ask every time" next to the message box. Messages from your phone follow this too, but only file edits are auto-allowed there.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.memoryEnabled} onChange={set('memoryEnabled')} /> Memory enabled</label>
              <label className="check"><input type="checkbox" checked={s.webEnabled} onChange={set('webEnabled')} /> Web search and page fetch</label>
              <label className="check"><input type="checkbox" checked={s.notesAi !== false} onChange={set('notesAi')} /> <span>Notes knowledge base<br /><small>Artemis can search and read your notes after you approve.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.shellEnabled} onChange={set('shellEnabled')} /> <span>Terminal commands<br /><small>Asks once per task.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.computerEnabled} onChange={set('computerEnabled')} /> <span>Computer control (macOS)<br /><small>Screen, mouse and keyboard. Asks once per task. Emergency stop: Cmd+Shift+Esc.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.connectorsEnabled !== false} onChange={set('connectorsEnabled')} /> Connectors (MCP servers)</label>
              <label className="check"><input type="checkbox" checked={s.fullFileAccess !== false} onChange={set('fullFileAccess')} /> <span>Full file access<br /><small>The assistant can reach files anywhere on this computer, not only in the project folder. It asks first: once per outside folder for reading, every time for keys and credentials, and for every change</small></span></label>
              <label className="check"><input type="checkbox" checked={s.toolsLazy !== false} onChange={set('toolsLazy')} /> <span>Switch heavy tools on only when needed<br /><small>Saves tokens: computer control, terminal, media, phone, scheduling, helper agents and Make are sent only after the assistant asks for them. Files, web, memory and notes are always on.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.connectorsLazy !== false} onChange={set('connectorsLazy')} /> <span>Switch connectors on only when needed<br /><small>Saves tokens: connector tools are sent only after the assistant asks for that app.</small></span></label>
              <fieldset className="group">
                <legend>Skills &amp; learning</legend>
                <label className="check"><input type="checkbox" checked={s.skillsEnabled !== false} onChange={set('skillsEnabled')} /> <span>Skills<br /><small>Artemis can load your saved instructions for tasks you repeat.</small></span></label>
                <label className="check"><input type="checkbox" checked={s.autoLearn !== false} onChange={set('autoLearn')} /> <span>Let Artemis learn by itself<br /><small>It saves a skill after a task you are likely to repeat and improves skills when you correct it. Off = it asks before saving. Not used in incognito chats or scheduled tasks.</small></span></label>
                {s.autoLearn !== false && (
                  <Field label="Learning model" hint="After a task with several steps this model decides whether it is worth saving as a skill. You always see the skill first and choose Allow or Deny. A small, cheap model is enough.">
                    <Select value={s.reflectModel || ''} onChange={set('reflectModel')}>
                      <option value="">Automatic (a small, cheap model)</option>
                      {chatGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
                    </Select>
                  </Field>
                )}
                <label className="check"><input type="checkbox" checked={s.chatSearchEnabled !== false} onChange={set('chatSearchEnabled')} /> <span>Search my earlier chats<br /><small>Lets Artemis look things up in your saved chats when you refer to them. Incognito chats are never searched.</small></span></label>
              </fieldset>
            </>
          )}
          {tab === 'access' && <AccessTab s={s} set={set} projects={projects} />}
          {tab === 'brains' && <BrainsTab s={s} setS={setS} chatGroups={chatGroups} />}
          {tab === 'agents' && <AgentsTab s={s} set={set} chatGroups={chatGroups} />}
          {tab === 'limits' && <LimitsTab s={s} setS={setS} />}
          {tab === 'voice' && <VoiceTab s={s} setS={setS} providers={providers} chatGroups={chatGroups} />}
          {tab === 'make' && <MakeTab s={s} setS={setS} />}
          {tab === 'phone' && <PhoneSettings s={s} set={set} setS={setS} />}
        </div>
        <div className="actions-row settings-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
