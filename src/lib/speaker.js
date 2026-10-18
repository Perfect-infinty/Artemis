// Renderer helpers for Settings → Security: record a sentence for voice recognition (a 16 kHz mono WAV, the same kind Sentinel sends) and
// grab one webcam frame for the unauthorized-access alert. The decisions are made in the main process, never here.
import { RATE, concat, encodeWav, rms } from './sentinel-core.mjs';
import { openMic } from './audio-devices.js';

const micError = (e) => new Error((e && e.name === 'NotAllowedError') || /denied|permission/i.test(String(e && e.message))
  ? 'Microphone access was denied. Allow Artemis in System Settings → Privacy & Security → Microphone.'
  : 'Could not open the microphone: ' + ((e && e.message) || e));

/**
 * Records until stop() is called (or maxMs passes). The same audio settings as Sentinel, so an enrolled voice sounds like what is checked later.
 * Returns { stop(), cancel(), done: Promise<{ wav: Uint8Array, seconds, level }> }.
 */
export async function recordWav({ maxMs = 8000, onLevel } = {}) {
  if (window.api && window.api.voicePermission) {
    const st = await window.api.voicePermission();
    if (st === 'denied' || st === 'restricted') throw new Error('Microphone access is blocked. Allow Artemis in System Settings → Privacy & Security → Microphone, then try again.');
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This computer has no microphone available to Artemis.');
  let stream;
  try { stream = await openMic({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }); } catch (e) { throw micError(e); }
  const ctx = new AudioContext({ sampleRate: RATE });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = []; let peak = 0; let ended = false; let finish;
  const done = new Promise((r) => { finish = r; });
  proc.onaudioprocess = (e) => {
    if (ended) return;
    const c = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(c); const l = rms(c); if (l > peak) peak = l;
    if (onLevel) onLevel(Math.min(1, l * 12));
  };
  const mute = ctx.createGain(); mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  const release = () => { try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch {} stream.getTracks().forEach((t) => t.stop()); try { ctx.close(); } catch {} };
  const timer = setTimeout(() => stop(), maxMs);
  function stop() {
    if (ended) return done;
    ended = true; clearTimeout(timer); release();
    const all = concat(chunks);
    finish({ wav: encodeWav(all, RATE), seconds: all.length / RATE, level: peak });
    return done;
  }
  const cancel = () => { if (ended) return; ended = true; clearTimeout(timer); release(); finish({ wav: new Uint8Array(0), seconds: 0, level: 0, cancelled: true }); };
  return { stop, cancel, done };
}

/** One frame from the webcam as a JPEG data URL, or null (no camera, not allowed). The camera is released right away and nothing is stored. */
export async function captureFrame({ width = 640, quality = 0.7 } = {}) {
  let stream = null;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: width }, facingMode: 'user' }, audio: false });
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    await Promise.race([v.play(), new Promise((_, j) => setTimeout(() => j(new Error('camera timeout')), 4000))]);
    await new Promise((r) => setTimeout(r, 700)); // let the exposure settle: the first frames are often dark
    const w = v.videoWidth || width; const h = v.videoHeight || Math.round(width * 0.75);
    if (!w || !h) return null;
    const c = document.createElement('canvas'); c.width = Math.min(w, width); c.height = Math.round(c.width * (h / w));
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } catch { return null; }
  finally { if (stream) stream.getTracks().forEach((t) => t.stop()); }
}

/** Phrases read aloud when enrolling. Varied sounds, a few seconds each. */
export const ENROLL_PHRASES = [
  'The quick brown fox jumps over the lazy dog near the river.',
  'Artemis, open my notes and show me what I wrote yesterday.',
  'Seven bright lanterns floated slowly across the quiet harbour.',
  'Please remind me to call the clinic before noon tomorrow.',
  'Good morning, it is a beautiful day to build something new.',
  'Only my voice should be able to unlock this computer.'
];
