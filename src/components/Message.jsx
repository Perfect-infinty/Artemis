import React, { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import ToolCard from './ToolCard.jsx';
import MediaBlock from './MediaBlock.jsx';
import { ArtifactCard } from './SidePanel.jsx';
import { assistantText } from '../lib/history.js';
import { openPreview } from '../lib/preview.js';
import { speak, stopSpeaking } from '../lib/voice.js';
import { createFollower } from '../lib/follow.js';
import { Icon, FILE_ICON } from './Icons.jsx';

function CopyButton({ getText }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(getText()); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function ReadButton({ getText }) {
  const [on, setOn] = useState(false);
  const fol = useRef(null);
  const stop = () => { stopSpeaking(); try { fol.current && fol.current.clear(); } catch {} setOn(false); };
  useEffect(() => () => { if (on) { stopSpeaking(); try { fol.current && fol.current.clear(); } catch {} } }, [on]);
  const click = (e) => {
    if (on) { stop(); return; }
    // follow along: highlight the sentence being read inside this message
    const box = e.currentTarget.closest('.msg');
    fol.current = createFollower(box);
    const ok = speak(getText(), {
      language: (window.__voiceLang || 'auto'),
      onChunk: (t) => fol.current && fol.current.follow(t),
      onEnd: () => { try { fol.current && fol.current.clear(); } catch {} setOn(false); }
    });
    setOn(ok);
  };
  return <button onClick={click} title={on ? 'Stop reading' : 'Read aloud (the text is highlighted as it is read)'}>{on ? 'Stop' : 'Read aloud'}</button>;
}

function DeleteButton({ onDelete }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 2500); return () => clearTimeout(t); }, [sure]);
  return <button className={sure ? 'danger' : ''} onClick={() => (sure ? onDelete() : setSure(true))}>{sure ? 'Click to confirm' : 'Delete'}</button>;
}

export function AttachmentChip({ a, onRemove }) {
  return (
    <span className={`chip ${a.kind === 'error' ? 'bad' : 'clickable'}`} title={a.error || a.path || a.name} onClick={() => a.kind !== 'error' && openPreview(a)}>
      {a.kind === 'image' && a.dataUrl ? <img src={a.dataUrl} alt="" /> : <Icon name={a.name?.toLowerCase().endsWith('.zip') ? 'file' : (FILE_ICON[a.kind] || 'file')} size={16} />}
      <span className="chip-name">{a.name}</span>
      {a.truncated && <span className="chip-note">truncated</span>}
      {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove(); }}><Icon name="x" size={13} /></button>}
    </span>
  );
}

function BrainHeader({ brain, council }) {
  const v = council && council.verdict;
  return (
    <div className="brain-head">
      {brain && <span className="brain-chip"><Icon name="shield" size={12} /> {brain.name}{brain.role ? <i> · {brain.role.replace(/^The /, '')}</i> : null}</span>}
      {council && council.pending && <span className="muted small">Council is voting…</span>}
      {council && council.votes && (
        <details className="council">
          <summary>Council vote: {v.answerer}{v.unanimous ? ' (unanimous)' : ''}{v.voters ? ` · ${v.voters} voted` : ''}{council.tokens ? ` · ${council.tokens.toLocaleString()} tokens` : ''}</summary>
          {council.votes.map((x) => (
            <div key={x.brain} className="vote">
              <b>{x.brain}</b> {x.ok ? <>→ {x.answerer}{x.skills && x.skills.length ? <span className="muted"> · skills: {x.skills.join(', ')}</span> : null}{x.agents && x.agents.length ? <span className="muted"> · agents: {x.agents.join(', ')}</span> : null}{x.reason ? <div className="muted small">{x.reason}</div> : null}</> : <span className="muted">no vote ({x.reason})</span>}
            </div>
          ))}
          {v && (v.skills.length > 0 || v.agents.length > 0) && <div className="vote muted small">Decision: {v.skills.length ? `skills ${v.skills.join(', ')}` : ''}{v.skills.length && v.agents.length ? '; ' : ''}{v.agents.length ? `agents ${v.agents.join(', ')}` : ''}</div>}
        </details>
      )}
    </div>
  );
}

export default function Message({ m, live, onRegenerate, onDecide, onDelete, artifacts, onOpenArtifact }) {
  if (m.role === 'user' && m.compacted) {
    return (
      <details className="msg compacted" data-msg={m.id}>
        <summary><Icon name="layers" size={14} /> Earlier conversation compacted ({m.compacted} messages summarized)</summary>
        <div className="compacted-body">{m.content}</div>
      </details>
    );
  }
  if (m.role === 'user') {
    return (
      <div className="msg user" data-msg={m.id}>
        {m.attachments?.length > 0 && <div className="chips right">{m.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}</div>}
        {m.content && <div className="bubble">{m.content}</div>}
        <div className="actions"><CopyButton getText={() => m.content} />{onDelete && <DeleteButton onDelete={onDelete} />}</div>
      </div>
    );
  }
  const steps = m.steps || [];
  const empty = !steps.some((s) => s.text || s.toolCalls?.length || s.media?.length || s.artifactRefs?.length);
  return (
    <div className="msg assistant" data-msg={m.id}>
      {(m.brain || m.council) && <BrainHeader brain={m.brain} council={m.council} />}
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          {s.text && <Markdown text={s.text} streaming={live && i === steps.length - 1} />}
          {s.toolCalls?.filter((tc) => tc.name !== 'create_artifact' || tc.status === 'awaiting').map((tc) => <ToolCard key={tc.id} tc={tc} onDecide={onDecide} />)}
          {[...new Set(s.artifactRefs || [])].map((id) => (artifacts && artifacts[id] ? <ArtifactCard key={id} a={artifacts[id]} onOpen={() => onOpenArtifact(id)} /> : null))}
          {s.media?.map((it, j) => <MediaBlock key={j} item={it} />)}
        </React.Fragment>
      ))}
      {live && <div className={`typing ${empty ? '' : 'small'}`}><i /><i /><i /></div>}
      {m.notices?.map((n, i) => <div key={i} className="notice">{n}</div>)}
      {m.error && <div className="error">{m.error}</div>}
      {!live && (
        <div className="actions">
          <CopyButton getText={() => assistantText(m)} />
          <ReadButton getText={() => assistantText(m)} />
          <button onClick={onRegenerate}>Regenerate</button>
          {onDelete && <DeleteButton onDelete={onDelete} />}
        </div>
      )}
    </div>
  );
}
