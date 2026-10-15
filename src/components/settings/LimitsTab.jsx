import React, { useEffect, useState } from 'react';
import { Field } from '../Modals.jsx';
import { costOf, fmtUsd } from '../../lib/cost.js';
import { parseTokens, fmtTokens, parseUsd, fmtUsdInput } from '../../lib/amount.mjs';

export const startOf = (month) => { const d = new Date(); d.setHours(0, 0, 0, 0); if (month) d.setDate(1); return d.getTime(); };

export function LimitRow({ title, kind, value, used, onChange, presets }) {
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

export function LimitsTab({ s, setS }) {
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
