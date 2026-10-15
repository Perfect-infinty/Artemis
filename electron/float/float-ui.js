(function () {
  const api = window.floatApi;
  const log = document.getElementById('log');
  const approval = document.getElementById('approval');
  const approvalText = document.getElementById('approval-text');
  const dot = document.querySelector('.dot');
  const calls = {};
  let curText = null, shot = null, pendingId = null;

  const el = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d; };
  const scroll = () => { log.scrollTop = log.scrollHeight; };

  function describe(name, a) {
    a = a || {};
    if (name === 'computer') {
      const extra = a.text ? `"${String(a.text).slice(0, 40)}"` : a.keys || (a.x != null ? `${a.x},${a.y}` : '');
      return [String(a.action || '').replace(/_/g, ' '), extra].filter(Boolean).join(' ');
    }
    if (name === 'run_command') return '$ ' + String(a.command || '').slice(0, 120);
    if (name === 'web_search') return 'search: ' + (a.query || '');
    if (name === 'web_fetch') return 'open ' + (a.url || '');
    return name + (a.path ? ' ' + a.path : '');
  }

  function setShot(src) {
    if (!shot) { shot = document.createElement('img'); shot.className = 'shot'; log.prepend(shot); }
    shot.src = src;
  }

  document.getElementById('stop').onclick = () => api.stop();
  document.getElementById('allow').onclick = () => decide(true);
  document.getElementById('deny').onclick = () => decide(false);
  function decide(ok) { if (pendingId) { api.decide(pendingId, ok); pendingId = null; approval.hidden = true; } }

  api.onEvent((ev) => {
    switch (ev.type) {
      case 'chunk':
        if (!curText) { curText = el('msg', ''); log.appendChild(curText); }
        curText.textContent += ev.text; scroll(); break;
      case 'step:new': curText = null; break;
      case 'tool:call':
        calls[ev.id] = { name: ev.name, args: ev.args };
        curText = null;
        calls[ev.id].node = el('tool', describe(ev.name, ev.args));
        log.appendChild(calls[ev.id].node); scroll(); break;
      case 'tool:approval': {
        const c = calls[ev.id] || {};
        pendingId = ev.id;
        approvalText.textContent = 'Allow: ' + describe(c.name || 'action', c.args);
        approval.hidden = false; break;
      }
      case 'tool:result': {
        const c = calls[ev.id];
        if (c && c.node && (!ev.ok || ev.denied)) { c.node.classList.add('err'); c.node.textContent += ev.denied ? ' — denied' : ' — failed'; }
        if (ev.image) setShot(ev.image);
        if (pendingId === ev.id) { pendingId = null; approval.hidden = true; }
        break;
      }
      case 'notice': log.appendChild(el('tool', ev.text)); scroll(); break;
      case 'error': log.appendChild(el('tool err', ev.message)); scroll(); break;
      case 'done': dot.classList.add('idle'); document.querySelector('.title').textContent = 'Done'; break;
    }
  });
})();
