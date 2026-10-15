import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { askConfirm } from '../../lib/dialog.js';
import { Field } from '../Modals.jsx';
import { ClaudeUsage, isClaudeProxy } from '../ClaudeUsage.jsx';
import { headersToText, textToHeaders, modelsToText, textToModels } from './shared.jsx';

export function ProviderEditor({ initial, presets, onDone, onProviders }) {
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

export function ProvSwitch({ on, onClick }) {
  return <button type="button" role="switch" aria-checked={on} className={'prov-switch' + (on ? ' on' : '')} onClick={onClick} title={on ? 'Enabled — click to turn off' : 'Disabled — click to turn on'}><span className="knob" /><span className="lbl">{on ? 'Enabled' : 'Disabled'}</span></button>;
}

export function ProvidersTab({ s, set, settings, providers, onProviders, onApply }) {
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
