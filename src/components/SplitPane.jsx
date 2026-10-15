import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { observeBottom } from '../lib/stick.js';
import Message from './Message.jsx';
import Composer, { ChatPills } from './Composer.jsx';
import { Icon } from './Icons.jsx';

/** The second chat in split view: its own header, message list and message box. h = handlers from App. */
export default function SplitPane({ chat, busy, settings, projects, brains, brain, groups, h }) {
  const ref = useRef(null);
  const stick = useRef(true);
  useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [chat.messages, chat.id]);
  useEffect(() => observeBottom(ref.current, stick), [chat.id]);
  const onScroll = () => { const el = ref.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140; };
  const perm = chat.perm === 'auto' ? 'auto' : chat.perm ? 'ask' : (settings.autoApproveEdits ? 'auto' : 'ask');
  const agents = chat.agents || (settings.delegateEnabled === false ? 'off' : 'on');
  const tools = chat.tools || (settings.toolsEnabled === false ? 'off' : 'on');
  return (
    <section className="split-pane" data-chat-pane={chat.id}>
      <header className="split-head">
        <div className="chat-title">{chat.incognito && <Icon name="ghost" size={15} className="incog-ico" />}{chat.title}</div>
        <ChatPills chatId={chat.id} model={chat.model} settings={settings} incognito={chat.incognito}
          perm={perm} onPerm={(v) => h.update({ perm: v })} agents={agents} onAgents={(v) => h.update({ agents: v })} tools={tools} onTools={(v) => h.update({ tools: v })} effort={chat.effort ?? (settings.reasoningEffort || 'auto')} onEffort={(v) => h.update({ effort: v })}
          projectId={chat.projectId} projects={projects} onProject={(id) => h.update({ projectId: id })}
          brains={brains} brain={brain} onBrain={(v) => h.update({ brain: v, councilPick: null })} councilPick={chat.councilPick} onRevote={() => h.update({ councilPick: null })}
          onUsageDetails={h.onUsageDetails} onOpenSettings={h.onOpenSettings} />
        <button className="icon-btn nodrag" title="Close split view" onClick={h.onClose}><Icon name="x" size={16} /></button>
      </header>
      <section className="messages" ref={ref} onScroll={onScroll}>
        {chat.messages.length === 0 ? (
          <div className="empty"><h1>New chat</h1><p>This chat is open next to the other one.</p></div>
        ) : chat.messages.map((m) => {
          const live = busy && m === chat.messages[chat.messages.length - 1] && m.role === 'assistant';
          return <Message key={m.id} m={m} live={live} onRegenerate={() => h.onRegenerate(m)} onDecide={h.onDecide} onDelete={live ? undefined : () => h.onDelete(m.id)} artifacts={chat.artifacts} onOpenArtifact={() => {}} />;
        })}
      </section>
      <Composer key={chat.id} chatId={chat.id} streaming={busy} onSend={h.onSend} onStop={h.onStop} queue={h.queue} queueHeld={h.queueHeld} onQueue={h.onQueue} onUnqueue={h.onUnqueue} onSendNow={h.onSendNow} model={chat.model} onModel={(m) => h.update({ model: m })} groups={groups}
        incognito={chat.incognito} settings={settings} onUsageDetails={h.onUsageDetails} onOpenSettings={h.onOpenSettings}
        onCompact={h.onCompact} canCompact={h.canCompact} compacting={h.compacting} />
    </section>
  );
}
