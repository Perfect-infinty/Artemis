import React, { useEffect, useRef, useState } from 'react';
import { applyTextSize, applyTheme, loadThemes } from './lib/themes.js';
import Markdown from './components/Markdown.jsx';
import ToolCard from './components/ToolCard.jsx';
import { Icon } from './components/Icons.jsx';
import { toApiMessages, uid } from './lib/history.js';
import { AttachmentChip } from './components/Message.jsx';
import { filesToAttachments, installDropGuard, onWindowDrop } from './lib/attach.js';

const api = window.api;
const lastStep = (m, fn) => { const steps = [...m.steps]; steps[steps.length - 1] = fn(steps[steps.length - 1]); return { ...m, steps }; };
const patchTool = (m, id, fn) => ({ ...m, steps: m.steps.map((s) => ({ ...s, toolCalls: s.toolCalls.map((t) => (t.id === id ? fn(t) : t)) })) });

function reduce(m, ev) {
  switch (ev.type) {
    case 'chunk': return lastStep(m, (s) => ({ ...s, text: s.text + ev.text }));
    case 'step:new': return { ...m, steps: [...m.steps, { text: '', toolCalls: [] }] };
    case 'tool:call': return lastStep(m, (s) => ({ ...s, toolCalls: [...s.toolCalls, { id: ev.id, name: ev.name, args: ev.args, status: 'running' }] }));
    case 'tool:approval': return patchTool(m, ev.id, (t) => ({ ...t, status: 'awaiting', session: ev.session, category: ev.category }));
    case 'tool:result': return patchTool(m, ev.id, (t) => ({ ...t, status: ev.denied ? 'denied' : ev.ok ? 'done' : 'error', result: ev.text, image: ev.image }));
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
  const reqRef = useRef(null);
  const asstRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const idRef = useRef(uid());

  useEffect(() => {
    document.documentElement.classList.add('quick');
    api.getSettings().then((s) => { setSettings(s); applyTextSize(s.textSize); loadThemes(api).then((t) => applyTheme(s.theme, t)); });
    return api.onQuickShown(() => { api.getSettings().then(setSettings); inputRef.current?.focus(); });
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

  useEffect(() => { const off1 = installDropGuard(), off2 = onWindowDrop((fl) => addFiles(fl)); return () => { off1(); off2(); }; }, []);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => { api.quickResize(msgs.length > 0 ? true : atts.length > 0 ? 'chips' : false); }, [msgs.length > 0, atts.length > 0]);

  const send = () => {
    const t = text.trim();
    const good = atts.filter((a) => a.kind !== 'error');
    if ((!t && !good.length) || running || !settings) return;
    if (!settings.hasApiKey) return;
    const user = { id: uid(), role: 'user', content: t, attachments: good };
    const asst = { id: uid(), role: 'assistant', steps: [{ text: '', toolCalls: [] }] };
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
      <div className="quick-grip drag" title="Drag to move"><i /></div>
      <div className="quick-bar drag">
        <Icon name="chat" size={18} className="quick-icon" />
        <textarea
          ref={inputRef} className="nodrag quick-input" rows={1} autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste}
          placeholder={settings.hasApiKey ? 'Ask anything…' : 'Add a provider in Settings first'}
        />
        <button className="icon-btn nodrag" title="Attach files or images" onClick={pick}><Icon name="paperclip" size={16} /></button>
        {running
          ? <button className="quick-btn stop nodrag" title="Stop" onClick={stop}><Icon name="stop" size={14} /></button>
          : <button className="quick-btn nodrag" title="Send" disabled={!text.trim() && !atts.length} onClick={send}><Icon name="arrowUp" size={15} /></button>}
        {msgs.length > 0 && (
          <>
            <button className="icon-btn nodrag" title="New chat" onClick={reset}><Icon name="plus" size={16} /></button>
            <button className="icon-btn nodrag" title="Open in the main window" onClick={handoff}><Icon name="external" size={16} /></button>
          </>
        )}
        <button className="icon-btn nodrag" title="Close (Esc)" onClick={() => api.quickHide()}><Icon name="x" size={16} /></button>
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
          ) : (
            <div key={m.id} className="msg assistant">
              {m.steps.map((s, i) => (
                <React.Fragment key={i}>
                  {s.text && <Markdown text={s.text} />}
                  {s.toolCalls.map((tc) => <ToolCard key={tc.id} tc={tc} onDecide={decide} />)}
                </React.Fragment>
              ))}
              {running && m.id === asstRef.current && <div className="typing small"><i /><i /><i /></div>}
              {m.notices?.map((n, i) => <div key={i} className="notice">{n}</div>)}
              {m.error && <div className="error">{m.error}</div>}
            </div>
          )))}
        </div>
      )}
    </div>
  );
}
