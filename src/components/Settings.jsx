import React, { useEffect, useState } from 'react';
import Select from './Select.jsx';
import { askConfirm } from '../lib/dialog.js';
import { dropSentinelModel } from '../lib/sentinel.js';
import { LANGS, listVoices, rankVoice, speak, stopSpeaking } from '../lib/voice.js';
import ModelPicker from './ModelPicker.jsx';
import PERSONALITIES from '../../electron/personality.json';
import { listDevices, unlockLabels } from '../lib/audio-devices.js';
import { SYSTEM_THEME, TEXT_SIZES } from '../lib/themes.js';
import { Modal, Field, ImportRow, PhoneSettings } from './Modals.jsx';
import { costOf, fmtUsd } from '../lib/cost.js';
import { ClaudeUsage, isClaudeProxy } from './ClaudeUsage.jsx';
import { parseTokens, fmtTokens, parseUsd, fmtUsdInput } from '../lib/amount.mjs';

const TABS = [
  ['general', 'General'],
  ['providers', 'Providers'],
  ['tools', 'Tools & safety'],
  ['access', 'Access'],
  ['agents', 'Agents'],
  ['brains', 'Brains'],
  ['limits', 'Usage limits'],
  ['voice', 'Voice'],
  ['make', 'Make'],
  ['phone', 'Phone']
];

// "model-id" or "model-id | price in | price out" per line (prices are USD per 1M tokens, optional)
const headersToText = (h) => Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
const textToHeaders = (t) => Object.fromEntries(String(t || '').split('\n').map((l) => { const i = l.indexOf(':'); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; }).filter((x) => x && x[0] && x[1]));
const modelsToText = (models) => (models || []).map((m) => (m.in !== undefined || m.out !== undefined ? `${m.id} | ${m.in ?? 0} | ${m.out ?? 0}` : m.id)).join('\n');
const textToModels = (text, old = []) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const [id, a, b] = l.split('|').map((x) => x.trim());
  const prev = old.find((m) => m.id === id);
  const m = { id };
  if (prev && prev.name) m.name = prev.name;
  if (a !== undefined && a !== '' && !isNaN(a)) m.in = Number(a);
  if (b !== undefined && b !== '' && !isNaN(b)) m.out = Number(b);
  return m;
});

