// Microphone and speaker choice. Empty id = the system default. Ids come from Settings → Voice (window.__micId / __speakerId).
/** Opens the chosen microphone; if it was unplugged (or the id is stale) it falls back to the default one. */
export async function openMic(audio = {}) {
  const md = navigator.mediaDevices;
  const id = window.__micId;
  if (id) {
    try { return await md.getUserMedia({ audio: { ...audio, deviceId: { exact: id } } }); }
    catch (e) { if (e && e.name === 'NotAllowedError') throw e; /* gone: use the default */ }
  }
  return md.getUserMedia({ audio });
}

/** Sends an <audio> element to the chosen speakers or headphones. */
export async function routeOutput(el) {
  const id = window.__speakerId;
  if (!id || !el || !el.setSinkId) return;
  try { await el.setSinkId(id); } catch { try { await el.setSinkId(''); } catch {} }
}

/** { inputs, outputs, labeled }: the labels are empty until the microphone has been allowed once. */
export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind) => all.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${i + 1}` }));
    return { inputs: pick('audioinput'), outputs: pick('audiooutput'), labeled: all.some((d) => d.label) };
  } catch { return { inputs: [], outputs: [], labeled: false }; }
}

/** Asks for the microphone once so the browser reveals the device names. */
export async function unlockLabels() {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return true; } catch { return false; }
}
