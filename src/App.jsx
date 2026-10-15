import { startDrag, clamp, loadWidth, saveWidth } from './lib/resize.js';
import { installDropGuard } from './lib/attach.js';
import { applyTextSize, applyTheme, loadThemes, SYSTEM_THEME, TEXT_SIZES } from './lib/themes.js';
import { askConfirm } from './lib/dialog.js';
import { speak, stopSpeaking, createSpeaker } from './lib/voice.js';
import { Sentinel, preloadSentinel } from './lib/sentinel.js';
import { afterWake, afterName, stripWake, looksLikeNoise, spokenPart, takePieces, VOICE_HINT } from './lib/sentinel-core.mjs';
import { parseCommand, confirmText } from './lib/sentinel-commands.mjs';
import SentinelPill from './components/SentinelPill.jsx';
import { assistantText } from './lib/history.js';
import BrowserPanel from './components/BrowserPanel.jsx';
import { ChatPills } from './components/Composer.jsx';
import SplitPane from './components/SplitPane.jsx';
import { observeBottom } from './lib/stick.js';
import TabBar, { ContextMenu } from './components/TabBar.jsx';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Sidebar from './components/Sidebar.jsx';
import { ProjectsList, ProjectPage } from './components/ProjectsView.jsx';
import { Icon } from './components/Icons.jsx';
import Message from './components/Message.jsx';
import Composer from './components/Composer.jsx';
import { SettingsModal } from './components/Settings.jsx';
import SkillsView from './components/SkillsView.jsx';
import AgentsView from './components/AgentsView.jsx';
import { progressOf } from './lib/outputs.js';
import LogsView from './components/LogsView.jsx';
import AutomationsView from './components/AutomationsView.jsx';
import { log } from './lib/log.js';
import { liveAgents } from './lib/agents.js';
import { MemoryModal, ProjectModal, ConnectorsModal, UsageModal, PermissionsModal, ProfileModal } from './components/Modals.jsx';
import SchedulesView from './components/SchedulesView.jsx';
import { modelGroups, defaultModel } from './lib/models.js';
import { setExtraPrices } from './lib/cost.js';
import { TerminalDock } from './components/Terminal.jsx';
import NoteEditor from './components/NoteEditor.jsx';
import { promptName } from './lib/prompt.js';
import { flushAllNotes } from './lib/noteRegistry.js';
import CommandPalette from './components/CommandPalette.jsx';
import { FilePanel, ArtifactPanel, ProgressPanel } from './components/SidePanel.jsx';
import { greeting, toApiMessages, uid } from './lib/history.js';

const api = window.api;

const lastStep = (m, fn) => { const steps = [...m.steps]; steps[steps.length - 1] = fn(steps[steps.length - 1]); return { ...m, steps }; };
const patchTool = (m, id, fn) => ({ ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => {
  if (t.id === id) return fn(t);
  if (t.agents && t.agents.some((a) => (a.tools || []).some((x) => x.id === id))) return { ...t, agents: t.agents.map((a) => ((a.tools || []).some((x) => x.id === id) ? { ...a, tools: a.tools.map((x) => (x.id === id ? fn(x) : x)) } : a)) };
  return t;
}) })) });
// live cards of role agents live on the delegate tool call that started them
const patchAgent = (m, parent, idx, fn) => ({ ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => {
  if (t.id !== parent) return t;
  const agents = [...(t.agents || [])];
  const cur = agents[idx] || { tools: [], text: '', status: 'running' };
  agents[idx] = fn(cur);
  return { ...t, agents };
}) })) });

