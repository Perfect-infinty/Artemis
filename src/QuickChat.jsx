import React, { useEffect, useRef, useState } from 'react';
import { applyTextSize, applyTheme, loadThemes } from './lib/themes.js';
import Markdown from './components/Markdown.jsx';
import ToolCard from './components/ToolCard.jsx';
import { Icon } from './components/Icons.jsx';
import { toApiMessages, uid } from './lib/history.js';
import { AttachmentChip, Thinking, ThinkBlock, thinkMode } from './components/Message.jsx';
import { addThinking, stepParts } from './lib/think.mjs';
import CommandPalette from './components/CommandPalette.jsx';
import { filesToAttachments, installDropGuard, onWindowDrop } from './lib/attach.js';

const api = window.api;
const lastStep = (m, fn) => { const steps = [...m.steps]; steps[steps.length - 1] = fn(steps[steps.length - 1]); return { ...m, steps }; };
const patchTool = (m, id, fn) => ({ ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => (t.id === id ? fn(t) : t)) })) });

function reduce(m, ev) {
  switch (ev.type) {
    case 'chunk': return lastStep(m, (s) => ({ ...s, text: s.text + ev.text }));
    case 'step:new': return { ...m, steps: [...m.steps, { text: '', toolCalls: [] }] };
    case 'thinking': return lastStep(m, (s) => ({ ...s, thinking: addThinking(s.thinking, ev.text) }));
    case 'thinking:end': return lastStep(m, (s) => (s.thinking ? { ...s, thinking: { ...s.thinking, ms: ev.ms } } : s));
    case 'tool:call': return lastStep(m, (s) => ({ ...s, toolCalls: [...s.toolCalls, { id: ev.id, name: ev.name, args: ev.args, status: 'running', startedAt: Date.now() }] }));
    case 'tool:approval': return patchTool(m, ev.id, (t) => ({ ...t, status: 'awaiting', session: ev.session, category: ev.category }));
    case 'tool:result': return patchTool(m, ev.id, (t) => ({ ...t, status: ev.denied ? 'denied' : ev.ok ? 'done' : 'error', result: ev.text, image: ev.image, endedAt: Date.now() }));
    case 'notice': return { ...m, notices: [...(m.notices || []), ev.text] };
    case 'error': return { ...m, error: ev.message };
    default: return m;
  }
}

const settle = (msgs) => msgs.map((m) => (m.steps ? { ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => (t.status === 'running' || t.status === 'awaiting' ? { ...t, status: 'cancelled' } : t)) })) } : m));