/** Model name picker: a dropdown of known ids plus "Custom…" for anything else (no more guessing names by hand). */
function ModelSelect({ value, onChange, options = [], placeholder = 'Choose a model…' }) {
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
const STT_MODELS = ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-large-v3-turbo', 'whisper-large-v3', 'distil-whisper-large-v3-en'].map((id) => ({ id }));
const TTS_MODELS = ['kokoro', 'tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'].map((id) => ({ id }));

function ProviderEditor({ initial, presets, onDone, onProviders }) {
  const [p, setP] = useState(initial);
  const [key, setKey] = useState('');
  const [text, setText] = useState(modelsToText(initial.models));
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  const [avail, setAvail] = useState([]);
  const isNew = !initial.id;
  const set = (k) => (e) => setP({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const [hdrText, setHdrText] = useState(headersToText(initial.headers));
  const [rtSort, setRtSort] = useState((initial.routing && initial.routing.sort) || '');
  const [rtOrder, setRtOrder] = useState(((initial.routing && initial.routing.order) || []).join(', '));
  const current = () => ({ ...p, models: textToModels(text, p.models), headers: textToHeaders(hdrText), routing: { sort: rtSort, order: rtOrder } });

  const test = async (fill) => {
    setBusy(fill ? 'fetch' : 'test'); setMsg(null);
    try {
      const r = await window.api.providersTest(current(), key);
      if (!r.ok) return setMsg({ bad: true, text: r.error });
      if (r.models) setAvail(r.models);
      if (fill && r.models) {
        const old = textToModels(text);
        const merged = [...old, ...r.models.filter((id) => !old.some((m) => m.id === id)).map((id) => ({ id }))];
        setText(modelsToText(merged));
        setMsg({ text: `Found ${r.models.length} model${r.models.length === 1 ? '' : 's'}.` });
      } else setMsg({ text: r.models ? `Connected. ${r.models.length} models available.` : r.note || 'Connected.' });
    } finally { setBusy(''); }
  };
  const save = async () => {
    setBusy('save');
    try {
      const r = await window.api.providersSave(current(), key);
      onProviders(r);
      onDone();
    } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!(await askConfirm({ title: 'Remove provider', message: `Remove "${p.name}"? Its API key is deleted too.`, confirmLabel: 'Remove', danger: true }))) return;
    onProviders(await window.api.providersDelete(p.id));
    onDone();
  };
  const usable = p.name.trim() && /^https?:\/\//i.test(p.baseUrl.trim());
  return (
    <div className="prov-editor">
      {isNew && (
        <div className="prov-presets">
          {presets.map((x) => (
            <button key={x.key} className={p.preset === x.key ? 'active' : ''} onClick={() => { setP({ ...p, preset: x.key, name: x.name, baseUrl: x.baseUrl, needsKey: x.needsKey, local: !!x.local, hint: x.hint }); setText(modelsToText(x.models)); setHdrText(headersToText(x.headers)); setMsg(null); }}>{x.name}</button>
          ))}
        </div>
      )}
      {p.hint && <small className="hint">{p.hint}</small>}
      <Field label="Name"><input value={p.name} onChange={set('name')} placeholder="My provider" /></Field>
      <Field label="Endpoint URL" hint="OpenAI-compatible base URL, with or without /v1."><input value={p.baseUrl} onChange={set('baseUrl')} placeholder="http://localhost:11434/v1" spellCheck={false} /></Field>
      <Field label={p.needsKey ? 'API key' : 'API key (optional)'} hint={initial.hasKey ? 'A key is saved. Type a new one to replace it.' : p.local ? 'Local servers usually need no key.' : ''}>
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={initial.hasKey ? '••••••••' : 'sk-…'} />
      </Field>
      <Field label="Extra headers (optional)" hint="One per line, Name: value. Sent with every request to this provider. Cloudflare AI Gateway uses cf-aig-gateway-id: default. Authorization cannot be overridden.">
        <textarea rows={2} value={hdrText} onChange={(e) => setHdrText(e.target.value)} placeholder="cf-aig-gateway-id: default" spellCheck={false} />
      </Field>
      {/openrouter\.ai/i.test(p.baseUrl || '') && (
        <>
          <Field label="Routing" hint="How OpenRouter picks the server that runs a model. Default balances price and speed. The other choices turn balancing off and always use the cheapest, the lowest-latency or the highest-throughput server.">
            <Select value={rtSort} onChange={(e) => setRtSort(e.target.value)}>
              <option value="">Default (balanced)</option>
              <option value="price">Cheapest first</option>
              <option value="latency">Lowest latency first</option>
              <option value="throughput">Highest throughput first</option>
            </Select>
          </Field>
          <Field label="Preferred servers (optional)" hint="Comma-separated OpenRouter server slugs, lowercase (for example morph, relace). They are tried first, other servers stay as the fallback. Use this or a routing choice above, not both.">
            <input value={rtOrder} onChange={(e) => setRtOrder(e.target.value)} placeholder="morph, relace" spellCheck={false} />
          </Field>
        </>
      )}
      <label className="check"><input type="checkbox" checked={!!p.needsKey} onChange={set('needsKey')} /> <span>This provider requires an API key</span></label>
      <label className="check"><input type="checkbox" checked={p.noTools === true || (p.noTools === undefined && /claude|anthropic/i.test(p.name || '') && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(p.baseUrl || ''))} onChange={(e) => setP({ ...p, noTools: e.target.checked })} /> <span>This server cannot call tools<br /><small>Turn on for a proxy in front of the Claude CLI: it ignores tool calls. Artemis then sends plain chat only; memory still works through a hidden marker.</small></span></label>
      <Field label="Models" hint="One per line: model-id, or model-id | price in | price out (USD per 1M tokens, optional). Local models without a price count as free.">
        <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={'llama3.2:3b\n@cf/google/gemma-4-26b-a4b-it | 0.1 | 0.3'} spellCheck={false} />
      </Field>
      <Field label="Add a model" hint={avail.length ? `${avail.length} models reported by this provider.` : 'Press “Fetch models” to load the provider’s list, then pick from it.'}>
        <Select value="" placeholder={avail.length ? 'Pick a model to add…' : 'Fetch models first'} disabled={!avail.length}
          onChange={(e) => { const id = e.target.value; if (!id) return; const old = textToModels(text); if (!old.some((m) => m.id === id)) setText(modelsToText([...old, { id }])); }}>
          {avail.filter((id) => !textToModels(text).some((m) => m.id === id)).map((id) => <option key={id} value={id}>{id}</option>)}
        </Select>
      </Field>
      <div className="row prov-actions">
        <button onClick={() => test(true)} disabled={!!busy || !/^https?:\/\//i.test(p.baseUrl.trim())}>{busy === 'fetch' ? 'Fetching…' : 'Fetch models'}</button>
        <button onClick={() => test(false)} disabled={!!busy || !/^https?:\/\//i.test(p.baseUrl.trim())}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        {msg && <small className={`hint ${msg.bad ? 'err' : 'ok'}`}>{msg.text}</small>}
      </div>
      <div className="actions-row">
        {!isNew && <button className="danger" onClick={remove}>Remove</button>}
        <span style={{ flex: 1 }} />
        <button onClick={onDone}>Cancel</button>
        <button className="primary" onClick={save} disabled={!usable || !!busy}>{isNew ? 'Add provider' : 'Save provider'}</button>
      </div>
    </div>
  );
}

function ProvSwitch({ on, onClick }) {
  return <button type="button" role="switch" aria-checked={on} className={'prov-switch' + (on ? ' on' : '')} onClick={onClick} title={on ? 'Enabled — click to turn off' : 'Disabled — click to turn on'}><span className="knob" /><span className="lbl">{on ? 'Enabled' : 'Disabled'}</span></button>;
}


function ProvidersTab({ s, set, settings, providers, onProviders, onApply }) {
  const [presets, setPresets] = useState([]);
  const [edit, setEdit] = useState(null);
  useEffect(() => { window.api.providersPresets().then(setPresets).catch(() => {}); }, []);
  const toggle = async (p) => onProviders(await window.api.providersSave({ ...p, enabled: p.enabled === false }));
  if (edit) {
    return <ProviderEditor key={edit.id || 'new'} initial={edit} presets={presets} onProviders={onProviders} onDone={() => setEdit(null)} />;
  }
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>Models from every enabled provider appear in the model picker. Provider changes are saved right away.</p>
      {providers.map((p) => (
        <div key={p.id} className={`prov-card ${p.enabled === false ? 'off' : ''}`}>
          <div className="prov-head">
            <b>{p.name}</b>
            <span className="muted small">{p.local ? 'local · ' : ''}{(p.models || []).length} model{(p.models || []).length === 1 ? '' : 's'}{p.needsKey && !p.hasKey ? ' · key missing' : ''}</span>
            <span style={{ flex: 1 }} />
            <ProvSwitch on={p.enabled !== false} onClick={() => toggle(p)} />
            <button onClick={() => setEdit(p)}>Edit</button>
          </div>
          <code className="prov-url">{p.baseUrl}</code>
          {isClaudeProxy(p) && <ClaudeUsage />}
        </div>
      ))}
      <button className="primary add-prov" onClick={() => setEdit({ name: '', baseUrl: '', needsKey: false, local: false, models: [], enabled: true })}>+ Add provider</button>
      <small className="hint">Works with Cloudflare Workers AI, Ollama, LM Studio, OpenRouter, OpenAI, the Claude API and any OpenAI-compatible server.</small>
    </>
  );
}


const startOf = (month) => { const d = new Date(); d.setHours(0, 0, 0, 0); if (month) d.setDate(1); return d.getTime(); };

function LimitRow({ title, kind, value, used, onChange, presets }) {
  const usd = kind === 'usd';
  const show = (n) => (usd ? fmtUsdInput(n) : fmtTokens(n));
  const [text, setText] = useState(show(value));
  useEffect(() => { setText(show(value)); }, [value]);
  const commit = () => { const n = usd ? parseUsd(text) : parseTokens(text); onChange(n); setText(show(n)); };
  const pct = value > 0 ? Math.min(100, Math.round((used / value) * 100)) : 0;
  const label = (n) => (usd ? '$' + n : fmtTokens(n));
  return (
    <div className="limit-row">
      <div className="limit-top">
        <b>{title}</b>
        <span className="muted small">{usd ? fmtUsd(used) : fmtTokens(used) || '0'} used{value > 0 ? ` of ${label(value)} (${pct}%)` : ' · no limit'}</span>
      </div>
      {value > 0 && <div className="limit-bar"><div className={pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : ''} style={{ width: pct + '%' }} /></div>}
      <div className="limit-chips">
        <button className={!value ? 'active' : ''} onClick={() => onChange(0)}>Off</button>
        {presets.map((n) => <button key={n} className={value === n ? 'active' : ''} onClick={() => onChange(n)}>{label(n)}</button>)}
        <input value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} placeholder={usd ? 'custom, e.g. 7.5' : 'custom, e.g. 750k'} />
      </div>
    </div>
  );
}

function LimitsTab({ s, setS }) {
  const [rows, setRows] = useState([]);
  useEffect(() => { window.api.usageGet().then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => {}); }, []);
  const d0 = startOf(false), m0 = startOf(true);
  const sum = (from) => rows.filter((r) => r.t >= from).reduce((a, r) => ({ tok: a.tok + (r.prompt || 0) + (r.completion || 0), usd: a.usd + costOf(r) }), { tok: 0, usd: 0 });
  const day = sum(d0), month = sum(m0);
  const put = (k) => (n) => setS((x) => ({ ...x, [k]: n }));
  const quick = (d, m) => setS((x) => ({ ...x, dailyUsdLimit: d, monthlyUsdLimit: m }));
  const q = [['No spending limit', 0, 0], ['Light: $1/day, $20/month', 1, 20], ['Normal: $5/day, $50/month', 5, 50], ['Heavy: $20/day, $200/month', 20, 200]];
  return (
    <>
      <p className="muted small" style={{ margin: 0 }}>Artemis stops answering when a limit is reached and warns at 80%. Spending is an estimate from list prices; models without a price count as free (local models, for example).</p>
      <div className="limit-quick">
        <span className="muted small">Quick setup</span>
        {q.map(([name, d, m]) => <button key={name} className={(s.dailyUsdLimit || 0) === d && (s.monthlyUsdLimit || 0) === m ? 'active' : ''} onClick={() => quick(d, m)}>{name}</button>)}
      </div>
      <LimitRow title="Spending today" kind="usd" value={Number(s.dailyUsdLimit) || 0} used={day.usd} onChange={put('dailyUsdLimit')} presets={[1, 2, 5, 10, 20]} />
      <LimitRow title="Spending this month" kind="usd" value={Number(s.monthlyUsdLimit) || 0} used={month.usd} onChange={put('monthlyUsdLimit')} presets={[20, 50, 100, 200]} />
      <LimitRow title="Tokens today" kind="tok" value={Number(s.dailyTokenLimit) || 0} used={day.tok} onChange={put('dailyTokenLimit')} presets={[500000, 1000000, 5000000, 20000000]} />
      <LimitRow title="Tokens this month" kind="tok" value={Number(s.monthlyTokenLimit) || 0} used={month.tok} onChange={put('monthlyTokenLimit')} presets={[5000000, 20000000, 100000000]} />
      <Field label="Max length of one answer (tokens)" hint="Longer answers cost more. 8192 fits most replies.">
        <div className="limit-chips">
          {[2048, 4096, 8192, 16384, 32768].map((n) => <button key={n} className={Number(s.maxTokens) === n ? 'active' : ''} onClick={() => setS((x) => ({ ...x, maxTokens: n }))}>{fmtTokens(n)}</button>)}
          <input type="number" min={256} max={64000} step={256} value={s.maxTokens} onChange={(e) => setS((x) => ({ ...x, maxTokens: e.target.value }))} />
        </div>
      </Field>
    </>
  );
}


function AudioDevices({ s, setS }) {
  const [dev, setDev] = useState({ inputs: [], outputs: [], labeled: true });
  const refresh = async () => setDev(await listDevices());
  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices; if (md && md.addEventListener) md.addEventListener('devicechange', refresh);
    return () => { if (md && md.removeEventListener) md.removeEventListener('devicechange', refresh); };
  }, []);
  const allow = async () => { await unlockLabels(); refresh(); };
  const has = (list, id) => !id || list.some((d) => d.id === id);
  return (
    <>
      <h4 className="sub-h">Audio devices</h4>
      <Field label="Microphone" hint="Used by the mic button and Sentinel. Sentinel picks it up the next time it starts.">
        <Select value={s.micDeviceId || ''} onChange={(e) => { window.__micId = e.target.value; setS((x) => ({ ...x, micDeviceId: e.target.value })); }}>
          <option value="">System default</option>
          {!has(dev.inputs, s.micDeviceId) && <option value={s.micDeviceId}>Not connected (using the default)</option>}
          {dev.inputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
      </Field>
      <Field label="Speakers / headphones" hint="Where Artemis’s voice plays. The built-in computer voice always uses the system output; Piper and OpenAI voices follow this choice.">
        <Select value={s.speakerDeviceId || ''} onChange={(e) => { window.__speakerId = e.target.value; setS((x) => ({ ...x, speakerDeviceId: e.target.value })); }}>
          <option value="">System default</option>
          {!has(dev.outputs, s.speakerDeviceId) && <option value={s.speakerDeviceId}>Not connected (using the default)</option>}
          {dev.outputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
      </Field>
      <div className="actions-row">
        <button onClick={refresh}>Refresh devices</button>
        {!dev.labeled && <button onClick={allow}>Show device names</button>}
      </div>
    </>
  );
}
/** One place to see and change what Artemis can reach: macOS permissions and the features it is allowed to use. */

/** Lets other apps (Claude Code, the Claude proxy, Claude Desktop …) control Artemis through MCP. */
function McpServerCard() {
  const [i, setI] = useState(null);
  const [port, setPort] = useState('');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  const load = () => window.api.mcpServerInfo().then((x) => { setI(x); setPort(String(x.port)); }).catch(() => {});
  useEffect(() => { load(); }, []);
  const apply = async (o) => { setI(await window.api.mcpServerSet(o)); };
  const url = i ? `http://127.0.0.1:${i.port}/mcp` : '';
  const tok = i && i.token ? i.token : '<token>';
  const cmd = `claude mcp add --transport http --scope user artemis ${url} --header "Authorization: Bearer ${tok}"`;
  const json = JSON.stringify({ mcpServers: { artemis: { type: 'http', url, headers: { Authorization: `Bearer ${tok}` } } } }, null, 2);
  const copy = async (what, text) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500); } catch {} };
  return (
    <>
      <h4 className="sub-h">Let other apps control Artemis (MCP server)</h4>
      <div className="prov-card">
        <div className="prov-head"><b>Artemis MCP server</b><span className="muted small">{i && i.running ? `running on 127.0.0.1:${i.port}` : 'off'}</span><span style={{ flex: 1 }} />
          <ProvSwitch on={!!(i && i.enabled)} onClick={() => i && apply({ enabled: !i.enabled })} />
        </div>
        <small className="hint">Claude Code, the Claude proxy or any MCP app can then change the theme and settings, switch providers on or off, use memory and Notes, and run commands in the Artemis terminal. It only listens on this Mac and needs the token below. Permissions that give Artemis more power (terminal, computer control, auto-approve, phone, keys) cannot be changed this way. Running a command or editing a note always asks you first.</small>
        {i && i.error && <small className="hint" style={{ color: 'var(--danger, #d9534f)' }}>{i.error}</small>}
        {i && i.enabled && (
          <>
            <div className="row" style={{ alignItems: 'end' }}>
              <Field label="Port"><input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={() => port && String(i.port) !== port && apply({ port })} /></Field>
              <Field label="Token"><input readOnly type={show ? 'text' : 'password'} value={i.token} onFocus={(e) => e.target.select()} /></Field>
              <button onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
              <button onClick={() => askConfirm({ title: 'Make a new token?', message: 'Apps that use the old token will stop working until you give them the new one.', confirmLabel: 'New token' }).then((ok) => ok && apply({ resetToken: true }))}>New token</button>
            </div>
            <label className="perm-row" style={{ marginTop: 6 }}>
              <div className="perm-main"><b>Don't ask before running commands from outside</b><span className="muted small">Off: Artemis asks (a window appears) each time an outside app wants to run a command or edit a note.</span></div>
              <span className={`perm-state ${i.alwaysAllow ? 'bad' : 'ok'}`}>{i.alwaysAllow ? 'No questions' : 'Asks first'}</span>
              <input type="checkbox" checked={!!i.alwaysAllow} onChange={(e) => apply({ alwaysAllow: e.target.checked })} />
            </label>
            <Field label="Add it to Claude Code (run once in a terminal)"><textarea readOnly rows={3} value={cmd} onFocus={(e) => e.target.select()} /></Field>
            <div className="row"><button onClick={() => copy('cmd', cmd)}>{copied === 'cmd' ? 'Copied' : 'Copy command'}</button><button onClick={() => copy('json', json)}>{copied === 'json' ? 'Copied' : 'Copy JSON config'}</button><button onClick={() => copy('url', url)}>{copied === 'url' ? 'Copied' : 'Copy address'}</button></div>
            <small className="hint">The Claude proxy starts Claude Code, which reads this list, so adding Artemis once makes its tools appear there too (restart the proxy). If it still asks for permission in headless mode, allow <code>mcp__artemis</code> in the Claude Code settings. Tools: artemis_status, set_theme, set_setting, list/set providers, memory, notes, terminal_run …</small>
          </>
        )}
      </div>
    </>
  );
}

