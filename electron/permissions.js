// macOS permissions Artemis may need. Each can be checked and requested from the app.
const { execFile } = require('child_process');

const PANES = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  notifications: 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
};

const INFO = [
  { id: 'microphone', title: 'Microphone', why: 'Lets you talk to Artemis: dictation, Sentinel (“Wake up”) and voice replies.' },
  { id: 'screen', title: 'Screen Recording', why: 'Lets Artemis see your screen when you ask it to use the computer.' },
  { id: 'accessibility', title: 'Accessibility', why: 'Lets Artemis click, type and read buttons in other apps.' },
  { id: 'automation', title: 'Automation (System Events)', why: 'Lets Artemis press keys and list on-screen controls.' },
  { id: 'notifications', title: 'Notifications', why: 'Lets scheduled tasks tell you when they finish.' }
];

function createPermissions({ systemPreferences, desktopCapturer, Notification, shell, platform = process.platform, run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { timeout: 15000 }, (e, so, se) => (e ? rej(Object.assign(e, { stderr: se })) : res(so)))) }) {
  const mac = platform === 'darwin';

  async function automationStatus(prompt) {
    try { await run('osascript', ['-e', 'tell application "System Events" to get name of first process']); return 'granted'; }
    catch (e) { return /-1743|not authorized|not allowed/i.test(String(e.stderr || e.message)) ? 'denied' : prompt ? 'denied' : 'not-determined'; }
  }

  async function status() {
    if (!mac) return { supported: false, items: [] };
    const microphone = systemPreferences.getMediaAccessStatus('microphone');
    const screen = systemPreferences.getMediaAccessStatus('screen');
    const accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied';
    // Automation can only be probed by trying; keep the probe silent (it may show the macOS prompt once)
    const automation = await automationStatus(false);
    return { supported: true, items: INFO.map((i) => ({ ...i, status: { microphone, screen, accessibility, automation, notifications: Notification.isSupported() ? 'unknown' : 'denied' }[i.id] })) };
  }

  async function request(kind) {
    if (!mac) return;
    if (kind === 'microphone') {
      let ok = systemPreferences.getMediaAccessStatus('microphone') === 'granted';
      if (!ok && systemPreferences.getMediaAccessStatus('microphone') === 'not-determined' && systemPreferences.askForMediaAccess) { try { ok = !!(await systemPreferences.askForMediaAccess('microphone')); } catch {} }
      if (!ok) await shell.openExternal(PANES.microphone);
    } else if (kind === 'screen') {
      try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch {}
      if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') await shell.openExternal(PANES.screen);
    } else if (kind === 'accessibility') {
      if (!systemPreferences.isTrustedAccessibilityClient(true)) await shell.openExternal(PANES.accessibility);
    } else if (kind === 'automation') {
      if ((await automationStatus(true)) !== 'granted') await shell.openExternal(PANES.automation);
    } else if (kind === 'notifications') {
      try { new Notification({ title: 'Artemis', body: 'Notifications are working.' }).show(); } catch {}
      await shell.openExternal(PANES.notifications);
    }
  }
  return { status, request, INFO, PANES };
}

module.exports = { createPermissions, INFO, PANES };
