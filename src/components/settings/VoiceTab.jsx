import React, { useEffect, useState } from 'react';
import Select from '../Select.jsx';
import { dropSentinelModel } from '../../lib/sentinel.js';
import { LANGS, listVoices, rankVoice, speak, stopSpeaking } from '../../lib/voice.js';
import { listDevices, unlockLabels } from '../../lib/audio-devices.js';
import { Field } from '../Modals.jsx';
import { ModelSelect, STT_MODELS, TTS_MODELS } from './shared.jsx';

export function AudioDevices({ s, setS }) {
  const [dev, setDev] = useState({ inputs: [], outputs: [], labeled: true });
  const refresh = async () => setDev(await listDevices());
  useEffect(() => {
    refresh();
    const md = navigator.mediaDevices; if (md && md.addEventListener) md.addEventListener('devicechange', refresh);
    return () => { if (md && md.removeEventListener) md.removeEventListener('devicechange', refresh); };
  }, []);
  const allow = async () => { await unlockLabels(); refresh(); };
  const has = (list, id) => !id || list.some((d) => d.id === id);
  return (
    <>
      <h4 className="sub-h">Audio devices</h4>
      <Field label="Microphone" hint="Used by the mic button and Sentinel. Sentinel picks it up the next time it starts.">
        <Select value={s.micDeviceId || ''} onChange={(e) => { window.__micId = e.target.value; setS((x) => ({ ...x, micDeviceId: e.target.value })); }}>
          <option value="">System default</option>
          {!has(dev.inputs, s.micDeviceId) && <option value={s.micDeviceId}>Not connected (using the default)</option>}
          {dev.inputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
      </Field>
      <Field label="Speakers / headphones" hint="Where Artemis’s voice plays. The built-in computer voice always uses the system output; Piper and OpenAI voices follow this choice.">
        <Select value={s.speakerDeviceId || ''} onChange={(e) => { window.__speakerId = e.target.value; setS((x) => ({ ...x, speakerDeviceId: e.target.value })); }}>
          <option value="">System default</option>
          {!has(dev.outputs, s.speakerDeviceId) && <option value={s.speakerDeviceId}>Not connected (using the default)</option>}
          {dev.outputs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </Select>
      </Field>
      <div className="actions-row">
        <button onClick={refresh}>Refresh devices</button>
        {!dev.labeled && <button onClick={allow}>Show device names</button>}
      </div>
    </>
  );
}
/** One place to see and change what Artemis can reach: macOS permissions and the features it is allowed to use. */

export function VoiceTab({ s, setS, providers, chatGroups = [] }) {
  const sel = s.voiceSttProvider || '';
  const [model, setModel] = useState(null);
  const [voices, setVoices] = useState(() => listVoices());
  useEffect(() => { window.api.sentinelStatus().then(setModel).catch(() => {}); const f = () => setVoices(listVoices()); try { speechSynthesis.addEventListener('voiceschanged', f); } catch {} return () => { try { speechSynthesis.removeEventListener('voiceschanged', f); } catch {} }; }, []);
  return (
    <>
      <p className="muted small">Press the mic button next to the message box, speak, press it again and your words are typed for you. Works in English.</p>
      <Field label="Speech-to-text provider" hint="Needs an endpoint that supports /audio/transcriptions (Whisper). OpenAI and Groq do. Add one under Providers first, then pick it here.">
        <Select value={sel} onChange={(e) => setS((x) => ({ ...x, voiceSttProvider: e.target.value }))}>
          <option value="">None</option>
          {providers.filter((p) => p.enabled !== false).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Field label="Speech-to-text model" hint="OpenAI: whisper-1 or gpt-4o-mini-transcribe. Groq: whisper-large-v3-turbo.">
        <ModelSelect value={s.voiceSttModel || ''} options={STT_MODELS} onChange={(v) => setS((x) => ({ ...x, voiceSttModel: v }))} />
      </Field>
      <Field label="Language" hint="Auto-detect works well for one language per message. Pick a language if short sentences get misheard.">
        <Select value={s.voiceLanguage === 'en' ? 'en' : 'auto'} onChange={(e) => setS((x) => ({ ...x, voiceLanguage: e.target.value }))}>
          {LANGS.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
        </Select>
      </Field>
      <label className="check"><input type="checkbox" checked={!!s.voiceAutoRead} onChange={(e) => setS((x) => ({ ...x, voiceAutoRead: e.target.checked }))} /> <span>Read replies aloud automatically<br /><small>Uses your computer's own voices (free, offline). You can also press the speaker button under any reply.</small></span></label>
      <h4 className="sub-h">Reading voice</h4>
      <Field label="Voice engine" hint="Computer voices work offline but sound robotic. A local voice server (Kokoro, Piper) sounds far more natural and still runs only on your Mac. If the server is not running, Artemis falls back to the computer voice.">
        <Select value={s.ttsEngine || 'system'} onChange={(e) => { window.__tts = { engine: e.target.value }; setS((x) => ({ ...x, ttsEngine: e.target.value })); }}>
          <option value="system">Computer voices (built in)</option>
          <option value="openai">Local / custom server (OpenAI-compatible, e.g. Kokoro)</option>
          <option value="piper">Piper server (local)</option>
        </Select>
      </Field>
      {(s.ttsEngine === 'openai' || s.ttsEngine === 'piper') && (
        <>
          <Field label="Server address" hint={s.ttsEngine === 'piper' ? 'Default http://localhost:5000. Start it with: python3 -m piper.http_server -m <voice>' : 'Default http://localhost:8880 (Kokoro-FastAPI). Anything that serves /v1/audio/speech works.'}>
            <input value={s.ttsUrl || ''} onChange={(e) => setS((x) => ({ ...x, ttsUrl: e.target.value }))} placeholder={s.ttsEngine === 'piper' ? 'http://localhost:5000' : 'http://localhost:8880'} spellCheck={false} />
          </Field>
          {s.ttsEngine === 'openai' && <Field label="Model"><ModelSelect value={s.ttsModel || ''} options={TTS_MODELS} onChange={(v) => setS((x) => ({ ...x, ttsModel: v }))} /></Field>}
          {s.ttsEngine === 'piper' ? (
            <>
              <Field label="English voice" hint="e.g. en_US-lessac-medium or en_GB-alba-medium."><input value={s.ttsVoiceEn || ''} onChange={(e) => setS((x) => ({ ...x, ttsVoiceEn: e.target.value }))} placeholder="en_US-lessac-medium" spellCheck={false} /></Field>
            </>
          ) : (
            <Field label="Voice name" hint="Kokoro: af_heart, af_bella, am_michael, bf_emma …">
              <input value={s.ttsVoice || ''} onChange={(e) => setS((x) => ({ ...x, ttsVoice: e.target.value }))} placeholder="af_heart" spellCheck={false} />
            </Field>
          )}
          <small className="hint">Server settings are used after you press Save, then Test voice.</small>
        </>
      )}
      <Field label="Voice" hint="Automatic picks the nicest voice installed for the language of the reply. For much better quality on a Mac: System Settings → Accessibility → Spoken Content → System Voice → Manage Voices, then download a Premium or Enhanced voice. It shows up here after you restart Artemis.">
        <Select value={s.voiceName || ''} onChange={(e) => { window.__voiceName = e.target.value; setS((x) => ({ ...x, voiceName: e.target.value })); }}>
          <option value="">Automatic (best available)</option>
          {voices.map((v) => <option key={v.name + v.lang} value={v.name}>{v.name} · {v.lang}{rankVoice(v) >= 35 ? ' · high quality' : ''}</option>)}
        </Select>
      </Field>
      <Field label="Speed">
        <Select value={String(s.voiceRate || 1)} onChange={(e) => { window.__voiceRate = Number(e.target.value); setS((x) => ({ ...x, voiceRate: Number(e.target.value) })); }}>
          <option value="0.9">Slower</option><option value="1">Normal</option><option value="1.1">Faster</option><option value="1.25">Fast</option>
        </Select>
      </Field>
      <div className="actions-row"><button onClick={() => speak('Hello, this is how I sound.', { language: 'auto' })}>Test voice</button><button onClick={stopSpeaking}>Stop</button></div>
      <AudioDevices s={s} setS={setS} />
      <h4 className="sub-h">Sentinel mode</h4>
      <p className="muted small">Turn it on with the shield button next to the mic (or ⇧⌘A). Artemis then listens for the phrase “Wake up”, like “Hey Siri”. The phrase is recognised on your computer by a small offline model, without AI or internet. After you say it, Artemis keeps listening: it answers in the chat, reads the answer aloud and waits for your next sentence, until you say “bye bye” or stay silent for 10 seconds. Your sentence is transcribed with the speech-to-text provider above.</p>
      <label className="check"><input type="checkbox" checked={!!s.sentinelAuto} onChange={(e) => setS((x) => ({ ...x, sentinelAuto: e.target.checked }))} /> <span>Start Sentinel when Artemis opens<br /><small>Needs the voice model below. The microphone stays on while Sentinel is on.</small></span></label>
      <label className="check"><input type="checkbox" checked={s.sentinelNameOnly !== false} onChange={(e) => setS((x) => ({ ...x, sentinelNameOnly: e.target.checked }))} /> <span>Only react when I say “Artemis”<br /><small>Inside a conversation, a sentence counts only if it starts with “Artemis” or follows Artemis' answer within a few seconds. Other people talking nearby, or you talking to someone else, is ignored.</small></span></label>
      <Field label="Microphone sensitivity" hint="Lower it if voices from further away or from other people are picked up. Speak closer to the microphone, or use headphones.">
        <Select value={s.sentinelSensitivity || 'normal'} onChange={(e) => setS((x) => ({ ...x, sentinelSensitivity: e.target.value }))}>
          <option value="high">High (quiet room)</option><option value="normal">Normal</option><option value="low">Low (noisy room, speak close)</option>
        </Select>
      </Field>
      <label className="check"><input type="checkbox" checked={s.sentinelPreload === true} onChange={(e) => setS((x) => ({ ...x, sentinelPreload: e.target.checked }))} /> <span>Load the voice model in the background<br /><small>Makes turning Sentinel on instant, but uses a lot of CPU and memory for a minute after Artemis opens. Leave off if your computer slows down.</small></span></label>
      <label className="check"><input type="checkbox" checked={s.sentinelInterrupt === true} onChange={(e) => setS((x) => ({ ...x, sentinelInterrupt: e.target.checked }))} /> <span>Interrupt by talking<br /><small>Start talking while Artemis is speaking and it stops. Best with headphones; off by default because other voices can cut it off. You can always say “stop”.</small></span></label>
      <Field label="Sentinel model" hint="Voice answers start sooner with a small, fast model. Sentinel chats use it instead of the default model; short spoken answers rarely need a big one.">
        <Select value={s.sentinelModel || ''} onChange={(e) => setS((x) => ({ ...x, sentinelModel: e.target.value }))}>
          <option value="">Same as the default model</option>
          {chatGroups.map((g) => <optgroup key={g.label} label={g.label}>{g.items.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
        </Select>
      </Field>
      <div className="muted small" style={{ marginTop: 8 }}>
        Voice model: {model ? (model.ready ? `installed (${Math.round(model.size / 1048576)} MB)` : 'not downloaded yet (about 40 MB, downloaded the first time you turn Sentinel on)') : '…'}
        {model && model.ready && <> · <button className="link" onClick={async () => { await window.api.sentinelDelete(); dropSentinelModel(); setModel(await window.api.sentinelStatus()); }}>Remove</button></>}
      </div>
    </>
  );
}
