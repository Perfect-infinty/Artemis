// Turns a provider / network error message into something a person can act on.
// Returns { kind, title, icon, action } where action is 'providers' | 'retry' | 'compact' | null.
export function classifyError(text) {
  const t = String(text || '');
  const l = t.toLowerCase();
  if (/\b401\b|\b403\b|unauthori[sz]ed|invalid[_ ]?(api[_ ]?)?key|incorrect api key|authentication|no api key|api key (is )?(missing|not set)|permission denied/.test(l))
    return { kind: 'auth', title: 'Authentication failed', icon: 'shield', hint: 'Check the API key for this provider.', action: 'providers', label: 'Open Providers' };
  if (/context[_ ]length|context window|maximum context|too many tokens|prompt is too long|token limit|max_tokens.*exceed|reduce the length/.test(l))
    return { kind: 'context', title: 'Conversation too long', icon: 'layers', hint: 'The chat no longer fits in the model’s context window.', action: 'compact', label: 'Compact chat' };
  if (/\b429\b|rate[_ ]?limit|too many requests|quota|overloaded/.test(l))
    return { kind: 'rate', title: 'Rate limited', icon: 'clock', hint: 'The provider is limiting requests. Wait a moment and retry.', action: 'retry', label: 'Retry' };
  if (/fetch failed|failed to fetch|network|enotfound|econnrefused|econnreset|etimedout|socket hang up|getaddrinfo|timed? ?out|offline/.test(l))
    return { kind: 'network', title: 'Network error', icon: 'globe', hint: 'Could not reach the provider.', action: 'retry', label: 'Retry' };
  if (/\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout|upstream/.test(l))
    return { kind: 'server', title: 'Provider error', icon: 'warning', hint: 'The provider had a problem answering.', action: 'retry', label: 'Retry' };
  return { kind: 'other', title: 'Something went wrong', icon: 'warning', hint: '', action: 'retry', label: 'Retry' };
}
