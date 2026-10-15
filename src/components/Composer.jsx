import React, { useEffect, useRef, useState } from 'react';
import Select from './Select.jsx';
import { AttachmentChip } from './Message.jsx';
import ModelPicker from './ModelPicker.jsx';
import { Icon } from './Icons.jsx';
import { filesToAttachments, onWindowDrop } from '../lib/attach.js';
import { startRecording, transcribe, LANGS } from '../lib/voice.js';
import { costOf, fmtUsd } from '../lib/cost.js';
import { fmtTokens } from '../lib/amount.mjs';
import { ClaudeUsageFor } from './ClaudeUsage.jsx';

// Text and attachments typed into a chat that is not on screen right now (another tab or chat), so nothing is lost when you switch.
const drafts = new Map();

function useOutside(ref, on, cb) {
  useEffect(() => {
    if (!on) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) cb(); };
    const k = (e) => { if (e.key === 'Escape') cb(); };
    window.addEventListener('mousedown', h); window.addEventListener('keydown', k);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [on]);
}

/** Usage button: today / this month at a glance, with limits when set. */
function UsageMenu({ settings, chatId, model, onDetails, onLimits, stacked }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const ref = useRef(null);
  useOutside(ref, open, () => setOpen(false));
  const toggle = async () => { const o = !open; setOpen(o); if (o) setRows(null); if (o) { try { const r = await window.api.usageGet(); setRows(Array.isArray(r) ? r : []); } catch { setRows([]); } } };
  const now = new Date(); const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); const mon0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const sum = (from) => (rows || []).filter((r) => r.t >= from).reduce((a, r) => ({ t: a.t + (r.prompt || 0) + (r.completion || 0), c: a.c + costOf(r) }), { t: 0, c: 0 });
  const d = sum(day0), m = sum(mon0);
  const chatRows = (rows || []).filter((r) => chatId && r.chat === chatId);
  const ch = chatRows.reduce((a, r) => ({ t: a.t + (r.prompt || 0) + (r.completion || 0), c: a.c + costOf(r) }), { t: 0, c: 0 });
  const Row = ({ label, v, tokLimit, usdLimit }) => {
    const pct = Math.max(tokLimit ? v.t / tokLimit : 0, usdLimit ? v.c / usdLimit : 0);
    return (
      <div className="um-row">
        <div className="um-top"><span>{label}</span><b>{fmtTokens(v.t) || '0'} tokens · {fmtUsd(v.c)}</b></div>
        {(tokLimit > 0 || usdLimit > 0) && (
          <>
            <div className="um-bar"><i className={pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : ''} style={{ width: Math.min(100, pct * 100) + '%' }} /></div>
            <div className="muted small">Limit {[tokLimit > 0 ? fmtTokens(tokLimit) + ' tokens' : '', usdLimit > 0 ? fmtUsd(usdLimit) : ''].filter(Boolean).join(' / ')} · {Math.round(pct * 100)}% used</div>
          </>
        )}
      </div>
    );
  };
  return (
    <span className="um-wrap" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''} ${stacked ? 'um-row-btn' : ''}`} title="Usage" onClick={toggle}><Icon name="chart" size={stacked ? 15 : 17} />{stacked && <span>Usage</span>}</button>
      {open && (
        <div className="um-pop">
          <div className="um-title">Usage</div>
          {rows === null ? <div className="muted small">Loading…</div> : (
            <>
              <Row label="This chat" v={ch} />
              <Row label="Today" v={d} tokLimit={settings.dailyTokenLimit} usdLimit={settings.dailyUsdLimit} />
              <Row label="This month" v={m} tokLimit={settings.monthlyTokenLimit} usdLimit={settings.monthlyUsdLimit} />
              <ClaudeUsageFor model={model} />
              <small className="hint">Costs are estimates from list prices.</small>
            </>
          )}
          <div className="um-actions"><button onClick={() => { setOpen(false); onDetails(); }}>Details</button><button onClick={() => { setOpen(false); onLimits(); }}>Set limits</button></div>
        </div>
      )}
    </span>
  );
}

/** Mic button: click to record, click again to turn the speech into text. */
function MicButton({ settings, onText, onVoiceSettings, onError }) {
  const [state, setState] = useState('idle'); // idle | rec | busy
  const [secs, setSecs] = useState(0);
  const [menu, setMenu] = useState(false);
  const [lang, setLang] = useState(settings.voiceLanguage === 'en' ? 'en' : 'auto');
  const rec = useRef(null); const wrap = useRef(null);
  useOutside(wrap, menu, () => setMenu(false));
  useEffect(() => { setLang(settings.voiceLanguage === 'en' ? 'en' : 'auto'); }, [settings.voiceLanguage]);
  useEffect(() => {
    if (state !== 'rec') return undefined;
    setSecs(0);
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    const k = (e) => { if (e.key === 'Escape') { rec.current?.cancel(); rec.current = null; setState('idle'); } };
    window.addEventListener('keydown', k);
    return () => { clearInterval(t); window.removeEventListener('keydown', k); };
  }, [state]);
  useEffect(() => () => { rec.current?.cancel(); }, []);
  const click = async () => {
    if (state === 'busy') return;
    if (state === 'rec') {
      const r = rec.current; rec.current = null; setState('busy');
      try {
        const blob = await r.stop();
        const out = await transcribe(blob, lang);
        if (out.ok) onText(out.text); else onError(out.error);
      } catch (e) { onError((e && e.message) || String(e)); }
      setState('idle');
      return;
    }
    try { rec.current = await startRecording(); setState('rec'); } catch (e) { onError((e && e.message) || String(e)); setState('idle'); }
  };
  const mm = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  return (
    <span className="mic-wrap" ref={wrap}>
      <button className={`icon-btn mic ${state}`} title={state === 'rec' ? 'Stop and transcribe (Esc cancels)' : state === 'busy' ? 'Transcribing…' : 'Dictate'} onClick={click}>
        {state === 'busy' ? <Icon name="spinner" size={17} /> : state === 'rec' ? <Icon name="stop" size={15} /> : <Icon name="mic" size={17} />}
      </button>
      {state === 'rec' && <span className="mic-time">{mm}</span>}
      {state === 'idle' && <button className="icon-btn mic-more" title="Voice language" onClick={() => setMenu(!menu)}><Icon name="chevronDown" size={13} /></button>}
      {menu && (
        <div className="um-pop mic-pop">
          <div className="um-title">Dictation language</div>
          {LANGS.map(([id, n]) => <button key={id} className={`menu-item ${lang === id ? 'on' : ''}`} onClick={() => { setLang(id); setMenu(false); window.api.setSettings({ voiceLanguage: id }); }}>{n}{lang === id && <Icon name="check" size={13} />}</button>)}
          <div className="um-actions"><button onClick={() => { setMenu(false); onVoiceSettings(); }}>Voice settings…</button></div>
        </div>
      )}
    </span>
  );
}

/** The per-chat switches (project, brain, tools, agents, permissions) and the usage button. In the main chat they are stacked in the right bar (stacked), in a split pane they sit in its header. */
export function ChatPills({ brains = [], brain, onBrain, councilPick, onRevote, tools, onTools, agents, onAgents, effort = 'auto', onEffort, perm, onPerm, projectId, projects = [], onProject, incognito, settings, chatId, model, onUsageDetails, onOpenSettings, stacked }) {
  return (
    <div className={`top-pills nodrag ${stacked ? 'stacked' : ''}`}>
      {onBrain && brains.length > 0 && (
        <>
          <Select className="pill-select brain" title="Brain mode: who answers in this chat. Council: the three brains vote on who answers and which skills and agents to use." value={brain} onChange={(e) => onBrain(e.target.value)}>
            <option value="">No brain</option>
            <option value="council">Council (vote)</option>
            {brains.map((b) => <option key={b.slug} value={b.slug}>{b.name}{b.role ? ` · ${b.role.replace(/^The /, '')}` : ''}</option>)}
          </Select>
          {brain === 'council' && councilPick && <button className="pill-select revote" title={`Council picked ${councilPick}. Click to ask the council again for the next message.`} onClick={onRevote}>Re-vote</button>}
        </>
      )}
      {onTools && (
        <Select className={`pill-select tools ${tools === 'off' ? 'off' : ''}`} title="Tools in this chat: files, memory, notes, web, terminal and the rest. Off sends a much smaller request (good for small local models and free-tier limits). The default for new chats is in Settings → General." value={tools} onChange={(e) => onTools(e.target.value)}>
          <option value="on">Tools</option>
          <option value="off">No tools</option>
        </Select>
      )}
      {onEffort && (
        <Select className={`pill-select effort ${effort === 'auto' ? 'off' : ''}`} title="Reasoning level for this chat: how much the model thinks before it answers. Low is faster and cheaper, high is slower and thinks harder. Auto leaves it to the model. Models that do not support it ignore it. The default for new chats is in Settings → General." value={effort} onChange={(e) => onEffort(e.target.value)}>
          <option value="auto">Think: auto</option>
          <option value="low">Think: low</option>
          <option value="medium">Think: medium</option>
          <option value="high">Think: high</option>
        </Select>
      )}
      {onAgents && (
        <Select className={`pill-select agents ${agents === 'off' ? 'off' : ''}`} title="Agents in this chat: when on, Artemis can hand parts of the work to your agents (Researcher, Reviewer, …). Off keeps it to one assistant and saves tokens." value={agents} onChange={(e) => onAgents(e.target.value)}>
          <option value="on">Agents</option>
          <option value="off">No agents</option>
        </Select>
      )}
      {onPerm && (
        <Select className={`pill-select perm ${perm}`} title="Auto-allow all: file edits, agent writes, web, terminal, computer control, Make and connectors run without asking. Deleting files still asks." value={perm} onChange={(e) => onPerm(e.target.value)}>
          <option value="ask">Ask first</option>
          <option value="auto">Auto-allow</option>
        </Select>
      )}
      {onProject && (
        <Select className="pill-select" title="Project" disabled={!!incognito} value={projectId || ''} onChange={(e) => onProject(e.target.value || null)}>
          <option value="">No project</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      )}
      <UsageMenu stacked={stacked} settings={settings} chatId={chatId} model={model} onDetails={onUsageDetails} onLimits={() => onOpenSettings('limits')} />
    </div>
  );
}

export default function Composer({ streaming, onSend, onStop, queue = [], queueHeld = false, onQueue, onUnqueue, onSendNow, disabledReason, placeholder, model, onModel, groups = [], projectId, projects = [], onProject, incognito, settings = {}, chatId, perm = 'auto', onPerm, agents = 'on', onAgents, tools = 'on', onTools, onUsageDetails = () => {}, onOpenSettings = () => {}, sentinel, onSentinel, onCompact, canCompact, compacting, brains = [], brain = '', onBrain, councilPick, onRevote }) {
  const [text, setText] = useState(() => (drafts.get(chatId) || {}).text || '');
  const [micErr, setMicErr] = useState('');
  const [atts, setAtts] = useState(() => (drafts.get(chatId) || {}).atts || []);
  useEffect(() => { if (text || atts.length) drafts.set(chatId, { text, atts }); else drafts.delete(chatId); }, [text, atts, chatId]);
  const [drag, setDrag] = useState(false);
  const ta = useRef(null);
  const [items, setItems] = useState({ skills: [], agents: [], connectors: [] });
  const [sel, setSel] = useState(0);
  const [slashOff, setSlashOff] = useState(false);

  // "@" menu: typing @ (at the start or after a space) lists files, skills, agents and connectors
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text);
  const slashOpen = !!m && !slashOff;
  const q = m ? m[1].toLowerCase() : '';
  const folder = (projects.find((p) => p.id === projectId) || {}).folder || undefined;
  useEffect(() => {
    if (!slashOpen) return;
    let live = true;
    Promise.all([window.api.skillsList(folder).catch(() => []), window.api.agentsList(folder).catch(() => []), window.api.mcpStatus().catch(() => [])])
      .then(([sk, ag, cn]) => { if (live) setItems({ skills: (sk || []).filter((x) => x.enabled !== false), agents: ag || [], connectors: (Array.isArray(cn) ? cn : []).filter((x) => x.state === 'connected') }); });
    return () => { live = false; };
  }, [slashOpen, folder]);
  const entries = !slashOpen ? [] : [
    { kind: 'files', name: 'Add files', desc: '' },
    ...items.skills.map((x) => ({ kind: 'skill', name: x.name, desc: x.description })),
    ...items.agents.map((x) => ({ kind: 'agent', name: x.name, desc: x.description })),
    ...(settings.makeEnabled !== false ? [{ kind: 'connector', name: 'Make', make: true, desc: settings.hasMakeToken ? 'Make.com scenarios' : 'Not connected: add your API token in Settings' }] : []),
    ...items.connectors.map((x) => ({ kind: 'connector', name: x.name, desc: `${(x.tools || []).length} tools` }))
  ].filter((e) => !q || e.name.toLowerCase().includes(q));
  useEffect(() => { setSel(0); }, [q, slashOpen]);
  useEffect(() => { if (!m) setSlashOff(false); }, [!!m]);
  const choose = (e) => {
    if (!e) return;
    const base = text.replace(/(^|\s)@[^\s@]*$/, '$1');
    if (e.kind === 'files') { setText(base); pick(); return; }
    if (e.make && !settings.hasMakeToken) { setText(base); onOpenSettings('make'); return; }
    const ins = e.make ? 'Use Make to ' : e.kind === 'skill' ? `Use the "${e.name}" skill. ` : e.kind === 'connector' ? `Use the ${e.name} connector to ` : `Use the ${e.name} agent (delegate) for this: `;
    setText(base + ins);
    setTimeout(() => ta.current?.focus(), 0);
  };

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 220) + 'px';
  }, [text]);

  const addFiles = async (list) => {
    const parsed = await filesToAttachments(list);
    setAtts((a) => [...a, ...parsed]);
  };

  useEffect(() => onWindowDrop((fl) => addFiles(fl)), []);

  const pick = async () => {
    const r = await window.api.pickFiles();
    if (r.length) setAtts((a) => [...a, ...r]);
  };

  const hasInput = !!text.trim() || atts.some((a) => a.kind !== 'error');
  const submit = () => {
    const good = atts.filter((a) => a.kind !== 'error');
    if (streaming) {
      // typing while an answer is being written queues the message; an empty box stops the answer
      if (!text.trim() && !good.length) return onStop();
      if (!onQueue) return onStop();
      drafts.delete(chatId);
      onQueue(text.trim(), good);
      setText(''); setAtts([]);
      return;
    }
    if (!text.trim() && !good.length) return;
    drafts.delete(chatId); // the box may be unmounted by onSend (Home opens the new chat), so its effect would never clear the saved draft
    onSend(text.trim(), good);
    setText(''); setAtts([]);
  };

  const onPaste = async (e) => {
    const fl = [...(e.clipboardData?.files || [])];
    if (fl.length) { e.preventDefault(); const parsed = await filesToAttachments(fl); setAtts((a) => [...a, ...parsed]); }
  };

  return (
    <footer className="composer-wrap">
      <div
        className={`composer ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDrag(false); addFiles([...e.dataTransfer.files]); }}
      >
        {queue.length > 0 && (
          <div className="queue">
            {queue.map((q) => (
              <div key={q.id} className="queue-item">
                <Icon name="clock" size={14} />
                <span className="queue-text">{q.text || `${(q.atts || []).length} attachment${(q.atts || []).length === 1 ? '' : 's'}`}</span>
                <button className="queue-send" onClick={() => onSendNow && onSendNow(q.id)} title="Stop the current answer and send this now">Send now</button>
                <button className="icon-btn" onClick={() => onUnqueue && onUnqueue(q.id)} title="Remove from the queue"><Icon name="x" size={13} /></button>
              </div>
            ))}
            {queueHeld && <div className="queue-note">Queue paused because you stopped the answer. Press Send now to continue.</div>}
          </div>
        )}
        {atts.length > 0 && (
          <div className="chips">{atts.map((a, i) => <AttachmentChip key={i} a={a} onRemove={() => setAtts(atts.filter((_, j) => j !== i))} />)}</div>
        )}
        {slashOpen && entries.length > 0 && (
          <div className="slash-pop">
            {['files', 'skill', 'agent', 'connector'].map((k) => {
              const rows = entries.filter((e) => e.kind === k);
              if (!rows.length) return null;
              return (
                <div key={k}>
                  {k !== 'files' && <div className="slash-title">{k === 'skill' ? 'Skills' : k === 'agent' ? 'Agents' : 'Connectors'}</div>}
                  {rows.map((e) => {
                    const i = entries.indexOf(e);
                    return (
                      <button key={k + e.name} className={`slash-item ${i === sel ? 'on' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={(ev) => { ev.preventDefault(); choose(e); }}>
                        <Icon name={k === 'files' ? 'paperclip' : k === 'skill' ? 'sparkle' : k === 'connector' ? 'plug' : 'user'} size={15} />
                        <span className="slash-name">{e.name}</span>
                        {e.desc && <span className="slash-desc">{e.desc}</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        <textarea
          ref={ta} rows={1} value={text} autoFocus
          placeholder={disabledReason || placeholder || 'Message…  (Enter to send, Shift+Enter for a new line)'}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (slashOpen && entries.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => (i + 1) % entries.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => (i - 1 + entries.length) % entries.length); return; }
              if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) { e.preventDefault(); choose(entries[sel]); return; }
            }
            if (slashOpen && e.key === 'Escape') { e.preventDefault(); setSlashOff(true); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          }}
        />
        {micErr && <div className="mic-err" onClick={() => setMicErr('')}>{micErr}</div>}
        <div className="composer-bar">
          <button className="icon-btn" title="Attach any file. Text, code, Excel, CSV, Word, PDF, ZIP and images are read; other files (audio, video, apps) are passed with their name and location. You can also drag or paste files here." onClick={pick}><Icon name="paperclip" size={18} /></button>
          <MicButton settings={settings} onVoiceSettings={() => onOpenSettings('voice')} onError={setMicErr}
            onText={(t) => { setMicErr(''); setText((x) => (x && !/\s$/.test(x) ? x + ' ' : x) + t); setTimeout(() => ta.current?.focus(), 0); }} />
          {onSentinel && <button className={`icon-btn sentinel-btn ${sentinel && sentinel !== 'off' ? 'on' : ''}`} title={sentinel && sentinel !== 'off' ? 'Sentinel is on. Click to turn off (⇧⌘A)' : 'Sentinel mode: say “Wake up” to talk hands-free (⇧⌘A)'} onClick={onSentinel}><Icon name="shield" size={17} /></button>}
          <span className="bar-spacer" />
          {onModel && <ModelPicker value={model} groups={groups} onChange={onModel} className="model" />}
          {onCompact && <button className="icon-btn compact-btn" disabled={!canCompact} title={compacting ? 'Compacting…' : canCompact ? 'Compact: summarize earlier messages to save tokens' : 'Compact is available once the chat has a few messages'} onClick={onCompact}>{compacting ? <Icon name="spinner" size={16} /> : <Icon name="compact" size={16} />}<span className="btn-label">Compact</span></button>}
          <button className={`send ${streaming && !(hasInput && onQueue) ? 'stop' : ''}`} onClick={submit} title={streaming ? (hasInput && onQueue ? 'Add to the queue' : 'Stop') : 'Send'}><Icon name={streaming && !(hasInput && onQueue) ? 'stop' : 'arrowUp'} size={16} /></button>
        </div>
      </div>
    </footer>
  );
}
