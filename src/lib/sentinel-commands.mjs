// Spoken commands for Sentinel mode: "Artemis, disable agents", "Artemis, new chat", "Artemis, brain off" ...
// Pure functions (no DOM), so they can be tested in Node. A sentence that is not a command returns null and goes to the chat as usual.

export const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const NUMS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const digitWords = (t) => String(t || '').replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (w) => NUMS[w]);
const OFF = /\b(off|disable|disabled|deactivate|turn off|switch off|shut off|without)\b/;
const ON = /\b(on|enable|enabled|activate|turn on|switch on)\b/;
const AGENTS = /\b(agents?|sub ?agents?)\b/;
const BRAIN = /\b(brains?|council)\b/;
const PERM = /\b(auto ?approv\w*|auto ?accept|auto mode)\b/;
const ASK_FIRST = /\b(ask (me )?(first|before))\b/;
const NEW = /\b(new|fresh|another|clean)\b/;
const CHAT = /\b(chat|conversation)\b/;
const INCOG = /\b(incognito|private)\b/;
const STOPS = new Set(['stop', 'cancel', 'never mind', 'nevermind', 'quiet', 'shut up', 'be quiet']);
const PAGES = [
  [/\b(settings?)\b/, 'settings', 'Settings'],
  [/\b(logs?)\b/, 'logs', 'Logs'],
  [/\b(automations?)\b/, 'automations', 'Automations'],
  [/\b(skills?)\b/, 'skills', 'Skills'],
  [/\b(projects?)\b/, 'projects', 'Projects'],
  [/\b(scheduled|schedules?)\b/, 'schedule', 'Scheduled']
];
const OPEN = /\b(open|show|go to|goto)\b/;

/**
 * Turns a spoken sentence into a command, or null when it is an ordinary message.
 * brains: [{ slug, name }] so a brain can be picked by name ("talk to Galahad").
 * Returns { type, value?, label?, page? }.
 */
export function parseCommand(text, { brains = [], models = [] } = {}) {
  const t = norm(text);
  if (!t) return null;
  const words = t.split(' ');
  if (words.length > 10) return null; // long sentences are questions, not commands
  const out = (o) => o;
  const off = OFF.test(t);
  const on = !off && ON.test(t);

  if (words.length <= 4 && /^(bye bye|bye|goodbye|good bye|see you|see you later|see ya)\b/.test(t)) return out({ type: 'bye' });
  if (STOPS.has(t)) return out({ type: 'stop' });
  if (/\bsentinel\b/.test(t) && (OFF.test(t) || /\b(stop|exit|quit|close)\b/.test(t))) return out({ type: 'sentinelOff' });
  if (INCOG.test(t) && (NEW.test(t) || ON.test(t) || CHAT.test(t) || /\bopen\b/.test(t))) return out({ type: 'incognito' });
  if (NEW.test(t) && CHAT.test(t) && words.length <= 5 && words.findIndex((w) => NEW.test(w)) <= 3) return out({ type: 'newChat' });
  if (/^(start over)$/.test(t)) return out({ type: 'newChat' });
  if (/\b(compact)\b/.test(t) && words.length <= 5) return out({ type: 'compact' });

  if (PERM.test(t) && (off || on)) return out({ type: 'perm', value: off ? 'ask' : 'auto' });
  if (ASK_FIRST.test(t)) return out({ type: 'perm', value: 'ask' });

  // "switch model to GPT 5 mini", "use model Claude", "modeli degistir"
  if (/\bmodel\w*\b/.test(t) && /\b(change|switch|use|set|select|pick|swap)\b/.test(t) && words.length <= 9) {
    const q = digitWords(t);
    let best = null;
    for (const mo of models) {
      const n = digitWords(norm(mo.name)); const id = digitWords(norm(String(mo.id).replace(/^prov:[^:]*:/, '')));
      for (const cand of [n, id]) {
        if (cand && new RegExp('\\b' + cand + '\\b').test(q) && (!best || cand.length > best.len)) best = { len: cand.length, mo };
      }
    }
    if (best) return out({ type: 'model', value: best.mo.id, label: best.mo.name });
    return out({ type: 'modelAsk' });
  }

  if (AGENTS.test(t) && !BRAIN.test(t) && (off || on)) return out({ type: 'agents', value: off ? 'off' : 'on' });

  if (BRAIN.test(t) || /\b(use|switch to|talk to|ask|call)\b/.test(t)) {
    const named = brains.find((b) => {
      const n = norm(b.name); return n && new RegExp('\\b' + n + '\\w*\\b').test(t);
    });
    if (named && (BRAIN.test(t) || words.length <= 5)) return out({ type: 'brain', value: named.slug, label: named.name });
    if (BRAIN.test(t) && /\b(council)\b/.test(t) && !off) return out({ type: 'brain', value: 'council', label: 'Council' });
    if (BRAIN.test(t) && off) return out({ type: 'brain', value: '', label: '' });
    if (BRAIN.test(t) && on) return out({ type: 'brain', value: 'council', label: 'Council' });
  }

  if (OPEN.test(t) && words.length <= 5) {
    for (const [re, page, en] of PAGES) if (re.test(t)) return out({ type: 'open', page, label: en });
  }
  return null;
}

/** What Artemis says back (short). */
export function confirmText(cmd) {
  switch (cmd.type) {
    case 'agents': return cmd.value === 'on' ? 'Agents are on.' : 'Agents are off.';
    case 'brain':
      if (!cmd.value) return 'Brain is off.';
      if (cmd.value === 'council') return 'Council is on.';
      return `Talking to ${cmd.label}.`;
    case 'perm': return cmd.value === 'auto' ? 'Auto-approve is on.' : 'I will ask before editing.';
    case 'model': return `Model: ${cmd.label}.`;
    case 'modelAsk': return 'Which model? Say “switch model to” and its name.';
    case 'bye': return 'Bye.';
    case 'newChat': return 'New chat.';
    case 'incognito': return 'Incognito chat.';
    case 'compact': return 'Compacting.';
    case 'open': return `Opening ${cmd.label}.`;
    default: return '';
  }
}