const stripImages = (chats) => chats.filter((c) => !c.incognito).map((c) => ({ ...c, messages: (c.messages || []).map((m) => (m.steps ? { ...m, steps: m.steps.map((st) => ({ ...st, toolCalls: (st.toolCalls || []).map(({ image, ...t }) => t) })) } : m)) }));

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState(null);
  const [chats, setChats] = useState([]);
  const [themeChoices, setThemeChoices] = useState([SYSTEM_THEME]);
  const [projects, setProjects] = useState([]);
  const [memory, setMemory] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [view, setView] = useState('chat'); // 'chat' | 'projects' | { project: id }
  const [providers, setProviders] = useState([]);
  const applyProviders = (r) => { setProviders(r.providers || []); setExtraPrices(r.prices || {}); };
  const [runningIds, setRunningIds] = useState([]); // chats with a run in progress
  const [connectorCount, setConnectorCount] = useState(0);
  const [modal, setModal] = useState(null); // 'settings' | 'memory' | {project: id|'new'}
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [avatar, setAvatar] = useState(null);
  useEffect(() => installDropGuard(), []);
  useEffect(() => { window.api.profileGet().then((p) => setAvatar((p && p.avatar) || null)).catch(() => {}); }, []);

  const [settingsTab, setSettingsTab] = useState('general');
  const [panel, setPanel] = useState(null); // { type: 'file', file } | { type: 'artifact', id }
  const [showProgress, setShowProgress] = useState(false);
  const [wide, setWide] = useState(false);
  const [spW, setSpW] = useState(() => loadWidth('zero.spW', 460));
  const [sbW, setSbW] = useState(() => loadWidth('zero.sbW', 280));
  const dragPanel = (e) => { setWide(false); startDrag(e, (x) => setSpW(clamp(window.innerWidth - x, 320, Math.round(window.innerWidth * 0.85))), () => setSpW((w) => { saveWidth('zero.spW', w); return w; })); };
  const dragSidebar = (e) => startDrag(e, (x) => setSbW(clamp(x, 200, 520)), () => setSbW((w) => { saveWidth('zero.sbW', w); return w; }));
  const [browser, setBrowser] = useState({ open: false, url: 'https://www.google.com' });
  const [term, setTerm] = useState({ open: false, tabs: [], active: null, height: 280 });
  const [palette, setPalette] = useState(false);
  // changes made from the phone (Telegram): switches, providers, compact
  useEffect(() => api.onAppChanged && api.onAppChanged(() => { api.getSettings().then((s) => setSettings(s)).catch(() => {}); api.providersList().then(applyProviders).catch(() => {}); }), []);
  useEffect(() => api.onRemoteCompact && api.onRemoteCompact(({ chatId }) => { const c = chatsRef.current.find((x) => x.id === chatId); if (c) actionsRef.current.compact && actionsRef.current.compact(c); }), []);
  // Notes live in the sidebar and open like chats: in the current tab, a new tab, or next to the current one (split view).
  const [notePath, setNotePath] = useState(null);
  const notePathRef = useRef(null); notePathRef.current = notePath;
  const [noteRev, setNoteRev] = useState(0); // bumped when the AI changes a note, so open editors reload it
  const [notes, setNotes] = useState({ items: [], root: '', loaded: false });
  const refreshNotes = useCallback(async () => {
    const r = await api.notesList();
    if (r && r.ok) setNotes((n) => ({ ...n, items: r.items, loaded: true }));
  }, []);
  useEffect(() => {
    api.notesRoot().then((root) => setNotes((n) => ({ ...n, root })));
    refreshNotes();
    const f = () => refreshNotes();
    window.addEventListener('focus', f);
    return () => window.removeEventListener('focus', f);
  }, [refreshNotes]);
  const openNote = (p) => { stick.current = true; setNotePath(p); setModal(null); setView('note'); };
  const termSeq = useRef(0);
  const termRef = useRef(term); termRef.current = term;
  const setPreviewFile = (f) => setPanel(f ? { type: 'file', file: f } : null);
  const currentRef = useRef(null);
  const streamsRef = useRef({}); // requestId -> { chatId, msgId }
  const listRef = useRef(null);
  const stick = useRef(true);

  const chat = chats.find((c) => c.id === currentId);
  currentRef.current = currentId;
  const chatsRef = useRef([]); chatsRef.current = chats;

  // ---------- tabs ----------
  // A tab remembers what it shows: a page (chat, notes, terminal, browser, …), which chat, and an open Settings / Memory / Usage / Connectors window.
  // The live state (view, currentId, modal) always belongs to the active tab, and is copied back into it on every change.
  const TAB_MODALS = ['settings', 'memory', 'usage', 'connectors'];
  const [tabs, setTabs] = useState(null);
  const [activeTab, setActiveTab] = useState(null);
  const [ctx, setCtx] = useState(null);
  const [splitTab, setSplitTab] = useState(null); // tab shown next to the active one (split view)
  const tabsRef = useRef(null); tabsRef.current = tabs;
  const activeRef = useRef(null); activeRef.current = activeTab;
  const viewRef = useRef('chat'); viewRef.current = view;
  const tabSeq = useRef(0);
  const orderTabs = (ts) => [...ts.filter((t) => t.pinned), ...ts.filter((t) => !t.pinned)];
  const snapNow = () => ({ view, chatId: currentId, notePath: view === 'note' ? notePath : null, modal: TAB_MODALS.includes(modal) ? modal : null, settingsTab });
  const applySnap = (sn) => {
    const cid = chatsRef.current.some((c) => c.id === sn.chatId) ? sn.chatId : currentRef.current;
    stick.current = true;
    setNotePath(sn.view === 'note' ? sn.notePath || null : null);
    setView(sn.view || 'chat'); setCurrentId(cid); setModal(sn.modal || null); setSettingsTab(sn.settingsTab || 'general');
  };
  const mkTab = (sn, pinned) => ({ id: 't' + Date.now().toString(36) + (++tabSeq.current), pinned: !!pinned, s: sn });
  const openTab = (sn) => { const t = mkTab(sn); setTabs((ts) => [...(ts || []), t]); setActiveTab(t.id); applySnap(sn); return t; };
  const activateTab = (id) => {
    const t = (tabsRef.current || []).find((x) => x.id === id); if (!t || id === activeRef.current) return;
    const cur = (tabsRef.current || []).find((x) => x.id === activeRef.current);
    setSplitTab((sp) => (sp === id ? (cur && (cur.s.view === 'chat' || cur.s.view === 'note') ? cur.id : null) : sp)); // clicking the other half swaps the halves
    setActiveTab(id); applySnap(t.s);
  };
  const splitWith = (id) => { const t = (tabsRef.current || []).find((x) => x.id === id); if (t && (t.s.view === 'chat' || t.s.view === 'note') && id !== activeRef.current) setSplitTab(id); };
  const splitChat = (chatId) => { // open a chat next to the current one
    if (chatId === currentRef.current) return;
    const ex = (tabsRef.current || []).find((t) => t.s.view === 'chat' && t.s.chatId === chatId);
    if (ex) { if (ex.id !== activeRef.current) setSplitTab(ex.id); return; }
    const t = mkTab({ view: 'chat', chatId, modal: null, settingsTab: 'general' }); setTabs((ts) => [...(ts || []), t]); setSplitTab(t.id);
  };
  const noteTab = (p) => (tabsRef.current || []).find((t) => t.s.view === 'note' && t.s.notePath === p);
  const noteSnap = (p) => ({ view: 'note', chatId: currentRef.current, notePath: p, modal: null, settingsTab: 'general' });
  const splitNote = (p) => { // open a note next to the current chat or note
    if (viewRef.current !== 'chat' && viewRef.current !== 'note') { openNote(p); return; }
    if (viewRef.current === 'note' && notePathRef.current === p) return;
    const ex = noteTab(p);
    if (ex) { if (ex.id !== activeRef.current) setSplitTab(ex.id); return; }
    const t = mkTab(noteSnap(p)); setTabs((ts) => [...(ts || []), t]); setSplitTab(t.id);
  };
  // an empty chat that no tab shows yet (or a new one)
  const freshChat = (projectId = null) => {
    const open = new Set((tabsRef.current || []).filter((t) => t.s.view === 'chat').map((t) => t.s.chatId));
    const ex = chatsRef.current.find((c) => !c.incognito && !c.messages.length && (c.projectId || null) === projectId && !open.has(c.id));
    if (ex) return ex.id;
    const c = { id: uid(), title: 'New chat', model: defaultModel(settings, providers), projectId, messages: [], updatedAt: Date.now() };
    chatsRef.current = [c, ...chatsRef.current];
    setChats((cs) => [c, ...cs]);
    return c.id;
  };
  const chatSnap = () => ({ view: 'chat', chatId: freshChat(), modal: null, settingsTab: 'general' });
  const newTab = (sn) => openTab(sn || chatSnap());
  const closeTab = (id) => {
    const ts = tabsRef.current || []; const t = ts.find((x) => x.id === id);
    if (!t || t.pinned) return; // pinned tabs stay until they are unpinned
    const rest = ts.filter((x) => x.id !== id);
    if (!rest.length) { const sn = chatSnap(); const nt = mkTab(sn); setTabs([nt]); setActiveTab(nt.id); applySnap(sn); return; }
    setTabs(rest);
    if (id === activeRef.current) {
      const order = orderTabs(ts); const i = order.findIndex((x) => x.id === id);
      const next = order.slice(i + 1).find((x) => x.id !== id) || [...order.slice(0, i)].reverse()[0];
      if (next) { setActiveTab(next.id); applySnap(next.s); }
    }
  };
  const closeOthers = (id) => {
    const ts = tabsRef.current || []; const keep = ts.filter((x) => x.id === id || x.pinned);
    setTabs(keep);
    if (!keep.some((x) => x.id === activeRef.current)) { const t = keep.find((x) => x.id === id) || keep[0]; setActiveTab(t.id); applySnap(t.s); }
  };
  const togglePin = (id) => setTabs((ts) => (ts || []).map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)));
  const duplicateTab = (id) => { const t = (tabsRef.current || []).find((x) => x.id === id); if (t) openTab({ ...t.s }); };
  const gotoTab = (n) => { const order = orderTabs(tabsRef.current || []); const t = n >= 9 ? order[order.length - 1] : order[n - 1]; if (t) activateTab(t.id); };
  const stepTab = (d) => { const order = orderTabs(tabsRef.current || []); if (order.length < 2) return; const i = order.findIndex((x) => x.id === activeRef.current); activateTab(order[(i + d + order.length) % order.length].id); };
  useEffect(() => { if (splitTab && tabs && !tabs.some((t) => t.id === splitTab)) setSplitTab(null); }, [tabs, splitTab]);
  const tabApi = useRef({}); tabApi.current = { newTab, closeTab, gotoTab, stepTab, openTab, snapNow, togglePin };

  useEffect(() => { // first start: restore the tabs of the last session
    if (!loaded || tabs || !currentId) return;
    let saved = null; try { saved = JSON.parse(localStorage.getItem('artemis.tabs') || 'null'); } catch {}
    const ok = saved && Array.isArray(saved.tabs) ? saved.tabs.filter((t) => t && t.id && t.s && t.s.view !== 'notes' && (t.s.view !== 'note' || typeof t.s.notePath === 'string') && (t.s.view !== 'chat' || chatsRef.current.some((c) => c.id === t.s.chatId))) : [];
    if (ok.length) { const act = ok.find((t) => t.id === saved.active) || ok[0]; setTabs(ok); setActiveTab(act.id); applySnap(act.s); }
    else { const t = mkTab(snapNow()); setTabs([t]); setActiveTab(t.id); }
  }, [loaded, currentId, tabs]);
  useEffect(() => { // the active tab follows what is on screen
    if (!tabs || !activeTab) return;
    const sn = snapNow();
    setTabs((ts) => { const t = ts.find((x) => x.id === activeTab); if (!t || JSON.stringify(t.s) === JSON.stringify(sn)) return ts; return ts.map((x) => (x.id === activeTab ? { ...x, s: sn } : x)); });
  }, [view, currentId, modal, settingsTab, activeTab]);
  useEffect(() => { if (tabs && activeTab) { try { localStorage.setItem('artemis.tabs', JSON.stringify({ tabs, active: activeTab })); } catch {} } }, [tabs, activeTab]);
  useEffect(() => { // a chat that was deleted or was an incognito chat: its tab goes too
    if (!tabs || !activeTab || !loaded) return;
    const ids = new Set(chats.map((c) => c.id));
    const dead = tabs.filter((t) => t.id !== activeTab && t.s.view === 'chat' && t.s.chatId && !ids.has(t.s.chatId));
    if (dead.length) setTabs((ts) => ts.filter((t) => !dead.includes(t)));
  }, [chats]);

  // tabs that show a note which no longer exists go away (deleted here, outside the app, or the notes folder was changed)
  const dropTabs = (ids) => {
    const ts = tabsRef.current || []; const rest = ts.filter((t) => !ids.includes(t.id));
    if (rest.length === ts.length) return;
    if (!rest.length) { const sn = chatSnap(); const nt = mkTab(sn); setTabs([nt]); setActiveTab(nt.id); applySnap(sn); return; }
    setTabs(rest);
    if (ids.includes(activeRef.current)) { const next = orderTabs(rest)[0]; setActiveTab(next.id); applySnap(next.s); }
  };
  useEffect(() => {
    if (!tabs || !activeTab || !notes.loaded) return;
    const have = new Set(notes.items.filter((i) => !i.dir).map((i) => i.path));
    const dead = tabs.filter((t) => t.s.view === 'note' && !have.has(t.s.notePath)).map((t) => t.id);
    if (dead.length) dropTabs(dead);
  }, [notes.items, notes.loaded]);

  const noteErr = (m) => askConfirm({ title: 'Notes', message: String(m || 'Something went wrong.'), confirmLabel: 'OK', cancelLabel: '' });
  const remapNote = (from, to) => {
    const m = (p) => (p === from ? to : p && p.startsWith(from + '/') ? to + p.slice(from.length) : p);
    setTabs((ts) => (ts || []).map((t) => (t.s.view === 'note' ? { ...t, s: { ...t.s, notePath: m(t.s.notePath) } } : t)));
    setNotePath((p) => m(p));
  };
  const noteActions = {
    open: (p, how) => {
      if (how === 'tab') { const o = noteTab(p); if (o) activateTab(o.id); else openTab(noteSnap(p)); return; }
      if (how === 'split') { splitNote(p); return; }
      const o = noteTab(p); if (o && o.id !== activeRef.current) activateTab(o.id); else openNote(p);
    },
    create: async (folder = '', name = 'Untitled') => {
      await flushAllNotes();
      const r = await api.notesCreate(name, folder, '');
      if (r && r.ok) { await refreshNotes(); openNote(r.path); } else await noteErr(r && r.error);
    },
    createFolder: async (parent = '') => {
      const name = await promptName('New folder name'); if (!name) return;
      const r = await api.notesCreateFolder(name, parent);
      if (r && r.ok) refreshNotes(); else await noteErr(r && r.error);
    },
    rename: async (target) => {
      const base = target.split('/').pop().replace(/\.md$/i, '');
      const name = await promptName('Rename', base); if (!name || name === base) return;
      await flushAllNotes();
      const r = await api.notesRename(target, name);
      if (r && r.ok) { remapNote(target, r.path); refreshNotes(); } else await noteErr(r && r.error);
    },
    remove: async (target) => {
      if (!(await askConfirm({ title: 'Delete', message: `Delete "${target}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
      await flushAllNotes();
      const r = await api.notesDelete(target);
      if (r && r.ok) { await refreshNotes(); dropTabs((tabsRef.current || []).filter((t) => t.s.view === 'note' && (t.s.notePath === target || (t.s.notePath || '').startsWith(target + '/'))).map((t) => t.id)); }
      else await noteErr(r && r.error);
    },
    move: async (src, folder) => {
      const parent = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : '';
      if (!src || parent === folder || src === folder || folder.startsWith(src + '/')) return;
      await flushAllNotes();
      const r = await api.notesMove(src, folder);
      if (r && r.ok) { remapNote(src, r.path); refreshNotes(); } else await noteErr(r && r.error);
    },
    pickRoot: async () => { await flushAllNotes(); const r = await api.notesPickRoot(); if (r) { setNotes((n) => ({ ...n, root: r })); refreshNotes(); } },
    reveal: () => api.notesReveal()
  };

  const sideApi = useRef({});
  useEffect(() => {
    const info = (e) => {
      const t = e.target; if (!t || !t.closest || t.closest('input, textarea, [contenteditable="true"]')) return null;
      const nav = t.closest('[data-nav]'), chat = t.closest('[data-chat]'), proj = t.closest('[data-project]');
      return nav ? { nav: nav.getAttribute('data-nav') } : chat ? { chat: chat.getAttribute('data-chat') } : proj ? { proj: proj.getAttribute('data-project') } : null;
    };
    const onCtx = (e) => {
      if (e.defaultPrevented) return; // the tab bar has its own menu
      const t = e.target; if (!t || !t.closest) return;
      const a = sideApi.current;
      const i = info(e); let items = [];
      if (i) {
        if (i.chat) {
          const c = chatsRef.current.find((x) => x.id === i.chat); if (!c) return;
          items = [
            { label: 'Open', onClick: () => a.select(i.chat) }, { label: 'Open in new tab', hint: '⌘-click', onClick: () => a.openChat(i.chat) }, { label: 'Open in split view', onClick: () => a.splitChat(i.chat) }, { sep: true },
            { label: c.pinned ? 'Unpin' : 'Pin', onClick: () => a.pinChat(i.chat) }, { label: 'Delete', danger: true, onClick: () => a.deleteChat(i.chat) }
          ];
        } else if (i.proj) {
          items = [{ label: 'Open', onClick: () => a.go({ view: { project: i.proj } }) }, { label: 'Open in new tab', hint: '⌘-click', onClick: () => a.open({ view: { project: i.proj } }) }];
        } else {
          items = [{ label: 'Open', onClick: () => a.goNav(i.nav) }, { label: 'Open in new tab', hint: '⌘-click', onClick: () => a.open(a.navSnap(i.nav)) }];
        }
        e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items }); return;
      }
      const field = t.closest('input, textarea, [contenteditable="true"]');
      if (field) { // Electron has no built-in menu for text fields
        e.preventDefault(); field.focus();
        const has = typeof field.selectionStart === 'number' ? field.selectionStart !== field.selectionEnd : String(window.getSelection()).length > 0;
        const ro = !!(field.readOnly || field.disabled);
        items = [
          { label: 'Cut', hint: '⌘X', disabled: !has || ro, onClick: () => document.execCommand('cut') },
          { label: 'Copy', hint: '⌘C', disabled: !has, onClick: () => document.execCommand('copy') },
          { label: 'Paste', hint: '⌘V', disabled: ro, onClick: async () => { try { const tx = await navigator.clipboard.readText(); field.focus(); document.execCommand('insertText', false, tx); } catch {} } },
          { sep: true }, { label: 'Select all', hint: '⌘A', onClick: () => { field.focus(); if (field.select) field.select(); else document.execCommand('selectAll'); } }
        ];
        setCtx({ x: e.clientX, y: e.clientY, items }); return;
      }
      const sel = String(window.getSelection ? window.getSelection() : '');
      const link = t.closest('a[href]'), code = t.closest('pre'), msgEl = t.closest('[data-msg]'), pane = t.closest('[data-chat-pane]');
      if (!sel && !link && !code && !msgEl) return; // nothing useful here
      if (link && /^https?:/i.test(link.href)) items.push({ label: 'Open in Artemis browser', onClick: () => a.openLink(link.href) }, { label: 'Open in default browser', onClick: () => window.api.openExternalUrl(link.href) }, { label: 'Copy link', onClick: () => navigator.clipboard.writeText(link.href) }, { sep: true });
      if (sel) items.push({ label: 'Copy', hint: '⌘C', onClick: () => navigator.clipboard.writeText(sel) });
      if (code) items.push({ label: 'Copy code', onClick: () => navigator.clipboard.writeText(code.innerText) });
      if (msgEl) {
        const mid = msgEl.getAttribute('data-msg'); const cid = pane ? pane.getAttribute('data-chat-pane') : currentRef.current;
        const c = chatsRef.current.find((x) => x.id === cid); const m = c && c.messages.find((x) => x.id === mid);
        if (m) {
          const text = m.role === 'user' ? (m.content || '') : (m.steps || []).map((st) => st.text || '').filter(Boolean).join('\n\n');
          const busy = a.isRunning(c.id);
          items.push({ label: 'Copy message', onClick: () => navigator.clipboard.writeText(text) });
          if (m.role === 'assistant' && !m.compacted) items.push({ label: 'Regenerate', disabled: busy, onClick: () => a.regen(m, c) });
          items.push({ sep: true }, { label: 'Delete message', danger: true, disabled: busy && m.role === 'assistant' && m === c.messages[c.messages.length - 1], onClick: () => a.deleteMsg(c.id, m.id) });
        }
      }
      while (items.length && items[0].sep) items.shift();
      while (items.length && items[items.length - 1].sep) items.pop();
      if (!items.length) return;
      e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, items });
    };
    const onClick = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return;
      const i = info(e); if (!i) return;
      e.preventDefault(); e.stopPropagation();
      const a = sideApi.current;
      if (i.chat) a.openChat(i.chat); else if (i.proj) a.open({ view: { project: i.proj } }); else a.open(a.navSnap(i.nav));
    };
    window.addEventListener('contextmenu', onCtx); window.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('contextmenu', onCtx); window.removeEventListener('click', onClick, true); };
  }, []);
  useEffect(() => { if (view === 'terminal' && !term.tabs.length) newTermTab(); }, [view, term.tabs.length]);

  // the browser page is a native view laid over the tab: show it only on the Browser tab and hide it behind pop-ups
  const browserOn = useRef(false);
  useEffect(() => {
    if (view === 'browser') { if (!browserOn.current) { browserOn.current = true; api.browserOpen(browser.url || 'https://www.google.com'); } }
    else if (browserOn.current) { browserOn.current = false; api.browserClose(); }
  }, [view]);
  useEffect(() => { if (browserOn.current) api.browserVisible && api.browserVisible(!palette && !modal && !ctx); }, [palette, modal, ctx, view]);

  // right-click menus: sidebar pages and chats, and ⌘-click to open in a new tab
  const NAV = {
    projects: { view: 'projects' }, schedule: { view: 'schedule' }, skills: { view: 'skills' }, agents: { view: 'agents' }, automations: { view: 'automations' },
    logs: { view: 'logs' }, terminal: { view: 'terminal' }, browser: { view: 'browser' },
    memory: { modal: 'memory' }, usage: { modal: 'usage' }, connectors: { modal: 'connectors' }, settings: { modal: 'settings' }
  };
  const navSnap = (k) => ({ view: 'chat', chatId: currentRef.current, modal: null, settingsTab: 'general', ...NAV[k] });
  // ---------- Sentinel (hands-free voice mode) ----------
  const [sent, setSent] = useState({ state: 'off', info: null, err: '' });
  const sentRef = useRef(null);
  const levelAt = useRef(0);
  const [brains, setBrains] = useState([]);
  useEffect(() => { const load = () => window.api.brainsList().then(setBrains).catch(() => {}); load(); const off = window.api.onBrainsChanged && window.api.onBrainsChanged(load); return () => off && off(); }, []);
  const pendingVoice = useRef(null); // chat id waiting for a spoken reply
  const sentChat = useRef(null);     // the chat Sentinel talks in: its own, whatever chat is open
  const voiceT0 = useRef(0);         // when the spoken question was sent, to log how fast the answer starts
  const voiceStream = useRef(null);  // the reply being read aloud while it is still being written
  // Sentinel: read the reply sentence by sentence as it is written, in parallel with the text appearing in the chat.
  // The model pauses (a tool call, a new step): read what is already written, even without a full stop, then wait and carry on when more arrives.
  const voiceFlush = (st) => {
    const vs = voiceStream.current;
    if (!vs || vs.sid !== st.chatId || pendingVoice.current !== st.chatId) return;
    vs.text += '\n\n';
    for (const p of takePieces(vs.text, vs.st, true)) vs.speaker.push(p);
  };
  const voiceChunk = (st, text) => {
    if (pendingVoice.current !== st.chatId) return;
    const sn = sentRef.current; if (!sn || !sn.running) return;
    let vs = voiceStream.current;
    if (!vs || vs.sid !== st.chatId || vs.rid !== st.msgId) {
      const s0 = settingsRef.current || {};
      vs = voiceStream.current = { sid: st.chatId, rid: st.msgId, text: '', st: { consumed: 0, spoken: 0, n: 0 }, shown: 0, done: false };
      const me = vs;
      const since = () => ((performance.now() - voiceT0.current) / 1000).toFixed(1) + 's';
      log('info', 'sentinel', `First text of the answer arrived after ${since()}`);
      me.speaker = createSpeaker({
        language: s0.voiceLanguage,
        onStart: () => { log('info', 'sentinel', `Voice started after ${since()}${me.done ? ' (the answer was already complete)' : ' (while it was still being written)'}`); if (sn.running) sn.speaking(); },
        onIdle: () => { if (voiceStream.current === me) voiceStream.current = null; if (sn.running && (sn.state === 'speaking' || (me.done && sn.state === 'thinking'))) sn.next(); } // back to waiting for "Wake up"
      });
    }
    vs.text += text;
    // Update UI immediately to keep spoken text in sync
    setSent((p) => ({ ...p, said: vs.text }));
    // Queue every finished sentence on the one speaker: it plays them in order while the text is still being written.
    // (Never call speak() here: it stops whatever is playing, including this speaker's queue.)
    for (const p of takePieces(vs.text, vs.st)) vs.speaker.push(p);
  };
  const actionsRef = useRef({});
  const flashSent = (err) => { setSent((p) => ({ ...p, err })); if (err) setTimeout(() => setSent((p) => (p.err === err ? { ...p, err: '' } : p)), 9000); };
  const startSentinel = () => {
    if (sentRef.current && sentRef.current.running) return;
    const sn = new Sentinel({
      onState: (state, info) => setSent((p) => ({ ...p, state, info: info || null, err: state === 'off' ? p.err : '', ...(state === 'off' || (state === 'listening' && info && info.wake) ? { heard: '', said: '' } : {}) })),
      onLevel: (v) => { const n = performance.now(); if (n - (levelAt.current || 0) > 90) { levelAt.current = n; window.api.sentinelLevel && window.api.sentinelLevel(v); } },
      onError: (e) => flashSent(e),
      canInterrupt: () => (settingsRef.current || {}).sentinelInterrupt === true,
      getMinRms: () => ({ high: 0.008, low: 0.026 }[(settingsRef.current || {}).sentinelSensitivity] || 0.012),
      onBarge: () => { actionsRef.current.voiceCmd && actionsRef.current.voiceCmd({ type: 'stop' }); }, // "stop" said while Artemis thinks or speaks
      onUtterance: async (wav) => {
        const s = settingsRef.current || {};
        const out = await window.api.voiceTranscribe({ audio: wav, mime: 'audio/wav', language: s.voiceLanguage && s.voiceLanguage !== 'auto' ? s.voiceLanguage : '', });
        if (!sn.running) return;
        if (!out.ok) { log('error', 'sentinel', 'Speech-to-text failed: ' + out.error); flashSent(out.error); sn.next(); return; }
        // First sentence after "Wake up": it must start with the phrase. After that the conversation goes on without it.
        const inSession = !!sn.session;
        let text;
        if (inSession && (settingsRef.current || {}).sentinelNameOnly !== false) {
          // Other people may be talking nearby. Inside a conversation a sentence counts only if it begins with "Artemis" (or "Wake up"),
          // or follows Artemis' reply within a few seconds. Everything else is ignored, and after a few in a row the conversation ends.
          const named = afterName(out.text);
          const follow = sn.utterStart - sn.lastReplyEnd <= 6000;
          if (named !== null) text = named;
          else if (follow) text = stripWake(out.text);
          else {
            sn.ignored = (sn.ignored || 0) + 1;
            log('info', 'sentinel', `Ignored (not said to Artemis, ${sn.ignored}): "${out.text}"`);
            if (sn.ignored >= 3) { sn.ignored = 0; sn.resume(); } else sn.next();
            return;
          }
          sn.ignored = 0;
        } else text = inSession ? stripWake(out.text) : afterWake(out.text);
        if (text === null) { log('info', 'sentinel', `Ignored (the speech did not start with "Wake up"): "${out.text}"`); sn.resume(); return; }
        log('info', 'sentinel', `Heard: "${out.text}"${text ? '' : ' (nothing after the wake phrase)'}`);
        sn.session = true;
        if (!text) { sn.next(); return; }
        if (inSession && looksLikeNoise(text) && !parseCommand(text, { brains })) { log('info', 'sentinel', 'Ignored (noise)'); sn.next(); return; }
        setSent((p) => ({ ...p, heard: text, said: '' }));
        actionsRef.current.sendVoice(text);
      }
    });
    sentRef.current = sn;
    sn.start();
  };
  const stopSentinel = () => { const sn = sentRef.current; pendingVoice.current = null; sentChat.current = null; voiceStream.current = null; if (sn) sn.stop(); stopSpeaking(); };
  const toggleSentinel = () => { if (sentRef.current && sentRef.current.running) stopSentinel(); else startSentinel(); };
  // Stop button on the pill: cut the reading / give up on the current question and go back to waiting for "Wake up".
  const skipSentinel = () => { const sn = sentRef.current; if (!sn || !sn.running) return; pendingVoice.current = null; voiceStream.current = null; sn.resume(); stopSpeaking(); };
  useEffect(() => () => { try { sentRef.current && sentRef.current.stop(); } catch {} }, []);
  // The floating widget (a separate window) and the tray show the state and send actions back.
  useEffect(() => { if (window.api.sentinelState) window.api.sentinelState({ state: sent.state, info: sent.info, err: sent.err, heard: sent.heard || '', said: sent.said || '' }); }, [sent]);
  actionsRef.current.sentinelAct = (a) => {
    if (a === 'toggle') toggleSentinel();
    else if (a === 'stop') stopSentinel();
    else if (a === 'skip') skipSentinel();
    else if (a === 'dismiss') flashSent('');
    else if (a === 'logs') setView('logs');
    else if (a === 'settings') { setSettingsTab('voice'); setModal('settings'); }
  };
  useEffect(() => (window.api.onSentinelAction ? window.api.onSentinelAction((a) => actionsRef.current.sentinelAct && actionsRef.current.sentinelAct(a)) : undefined), []);
  const newTermTab = () => { const key = 't' + (++termSeq.current); setTerm((t) => ({ ...t, open: true, tabs: [...t.tabs, { key, id: null }], active: key })); };
  const toggleTerm = () => { const t = termRef.current; if (!t.tabs.length) newTermTab(); else setTerm({ ...t, open: !t.open }); };
  const closeTermTab = (key) => setTerm((t) => {
    const tab = t.tabs.find((x) => x.key === key); if (tab && tab.id) api.termClose(tab.id);
    const tabs = t.tabs.filter((x) => x.key !== key);
    return { ...t, tabs, open: tabs.length ? t.open : false, active: t.active === key ? (tabs[tabs.length - 1]?.key || null) : t.active };
  });
  const popOutTerm = (key, float) => {
    const tab = termRef.current.tabs.find((x) => x.key === key); if (!tab || !tab.id) return;
    api.termPopOut(tab.id, float);
    setTerm((t) => { const tabs = t.tabs.filter((x) => x.key !== key); return { ...t, tabs, open: tabs.length ? t.open : false, active: tabs[tabs.length - 1]?.key || null }; });
  };
  useEffect(() => api.onTermDocked && api.onTermDocked(({ id }) => {
    const key = 't' + (++termSeq.current);
    setTerm((t) => ({ ...t, open: true, tabs: [...t.tabs, { key, id }], active: key }));
  }), []);
  useEffect(() => {
    const k = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === '`' || e.code === 'Backquote')) { e.preventDefault(); toggleTerm(); }
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); toggleTerm(); }
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); tabApi.current.gotoTab(Number(e.key)); }
      else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); tabApi.current.stepTab(e.shiftKey ? -1 : 1); }
      else if (e.metaKey && e.shiftKey && !e.altKey && (e.key === ']' || e.key === '}')) { e.preventDefault(); tabApi.current.stepTab(1); }
      else if (e.metaKey && e.shiftKey && !e.altKey && (e.key === '[' || e.key === '{')) { e.preventDefault(); tabApi.current.stepTab(-1); }
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPalette((v) => !v); }
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === '\\' || e.code === 'Backslash')) { e.preventDefault(); setSidebarHidden((v) => !v); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); toggleSentinel(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  // Optional (Settings → Voice): load the offline voice model in the background once the computer is idle, so Sentinel starts at once.
  // Off by default: unpacking the model uses a lot of CPU and memory and can freeze weaker computers while the app is opening.
  const warmed = useRef(false);
  useEffect(() => {
    if (!settings || warmed.current || settings.sentinelPreload !== true) return;
    warmed.current = true;
    let t2 = null;
    const t = setTimeout(() => {
      const go = () => preloadSentinel();
      if (window.requestIdleCallback) t2 = window.requestIdleCallback(go, { timeout: 60000 }); else go();
    }, 45000);
    return () => { clearTimeout(t); if (t2 && window.cancelIdleCallback) window.cancelIdleCallback(t2); };
  }, [!!settings, settings && settings.sentinelPreload]);
  const autoSent = useRef(false);
  useEffect(() => {
    if (!settings || !settings.sentinelAuto || autoSent.current) return;
    autoSent.current = true;
    window.api.sentinelStatus().then((st) => { if (st && st.ready) startSentinel(); }).catch(() => {});
  }, [settings && settings.sentinelAuto]);
  const settingsRef = useRef(null); settingsRef.current = settings;
  window.__voiceLang = (settings && settings.voiceLanguage) || 'auto';
  window.__voiceName = (settings && settings.voiceName) || '';
  window.__voiceRate = Number(settings && settings.voiceRate) || 1;
  window.__micId = (settings && settings.micDeviceId) || '';
  window.__speakerId = (settings && settings.speakerDeviceId) || '';
  window.__tts = { engine: (settings && settings.ttsEngine) || 'system' };
  useEffect(() => { setPanel(null); }, [currentId]);
  useEffect(() => {
    const request = async (url) => {
      if (!/^https?:\/\//i.test(url || '')) return;
      if (await askConfirm({ title: 'Open link?', message: `Open this link in Artemis's integrated browser?\n\n${url}`, confirmLabel: 'Open' })) { setBrowser((b) => ({ ...b, url })); if (viewRef.current === 'browser') api.browserNavigate(url); else setView('browser'); }
    };
    const h = (e) => {
      const url = e.detail;
      if (!/^https?:\/\//i.test(url || '')) return;
      request(url);
    };
    const off = api.onBrowserRequest(request);
    window.addEventListener('aid-browser-open', h);
    return () => { window.removeEventListener('aid-browser-open', h); off?.(); };
  }, []);
  const project = chat && projects.find((p) => p.id === chat.projectId);

  useEffect(() => {
    (async () => {
      const [s, c, p, m] = await Promise.all([api.getSettings(), api.getStore('chats'), api.getStore('projects'), api.getStore('memory')]);
      setSettings(s); setProjects(p || []); setMemory(m || []);
      if (api.platform === 'darwin' && !s.permissionsAsked) setModal('permissions');
      const list = c || [];
      if (list.length) {
        setChats(list);
        setCurrentId([...list].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
      } else {
        const first = { id: uid(), title: 'New chat', model: s.model, projectId: null, messages: [], updatedAt: Date.now() };
        setChats([first]); setCurrentId(first.id);
      }
      setLoaded(true);
      api.providersList().then(applyProviders).catch(() => {});
      api.mcpStatus().then((l) => setConnectorCount(l.filter((x) => x.state === 'connected').length)).catch(() => {});
      if (!s.hasApiKey) setModal('settings');
    })();
  }, []);

  // messages written from Telegram into a desktop chat
  useEffect(() => api.onChatAppend(({ chatId, user, assistant }) => {
    setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, updatedAt: Date.now(), messages: [...c.messages, { id: uid(), role: 'user', content: user, via: 'telegram' }, { id: uid(), role: 'assistant', via: 'telegram', steps: [{ text: assistant, toolCalls: [] }] }] } : c)));
  }), []);
  useEffect(() => { if (!loaded) return; const t = setTimeout(() => api.setStore('chats', stripImages(chats)), 300); return () => clearTimeout(t); }, [chats, loaded]);
  useEffect(() => { if (!loaded) return; api.setStore('projects', projects); }, [projects, loaded]);

  // ---------- tema ----------
  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.vars = '1';
    applyTheme(settings.theme, themeChoices);
  }, [settings?.theme, settings?.activeProjectId, themeChoices]);

  // Themes are JSON: main reads <userData>/themes and <project>/.artemis/themes, we inject them and repaint.
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const t = await loadThemes(api, project?.folder);
      if (alive) { setThemeChoices([SYSTEM_THEME, ...t]); applyTheme(settings?.theme, t); }
      return t;
    };
    run();
    const off = api.onThemeChanged ? api.onThemeChanged(run) : undefined;
    return () => { alive = false; if (off) off(); };
  }, [project?.folder]);
  useEffect(() => { if (settings) applyTextSize(settings.textSize); }, [settings?.textSize]);

  // ---------- stream events ----------
  const reloadMemory = useCallback(async () => setMemory((await api.getStore('memory')) || []), []);

  useEffect(() => api.onEvent((ev) => {
    if (ev.type === 'memory:changed') { reloadMemory(); return; }
    const st = streamsRef.current[ev.requestId];
    if (!st) return;
    const patch = (fn) => setChats((cs) => cs.map((c) => (c.id !== st.chatId ? c : {
      ...c, updatedAt: Date.now(), messages: c.messages.map((m) => (m.id === st.msgId ? fn(m) : m))
    })));
    switch (ev.type) {
      case 'chunk': patch((m) => lastStep(m, (s) => ({ ...s, text: s.text + ev.text }))); voiceChunk(st, ev.text); break;
      case 'step:new': patch((m) => ({ ...m, steps: [...m.steps, { text: '', toolCalls: [] }] })); voiceFlush(st); break;
      case 'tool:call':
        if (!ev.agent) voiceFlush(st);
        if (ev.agent) patch((m) => patchAgent(m, ev.agent.parent, ev.agent.idx, (a) => ({ ...a, tools: [...a.tools, { id: ev.id, name: ev.name, args: ev.args, status: 'running' }] })));
        else patch((m) => lastStep(m, (s) => ({ ...s, toolCalls: [...s.toolCalls, { id: ev.id, name: ev.name, args: ev.args, status: 'running' }] })));
        break;
      case 'agent:start': patch((m) => patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, name: ev.agent, role: ev.role, task: ev.task, model: ev.model, status: 'running', prompt: 0, completion: 0 }))); break;
      case 'agent:chunk': patch((m) => patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, text: ((a.text || '') + ev.text).slice(-600) }))); break;
      case 'agent:usage': patch((m) => patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, prompt: ev.prompt, completion: ev.completion }))); break;
      case 'agent:done': patch((m) => patchAgent(m, ev.parent, ev.idx, (a) => ({ ...a, status: ev.ok ? 'done' : 'error', error: ev.error, prompt: ev.prompt ?? a.prompt, completion: ev.completion ?? a.completion, tools: a.tools.map((x) => (x.status === 'running' ? { ...x, status: ev.ok ? 'done' : 'cancelled' } : x)) }))); break;
      case 'tool:approval': patch((m) => patchTool(m, ev.id, (t) => ({ ...t, status: 'awaiting', session: ev.session, category: ev.category, agent: ev.agent, summary: ev.summary }))); break;
      case 'tool:result': if (ev.ok && /^notes_(write|append|edit)$/.test(ev.name || '')) { refreshNotes(); setNoteRev((n) => n + 1); } patch((m) => patchTool(m, ev.id, (t) => ({ ...t, status: ev.denied ? 'denied' : ev.ok ? 'done' : 'error', result: ev.text, image: ev.image }))); break;
      case 'artifact':
        setChats((cs) => cs.map((c) => {
          if (c.id !== st.chatId) return c;
          const prev = c.artifacts && c.artifacts[ev.id];
          const versions = [...(prev ? prev.versions : []), ev.content].slice(-12);
          return { ...c, artifacts: { ...(c.artifacts || {}), [ev.id]: { id: ev.id, title: ev.title, type: ev.kind, language: ev.language, versions } } };
        }));
        patch((m) => lastStep(m, (s) => ({ ...s, artifactRefs: [...(s.artifactRefs || []), ev.id] })));
        if (currentRef.current === st.chatId) setPanel({ type: 'artifact', id: ev.id });
        break;
      case 'media': patch((m) => lastStep(m, (s) => ({ ...s, media: [...(s.media || []), { kind: ev.kind, path: ev.path, prompt: ev.prompt, model: ev.model }] }))); break;
      case 'brain': patch((m) => ({ ...m, brain: { name: ev.name, role: ev.role, model: ev.model } })); break;
      case 'council': patch((m) => ({ ...m, council: { votes: ev.votes, verdict: ev.verdict, tokens: ev.tokens } })); if (ev.verdict && ev.verdict.answerer) updateChat(st.chatId, { councilPick: ev.verdict.answerer }); break;
      case 'council:start': patch((m) => ({ ...m, council: { pending: true } })); break;
      case 'notice': patch((m) => ({ ...m, notices: [...(m.notices || []), ev.text] })); break;
      case 'error': patch((m) => ({ ...m, error: ev.message })); break;
      case 'done':
        patch((m) => {
          let steps = m.steps.map((s) => ({
            ...s, toolCalls: s.toolCalls.map((t) => {
              const t2 = t.status === 'running' || t.status === 'awaiting' ? { ...t, status: 'cancelled' } : t;
              return t2.agents ? { ...t2, agents: t2.agents.map((a) => (a && a.status === 'running' ? { ...a, status: 'cancelled', tools: a.tools.map((x) => (x.status === 'running' || x.status === 'awaiting' ? { ...x, status: 'cancelled' } : x)) } : a)) } : t2;
            })
          }));
          while (steps.length > 1 && !steps[steps.length - 1].text && !steps[steps.length - 1].toolCalls.length) steps = steps.slice(0, -1);
          return { ...m, steps };
        });
        delete streamsRef.current[ev.requestId];
        setRunningIds((ids) => ids.filter((id) => id !== st.chatId));
        { const sid = st.chatId, mid = st.msgId;
          // Handle completion immediately without artificial delay
          if (pendingVoice.current === sid) {
            pendingVoice.current = null;
            const sn = sentRef.current; const s0 = settingsRef.current || {};
            const vs = voiceStream.current;
            if (vs && vs.sid === sid && sn && sn.running) {
              // Finish streaming pieces
              for (const p of takePieces(vs.text, vs.st, true)) vs.speaker.push(p);
              vs.done = true; const full = vs.text; setSent((p) => ({ ...p, said: full }));
              vs.speaker.end();
            } else {
              const m0 = (chatsRef.current.find((x) => x.id === sid) || { messages: [] }).messages.find((x) => x.id === mid);
              const t0 = m0 && assistantText(m0);
              if (sn && sn.running && t0) {
                setSent((p) => ({ ...p, said: t0 }));
                sn.speaking();
                const ok = speak(spokenPart(t0).text, { language: s0.voiceLanguage, onEnd: () => { if (sn.running && sn.state === 'speaking') sn.next(); } });
                if (!ok) sn.next();
              } else if (sn) {
                sn.next();
              }
            }
          } else {
            const s = settingsRef.current;
            if (s && s.voiceAutoRead && currentRef.current === sid) {
              const m = (chatsRef.current.find((x) => x.id === sid) || { messages: [] }).messages.find((x) => x.id === mid);
              const t = m && assistantText(m);
              if (t) speak(t, { language: s.voiceLanguage });
            }
          }
        }
        break;
      default:
    }
  }), [reloadMemory]);

  // ---------- scrolling ----------
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chats, currentId]);
  const onScroll = () => {
    const el = listRef.current;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  useEffect(() => observeBottom(listRef.current, stick), [view, currentId, activeTab]);

  // ---------- chat operations ----------
  const runOf = (chatId) => Object.entries(streamsRef.current).find(([, v]) => v.chatId === chatId);
  const isRunning = (chatId) => runningIds.includes(chatId);
  const awaitingOf = (c) => c.messages.some((m) => (m.steps || []).some((st) => (st.toolCalls || []).some((t) => t.status === 'awaiting' || (t.agents || []).some((a) => a && (a.tools || []).some((x) => x.status === 'awaiting')))));
  const statusOf = (c) => (awaitingOf(c) ? 'awaiting' : isRunning(c.id) ? 'running' : null);

  const select = (id) => {
    const other = (tabsRef.current || []).find((t) => t.id !== activeRef.current && t.s.view === 'chat' && t.s.chatId === id);
    if (other) { activateTab(other.id); return; } // already open in another tab: go there
    // incognito chats vanish as soon as you leave them
    chats.filter((c) => c.incognito && c.id !== id).forEach((c) => { const run = runOf(c.id); if (run) api.abort(run[0]); });
    setChats((cs) => cs.filter((c) => !c.incognito || c.id === id));
    stick.current = true; setCurrentId(id); setView('chat');
  };

  const newIncognito = () => {
    const existing = chats.find((c) => c.incognito && !c.messages.length);
    if (existing) { select(existing.id); return existing; }
    const c = { id: uid(), title: 'Incognito chat', model: defaultModel(settings, providers), projectId: null, incognito: true, messages: [], updatedAt: Date.now() };
    setChats((cs) => [c, ...cs.filter((x) => !x.incognito)]);
    select(c.id);
    return c;
  };

  const newChat = (projectId) => {
    const pid = projectId !== undefined ? projectId : (view && view.project ? view.project : null);
    const empty = chats.find((c) => !c.incognito && !c.messages.length && (c.projectId || null) === pid);
    if (empty) { select(empty.id); return empty; }
    const c = { id: uid(), title: 'New chat', model: defaultModel(settings, providers), projectId: pid, messages: [], updatedAt: Date.now() };
    setChats((cs) => [c, ...cs]);
    select(c.id);
    return c;
  };

  const deleteChat = (id) => {
    const run = runOf(id);
    if (run) api.abort(run[0]);
    const rest = chats.filter((c) => c.id !== id);
    if (!rest.length) {
      const c = { id: uid(), title: 'New chat', model: defaultModel(settings, providers), projectId: null, messages: [], updatedAt: Date.now() };
      setChats([c]); select(c.id);
    } else {
      setChats(rest);
      if (id === currentId) setCurrentId([...rest].sort((a, b) => b.updatedAt - a.updatedAt)[0].id);
    }
  };

  const deleteMessage = (chatId, msgId) => {
    const run = runOf(chatId);
    if (run && run[1].msgId === msgId) return; // the answer still being written
    setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, messages: c.messages.filter((m) => m.id !== msgId) } : c)));
  };

  const updateChat = (id, patch) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const brainOf = (c) => (c && c.brain !== undefined ? c.brain : (settings.defaultBrain || ''));
  const startStream = (c, msgs, opts) => {
    const asst = { id: uid(), role: 'assistant', steps: [{ text: '', toolCalls: [] }] };
    const requestId = uid();
    streamsRef.current[requestId] = { chatId: c.id, msgId: asst.id };
    setRunningIds((ids) => [...ids, c.id]);
    stick.current = true;
    setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, messages: [...msgs, asst], updatedAt: Date.now() } : x)));
    const p = projects.find((x) => x.id === c.projectId);
    api.chat({
      requestId, model: c.model, messages: toApiMessages(msgs), system: settings.systemPrompt + (opts && opts.voice ? '\n\n' + VOICE_HINT : ''),
      project: p ? { name: p.name, instructions: p.instructions, folder: p.folder } : null, maxTokens: settings.maxTokens, incognito: !!c.incognito,
      chatId: c.id, brain: brainOf(c), brainPick: c.councilPick || '', agentsMode: c.agents || '', toolsMode: c.tools || '', effort: c.effort || '', permMode: c.perm === 'auto' ? 'auto' : c.perm ? 'ask' : (settings.autoApproveEdits ? 'auto' : 'ask')
    });
  };

  const sendTo = (c, text, atts, opts) => {
    if (!c || isRunning(c.id)) return false;
    if (!settings.hasApiKey) { setModal('settings'); return false; }
    if (held[c.id]) setHeld((h) => ({ ...h, [c.id]: false }));
    const user = { id: uid(), role: 'user', content: text, attachments: atts };
    const msgs = [...c.messages, user];
    if (!c.messages.length && !c.incognito) updateChat(c.id, { title: (text || atts[0]?.name || 'New chat').replace(/\s+/g, ' ').slice(0, 48) });
    startStream(c, msgs, opts);
    return true;
  };
  const send = (text, atts) => sendTo(chat, text, atts);
  // Message queue: what you type while an answer is being written waits here and goes out when the answer ends.
  const [queues, setQueues] = useState({}); // chat id -> [{ id, text, atts }]
  const [held, setHeld] = useState({}); // chat id -> true while the queue waits after a manual Stop
  const enqueue = (cid, text, atts) => setQueues((q) => ({ ...q, [cid]: [...(q[cid] || []), { id: uid(), text, atts }] }));
  const unqueue = (cid, id) => setQueues((q) => ({ ...q, [cid]: (q[cid] || []).filter((x) => x.id !== id) }));
  const sendNow = (cid, id) => {
    setQueues((q) => { const l = q[cid] || []; const it = l.find((x) => x.id === id); return it ? { ...q, [cid]: [it, ...l.filter((x) => x.id !== id)] } : q; });
    setHeld((h) => ({ ...h, [cid]: false }));
    const c = chats.find((x) => x.id === cid);
    if (c && isRunning(cid)) stop(c, true); // the queue sends it as soon as the run has ended
  };
  const queueFor = (c) => ({ queue: (c && queues[c.id]) || [], queueHeld: !!(c && held[c.id]), onQueue: (text, atts) => c && enqueue(c.id, text, atts), onUnqueue: (id) => c && unqueue(c.id, id), onSendNow: (id) => c && sendNow(c.id, id) });
  useEffect(() => {
    for (const [cid, list] of Object.entries(queues)) {
      if (!list.length || isRunning(cid) || held[cid]) continue;
      const c = chats.find((x) => x.id === cid);
      if (!c) continue;
      setQueues((q) => ({ ...q, [cid]: (q[cid] || []).slice(1) }));
      sendTo(c, list[0].text, list[0].atts);
      break;
    }
  }, [queues, runningIds, chats, held]);
  // Compact button: summarize the older messages into one card and keep the last few as they are.
  const [compacting, setCompacting] = useState(false);
  const compactTail = (c) => { let i = Math.max(0, c.messages.length - 4); while (i > 0 && c.messages[i].role !== 'user') i--; return i; };
  const canCompact = (c) => !!c && !isRunning(c.id) && !compacting && compactTail(c) >= 2;
  const compactChat = async (target) => {
    const c = target && target.messages ? target : chat; if (!canCompact(c)) return;
    const at = compactTail(c); const older = c.messages.slice(0, at);
    setCompacting(true);
    try {
      const r = await api.compact({ model: c.model, messages: toApiMessages(older), chatId: c.id, incognito: !!c.incognito });
      if (!r.ok) { flashSent(r.error); return; }
      const card = { id: uid(), role: 'user', compacted: older.length, content: `[Summary of the earlier conversation — compacted to save tokens]\n${r.summary}` };
      setChats((cs) => cs.map((x) => (x.id === c.id ? { ...x, messages: [card, ...x.messages.slice(at)], updatedAt: Date.now() } : x)));
    } catch (e) { flashSent((e && e.message) || String(e)); }
    finally { setCompacting(false); }
  };
  actionsRef.current.compact = compactChat;
  // Sentinel has its own chat, independent of the one on screen. The first thing you say opens it; "new chat" starts another.
  const sentinelChat = (fresh) => {
    const cur = chatsRef.current.find((x) => x.id === sentChat.current);
    if (cur && !fresh) return cur;
    if (cur && fresh && !cur.messages.length) { select(cur.id); return cur; }
    // Fast by default: the chosen Sentinel model and no council vote (say "turn on the council" to get it back).
    const c = { id: uid(), title: 'New chat', model: settings.sentinelModel || defaultModel(settings, providers), projectId: null, sentinel: true, brain: '', messages: [], updatedAt: Date.now() };
    setChats((cs) => [c, ...cs]);
    sentChat.current = c.id;
    select(c.id);
    return c;
  };
  // Say a short answer and go back to waiting for "Wake up".
  const sayVoice = (text, end = false) => {
    const sn = sentRef.current; if (!sn || !sn.running) return;
    pendingVoice.current = null;
    if (!text) { end ? sn.resume() : sn.next(); return; }
    setSent((p) => ({ ...p, said: text }));
    sn.speaking();
    speak(text, { language: (settingsRef.current || {}).voiceLanguage, onEnd: () => { if (sn.running) { end ? sn.resume() : sn.next(); } } });
  };
  // Everything in the chat bar can be said out loud: agents, brains, permissions, new / incognito chat, pages.
  const voiceModels = () => modelGroups('', providers).flatMap((g) => g.items.map(([id, n]) => ({ id, name: n.replace(/\s*\([^)]*\)\s*$/, '') })));
  const runVoiceCommand = (cmd) => {
    log('info', 'sentinel', `Voice command: ${JSON.stringify({ type: cmd.type, value: cmd.value, page: cmd.page })}`);
    const sn = sentRef.current;
    switch (cmd.type) {
      case 'stop': {
        const c = chatsRef.current.find((x) => x.id === sentChat.current); const run = c && runOf(c.id); if (run) api.abort(run[0]);
        pendingVoice.current = null; voiceStream.current = null; stopSpeaking(); sn && sn.next(); return;
      }
      case 'sentinelOff': stopSentinel(); return;
      case 'bye': sayVoice(confirmText(cmd), true); return; // the conversation ends: back to waiting for "Wake up"
      case 'agents': { const c = sentinelChat(false); updateChat(c.id, { agents: cmd.value }); break; }
      case 'brain': { const c = sentinelChat(false); updateChat(c.id, { brain: cmd.value, councilPick: null }); break; }
      case 'perm': { const c = sentinelChat(false); updateChat(c.id, { perm: cmd.value }); break; }
      case 'model': { const c = sentinelChat(false); updateChat(c.id, { model: cmd.value }); api.setSettings({ sentinelModel: cmd.value }).then((s) => setSettings({ ...s })).catch(() => {}); break; }
      case 'newChat': sentinelChat(true); break;
      case 'incognito': { const c = newIncognito(); if (c) sentChat.current = c.id; break; }
      case 'compact': { const c = sentinelChat(false); compactChat(c); break; }
      case 'open':
        if (cmd.page === 'settings') { setSettingsTab('general'); setModal('settings'); } else setView(cmd.page);
        break;
      default: break;
    }
    sayVoice(confirmText(cmd));
  };
  actionsRef.current.voiceCmd = runVoiceCommand;
  // A sentence heard by Sentinel: a command, or a message for Sentinel's own chat (the reply is read aloud as it is written).
  actionsRef.current.sendVoice = (text) => {
    const sn = sentRef.current;
    const cmd = parseCommand(text, { brains, models: voiceModels() });
    if (cmd) { runVoiceCommand(cmd); return; }
    if (!settings.hasApiKey) { flashSent('Add a provider in Settings first.'); sn && sn.resume(); return; }
    let c = sentinelChat(false);
    if (isRunning(c.id)) c = sentinelChat(true); // still answering the last one: this goes to a new chat
    if (currentRef.current !== c.id || !chatView) select(c.id);
    pendingVoice.current = c.id; voiceT0.current = performance.now();
    sn && sn.thinking();
    log('info', 'sentinel', `Sending to chat "${c.title}" (brain: ${brainOf(c) || 'none'})`);
    if (!sendTo(c, text, [], { voice: true })) { pendingVoice.current = null; log('warn', 'sentinel', 'The chat could not start the message'); flashSent('Could not send: this chat is busy or has no API key.'); sn && sn.next(); }
  };

  const startProjectChat = (projectId) => (text, atts) => {
    const c = { id: uid(), title: 'New chat', model: defaultModel(settings, providers), projectId, messages: [], updatedAt: Date.now() };
    setChats((cs) => [c, ...cs]);
    select(c.id);
    sendTo(c, text, atts);
  };

  const regenerate = (msg, c = chat) => {
    if (!c || isRunning(c.id)) return;
    const idx = c.messages.indexOf(msg);
    if (idx < 1) return;
    startStream(c, c.messages.slice(0, idx));
  };

  const stop = (c = chat, keepQueue = false) => {
    const run = c && runOf(c.id);
    if (!run) return;
    if (!keepQueue && (queues[c.id] || []).length) setHeld((h) => ({ ...h, [c.id]: true })); // a Stop pauses the queue
    const [rid, st] = run;
    api.abort(rid);
    // A run that does not wind down by itself must not lock the chat: release it so messages can be deleted and a new one sent.
    setTimeout(() => {
      if (!streamsRef.current[rid]) return;
      delete streamsRef.current[rid];
      setRunningIds((ids) => ids.filter((id) => id !== st.chatId));
      setChats((cs) => cs.map((x) => (x.id !== st.chatId ? x : { ...x, messages: x.messages.map((m) => (m.id !== st.msgId ? m : { ...m, steps: (m.steps || []).map((s) => ({ ...s, toolCalls: (s.toolCalls || []).map((t) => (t.status === 'running' || t.status === 'awaiting' ? { ...t, status: 'cancelled' } : t)) })) })) })));
    }, 2500);
  };

  const decide = (toolId, ok) => {
    api.decide(toolId, ok);
    if (ok) setChats((cs) => cs.map((c) => (awaitingOf(c) ? { ...c, messages: c.messages.map((m) => (m.steps ? patchTool(m, toolId, (t) => (t.status === 'awaiting' ? { ...t, status: 'running' } : t)) : m)) } : c)));
  };

  // ---------- settings / memory / projects ----------
  const saveSettings = async (s) => {
    const { hasApiKey, ...patch } = s;
    try { setSettings(await api.setSettings(patch)); } catch (e) { console.error('Saving settings failed', e); }
    setModal(null);
  };
  const changeMemory = (list) => { setMemory(list); api.setStore('memory', list); };
  const toggleMemory = async (on) => setSettings(await api.setSettings({ memoryEnabled: on }));

  const saveProject = (p) => {
    if (p.id) setProjects((ps) => ps.map((x) => (x.id === p.id ? p : x)));
    else {
      const np = { ...p, id: uid() };
      setProjects((ps) => [...ps, np]);
      setView({ project: np.id });
    }
    setModal(null);
  };
  const deleteProject = (id) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    setChats((cs) => cs.map((c) => (c.projectId === id ? { ...c, projectId: null } : c)));
    if (view && view.project === id) setView('projects');
    setModal(null);
  };

  // menu events (ref so the closure is always current)
  const menuRef = useRef();
  menuRef.current = (what) => { if (what === 'new-chat') newChat(null); if (what === 'settings') setModal('settings'); if (what === 'palette') setPalette((v) => !v); if (what === 'palette-open') setPalette(true); if (what === 'new-tab') tabApi.current.newTab(); if (what === 'close-tab') tabApi.current.closeTab(activeRef.current); };
  useEffect(() => api.onMenu((w) => menuRef.current(w)), []);
  useEffect(() => api.onQuickImport((c) => {
    const nc = { ...c, id: uid() };
    setChats((cs) => [nc, ...cs]); setCurrentId(nc.id); setView('chat');
  }), []);

  useEffect(() => {
    const h = (e) => {
      const result = Array.isArray(e.detail) ? { chats: e.detail, projects: [], memory: [] } : (e.detail || {});
      setProjects((ps) => {
        const have = new Set(ps.map((p) => p.importKey).filter(Boolean));
        const fresh = (result.projects || []).filter((p) => !p.importKey || !have.has(p.importKey));
        return fresh.length ? [...ps, ...fresh] : ps;
      });
      setMemory((ms) => {
        const have = new Set(ms.map((m) => m.text));
        const fresh = (result.memory || []).filter((m) => m.text && !have.has(m.text));
        if (fresh.length) api.setStore('memory', [...ms, ...fresh]);
        return fresh.length ? [...ms, ...fresh] : ms;
      });
      setChats((cs) => {
        const have = new Set(cs.map((c) => c.importKey).filter(Boolean));
        const fresh = (result.chats || []).filter((c) => !have.has(c.importKey));
        return fresh.length ? [...cs, ...fresh] : cs;
      });
    };
    window.addEventListener('aid-import', h);
    return () => window.removeEventListener('aid-import', h);
  }, []);

  // Conversations coming from the phone (Telegram) show up as a chat here, live.
  useEffect(() => api.onPhoneStart((p) => {
    const asst = { id: uid(), role: 'assistant', steps: [{ text: '', toolCalls: [] }] };
    const user = { id: uid(), role: 'user', content: p.text || (p.images.length ? '(image)' : ''), attachments: p.images.map((u, i) => ({ kind: 'image', name: `photo-${i + 1}`, dataUrl: u })) };
    const into = p.chatId || null; // the phone is continuing one of the desktop chats
    streamsRef.current[p.requestId] = { chatId: into || 'phone-' + p.session, msgId: asst.id };
    setRunningIds((ids) => [...ids, into || 'phone-' + p.session]);
    setChats((cs) => {
      if (into && cs.some((c) => c.id === into)) return cs.map((c) => (c.id === into ? { ...c, updatedAt: Date.now(), messages: [...c.messages, { ...user, via: 'telegram' }, { ...asst, via: 'telegram' }] } : c));
      const id = 'phone-' + p.session;
      const ex = cs.find((c) => c.id === id);
      if (ex) return cs.map((c) => (c.id === id ? { ...c, model: p.model, updatedAt: Date.now(), messages: [...c.messages, user, asst] } : c));
      const title = (p.text || 'Phone chat').replace(/\s+/g, ' ').slice(0, 48);
      return [{ id, title, source: 'phone', model: p.model, projectId: p.projectId, messages: [user, asst], updatedAt: Date.now() }, ...cs];
    });
  }), []);

  // Scheduled task runs show up as their own chat, live.
  useEffect(() => api.onScheduleStart((p) => {
    const id = 'sched-' + p.requestId;
    const asst = { id: uid(), role: 'assistant', steps: [{ text: '', toolCalls: [] }] };
    const user = { id: uid(), role: 'user', content: p.prompt };
    streamsRef.current[p.requestId] = { chatId: id, msgId: asst.id };
    setRunningIds((ids) => [...ids, id]);
    setChats((cs) => [{ id, title: p.name, source: 'schedule', model: p.model, projectId: p.projectId, messages: [user, asst], updatedAt: Date.now() }, ...cs]);
  }), []);

  // file preview requests from chips / tool cards
  const projectRef = useRef(null);
  projectRef.current = project;
  useEffect(() => {
    const h = async (e) => {
      const t = e.detail;
      if (!t.project) return setPreviewFile(t);
      const folder = projectRef.current?.folder || await api.defaultFilesFolder();
      if (!folder) return;
      const a = await api.previewProjectFile(folder, t.path);
      const full = a.path ? a : { ...a, path: undefined };
      if (t.action === 'open' && a.path) return api.openPath(a.path);
      if (t.action === 'phone' && a.path) { const r = await api.sendFileToPhone(a.path); return setPreviewFile({ ...full, _note: r.ok ? 'Sent to your phone.' : r.error }); }
      setPreviewFile(full);
    };
    window.addEventListener('aid-preview', h);
    return () => window.removeEventListener('aid-preview', h);
  }, []);

  // hooks for the floating Cmd+K window live above the early return below (a hook after it breaks React's hook order)
  const paletteRunRef = useRef();
  const paletteSnapRef = useRef(null);
  useEffect(() => { if (paletteSnapRef.current) api.paletteSync(paletteSnapRef.current); });
  useEffect(() => api.onPaletteRun((it) => { if (paletteRunRef.current) paletteRunRef.current(it); }), []);

  if (!loaded || !settings || !chat) return <div className="boot" />;

  const groups = modelGroups(chat.model, providers);
  const editingProject = modal && modal.project && modal.project !== 'new' ? projects.find((p) => p.id === modal.project) : null;
  const mac = api.platform === 'darwin';
  const viewProject = view && view.project ? projects.find((p) => p.id === view.project) : null;
  const chatView = view === 'chat';
  const chatBusy = isRunning(chat.id);
  const canSplit = view === 'chat' || view === 'note';
  const splitT = splitTab && canSplit ? (tabs || []).find((t) => t.id === splitTab && t.id !== activeTab && (t.s.view === 'chat' || t.s.view === 'note')) : null;
  const chat2 = splitT && splitT.s.view === 'chat' ? chats.find((c) => c.id === splitT.s.chatId) : null;
  const note2 = splitT && splitT.s.view === 'note' ? splitT.s.notePath : null;
  const showSplit = !!chat2 && !(view === 'chat' && chat2.id === chat.id);
  const showNoteSplit = !!note2 && !(view === 'note' && note2 === notePath);
  const noteProps = { items: notes.items, onCreateNote: (n, f) => noteActions.create(f, n) };

  sideApi.current = {
    select, deleteChat, navSnap,
    pinChat: (id) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))),
    open: (sn) => { if (sn.view === 'terminal' && !termRef.current.tabs.length) newTermTab(); openTab({ view: 'chat', chatId: currentRef.current, modal: null, settingsTab: 'general', ...sn }); },
    splitChat, regen: (m, c) => regenerate(m, c), deleteMsg: (cid, mid) => deleteMessage(cid, mid), isRunning,
    openLink: (url) => { setBrowser((b) => ({ ...b, url })); if (viewRef.current === 'browser') api.browserNavigate(url); else setView('browser'); },
    openChat: (id) => { const o = (tabsRef.current || []).find((t) => t.s.view === 'chat' && t.s.chatId === id); if (o) activateTab(o.id); else openTab({ view: 'chat', chatId: id, modal: null, settingsTab: 'general' }); },
    go: (sn) => { if (sn.view) setView(sn.view); },
    goNav: (k) => { const sn = NAV[k]; if (!sn) return; if (k === 'terminal' && !termRef.current.tabs.length) newTermTab(); if (sn.view) { setModal(null); setView(sn.view); } if (sn.modal) { if (sn.modal === 'settings') setSettingsTab('general'); setModal(sn.modal); } }
  };
  const VIEW_INFO = { projects: ['Projects', 'folders'], schedule: ['Scheduled', 'clock'], skills: ['Skills', 'sparkle'], agents: ['Agents', 'layers'], automations: ['Automations', 'bolt'], logs: ['Logs', 'code'], terminal: ['Terminal', 'terminal'], browser: ['Browser', 'globe'] };
  const MODAL_INFO = { settings: ['Settings', 'sliders'], memory: ['Memory', 'bulb'], usage: ['Usage', 'chart'], connectors: ['Connectors', 'plug'] };
  const tabInfo = (t) => {
    const sn = t.s;
    if (sn.modal && MODAL_INFO[sn.modal]) return { title: MODAL_INFO[sn.modal][0], icon: MODAL_INFO[sn.modal][1] };
    if (sn.view && sn.view.project) { const pr = projects.find((x) => x.id === sn.view.project); return { title: pr ? pr.name : 'Project', icon: 'folder' }; }
    if (VIEW_INFO[sn.view]) return { title: VIEW_INFO[sn.view][0], icon: VIEW_INFO[sn.view][1] };
    if (sn.view === 'note') return { title: (sn.notePath || 'Note').split('/').pop().replace(/\.md$/i, ''), icon: 'file' };
    const c = chats.find((x) => x.id === sn.chatId);
    return { title: c ? c.title : 'Chat', icon: c && c.incognito ? 'ghost' : 'chat', running: !!c && isRunning(c.id), awaiting: !!c && awaitingOf(c) };
  };
  const tabMenu = (e, id) => {
    const t = id && (tabs || []).find((x) => x.id === id);
    const items = t ? [
      ...((t.s.view === 'chat' || t.s.view === 'note') && id !== activeTab ? [splitTab === id ? { label: 'Close split view', onClick: () => setSplitTab(null) } : { label: 'Open in split view', onClick: () => splitWith(id) }] : splitTab && id === activeTab ? [{ label: 'Close split view', onClick: () => setSplitTab(null) }] : []),
      { label: t.pinned ? 'Unpin tab' : 'Pin tab', onClick: () => togglePin(id) },
      { label: 'Duplicate tab', onClick: () => duplicateTab(id) },
      { sep: true },
      { label: 'Close tab', hint: '⌘W', disabled: t.pinned, onClick: () => closeTab(id) },
      { label: 'Close other tabs', disabled: (tabs || []).filter((x) => x.id !== id && !x.pinned).length === 0, onClick: () => closeOthers(id) },
      { sep: true },
      { label: 'New tab', hint: '⌘T', onClick: () => newTab() }
    ] : [{ label: 'New tab', hint: '⌘T', onClick: () => newTab() }];
    setCtx({ x: e.clientX, y: e.clientY, items });
  };

  const tabsBar = tabs && tabs.length > 0 ? <TabBar tabs={tabs} active={activeTab} info={tabInfo} onSelect={activateTab} onClose={closeTab} onNew={() => newTab()} onMenu={tabMenu} /> : null;
  const topbar = (
    <header className={`topbar drag ${sidebarHidden && mac ? 'pad-mac' : ''}`}>
      <button className="icon-btn nodrag" title={`Sidebar (${mac ? '⌘' : 'Ctrl+'}\\)`} onClick={() => setSidebarHidden(!sidebarHidden)}><Icon name="sidebar" size={18} /></button>
      {tabsBar || <div className="chat-title">{chatView ? chat.title : ''}</div>}
      {!tabsBar && <span style={{ flex: 1 }} />}
      {chatView && (
        <>
          <ChatPills chatId={chat.id} model={chat.model} settings={settings} incognito={chat.incognito}
            perm={chat.perm === 'auto' ? 'auto' : chat.perm ? 'ask' : (settings.autoApproveEdits ? 'auto' : 'ask')} onPerm={(v) => updateChat(chat.id, { perm: v })}
            agents={chat.agents || (settings.delegateEnabled === false ? 'off' : 'on')} onAgents={(v) => updateChat(chat.id, { agents: v })}
            tools={chat.tools || (settings.toolsEnabled === false ? 'off' : 'on')} onTools={(v) => updateChat(chat.id, { tools: v })}
            effort={chat.effort ?? (settings.reasoningEffort || 'auto')} onEffort={(v) => updateChat(chat.id, { effort: v })}
            projectId={chat.projectId} projects={projects} onProject={(id) => updateChat(chat.id, { projectId: id })}
            brains={brains} brain={brainOf(chat)} onBrain={(v) => { const b = brains.find((x) => x.slug === v); updateChat(chat.id, { brain: v, ...(b?.model ? { model: b.model } : {}), councilPick: null }); }} councilPick={chat.councilPick} onRevote={() => updateChat(chat.id, { councilPick: null })}
            onUsageDetails={() => setModal('usage')} onOpenSettings={(t) => { setSettingsTab(t || 'general'); setModal('settings'); }} />
          {project?.folder && <button className="icon-btn nodrag" title={`Open folder: ${project.folder}`} onClick={() => api.openPath(project.folder)}><Icon name="external" size={16} /></button>}
          {(chat.messages.length > 0) && (() => { const pr = progressOf(chat); return (
            <button className={`step-chip nodrag ${showProgress && !panel ? 'on' : ''}`} onClick={() => { setPanel(null); setShowProgress(!(showProgress && !panel)); }} title={pr.total ? `Step ${pr.done} of ${pr.total}: progress and outputs` : 'Progress and outputs'}>
              <Icon name="layers" size={14} /> {pr.total ? `${pr.done}/${pr.total}` : 'Progress'}
            </button>); })()}
        </>
      )}
    </header>
  );

  const setPref = (patch) => api.setSettings(patch).then((st) => setSettings({ ...st })).catch(() => {});
  const openSettings = (tab) => { setSettingsTab(tab); setModal('settings'); };
  // Settings moves into a tab of its own; the tab it was opened from goes back to what it showed before
  const settingsToNewTab = (tab) => {
    setTabs((ts) => (ts || []).map((x) => (x.id === activeTab ? { ...x, s: { ...x.s, modal: null } } : x)));
    openTab({ view, chatId: currentId, modal: 'settings', settingsTab: tab || 'general' });
  };
  const SETTING_TABS = [['general', 'General', 'sliders', 'theme appearance text size shortcut'], ['providers', 'Providers', 'plug', 'api keys models'], ['tools', 'Tools & safety', 'wrench', 'terminal permissions'], ['access', 'Access & permissions', 'shield', 'folders computer control'], ['agents', 'Agents', 'layers', 'helpers delegate'], ['brains', 'Brains', 'bulb', 'council'], ['limits', 'Usage limits', 'chart', 'budget cost'], ['voice', 'Voice', 'mic', 'sentinel speech'], ['make', 'Make', 'bolt', 'webhook automation'], ['phone', 'Phone', 'phone', 'telegram mobile remote']];
  const paletteActions = [
    { id: 'newtab', group: 'Create', label: 'New tab', icon: 'plus', hint: '⌘T', run: () => newTab() },
    { id: 'newchat', group: 'Create', label: 'New chat', icon: 'plus', hint: '⌘N', run: () => newChat() },
    { id: 'incog', group: 'Create', label: 'New incognito chat', icon: 'ghost', run: () => newIncognito() },
    { id: 'newnote', group: 'Create', label: 'New note', icon: 'file', run: () => noteActions.create('') },
    { id: 'newterm', group: 'Create', label: 'New terminal tab', icon: 'terminal', run: newTermTab },
    { id: 'newproject', group: 'Create', label: 'New project', icon: 'folder', run: () => setModal({ project: 'new' }) },
    { id: 'closetab', group: 'Tabs', label: 'Close tab', icon: 'x', hint: '⌘W', run: () => closeTab(activeTab) },
    ...(splitTab ? [{ id: 'closesplit', group: 'Tabs', label: 'Close split view', icon: 'x', run: () => setSplitTab(null) }] : []),
    { id: 'sidebar', group: 'Tabs', label: 'Toggle sidebar', icon: 'sidebar', hint: '⌘\\', run: () => setSidebarHidden((v) => !v) },
    { id: 'projects', group: 'Go to', label: 'Projects', icon: 'folder', run: () => setView('projects') },
    { id: 'sched', group: 'Go to', label: 'Scheduled tasks', icon: 'clock', run: () => setView('schedule') },
    { id: 'skills', group: 'Go to', label: 'Skills', icon: 'sparkle', run: () => setView('skills') },
    { id: 'agents', group: 'Go to', label: 'Agents', icon: 'layers', run: () => setView('agents') },
    { id: 'automations', group: 'Go to', label: 'Automations', icon: 'bolt', run: () => setView('automations') },
    { id: 'browser', group: 'Go to', label: 'Browser', icon: 'globe', run: () => setView('browser') },
    { id: 'term', group: 'Go to', label: 'Terminal', icon: 'terminal', hint: '⌘J', run: toggleTerm },
    { id: 'memory', group: 'Go to', label: 'Memory', icon: 'bulb', run: () => setModal('memory') },
    { id: 'usage', group: 'Go to', label: 'Usage', icon: 'chart', run: () => setModal('usage') },
    { id: 'connectors', group: 'Go to', label: 'Connectors', icon: 'plug', run: () => setModal('connectors') },
    { id: 'logs', group: 'Go to', label: 'Logs', icon: 'code', run: () => setView('logs') },
    { id: 'sentinel', group: 'Go to', label: 'Toggle Sentinel (voice)', icon: 'shield', hint: '⇧⌘A', run: toggleSentinel },
    ...SETTING_TABS.map(([id, label, icon, words]) => ({ id: 'set-' + id, group: 'Settings', label: id === 'general' ? 'Settings' : 'Settings: ' + label, icon, hint: id === 'general' ? '⌘,' : '', words, run: () => openSettings(id) })),
    ...themeChoices.map((t) => ({ id: 'theme-' + t.id, group: 'Theme', label: 'Theme: ' + t.name, icon: 'sparkle', swatch: t.preview, current: (settings.theme || 'system') === t.id, onlyTyped: true, words: 'appearance color ' + t.group, run: () => setPref({ theme: t.id }) })),
    ...TEXT_SIZES.map(([id, name, px]) => ({ id: 'size-' + id, group: 'Theme', label: `Text size: ${name} (${px}px)`, icon: 'edit', current: (settings.textSize || 'medium') === id, onlyTyped: true, words: 'font appearance', run: () => setPref({ textSize: id }) })),
    ...(chatView ? groups.flatMap((g) => g.items.map(([id, name]) => ({ id: 'model-' + id, group: 'Model', label: 'Model: ' + name, icon: 'bulb', current: chat.model === id, onlyTyped: true, words: g.label + ' switch chat', run: () => updateChat(chat.id, { model: id }) }))) : [])
  ];
  paletteSnapRef.current = { chats: chats.filter((c) => !c.incognito).map((c) => ({ id: c.id, title: c.title })), actions: paletteActions.map(({ id, label, icon, hint, group, swatch, current, onlyTyped, words }) => ({ id, label, icon, hint, group, swatch, current, onlyTyped, words })) };
  paletteRunRef.current = (it) => { if (!it) return; if (it.kind === 'action') paletteActions.find((x) => x.id === it.id)?.run(); else if (it.kind === 'chat') select(it.id); else if (it.kind === 'note') openNote(it.path); };

  return (
    <div className="app" style={{ '--sb-w': sbW + 'px' }}>
      <SentinelPill state={sent.state} info={sent.info} err={sent.err} onStop={stopSentinel} onSkip={skipSentinel} onDismiss={() => flashSent('')} onSettings={() => { setSettingsTab('voice'); setModal('settings'); }} onLogs={() => setView('logs')} external={!!window.api.sentinelState} />
      <Sidebar
        onProfile={() => setModal('profile')} profile={{ name: settings.profileName, avatar }}
        onResizeStart={dragSidebar}
        hidden={sidebarHidden} chats={chats} projects={projects}
        onPinChat={(id) => setChats((cs) => cs.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)))}
        onPinProject={(id) => setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)))}
        onOpenProject={(id) => setView({ project: id })} currentId={currentId} view={chatView ? 'chat' : 'other'} statusOf={statusOf}
        onNewChat={() => newChat()} onNewIncognito={newIncognito} onSelect={select} onDelete={deleteChat}
        onRename={(id, title) => updateChat(id, { title })}
        onProjects={() => setView('projects')} onSchedule={() => setView('schedule')} onSkills={() => setView('skills')} onAgents={() => setView('agents')} onAutomations={() => setView('automations')} onSentinel={toggleSentinel} sentinel={sent.state} onLogs={() => setView('logs')} agentCount={liveAgents(chats, runningIds).length} onPermissions={() => setModal('permissions')} onConnectors={() => setModal('connectors')}
        onSettings={() => { setSettingsTab('general'); setModal('settings'); }} onMemory={() => setModal('memory')} onUsage={() => setModal('usage')}
        onTerminal={() => { if (!termRef.current.tabs.length) newTermTab(); setView('terminal'); }}
        notes={{ items: notes.items, root: notes.root, active: view === 'note' ? notePath : null, onOpen: noteActions.open, onNew: (f) => noteActions.create(f), onNewFolder: noteActions.createFolder, onRename: noteActions.rename, onDelete: noteActions.remove, onMove: noteActions.move, onPickRoot: noteActions.pickRoot, onReveal: noteActions.reveal }}
        onBrowser={() => setView('browser')}
        memoryCount={settings.memoryEnabled ? memory.length : 0} connectorCount={connectorCount}
      />

      <CommandPalette open={palette} onClose={() => setPalette(false)} chats={chats} onOpenChat={select} onOpenNote={openNote}
        actions={paletteActions} />

      <main className="main">
        {topbar}
        {view === 'browser' && <BrowserPanel full url={browser.url} onUrl={(u) => setBrowser((b) => ({ ...b, url: u }))} onClose={() => setView('chat')} />}

        {view === 'schedule' && <SchedulesView projects={projects} models={groups} />}
        {view === 'skills' && <SkillsView projects={projects} />}
        {view === 'logs' && <LogsView />}
        {view === 'automations' && <AutomationsView onOpenSettings={(t) => { setSettingsTab(t || 'general'); setModal('settings'); }} />}
        {view === 'agents' && <AgentsView settings={settings} chats={chats} runningIds={runningIds} groups={groups} onOpenChat={(id) => select(id)} />}
        {view === 'projects' && (
          <ProjectsList onPin={(id) => setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p)))} projects={projects} chats={chats} onOpen={(id) => setView({ project: id })} onNew={() => setModal({ project: 'new' })} />
        )}
        {viewProject && (
          <ProjectPage
            project={viewProject} chats={chats} statusOf={statusOf} onBack={() => setView('projects')}
            onEdit={() => setModal({ project: viewProject.id })} onSelect={select} onStartChat={startProjectChat(viewProject.id)}
          />
        )}
        {(chatView || (view === 'note' && notePath)) && (
          <div className="split-wrap">
          {view === 'note' && notePath && <div className="pane"><NoteEditor key={notePath + ':' + noteRev} path={notePath} {...noteProps} onOpenNote={(p) => noteActions.open(p, 'here')} /></div>}
          {chatView && <div className="pane">
            <section className="messages" ref={listRef} onScroll={onScroll}>
              {chat.messages.length === 0 ? (
                <div className="empty">
                  {chat.incognito ? (
                    <>
                      <Icon name="ghost" size={40} className="incog-ico" />
                      <h1>Incognito chat</h1>
                      <p>This chat isn't saved. It disappears when you leave it, and memory is off.</p>
                    </>
                  ) : (<>
                  <h1>{greeting()}</h1>
                  <p>How can I help you today?</p>
                  {project?.folder
                    ? <p className="muted small"><Icon name="folder" size={14} /> {project.name}: {project.folder}<br />I can read and edit files and create Excel/CSV files here.</p>
                    : <p className="muted small">Create a project and pick a folder so I can read and write files.</p>}
                  </>)}
                </div>
              ) : (
                chat.messages.map((m) => {
                  const live = chatBusy && m === chat.messages[chat.messages.length - 1] && m.role === 'assistant';
                  return <Message key={m.id} m={m} live={live} onRegenerate={() => regenerate(m)} onDecide={decide} onDelete={live ? undefined : () => deleteMessage(chat.id, m.id)} artifacts={chat.artifacts} onOpenArtifact={(id) => setPanel({ type: 'artifact', id })} />;
                })
              )}
            </section>
            <Composer key={chat.id} chatId={chat.id} perm={chat.perm === 'auto' ? 'auto' : chat.perm ? 'ask' : (settings.autoApproveEdits ? 'auto' : 'ask')} onPerm={(v) => updateChat(chat.id, { perm: v })} agents={chat.agents || (settings.delegateEnabled === false ? 'off' : 'on')} onAgents={(v) => updateChat(chat.id, { agents: v })} tools={chat.tools || (settings.toolsEnabled === false ? 'off' : 'on')} onTools={(v) => updateChat(chat.id, { tools: v })} streaming={chatBusy} {...queueFor(chat)} onSend={send} onStop={() => stop()} model={chat.model} onModel={(m) => updateChat(chat.id, { model: m })} groups={groups} projectId={chat.projectId} projects={projects} onProject={(id) => updateChat(chat.id, { projectId: id })} incognito={chat.incognito} settings={settings} onUsageDetails={() => setModal('usage')} onOpenSettings={(t) => { setSettingsTab(t || 'general'); setModal('settings'); }} brains={brains} brain={brainOf(chat)} onBrain={(v) => { const b = brains.find((x) => x.slug === v); updateChat(chat.id, { brain: v, ...(b?.model ? { model: b.model } : {}), councilPick: null }); }} councilPick={chat.councilPick} onRevote={() => updateChat(chat.id, { councilPick: null })} sentinel={sent.state} onSentinel={toggleSentinel} onCompact={compactChat} canCompact={canCompact(chat)} compacting={compacting} />
          </div>}
          {showSplit && (
            <SplitPane chat={chat2} busy={isRunning(chat2.id)} settings={settings} projects={projects} brains={brains} brain={brainOf(chat2)} groups={modelGroups(chat2.model, providers)}
              h={{
                update: (patch) => updateChat(chat2.id, patch), onClose: () => setSplitTab(null),
                onSend: (text, atts) => sendTo(chat2, text, atts), onStop: () => stop(chat2), ...queueFor(chat2), onRegenerate: (m) => regenerate(m, chat2), onDecide: decide,
                onDelete: (mid) => deleteMessage(chat2.id, mid), onUsageDetails: () => setModal('usage'), onOpenSettings: (t) => { setSettingsTab(t || 'general'); setModal('settings'); },
                onCompact: () => compactChat(chat2), canCompact: canCompact(chat2), compacting
              }} />
          )}
          {showNoteSplit && (
            <section className="split-pane" data-note-pane={note2}>
              <header className="split-head">
                <div className="chat-title"><Icon name="file" size={15} className="incog-ico" /> {note2.split('/').pop().replace(/\.md$/i, '')}</div>
                <button className="icon-btn nodrag" title="Close split view" onClick={() => setSplitTab(null)}><Icon name="x" size={16} /></button>
              </header>
              <NoteEditor key={note2 + ':' + noteRev} path={note2} narrow {...noteProps} onOpenNote={(p) => noteActions.open(p, 'split')} />
            </section>
          )}
          </div>
        )}
        {term.tabs.length > 0 && (
          <div className={view === 'terminal' ? 'term-wrap-full' : undefined} style={view === 'terminal' ? undefined : { display: term.open ? 'block' : 'none' }}>
            <TerminalDock full={view === 'terminal'} tabs={term.tabs} activeKey={term.active} cwd={project?.folder || undefined} height={term.height}
              onHeight={(h) => setTerm((t) => ({ ...t, height: h }))}
              onSelect={(k) => setTerm((t) => ({ ...t, active: k }))} onNew={newTermTab} onClose={closeTermTab}
              onId={(k, id) => setTerm((t) => ({ ...t, tabs: t.tabs.map((x) => x.key === k ? { ...x, id } : x) }))}
              onExit={() => {}} onPopOut={popOutTerm} onHide={() => setTerm((t) => ({ ...t, open: false }))} />
          </div>
        )}
      </main>

      {chatView && (panel || showProgress) && (
        <aside className={`side-panel ${wide ? 'wide' : ''}`} style={wide ? undefined : { width: spW }}>
          <div className="resize-grip left" onMouseDown={dragPanel} onDoubleClick={() => { setSpW(460); saveWidth('zero.spW', 460); }} title="Drag to resize · double-click to reset" />
          {panel && panel.type === 'file' && <FilePanel file={panel.file} onClose={() => setPanel(null)} expanded={wide} onExpand={() => setWide(!wide)} />}
          {panel && panel.type === 'artifact' && <ArtifactPanel artifact={chat.artifacts && chat.artifacts[panel.id]} onClose={() => setPanel(null)} expanded={wide} onExpand={() => setWide(!wide)} />}
          {!panel && <ProgressPanel chat={chat} onClose={() => setShowProgress(false)} expanded={wide} onExpand={() => setWide(!wide)} onOpenArtifact={(id) => setPanel({ type: 'artifact', id })} />}
        </aside>
      )}

      {modal === 'settings' && <SettingsModal projects={projects} onApply={async (patch) => { try { setSettings({ ...(await api.setSettings(patch)) }); } catch {} }} settings={settings} groups={groups} providers={providers} onProviders={applyProviders} onSave={saveSettings} initialTab={settingsTab} onNewTab={settingsToNewTab} onClose={() => setModal(null)} />}
      {modal === 'memory' && <MemoryModal memory={memory} enabled={settings.memoryEnabled} onChange={changeMemory} onToggle={toggleMemory} onClose={() => setModal(null)} />}
      {modal === 'permissions' && <PermissionsModal firstRun={!settings.permissionsAsked} onClose={() => { if (!settings.permissionsAsked) { api.setSettings({ permissionsAsked: true }); setSettings((x) => ({ ...x, permissionsAsked: true })); } setModal(null); }} />}
      {modal === 'profile' && <ProfileModal settings={settings} avatar={avatar} onAvatar={setAvatar} onSave={async (patch) => { setSettings(await api.setSettings(patch)); setModal(null); }} onClose={() => setModal(null)} />}
      <ContextMenu menu={ctx} onClose={() => setCtx(null)} />
      {modal === 'usage' && <UsageModal projects={projects} chats={chats} onClose={() => setModal(null)} />}
      {modal === 'connectors' && <ConnectorsModal onClose={() => setModal(null)} onChanged={(n) => setConnectorCount(n)} />}
      {modal && modal.project && (modal.project === 'new' || editingProject) && (
        <ProjectModal project={editingProject} onSave={saveProject} onDelete={deleteProject} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