export default function QuickChat() {
  const [settings, setSettings] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [atts, setAtts] = useState([]);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState('chat'); // 'chat' or 'search' (Cmd+1 / Cmd+2, or the Quick chat / Quick search shortcut)
  const [snap, setSnap] = useState({ chats: [], actions: [] });
  const [nonce, setNonce] = useState(0);
  const reqRef = useRef(null);
  const asstRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const idRef = useRef(uid());

  useEffect(() => {
    document.documentElement.classList.add('quick');
    // the window lives on after the first open: repaint the theme every time it is shown, otherwise a theme changed in the main window never reaches it
    const paint = (s) => { applyTextSize(s.textSize); document.documentElement.dataset.thinking = s.showThinking || 'collapsed'; return loadThemes(api).then((t) => applyTheme(s.theme, t)); };
    api.getSettings().then((s) => { setSettings(s); paint(s); });
    const offTheme = api.onThemeChanged ? api.onThemeChanged(() => { api.getSettings().then(paint); }) : undefined;
    const offShown = api.onQuickShown((o) => {
      api.getSettings().then((s) => { setSettings(s); paint(s); });
      setMode(o && o.mode === 'search' ? 'search' : 'chat'); setNonce((n) => n + 1);
      api.paletteGet().then((x) => setSnap(x || { chats: [], actions: [] })).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 30);
    });
    return () => { try { offShown && offShown(); } catch {} try { offTheme && offTheme(); } catch {} };
  }, []);

  useEffect(() => api.onEvent((ev) => {
    if (ev.requestId !== reqRef.current) return;
    if (ev.type === 'done') {
      setMsgs((ms) => settle(ms));
      reqRef.current = null; setRunning(false); api.quickKeepOpen(false);
      return;
    }
    setMsgs((ms) => ms.map((m) => (m.id === asstRef.current ? reduce(m, ev) : m)));
  }), []);

  // links in answers: the quick window has no browser panel, so http(s) links open in the system browser
  useEffect(() => {
    const h = (e) => { const url = e.detail; if (/^https?:\/\//i.test(url || '') && api.openExternalUrl) api.openExternalUrl(url); };
    window.addEventListener('aid-browser-open', h);
    return () => window.removeEventListener('aid-browser-open', h);
  }, []);
  useEffect(() => { const off1 = installDropGuard(), off2 = onWindowDrop((fl) => addFiles(fl)); return () => { off1(); off2(); }; }, []);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => { if (api.quickMode) api.quickMode(mode); }, [mode]); // main needs the tab to decide whether a shortcut switches tabs or hides the window
  useEffect(() => { api.quickResize(mode === 'search' || msgs.length > 0 ? true : atts.length > 0 ? 'chips' : false); }, [mode, msgs.length > 0, atts.length > 0]);
  useEffect(() => {
    const h = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key === '1') { e.preventDefault(); setMode('chat'); setTimeout(() => inputRef.current?.focus(), 0); }
      else if (e.key === '2') { e.preventDefault(); setMode('search'); setNonce((n) => n + 1); api.paletteGet().then((x) => setSnap(x || { chats: [], actions: [] })).catch(() => {}); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const send = () => {
    const t = text.trim();
    const good = atts.filter((a) => a.kind !== 'error');
    if ((!t && !good.length) || running || !settings) return;
    if (!settings.hasApiKey) return;
    const user = { id: uid(), role: 'user', content: t, attachments: good };
    const asst = { id: uid(), role: 'assistant', createdAt: Date.now(), steps: [{ text: '', toolCalls: [] }] };
    const requestId = uid();
    reqRef.current = requestId; asstRef.current = asst.id;
    const history = [...msgs, user];
    setMsgs([...history, asst]); setText(''); setAtts([]); setRunning(true); api.quickKeepOpen(true);
    api.chat({ requestId, model: settings.model, messages: toApiMessages(history), system: settings.systemPrompt, project: null, maxTokens: settings.maxTokens });
  };
  const addFiles = async (list) => {
    const parsed = await filesToAttachments(list);
    if (parsed.length) setAtts((a) => [...a, ...parsed]);
  };
  const pick = async () => {
    api.quickKeepOpen(true); // the file dialog steals focus; do not hide the window meanwhile
    try { const r = await api.pickFiles(); if (r.length) setAtts((a) => [...a, ...r]); }
    finally { if (!reqRef.current) api.quickKeepOpen(false); setTimeout(() => inputRef.current?.focus(), 0); }
  };
  const onPaste = (e) => {
    const fl = [...(e.clipboardData?.files || [])];
    if (fl.length) { e.preventDefault(); addFiles(fl); }
  };
  const stop = () => reqRef.current && api.abort(reqRef.current);
  const reset = () => { if (running) stop(); setMsgs([]); setAtts([]); idRef.current = uid(); setTimeout(() => inputRef.current?.focus(), 0); };
  const decide = (id, ok) => {
    api.decide(id, ok);
    if (ok) setMsgs((ms) => ms.map((m) => (m.steps ? patchTool(m, id, (t) => (t.status === 'awaiting' ? { ...t, status: 'running' } : t)) : m)));
  };
  const handoff = () => {
    const first = msgs.find((m) => m.role === 'user');
    api.quickHandoff({ id: idRef.current, title: (first?.content || 'Quick chat').slice(0, 48), model: settings.model, projectId: null, messages: settle(msgs), updatedAt: Date.now() });
    reset(); api.quickHide();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { api.quickHide(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
  };

  if (!settings) return null;
  return (
    <div
      className={`quick-card ${drag ? 'dropping' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); addFiles([...e.dataTransfer.files]); }}
    >
      <div className="quick-grip drag" title="Drag to move"><i />
        <div className="quick-tabs nodrag">
          <button className={mode === 'chat' ? 'on' : ''} onClick={() => { setMode('chat'); setTimeout(() => inputRef.current?.focus(), 0); }}>Chat <kbd>⌘1</kbd></button>
          <button className={mode === 'search' ? 'on' : ''} onClick={() => { setMode('search'); setNonce((n) => n + 1); }}>Search <kbd>⌘2</kbd></button>
        </div>
      </div>
      {mode === 'search' ? (
        <CommandPalette key={nonce} embedded open chats={snap.chats} onClose={() => api.quickHide()}
          actions={snap.actions.map((a) => ({ ...a, run: () => api.paletteRun({ kind: 'action', id: a.id }) }))}
          onOpenChat={(id) => api.paletteRun({ kind: 'chat', id })} onOpenNote={(p) => api.paletteRun({ kind: 'note', path: p })} onOpenFile={(p) => api.paletteRun({ kind: 'file', path: p })} />
      ) : (<>
      <div className="quick-bar drag">
        <Icon name="chat" size={18} className="quick-icon" />
        <textarea
          ref={inputRef} className="nodrag quick-input" rows={1} autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
          placeholder={settings.hasApiKey ? 'Ask anything…' : 'Add a provider in Settings first'}
        />
        <button className="icon-btn nodrag" title="Attach files or images" aria-label="Attach files or images" onClick={pick}><Icon name="paperclip" size={16} /></button>
        {running
          ? <button className="quick-btn stop nodrag" title="Stop" aria-label="Stop" onClick={stop}><Icon name="stop" size={14} /></button>
          : <button className="quick-btn nodrag" title="Send" aria-label="Send" disabled={!text.trim() && !atts.length} onClick={send}><Icon name="arrowUp" size={15} /></button>}
        {msgs.length > 0 && (
          <>
            <button className="icon-btn nodrag" title="New chat" aria-label="New chat" onClick={reset}><Icon name="plus" size={16} /></button>
            <button className="icon-btn nodrag" title="Open in the main window" aria-label="Open in the main window" onClick={handoff}><Icon name="external" size={16} /></button>
          </>
        )}
        <button className="icon-btn nodrag" title="Close (Esc)" aria-label="Close (Esc)" onClick={() => api.quickHide()}><Icon name="x" size={16} /></button>
      </div>
      {atts.length > 0 && (
        <div className="quick-chips">{atts.map((a, i) => <AttachmentChip key={i} a={a} onRemove={() => setAtts(atts.filter((_, j) => j !== i))} />)}</div>
      )}
      {msgs.length > 0 && (
        <div className="quick-list" ref={listRef}>
          {msgs.map((m) => (m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.attachments?.length > 0 && <div className="chips right">{m.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}</div>}
              {m.content && <div className="bubble">{m.content}</div>}
            </div>
          ) : (() => {
            // the same streaming states as the main chat: "Thinking…" with seconds before the first words, then a caret at the end of the text
            const live = running && m.id === asstRef.current;
            const last = m.steps[m.steps.length - 1] || {};
            const parts = m.steps.map(stepParts);
            const lp = parts[parts.length - 1] || {};
            const waiting = live && !lp.text && !(lp.thinking && thinkMode() !== 'hidden') && !(last.toolCalls || []).some((t) => t.status === 'running' || t.status === 'awaiting');
            return (
            <div key={m.id} className={`msg assistant ${live ? 'live' : ''}`}>
              {m.steps.map((s, i) => (
                <React.Fragment key={i}>
                  {parts[i].thinking && <ThinkBlock text={parts[i].thinking} start={parts[i].start} ms={parts[i].ms}
                    live={live && i === m.steps.length - 1 && (parts[i].open || (parts[i].ms === undefined && !parts[i].text.trim() && !s.toolCalls.length))} />}
                  {parts[i].text && <Markdown text={parts[i].text} streaming={live && i === m.steps.length - 1} caret={live && i === m.steps.length - 1 && !s.toolCalls.length} />}
                  {s.toolCalls.map((tc) => <ToolCard key={tc.id} tc={tc} onDecide={decide} />)}
                </React.Fragment>
              ))}
              {waiting && <Thinking since={m.createdAt} />}
              {m.notices?.map((n, i) => <div key={i} className="notice">{n}</div>)}
              {m.error && <div className="error">{m.error}</div>}
            </div>
            );
          })()))}
        </div>
      )}
      </>)}
    </div>
  );
}
