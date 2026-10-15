// IPC: voice
module.exports = function registerVoiceIpc(deps) {
  const { ipcMain, getSettings, logger, providersLib, systemPreferences, transcribeAudio } = deps;
  ipcMain.handle('voice:permission', async () => {
    if (process.platform !== 'darwin') return 'granted';
    try {
      const st = systemPreferences.getMediaAccessStatus('microphone');
      if (st === 'not-determined') return (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied';
      return st;
    } catch { return 'granted'; }
  });
  ipcMain.handle('voice:transcribe', (_e, a) => transcribeAudio(a || {}));
  ipcMain.handle('voice:speak', async (_e, { text, speed, lang } = {}) => {
    try {
      const st = getSettings();
      const engine = st.ttsEngine === 'piper' ? 'piper' : 'openai';
      const base = String(st.ttsUrl || (engine === 'piper' ? 'http://localhost:5000' : 'http://localhost:8880')).trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(base)) return { ok: false, error: 'The voice server address must start with http:// or https://' };
      const input = String(text || '').slice(0, 1500);
      if (!input.trim()) return { ok: false, error: 'Nothing to read.' };
      const rate = Math.min(1.6, Math.max(0.6, Number(speed) || 1));
      const t0 = Date.now();
      let res;
      if (engine === 'piper') {
        const body = { text: input, length_scale: Number((1 / rate).toFixed(2)) };
        const pv = st.ttsVoiceEn || st.ttsVoice;
        if (pv) body.voice = pv;
        res = await fetch(base + '/synthesize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      } else {
        res = await fetch(providersLib.joinUrl(base, 'audio/speech'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: st.ttsModel || 'kokoro', input, voice: st.ttsVoice || 'af_heart', response_format: 'wav', speed: rate }), signal: AbortSignal.timeout(60000) });
      }
      if (!res.ok) { const t = (await res.text().catch(() => '')).slice(0, 200); logger.error('voice', `Text-to-speech failed HTTP ${res.status}`, { detail: t }); return { ok: false, error: `Voice server answered HTTP ${res.status}: ${t || res.statusText}` }; }
      const buf = Buffer.from(await res.arrayBuffer());
      logger.info('voice', `Text-to-speech ${engine}: ${Math.round(buf.length / 1024)} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return { ok: true, audio: new Uint8Array(buf), mime: res.headers.get('content-type') || 'audio/wav' };
    } catch (e) {
      const m = (e && e.cause && e.cause.code === 'ECONNREFUSED') ? 'The voice server is not running at that address.' : ((e && e.message) || String(e));
      logger.error('voice', 'Text-to-speech failed: ' + m);
      return { ok: false, error: m };
    }
  });
};
