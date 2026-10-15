// Agents that are working right now, collected from the chats' delegate tool calls.
export function liveAgents(chats, runningIds) {
  const out = [];
  for (const c of chats || []) {
    if (!runningIds.includes(c.id)) continue;
    const m = [...(c.messages || [])].reverse().find((x) => x.role === 'assistant');
    for (const st of (m && m.steps) || []) {
      for (const tc of st.toolCalls || []) {
        for (const a of tc.agents || []) {
          if (a && a.status === 'running') out.push({ ...a, chatId: c.id, chatTitle: c.title || 'Untitled' });
        }
      }
    }
  }
  return out;
}
