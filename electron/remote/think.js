// The model's thinking (<think>…</think>, or only a closing tag) is for the app, never for the phone.
// Emotion tags for the voice ("[warm] ...") are not shown on the phone either (code is left as it is).
const TAG = /\[(?:warm|soft|excited|sad|serious)\](?![(:])[ \t]*/gi;
const stripTags = (s) => (s.includes('[') ? s.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/).map((p, i) => (i % 2 ? p : p.replace(TAG, ''))).join('') : s);
function stripThink(text) {
  let s = stripTags(String(text == null ? '' : text));
  if (!/<\/?think(?:ing)?>/i.test(s)) return s;
  const close = /<\/think(?:ing)?>/i.exec(s), open = /<think(?:ing)?>/i.exec(s);
  if (close && (!open || close.index < open.index)) s = s.slice(close.index + close[0].length);
  return s.replace(/<(think|thinking)>[\s\S]*?(?:<\/\1>|$)/gi, '').trim();
}
module.exports = { stripThink };
