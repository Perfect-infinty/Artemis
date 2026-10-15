// Sends messages to the app log (shown on the Logs page and written to ~/.artemis/logs).
const api = window.api;
export const log = (level, source, message, data) => { try { api.logAdd && api.logAdd({ level, source, message: String(message), data }); } catch {} };
export const progress = (id, label, o = {}) => { try { api.logProgress && api.logProgress({ id, label, ...o }); } catch {} };

let installed = false;
/** Report uncaught errors in the window. */
export function installErrorLog() {
  if (installed) return; installed = true;
  window.addEventListener('error', (e) => log('error', 'window', e.message || 'Error', { file: e.filename, line: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => log('error', 'window', 'Unhandled: ' + ((e.reason && e.reason.message) || e.reason)));
}
