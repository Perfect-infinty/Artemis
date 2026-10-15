// Promise-based replacement for window.confirm: the <DialogHost /> in main.jsx renders it.
let handler = null;
export const setDialogHandler = (h) => { handler = h; };

/** askConfirm({ title, message, confirmLabel, cancelLabel, danger }) -> Promise<boolean> */
export function askConfirm(opts) {
  const o = typeof opts === 'string' ? { message: opts } : opts || {};
  if (!handler) return Promise.resolve(window.confirm(o.message || o.title || ''));
  return new Promise((resolve) => handler({ ...o, resolve }));
}
