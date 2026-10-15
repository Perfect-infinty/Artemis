import React, { useState } from 'react';
import Select from '../Select.jsx';

// "model-id" or "model-id | price in | price out" per line (prices are USD per 1M tokens, optional)
export const headersToText = (h) => Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`).join('\n');

export const textToHeaders = (t) => Object.fromEntries(String(t || '').split('\n').map((l) => { const i = l.indexOf(':'); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; }).filter((x) => x && x[0] && x[1]));

export const modelsToText = (models) => (models || []).map((m) => (m.in !== undefined || m.out !== undefined ? `${m.id} | ${m.in ?? 0} | ${m.out ?? 0}` : m.id)).join('\n');

export const textToModels = (text, old = []) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [id, a, b] = l.split('|').map((x) => x.trim());
  const prev = old.find((m) => m.id === id);
  const m = { id };
  if (prev && prev.name) m.name = prev.name;
  if (a !== undefined && a !== '' && !isNaN(a)) m.in = Number(a);
  if (b !== undefined && b !== '' && !isNaN(b)) m.out = Number(b);
  return m;
});

/** Model name picker: a dropdown of known ids plus "Custom…" for anything else (no more guessing names by hand). */
export function ModelSelect({ value, onChange, options = [], placeholder = 'Choose a model…' }) {
  const v = value || '';
  const listed = options.some((o) => o.id === v);
  const [custom, setCustom] = useState(!!v && !listed);
  return (
    <div className="model-select">
      <Select value={custom ? '__custom' : v} onChange={(e) => { if (e.target.value === '__custom') { setCustom(true); } else { setCustom(false); onChange(e.target.value); } }} placeholder={placeholder}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name || o.id}</option>)}
        <option value="__custom">Other (type the id)…</option>
      </Select>
      {custom && <input value={v} onChange={(e) => onChange(e.target.value)} placeholder="model id" spellCheck={false} style={{ marginTop: 6 }} />}
    </div>
  );
}

export const STT_MODELS = ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-large-v3-turbo', 'whisper-large-v3', 'distil-whisper-large-v3-en'].map((id) => ({ id }));

export const TTS_MODELS = ['kokoro', 'tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'].map((id) => ({ id }));
