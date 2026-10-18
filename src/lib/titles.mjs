// When a chat gets an automatic title (pure; tested by scripts/test-titles.js).
// The first title comes after the first reply; the topic can drift, so it is redone once at 8 messages and then every 20.

export const FIRST_RETITLE = 8;
export const RETITLE_EVERY = 20;

/** True when the chat's name is its own (renamed by the user, imported, a phone or scheduled task, incognito). */
export const keepsTitle = (c) => !c || !!c.titleManual || !!c.incognito || !!c.imported || c.source === 'phone' || c.source === 'schedule';

/** Should the chat be (re)titled now that it has c.messages.length messages? titleAt = message count at the last automatic title. */
export function needsTitle(c) {
  if (keepsTitle(c)) return false;
  const n = (c.messages || []).length;
  const at = Number(c.titleAt) || 0;
  if (n < 2) return false;
  if (!at) return true;
  if (at < FIRST_RETITLE) return n >= FIRST_RETITLE;
  return n - at >= RETITLE_EVERY;
}