function AccessTab({ s, set, projects = [] }) {
  const [st, setSt] = useState(null);
  const [dirs, setDirs] = useState({ files: '', notes: '' });
  useEffect(() => { Promise.all([window.api.defaultFilesFolder().catch(() => ''), window.api.notesRoot().catch(() => '')]).then(([files, notes]) => setDirs({ files: files || '', notes: (notes && (notes.root || notes)) || '' })); }, []);
  const refresh = () => window.api.permStatus().then(setSt).catch(() => setSt({ supported: false, items: [] }));
  useEffect(() => { refresh(); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh); }, []);
  const ask = async (id) => { setSt(await window.api.permRequest(id)); };
  const mark = { granted: ['Allowed', 'ok'], denied: ['Not allowed', 'bad'], 'not-determined': ['Not asked yet', 'warn'], unknown: ['Check in System Settings', 'warn'], restricted: ['Restricted', 'bad'] };
  const phoneOn = !!s.telegramEnabled;
  const rows = [
    ['toolsEnabled', 'Files and tools', 'Read and write files in the project folder, create artifacts.', s.toolsEnabled],
    ['shellEnabled', 'Terminal', 'Run commands on this computer, also in the visible terminal panel. Asks once per task.', s.shellEnabled],
    ['notesAi', 'Notes (knowledge base)', 'Let Artemis search and read your Notes. Asks once per task; writing a note asks every time.', s.notesAi !== false],
    ['computerEnabled', 'Computer control', 'See the screen, move the mouse, type. Asks once per task. Emergency stop: Cmd+Shift+Esc.', s.computerEnabled],
    ['webEnabled', 'Internet', 'Search the web and open pages.', s.webEnabled],
    ['memoryEnabled', 'Memory', 'Remember facts about you between chats.', s.memoryEnabled],
    ['connectorsEnabled', 'Connectors', 'Use your connected apps (MCP servers).', s.connectorsEnabled !== false],
    ['skillsEnabled', 'Skills', 'Load your saved instructions.', s.skillsEnabled !== false],
    ['delegateEnabled', 'Agents', 'Hand parts of a task to helper agents.', s.delegateEnabled !== false]
  ];
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>Everything Artemis can reach, in one place. Switch features off here, or open the macOS permission it needs.</p>
      <h4 className="sub-h">macOS permissions</h4>
      {st === null ? <div className="muted">Checking…</div> : !st.supported ? <div className="muted small">macOS permissions are not used on this system.</div> : (
        <div className="perm-list">
          {st.items.map((i) => {
            const [label, tone] = mark[i.status] || mark.unknown;
            return (
              <div key={i.id} className="perm-row">
                <div className="perm-main"><b>{i.title}</b><span className="muted small">{i.why}</span></div>
                <span className={`perm-state ${tone}`}>{label}</span>
                <button type="button" onClick={() => ask(i.id)} disabled={i.status === 'granted'}>{i.status === 'granted' ? 'Done' : i.id === 'notifications' ? 'Test' : 'Allow'}</button>
              </div>
            );
          })}
        </div>
      )}
      <small className="hint">After allowing Screen Recording or Accessibility, macOS may ask you to restart Artemis. If you run Artemis from a terminal, allow the terminal app instead. This list refreshes when you come back from System Settings.</small>
      <h4 className="sub-h">Folders Artemis can reach</h4>
      <div className="perm-list">
        {[
          ['Default files folder', 'Used by chats that have no project. File tools stay inside it.', dirs.files],
          ...projects.filter((p) => p.folder).map((p) => ['Project: ' + p.name, 'File tools stay inside this folder in chats of this project.', p.folder]),
          ['Notes', s.notesAi !== false ? 'Artemis can search and read these notes (asks once per task); writing a note always asks.' : 'Notes access for Artemis is off.', dirs.notes]
        ].filter((r) => r[2]).map(([title, why, dir]) => (
          <div key={title + dir} className="perm-row">
            <div className="perm-main"><b>{title}</b><span className="muted small">{why}</span><code className="prov-url">{dir}</code></div>
            <button type="button" onClick={() => window.api.revealPath(dir)}>Show</button>
          </div>
        ))}
        <div className="perm-row">
          <div className="perm-main"><b>Terminal and computer control</b><span className="muted small">{s.shellEnabled || s.computerEnabled ? 'Not limited to folders: a command can reach anything your Mac user can. Each task asks first.' : 'Off, so no commands run and no folder outside the ones above is reachable.'}</span></div>
          <span className={`perm-state ${s.shellEnabled || s.computerEnabled ? 'warn' : 'ok'}`}>{s.shellEnabled || s.computerEnabled ? 'Any folder' : 'Off'}</span>
        </div>
      </div>
      <small className="hint">macOS may also ask separately the first time a folder such as Documents or Desktop is used. You can review that in System Settings → Privacy &amp; Security → Files and Folders.</small>
      <h4 className="sub-h">What Artemis may use</h4>
      <div className="perm-list">
        {rows.map(([key, title, why, on]) => (
          <label key={key} className="perm-row">
            <div className="perm-main"><b>{title}</b><span className="muted small">{why}</span></div>
            <span className={`perm-state ${on ? 'ok' : 'warn'}`}>{on ? 'On' : 'Off'}</span>
            <input type="checkbox" checked={!!on} onChange={set(key)} />
          </label>
        ))}
        <div className="perm-row">
          <div className="perm-main"><b>Phone (Telegram)</b><span className="muted small">Lets you chat with Artemis from your phone and lets it send you files. Set up in the Phone tab.</span></div>
          <span className={`perm-state ${phoneOn ? 'ok' : 'warn'}`}>{phoneOn ? 'On' : 'Off'}</span>
        </div>
        <label className="perm-row">
          <div className="perm-main"><b>Approve everything in new chats</b><span className="muted small">Off: Artemis asks before edits, the terminal, the computer and scheduled tasks. On: it does not ask.</span></div>
          <span className={`perm-state ${s.autoApproveEdits ? 'bad' : 'ok'}`}>{s.autoApproveEdits ? 'No questions' : 'Asks first'}</span>
          <input type="checkbox" checked={!!s.autoApproveEdits} onChange={set('autoApproveEdits')} />
        </label>
      </div>
      <McpServerCard />
    </>
  );
}

