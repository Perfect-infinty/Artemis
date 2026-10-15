// Turns the Markdown the assistant writes into Telegram's HTML subset (b, i, s, code, pre, a, blockquote),
// because Telegram shows raw Markdown as plain text ("**bold**", "## heading", ```code``` ...).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

function tableToText(lines) {
  const rows = lines.map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  const body = rows.filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
  const w = []; body.forEach((r) => r.forEach((c, i) => { w[i] = Math.max(w[i] || 0, [...c].length); }));
  return body.map((r) => r.map((c, i) => c + ' '.repeat(Math.max(0, w[i] - [...c].length))).join('  ').trimEnd()).join('\n');
}

function mdToTelegramHtml(md) {
  let text = String(md || '').replace(/\r\n/g, '\n');
  const hold = [];
  const keep = (html) => { hold.push(html); return `\u0000${hold.length - 1}\u0000`; };
  // fenced code blocks
  text = text.replace(/```([\w+#.-]*)[ \t]*\n?([\s\S]*?)```/g, (_, lang, code) => keep(`<pre>${lang ? `<code class="language-${escAttr(lang)}">` : ''}${esc(code.replace(/\n$/, ''))}${lang ? '</code>' : ''}</pre>`));
  // tables
  text = text.replace(/(^\|.*\|[ \t]*\n)((?:\|[ \t:-]+)+\|?[ \t]*\n)((?:\|.*\n?)*)/gm, (m, h, sep, rest) => keep(`<pre>${esc(tableToText([h, ...rest.split('\n').filter(Boolean)]))}</pre>`) + '\n');
  // inline code
  text = text.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  // quotes: group consecutive "> " lines
  text = text.replace(/(^>[ \t]?.*(?:\n>[ \t]?.*)*)/gm, (m) => keep(`<blockquote>${esc(m.split('\n').map((l) => l.replace(/^>[ \t]?/, '')).join('\n'))}</blockquote>`));
  text = esc(text);
  text = text
    .replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, '<b>$1</b>')
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, '──────────')
    .replace(/^([ \t]*)[-*+][ \t]+/gm, '$1• ')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t, u) => `<a href="${escAttr(u.replace(/&amp;/g, '&'))}">${t}</a>`)
    .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<b>$1</b>')
    .replace(/__(?=\S)([\s\S]+?)(?<=\S)__/g, '<b>$1</b>')
    .replace(/~~(?=\S)([\s\S]+?)(?<=\S)~~/g, '<s>$1</s>')
    .replace(/(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=[^\s*])\*(?![\w*])/g, '<i>$1</i>')
    .replace(/(?<![\w_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w_])/g, '<i>$1</i>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[+i]).trim();
}

/** Splits Markdown into pieces below `max` characters at line breaks, closing and reopening code fences across pieces. */
function splitMarkdown(md, max = 3400) {
  const out = []; let cur = ''; let fence = null;
  const push = () => { if (cur.trim()) out.push(fence ? cur + '\n```' : cur); cur = fence ? '```' + fence : ''; };
  for (let line of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    while (line.length > max) { // one huge line
      if ((cur + '\n' + line).length > max) push();
      cur += (cur ? '\n' : '') + line.slice(0, max - 20); line = line.slice(max - 20); push();
    }
    if (cur && (cur + '\n' + line).length > max) push();
    cur += (cur ? '\n' : '') + line;
    const m = /^```([\w+#.-]*)\s*$/.exec(line.trim());
    if (m) fence = fence === null ? m[1] : null;
  }
  if (cur.trim() && cur !== '```' + (fence || '')) out.push(cur);
  return out.length ? out : ['(empty)'];
}

module.exports = { mdToTelegramHtml, splitMarkdown };
