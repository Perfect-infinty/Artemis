// window.prompt is not available in Electron, so ask for a name with a tiny inline dialog.
export function promptName(title, initial = '') {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'notes-prompt-back';
    const box = document.createElement('div'); box.className = 'notes-prompt';
    const label = document.createElement('div'); label.textContent = title;
    const input = document.createElement('input'); input.spellcheck = false; input.value = initial;
    const row = document.createElement('div'); row.className = 'row';
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
    const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = 'OK';
    row.append(cancel, ok); box.append(label, input, row); wrap.append(box);
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) done(null); });
    cancel.onclick = () => done(null);
    ok.onclick = () => done(input.value.trim() || null);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim() || null); if (e.key === 'Escape') done(null); });
    document.body.appendChild(wrap); input.focus(); input.select();
  });
}