function VoiceTab({ s, setS, providers, chatGroups = [] }) {
  const sel = s.voiceSttProvider || '';
  const [model, setModel] = useState(null);
  const [voices, setVoices] = useState(() => listVoices());
  useEffect(() => { window.api.sentinelStatus().then(setModel).catch(() => {}); const f = () => setVoices(listVoices()); try { speechSynthesis.addEventListener('voiceschanged', f); } catch {} return () => { try { speechSynthesis.removeEventListener('voiceschanged', f); } catch {} }; }, []);
  return (
    <>
      <p className="muted small">Press the mic button next to the message box, speak, press it again and your words are typed for you. Works in English.</p>
      <Field label="Speech-to-text provider" hint="Needs an endpoint that supports /audio/transcriptions (Whisper). OpenAI and Groq do. Add one under Providers first, then pick it here.">
        <Select value={sel} onChange={(e) => setS((x) => ({ ...x, voiceSttProvider: e.target.value }))}>
          <option value="">None</option>
          {providers.filter((p) => p.enabled !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Speech-to-text model" hint="OpenAI: whisper-1 or gpt-4o-mini-transcribe. Groq: whisper-large-v3-turbo.">
        <ModelSelect value={s.voiceSttModel || ''} options={STT_MODELS} onChange={(v) => setS((x) => ({ ...x, voiceSttModel: v }))} />
      </Field>
      <Field label="Language" hint="Auto-detect works well for one language per message. Pick a language if short sentences get misheard.">
        <Select value={s.voiceLanguage === 'en' ? 'en' : 'auto'} onChange={(e) => setS((x) => ({ ...x, voiceLanguage: e.target.value }))}>
          {LANGS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </Select>
      </Field>
      <label className="check"><input type="checkbox" checked={!!s.voiceAutoRead} onChange={(e) => setS((x) => ({ ...x, voiceAutoRead: e.target.checked }))} /> <span>Read replies aloud automatically<br /><small>Uses your computer's own voices (free, offline). You can also press the speaker button under any reply.</small></span></label>
      <h4 className="sub-h">Reading voice</h4>
      <Field label="Voice engine" hint="Computer voices work offline but sound robotic. A local voice server (Kokoro, Piper) sounds far more natural and still runs only on your Mac. If the server is not running, Artemis falls back to the computer voice.">
        <Select value={s.ttsEngine || 'system'} onChange={(e) => { window.__tts = { engine: e.target.value }; setS((x) => ({ ...x, ttsEngine: e.target.value })); }}>
          <option value="system">Computer voices (built in)</option>
          <option value="openai">Local / custom server (OpenAI-compatible, e.g. Kokoro)</option>
          <option value="piper">Piper server (local)</option>
        </Select>
      </Field>
      {(s.ttsEngine === 'openai' || s.ttsEngine === 'piper') && (
        <>
          <Field label="Server address" hint={s.ttsEngine === 'piper' ? 'Default http://localhost:5000. Start it with: python3 -m piper.http_server -m <voice>' : 'Default http://localhost:8880 (Kokoro-FastAPI). Anything that serves /v1/audio/speech works.'}>
            <input value={s.ttsUrl || ''} onChange={(e) => setS((x) => ({ ...x, ttsUrl: e.target.value }))} placeholder={s.ttsEngine === 'piper' ? 'http://localhost:5000' : 'http://localhost:8880'} spellCheck={false} />
          </Field>
          {s.ttsEngine === 'openai' && <Field label="Model"><ModelSelect value={s.ttsModel || ''} options={TTS_MODELS} onChange={(v) => setS((x) => ({ ...x, ttsModel: v }))} /></Field>}
          {s.ttsEngine === 'piper' ? (
            <>
              <Field label="English voice" hint="e.g. en_US-lessac-medium or en_GB-alba-medium."><input value={s.ttsVoiceEn || ''} onChange={(e) => setS((x) => ({ ...x, ttsVoiceEn: e.target.value }))} placeholder="en_US-lessac-medium" spellCheck={false} /></Field>
            </>
          ) : (
            <Field label="Voice name" hint="Kokoro: af_heart, af_bella, am_michael, bf_emma …">
              <input value={s.ttsVoice || ''} onChange={(e) => setS((x) => ({ ...x, ttsVoice: e.target.value }))} placeholder="af_heart" spellCheck={false} />
            </Field>
          )}
          <small className="hint">Server settings are used after you press Save, then Test voice.</small>
        </>
      )}
      <Field label="Voice" hint="Automatic picks the nicest voice installed for the language of the reply. For much better quality on a Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, then download a Premium or Enhanced voice. It shows up here after you restart Artemis.">
        <Select value={s.voiceName || ''} onChange={(e) => { window.__voiceName = e.target.value; setS((x) => ({ ...x, voiceName: e.target.value })); }}>
          <option value="">Automatic (best available)</option>
          {voices.map((v) => <option key={v.name + v.lang} value={v.name}>{v.name} · {v.lang}{rankVoice(v) >= 35 ? ' · high quality' : ''}</option>)}
        </Select>
      </Field>
      <Field label="Speed">
        <Select value={String(s.voiceRate || 1)} onChange={(e) => { window.__voiceRate = Number(e.target.value); setS((x) => ({ ...x, voiceRate: Number(e.target.value) })); }}>
          <option value="0.9">Slower</option><option value="1">Normal</option><option value="1.1">Faster</option><option value="1.25">Fast</option>
        </Select>
      </Field>
      <div className="actions-row"><button onClick={() => speak('Hello, this is how I sound.', { language: 'auto' })}>Test voice</button><button onClick={stopSpeaking}>Stop</button></div>
      <AudioDevices s={s} setS={setS} />
      <h4 className="sub-h">Sentinel mode</h4>
      <p className="muted small">Turn it on with the shield button next to the mic (or ⇧⌘A). Artemis then listens for the phrase “Wake up”, like “Hey Siri”. The phrase is recognised on your computer by a small offline model, without AI or internet. After you say it, Artemis keeps listening: it answers in the chat, reads the answer aloud and waits for your next sentence, until you say “bye bye” or stay silent for 10 seconds. Your sentence is transcribed with the speech-to-text provider above.</p>
      <label className="check"><input type="checkbox" checked={!!s.sentinelAuto} onChange={(e) => setS((x) => ({ ...x, sentinelAuto: e.target.checked }))} /> <span>Start Sentinel when Artemis opens<br /><small>Needs the voice model below. The microphone stays on while Sentinel is on.</small></span></label>
      <label className="check"><input type="checkbox" checked={s.sentinelNameOnly !== false} onChange={(e) => setS((x) => ({ ...x, sentinelNameOnly: e.target.checked }))} /> <span>Only react when I say “Artemis”<br /><small>Inside a conversation, a sentence counts only if it starts with “Artemis” or follows Artemis' answer within a few seconds. Other people talking nearby, or you talking to someone else, is ignored.</small></span></label>
      <Field label="Microphone sensitivity" hint="Lower it if voices from further away or from other people are picked up. Speak closer to the microphone, or use headphones.">
        <Select value={s.sentinelSensitivity || 'normal'} onChange={(e) => setS((x) => ({ ...x, sentinelSensitivity: e.target.value }))}>
          <option value="high">High (quiet room)</option><option value="normal">Normal</option><option value="low">Low (noisy room, speak close)</option>
        </Select>
      </Field>
      <label className="check"><input type="checkbox" checked={s.sentinelPreload === true} onChange={(e) => setS((x) => ({ ...x, sentinelPreload: e.target.checked }))} /> <span>Load the voice model in the background<br /><small>Makes turning Sentinel on instant, but uses a lot of CPU and memory for a minute after Artemis opens. Leave off if your computer slows down.</small></span></label>
      <label className="check"><input type="checkbox" checked={s.sentinelInterrupt === true} onChange={(e) => setS((x) => ({ ...x, sentinelInterrupt: e.target.checked }))} /> <span>Interrupt by talking<br /><small>Start talking while Artemis is speaking and it stops. Best with headphones; off by default because other voices can cut it off. You can always say “stop”.</small></span></label>
      <Field label="Sentinel model" hint="Voice answers start sooner with a small, fast model. Sentinel chats use it instead of the default model; short spoken answers rarely need a big one.">
        <Select value={s.sentinelModel || ''} onChange={(e) => setS((x) => ({ ...x, sentinelModel: e.target.value }))}>
          <option value="">Same as the default model</option>
          {chatGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
        </Select>
      </Field>
      <div className="muted small" style={{ marginTop: 8 }}>
        Voice model: {model ? (model.ready ? `installed (${Math.round(model.size / 1048576)} MB)` : 'not downloaded yet (about 40 MB, downloaded the first time you turn Sentinel on)') : '…'}
        {model && model.ready && <> · <button className="link" onClick={async () => { await window.api.sentinelDelete(); dropSentinelModel(); setModel(await window.api.sentinelStatus()); }}>Remove</button></>}
      </div>
    </>
  );
}

const MAKE_ZONES = ['eu1.make.com', 'eu2.make.com', 'us1.make.com', 'us2.make.com', 'eu1.make.celonis.com', 'eu2.make.celonis.com', 'us1.make.celonis.com'];

function MakeTab({ s, setS }) {
  const [zone, setZone] = useState(s.makeZone || 'eu1.make.com');
  const [token, setToken] = useState('');
  const [has, setHas] = useState(!!s.hasMakeToken);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const custom = !MAKE_ZONES.includes(zone);
  const run = async () => {
    setBusy(true); setRes(null);
    try {
      const saved = await window.api.makeSave({ zone, token });
      if (!saved.ok) { setRes({ ok: false, error: saved.error }); return; }
      setHas(saved.hasToken); setS((x) => ({ ...x, makeZone: saved.zone, hasMakeToken: saved.hasToken })); setToken('');
      setRes(await window.api.makeTest({ zone: saved.zone }));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await askConfirm({ title: 'Disconnect Make', message: 'Remove the saved Make API token from this computer?', confirmLabel: 'Remove', danger: true }))) return;
    await window.api.makeClear(); setHas(false); setRes(null); setS((x) => ({ ...x, hasMakeToken: false }));
  };
  return (
    <>
      <p className="muted small">Lets Artemis list, read, create, change, switch on/off and run your Make scenarios when you ask. Creating, changing and running always ask for approval first.</p>
      <label className="check"><input type="checkbox" checked={s.makeEnabled !== false} onChange={(e) => setS((x) => ({ ...x, makeEnabled: e.target.checked }))} /> <span>Use Make in chats</span></label>
      <Field label="Zone" hint="The address you see when you are logged in to Make, e.g. eu1.make.com.">
        <div className="row">
          <Select value={custom ? '__custom' : zone} onChange={(e) => setZone(e.target.value === '__custom' ? '' : e.target.value)}>
            {MAKE_ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            <option value="__custom">Other…</option>
          </Select>
          {custom && <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="eu1.make.com" />}
        </div>
      </Field>
      <Field label="API token" hint={has ? 'A token is saved. Paste a new one to replace it.' : 'Make → your profile → API → Add token. Give it the scopes Artemis should use (scenarios: read, write, run; connections: read; teams and organizations: read). Needs a paid Make plan for most endpoints.'}>
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={has ? '••••••••••••' : 'Paste token'} />
      </Field>
      <div className="row">
        <button className="primary" onClick={run} disabled={busy || (!token.trim() && !has)}>{busy ? 'Testing…' : 'Save & test'}</button>
        {has && <button className="danger" onClick={remove}>Remove token</button>}
      </div>
      {res && !res.ok && <div className="error">{res.error}</div>}
      {res && res.ok && (
        <div className="make-res">
          <strong>Connected.</strong>{!res.orgs.length && ' No organizations were returned for this token.'}
          {res.orgs.map((o) => (
            <div key={o.id} className="make-org"><b>{o.name}</b> <span className="muted small">(organization {o.id})</span>
              {o.teams.map((t) => <div key={t.id} className="muted small">Team: {t.name} · id {t.id}</div>)}
            </div>
          ))}
        </div>
      )}
      <small className="hint">The token is stored encrypted on this computer and is never written to chats or files.</small>
    </>
  );
}


const AGENT_BLANK = { name: '', role: '', description: '', model: '', tools: ['read'], body: '', isNew: true };

export function AgentsTab({ s, set, chatGroups, showToggles = true }) {
  const api = window.api;
  const [list, setList] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ed, setEd] = useState(null);
  const [err, setErr] = useState('');
  const load = async () => { try { setList(await api.agentsList()); } catch {} };
  useEffect(() => { load(); api.agentsGroups().then(setGroups).catch(() => {}); const off = api.onAgentsChanged && api.onAgentsChanged(load); return () => off && off(); }, []);
  const modelLabel = (id) => { if (!id) return 'Same as chat'; for (const g of chatGroups) for (const [mid, n] of g.items) if (mid === id) return n; return id; };
  const save = async () => {
    setErr('');
    const r = await api.agentsSave({ name: ed.name, role: ed.role, description: ed.description, model: ed.model, tools: ed.tools, body: ed.body });
    if (!r.ok) return setErr(r.error);
    setEd(null); load();
  };
  const remove = async (a) => {
    const reset = !!a.overrides;
    if (!(await askConfirm({ title: reset ? 'Reset agent' : 'Delete agent', message: reset ? `Reset "${a.name}" to its default?` : `Delete the agent "${a.name}"?`, confirmLabel: reset ? 'Reset' : 'Delete', danger: true }))) return;
    await api.agentsDelete(a.name); load();
  };
  if (ed) {
    const toggle = (g) => setEd({ ...ed, tools: ed.tools.includes(g) ? ed.tools.filter((x) => x !== g) : [...ed.tools, g] });
    return (
      <>
        <label className="field"><span>Name</span><input value={ed.name} disabled={!ed.isNew} onChange={(e) => setEd({ ...ed, name: e.target.value })} placeholder="Athena" /></label>
        <label className="field"><span>Role</span><input value={ed.role || ''} onChange={(e) => setEd({ ...ed, role: e.target.value })} placeholder="Researcher" /><small>Optional title. You can ask for the agent by name or by role.</small></label>
        <label className="field"><span>What is it for?</span><input value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} placeholder="Finds and checks facts on the web" /><small>One line. Artemis reads this to decide when to hand work to this agent.</small></label>
        <div className="field"><span>Model</span>
          <ModelPicker value={ed.model} groups={chatGroups} onChange={(m) => setEd({ ...ed, model: m })} emptyLabel="Same as chat" up={false} align="left" className="wide" />
          <small>Put cheap jobs (search, summaries) on a cheap model and hard jobs on a strong one. This is what cuts the cost.</small>
        </div>
        <div><div className="muted small" style={{ margin: '12px 0 4px' }}>Tools</div>
          {groups.map((g) => <label key={g.id} className="check"><input type="checkbox" checked={ed.tools.includes(g.id)} onChange={() => toggle(g.id)} /> <span>{g.label}</span></label>)}
        </div>
        <label className="field"><span>Instructions</span><textarea rows={9} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} /></label>
        {err && <small className="hint err">{err}</small>}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={() => setEd(null)}>Cancel</button><button className="primary" onClick={save}>Save agent</button></div>
      </>
    );
  }
  return (
    <>
      {showToggles && (<>
      <label className="check"><input type="checkbox" checked={s.delegateEnabled !== false} onChange={set('delegateEnabled')} /> <span>Let Artemis use agents<br /><small>Artemis plans the work, hands parts to the agents below (up to 4 at once, one level deep) and merges the results. Add "use the Reviewer" to a request to have the output checked.</small></span></label>
      <label className="check"><input type="checkbox" checked={s.agentWriteApproval !== false} onChange={set('agentWriteApproval')} /> <span>Ask before agents write files<br /><small>On: every write by an agent asks you in the chat ("Coder agent wants to..."). Off: agents write without asking when edits are auto-allowed. Deleting is never available to agents.</small></span></label>
      </>)}
      <div className="agent-rows">
        {list.map((a) => (
          <div key={a.slug + a.source} className="agent-row">
            <div className="agent-row-main">
              <b>{a.name}</b>{a.role ? <span className="muted"> · {a.role}</span> : null} <small className="muted">{a.builtin ? 'built-in' : a.overrides ? 'edited' : a.source}</small>
              <div className="muted">{a.description}</div>
              <div className="agent-chips"><span>{modelLabel(a.model)}</span>{a.tools.map((t) => <span key={t}>{t}</span>)}</div>
            </div>
            <button onClick={() => setEd({ ...a })}>Edit</button>
            {!a.builtin && <button onClick={() => remove(a)}>{a.overrides ? 'Reset' : 'Delete'}</button>}
          </div>
        ))}
      </div>
      <div className="actions-row"><button onClick={() => setEd({ ...AGENT_BLANK })}>+ New agent</button><button onClick={() => api.agentsReveal()}>Open agents folder</button></div>
      <small className="hint">Agents are plain .md files (name, description, model, tools, then instructions), like skills. Per-project agents go in &lt;project&gt;/.ares/agents/.</small>
    </>
  );
}

function BrainsTab({ s, setS, chatGroups }) {
  const api = window.api;
  const [list, setList] = useState([]);
  const [ed, setEd] = useState(null);
  const [err, setErr] = useState('');
  const load = async () => { try { setList(await api.brainsList()); } catch {} };
  useEffect(() => { load(); const off = api.onBrainsChanged && api.onBrainsChanged(load); return () => off && off(); }, []);
  const modelLabel = (id) => { if (!id) return 'Same as chat'; for (const g of chatGroups) for (const [mid, n] of g.items) if (mid === id) return n; return id; };
  const save = async () => { setErr(''); const r = await api.brainsSave({ name: ed.name, role: ed.role, description: ed.description, model: ed.model, body: ed.body }); if (!r.ok) return setErr(r.error); setEd(null); load(); };
  const reset = async (b) => { if (!(await askConfirm({ title: 'Reset brain', message: `Reset "${b.name}" to its default personality and model?`, confirmLabel: 'Reset', danger: true }))) return; await api.brainsDelete(b.name); load(); };
  if (ed) {
    return (
      <>
        <label className="field"><span>Name</span><input value={ed.name} disabled /></label>
        <label className="field"><span>Role</span><input value={ed.role || ''} onChange={(e) => setEd({ ...ed, role: e.target.value })} /></label>
        <label className="field"><span>What is it good at?</span><input value={ed.description} onChange={(e) => setEd({ ...ed, description: e.target.value })} /><small>The council reads this line when it decides who should answer.</small></label>
        <div className="field"><span>Model</span>
          <ModelPicker value={ed.model} groups={chatGroups} onChange={(m) => setEd({ ...ed, model: m })} emptyLabel="Same as chat" up={false} align="left" className="wide" />
          <small>This brain answers with this model, whatever model the chat uses.</small>
        </div>
        <label className="field"><span>Personality</span><textarea rows={8} value={ed.body} onChange={(e) => setEd({ ...ed, body: e.target.value })} spellCheck={false} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5 }} /></label>
        {err && <small className="hint err">{err}</small>}
        <div className="actions-row"><span style={{ flex: 1 }} /><button onClick={() => setEd(null)}>Cancel</button><button className="primary" onClick={save}>Save brain</button></div>
      </>
    );
  }
  return (
    <>
      <p className="muted small">Three brains with their own personality and model. In a chat, pick one from the brain menu next to the model, or pick Council: the three vote on who answers and which skills and agents to use (a vote costs a few thousand tokens). The council's choice sticks for the chat until you press Re-vote.</p>
      <Field label="Default brain for new chats" hint="Council is never the default unless you choose it here. Telegram and scheduled tasks use this brain too (Council only works in the app).">
        <Select value={s.defaultBrain || ''} onChange={(e) => setS((x) => ({ ...x, defaultBrain: e.target.value }))}>
          <option value="">No brain (plain Artemis)</option>
          <option value="council">Council (vote)</option>
          {list.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </Select>
      </Field>
      <div className="agent-rows">
        {list.map((b) => (
          <div key={b.slug} className="agent-row">
            <div className="agent-row-main">
              <b>{b.name}</b>{b.role ? <span className="muted"> · {b.role}</span> : null} <small className="muted">{b.overrides ? 'edited' : 'built-in'}</small>
              <div className="muted">{b.description}</div>
              <div className="agent-chips"><span>{modelLabel(b.model)}</span></div>
            </div>
            <button onClick={() => setEd({ ...b })}>Edit</button>
            {b.overrides && <button onClick={() => reset(b)}>Reset</button>}
          </div>
        ))}
      </div>
    </>
  );
}

