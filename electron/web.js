// Web search and page fetching. Results are untrusted content.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_BODY = 3 * 1024 * 1024;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function htmlToText(html) {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  let s = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|head|template)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const text = inner.replace(/<[^>]+>/g, '').trim();
      return text ? `${text} (${href})` : '';
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|h[1-6]|tr|ul|ol|table|blockquote|pre)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s).replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: s };
}

function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1' || h === '0.0.0.0') return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return /^(fc|fd|fe80)/.test(h);
}

function withTimeout(signal, ms) {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

async function webFetch(url, { signal, maxChars = 40000, allowPrivate = false } = {}) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Invalid URL: ${url}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http(s) URLs are allowed.');
  if (!allowPrivate && isPrivateHost(u.hostname)) throw new Error('Local and private network addresses are blocked.');

  const res = await fetch(u, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5' },
    redirect: 'follow', signal: withTimeout(signal, 20000)
  });
  const finalHost = new URL(res.url).hostname;
  if (!allowPrivate && isPrivateHost(finalHost)) throw new Error('Redirected to a private network address; blocked.');
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!/(text\/|json|xml|javascript)/.test(type)) throw new Error(`Unsupported content type: ${type || 'unknown'}`);

  const reader = res.body.getReader();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length; chunks.push(value);
    if (size > MAX_BODY) { await reader.cancel(); break; }
  }
  const body = Buffer.concat(chunks).toString('utf8');
  let out;
  if (type.includes('html')) {
    const { title, text } = htmlToText(body);
    out = (title ? `Title: ${title}\n\n` : '') + text;
  } else out = body;
  const clipped = out.length > maxChars ? out.slice(0, maxChars) + `\n…[truncated, ${out.length} characters total]` : out;
  return `URL: ${res.url}\n\n${clipped}`;
}

function parseDdg(html) {
  const results = [];
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snipRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets = [];
  let m;
  while ((m = snipRe.exec(html))) snippets.push(decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim());
  let i = 0;
  while ((m = linkRe.exec(html))) {
    let href = decodeEntities(m[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    try {
      const u = new URL(href);
      if (u.hostname.endsWith('duckduckgo.com') && u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
    } catch {}
    if (!/^https?:/.test(href)) { i++; continue; }
    results.push({ title: decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim(), url: href, snippet: snippets[i] || '' });
    i++;
  }
  return results;
}

/** Bing wraps result links as bing.com/ck/a?...&u=a1<base64url of the real URL>; give back the real URL. */
function bingTarget(href) {
  try {
    const u = new URL(href);
    if (/(^|\.)bing\.com$/.test(u.hostname) && u.pathname.startsWith('/ck/')) {
      const v = u.searchParams.get('u') || '';
      if (/^a1/.test(v)) { const d = Buffer.from(v.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); if (/^https?:\/\//.test(d)) return d; }
    }
  } catch {}
  return href;
}
function parseBing(html) {
  const results = [];
  const blocks = String(html).split(/<li[^>]+class="[^"]*\bb_algo\b[^"]*"[^>]*>/i).slice(1);
  for (const b of blocks) {
    const m = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(b);
    if (!m) continue;
    const url = bingTarget(decodeEntities(m[1]));
    if (!/^https?:/.test(url)) continue;
    const sn = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(b);
    results.push({ title: decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim(), url, snippet: sn ? decodeEntities(sn[1].replace(/<[^>]+>/g, '')).trim() : '' });
  }
  return results;
}

async function webSearch(query, { signal, max = 8, fallback, ddgUrl = 'https://html.duckduckgo.com/html/', bingUrl = 'https://www.bing.com/search' } = {}) {
  let results = [], failure = null;
  try {
    const res = await fetch(ddgUrl, {
      method: 'POST',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: query }).toString(),
      signal: withTimeout(signal, 15000)
    });
    const html = await res.text();
    if (!res.ok) failure = `HTTP ${res.status}`;
    else if (/anomaly|bots use duckduckgo/i.test(html) && !/result__a/.test(html)) failure = 'DuckDuckGo blocked the request';
    else results = parseDdg(html);
  } catch (e) {
    if (e.name === 'AbortError' && signal?.aborted) throw e;
    failure = e.message;
  }
  if (!results.length) { // DuckDuckGo refuses scripts now and then: Bing's plain result page is the second try
    try {
      const res = await fetch(bingUrl + '?setlang=en&q=' + encodeURIComponent(query), { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }, signal: withTimeout(signal, 15000) });
      if (res.ok) results = parseBing(await res.text());
    } catch (e) { if (e.name === 'AbortError' && signal?.aborted) throw e; }
  }
  if (results.length) {
    return results.slice(0, max).map((r, n) => `${n + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
  }
  if (fallback) {
    const text = await fallback(query, signal);
    if (text) return `(fallback search)\n${text}`;
  }
  return failure ? `No results (${failure}).` : 'No results.';
}

/** Search-grounded answer through the configured OpenAI-compatible endpoint (e.g. perplexity/sonar). */
async function endpointSearch({ baseUrl, key, query, signal, model = 'perplexity/sonar' }) {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: query }] }),
    signal: withTimeout(signal, 30000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content || '';
  const cites = Array.isArray(j.citations) ? '\n\nSources:\n' + j.citations.map((c, i) => `${i + 1}. ${typeof c === 'string' ? c : c.url}`).join('\n') : '';
  return text + cites;
}

module.exports = { webFetch, webSearch, endpointSearch, htmlToText, parseDdg, parseBing, isPrivateHost };