export function SettingsModal({ settings, groups = [], projects = [], providers = [], onProviders = () => {}, onApply = () => {}, onSave, onClose, onNewTab, initialTab = 'general' }) {
  const [tab, setTab] = useState(initialTab);
  const [s, setS] = useState({ ...settings });
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const chatGroups = groups;
  // Themes come from main: built-in JSON plus <userData>/themes and <project>/.ares/themes, refreshed here.
  const projectFolder = (projects.find((p) => p.id === (settings.activeProjectId || (settings.projectId || ''))) || {}).folder || (projects[0] || {}).folder || '';
  const [themeInfo, setThemeInfo] = useState({ themes: [], folder: '' });
  const [themeMsg, setThemeMsg] = useState('');
  const [themeBusy, setThemeBusy] = useState(false);
  const refreshThemes = async () => {
    try {
      const r = await api.themesList(projectFolder);
      if (r) setThemeInfo({ themes: r.themes || [], folder: (r.folders && r.folders.project) || (r.folders && r.folders.user) || '' });
    } catch {}
  };
  const importThemes = async () => {
    setThemeBusy(true);
    try {
      const r = await api.themesImport(projectFolder);
      if (r) setThemeMsg(r.added ? `Imported: ${r.added.join(', ')}` : '');
      await refreshThemes(); onApply({});
    } catch (e) { setThemeMsg(String((e && e.message) || e)); }
    setThemeBusy(false);
  };
  useEffect(() => { refreshThemes(); }, []);
  useEffect(() => api.onThemeChanged ? api.onThemeChanged(() => refreshThemes()) : undefined, []);
  const themeList = [SYSTEM_THEME, ...themeInfo.themes];
  const mediaGroups = providers.filter((p) => p.enabled !== false && (p.models || []).length).map((p) => <optgroup key={p.id} label={p.name}>{p.models.map((m) => <option key={m.id} value={`prov:${p.id}:${m.id}`}>{m.name || m.id}</option>)}</optgroup>);
  const known = !s.model || chatGroups.some((g) => g.items.some(([id]) => id === s.model));
  const save = () => onSave({
    ...s,
    telegramToken: s.telegramToken ? s.telegramToken.trim() : undefined,
    maxTokens: Math.max(256, parseInt(s.maxTokens, 10) || 8192),
    dailyTokenLimit: Math.max(0, parseInt(s.dailyTokenLimit, 10) || 0),
    monthlyTokenLimit: Math.max(0, parseInt(s.monthlyTokenLimit, 10) || 0),
    dailyUsdLimit: Math.max(0, parseFloat(s.dailyUsdLimit) || 0),
    monthlyUsdLimit: Math.max(0, parseFloat(s.monthlyUsdLimit) || 0)
  });
  return (
    <Modal onClose={onClose} cls="settings" bare>
      <div className="settings-nav">
        <h2>Settings</h2>
        {TABS.map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
        {onNewTab && <button className="nav-newtab" title="Move Settings into its own tab" onClick={() => onNewTab(tab)}>Open in new tab ↗</button>}
      </div>
      <div className="settings-main">
        <div className="settings-body">
          <h3>{TABS.find(([id]) => id === tab)[1]}</h3>
          {tab === 'general' && (
            <>
              <div className="field"><span>Theme</span>
                <div className="theme-grid">
                  {themeList.map((t) => (
                    <button key={t.id} type="button" className={`theme-sw ${s.theme === t.id ? 'on' : ''}`} onClick={() => { setS({ ...s, theme: t.id }); onApply({ theme: t.id }); }} title={t.source === 'builtin' ? t.name : `${t.name} (${t.source})`}>
                      <i style={{ background: t.id === 'system' ? `linear-gradient(135deg, ${t.preview[0]} 50%, ${t.preview[2]} 50%)` : t.preview[0] }}><b style={{ background: t.preview[1] }} /><b style={{ background: t.preview[2] }} /></i>
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
                <div className="row" style={{ alignItems: 'center', marginTop: 8 }}>
                  <button type="button" onClick={refreshThemes} disabled={themeBusy}>{themeBusy ? 'Refreshing…' : 'Refresh'}</button>
                  <button type="button" onClick={() => api.themesOpen('project').then(refreshThemes).catch(() => {})}>Open folder</button>
                  <button type="button" onClick={importThemes} disabled={themeBusy}>Import .json</button>
                  <span className="hint">{themeMsg || `${themeList.length} themes · ${themeInfo.folder || ''}`}</span>
                </div>
                <div className="hint">Drop a theme .json in that folder and press Refresh — no rebuild. A file is <code>{'{ "id": "ares", "name": "Ares", "group": "Gods", "dark": true, "preview": ["#130808","#c9923a","#8c1c1c"], "vars": { "--theme-bg": "#130808", "…": "…" } }'}</code>. The project’s .ares/themes wins over the user folder.</div>
              </div>
              <Field label="Text size" hint="Size of the text across the whole app.">
                <Select value={s.textSize || 'medium'} onChange={(e) => { setS({ ...s, textSize: e.target.value }); onApply({ textSize: e.target.value }); }}>{TEXT_SIZES.map(([id, n, px]) => <option key={id} value={id}>{n} ({px}px)</option>)}</Select>
              </Field>
              <Field label="Default model" hint="Used for new chats. Add more models in Providers.">
                <Select value={s.model} onChange={set('model')}>
                  {!s.model && <option value="">First model of the first provider</option>}
                  {!known && <option value={s.model}>{s.model}</option>}
                  {chatGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
                </Select>
              </Field>
              <Field label="Reasoning level" hint="How hard the model thinks before it answers: low is faster and cheaper, high thinks harder. Auto leaves it to the model. Used for new chats; change it per chat at the top. Models that do not support it ignore it.">
                <Select value={s.reasoningEffort || 'auto'} onChange={(e) => setS({ ...s, reasoningEffort: e.target.value === 'auto' ? '' : e.target.value })}>
                  <option value="auto">Auto</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              </Field>
              <div className="row">
                <Field label="Image model" hint="Needs a provider whose endpoint supports /images/generations. Off = no image generation.">
                  <Select value={s.imageModel || ''} onChange={set('imageModel')}><option value="">Off</option>{mediaGroups}</Select>
                </Field>
                <Field label="Video model" hint="Needs a provider whose endpoint supports /videos/generations. Off = no video generation.">
                  <Select value={s.videoModel || ''} onChange={set('videoModel')}><option value="">Off</option>{mediaGroups}</Select>
                </Field>
              </div>
              <Field label="Personality" hint={(PERSONALITIES.find((p) => p.id === (s.personality || '')) || {}).hint || ''}>
                <Select value={s.personality || ''} onChange={set('personality')}>
                  {PERSONALITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Personality notes (optional)" hint="Your own words, e.g. “Talk like a sarcastic best friend”. Added to the preset above."><textarea rows={2} value={s.personalityCustom || ''} onChange={set('personalityCustom')} placeholder="How should Artemis talk to you?" /></Field>
              <Field label="Custom instructions (system prompt)"><textarea rows={4} value={s.systemPrompt} onChange={set('systemPrompt')} placeholder="e.g. Keep answers short and direct." /></Field>
              <Field label="Quick chat shortcut" hint={settings.shortcutError || 'Opens the floating chat from anywhere. Example: CommandOrControl+Shift+Space'}>
                <input value={s.quickChatShortcut || ''} onChange={set('quickChatShortcut')} placeholder="CommandOrControl+Shift+Space" />
              </Field>
              <Field label="Command palette shortcut" hint="Opens Artemis and its command palette from any app, even when it is minimized. Leave empty to turn off. Example: CommandOrControl+K">
                <input value={s.paletteShortcut || ''} onChange={set('paletteShortcut')} placeholder="CommandOrControl+K" />
              </Field>
              <label className="check"><input type="checkbox" checked={s.closeToTray !== false} onChange={set('closeToTray')} /> <span>Closing the window keeps Artemis running in the background<br /><small>Needed for the phone bot and scheduled tasks. Artemis stays in the Dock; quit it from the Artemis menu (Cmd+Q) or the menu bar icon.</small></span></label>
              <label className="check"><input type="checkbox" checked={!!s.launchAtLogin} onChange={set('launchAtLogin')} /> Start Artemis when I log in</label>
              <ImportRow />
            </>
          )}
          {tab === 'providers' && <ProvidersTab s={s} set={set} settings={settings} providers={providers} onProviders={onProviders} onApply={onApply} />}
          {tab === 'tools' && (
            <>
              <label className="check"><input type="checkbox" checked={s.toolsEnabled} onChange={set('toolsEnabled')} /> Tools on by default in new chats (files, memory, notes, web, terminal)<br /><small className="muted">You can switch tools on or off per chat with the “Tools” pill next to the model picker. Off sends much smaller requests, which small local models and free tiers need.</small></label>
              <label className="check"><input type="checkbox" checked={s.autoApproveEdits} onChange={set('autoApproveEdits')} /> <span>Auto-allow all in new chats<br /><small>Off by default: every action asks. On: file edits, agent file writes, web, terminal, computer control, Make and connectors run without asking. Deleting files always asks. Each chat can switch to "Ask every time" next to the message box. Messages from your phone follow this too, but only file edits are auto-allowed there.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.memoryEnabled} onChange={set('memoryEnabled')} /> Memory enabled</label>
              <label className="check"><input type="checkbox" checked={s.webEnabled} onChange={set('webEnabled')} /> Web search and page fetch</label>
              <label className="check"><input type="checkbox" checked={s.notesAi !== false} onChange={set('notesAi')} /> <span>Notes knowledge base<br /><small>Artemis can search and read your notes after you approve.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.shellEnabled} onChange={set('shellEnabled')} /> <span>Terminal commands<br /><small>Asks once per task.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.computerEnabled} onChange={set('computerEnabled')} /> <span>Computer control (macOS)<br /><small>Screen, mouse and keyboard. Asks once per task. Emergency stop: Cmd+Shift+Esc.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.connectorsEnabled !== false} onChange={set('connectorsEnabled')} /> Connectors (MCP servers)</label>
              <label className="check"><input type="checkbox" checked={s.fullFileAccess !== false} onChange={set('fullFileAccess')} /> <span>Full file access<br /><small>The assistant can reach files anywhere on this computer, not only in the project folder. It asks first: once per outside folder for reading, every time for keys and credentials, and for every change</small></span></label>
              <label className="check"><input type="checkbox" checked={s.toolsLazy !== false} onChange={set('toolsLazy')} /> <span>Switch heavy tools on only when needed<br /><small>Saves tokens: computer control, terminal, media, phone, scheduling, helper agents and Make are sent only after the assistant asks for them. Files, web, memory and notes are always on.</small></span></label>
              <label className="check"><input type="checkbox" checked={s.connectorsLazy !== false} onChange={set('connectorsLazy')} /> <span>Switch connectors on only when needed<br /><small>Saves tokens: connector tools are sent only after the assistant asks for that app.</small></span></label>
              <fieldset className="group">
                <legend>Skills &amp; learning</legend>
                <label className="check"><input type="checkbox" checked={s.skillsEnabled !== false} onChange={set('skillsEnabled')} /> <span>Skills<br /><small>Artemis can load your saved instructions for tasks you repeat.</small></span></label>
                <label className="check"><input type="checkbox" checked={s.autoLearn !== false} onChange={set('autoLearn')} /> <span>Let Artemis learn by itself<br /><small>It saves a skill after a task you are likely to repeat and improves skills when you correct it. Off = it asks before saving. Not used in incognito chats or scheduled tasks.</small></span></label>
                {s.autoLearn !== false && (
                  <Field label="Learning model" hint="After a task with several steps this model decides whether it is worth saving as a skill. You always see the skill first and choose Allow or Deny. A small, cheap model is enough.">
                    <Select value={s.reflectModel || ''} onChange={set('reflectModel')}>
                      <option value="">Automatic (a small, cheap model)</option>
                      {chatGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
                    </Select>
                  </Field>
                )}
                <label className="check"><input type="checkbox" checked={s.chatSearchEnabled !== false} onChange={set('chatSearchEnabled')} /> <span>Search my earlier chats<br /><small>Lets Artemis look things up in your saved chats when you refer to them. Incognito chats are never searched.</small></span></label>
              </fieldset>
            </>
          )}
          {tab === 'access' && <AccessTab s={s} set={set} projects={projects} />}
          {tab === 'brains' && <BrainsTab s={s} setS={setS} chatGroups={chatGroups} />}
          {tab === 'agents' && <AgentsTab s={s} set={set} chatGroups={chatGroups} />}
          {tab === 'limits' && <LimitsTab s={s} setS={setS} />}
          {tab === 'voice' && <VoiceTab s={s} setS={setS} providers={providers} chatGroups={chatGroups} />}
          {tab === 'make' && <MakeTab s={s} setS={setS} />}
          {tab === 'phone' && <PhoneSettings s={s} set={set} setS={setS} />}
        </div>
        <div className="actions-row settings-foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
