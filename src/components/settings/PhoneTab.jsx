import React, { useEffect, useState } from 'react';
import { Group, Row, SwitchRow, SecretInput, Note } from './ui.jsx';

/** Settings → Phone: the Telegram bot. The token is a secret: it is saved on blur / Enter (or by Connect & test), never per keystroke. */
export function PhoneTab({ s, setS, onSaveToken }) {
  const [st, setSt] = useState(null);
  useEffect(() => {
    let alive = true;
    const tick = () => window.api.remoteStatus().then((r) => alive && setSt(r)).catch(() => {});
    tick(); const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [draft, setDraft] = useState(''); // a pasted token that has not been saved yet
  const pick = async () => { const f = await window.api.pickFolder(); if (f) setS((x) => ({ ...x, remoteFolder: f })); };
  const commitToken = async (t) => { setS((x) => ({ ...x, hasTelegramToken: true })); setDraft(''); if (onSaveToken) await onSaveToken(t); };
  const connect = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await window.api.remoteConnectTelegram(draft.trim());
      if (r.status) setSt({ ...(st || {}), telegram: r.status });
      window.api.remoteStatus().then(setSt).catch(() => {});
      if (!r.ok) return setNote({ bad: true, text: r.error });
      setDraft('');
      setS((x) => ({ ...x, telegramEnabled: true, hasTelegramToken: true }));
      setNote({ text: r.paired ? (r.testMessageSent ? `Connected to @${r.botName}. A test message was sent to your Telegram.` : `Connected to @${r.botName}.`) : `Connected to @${r.botName}. Now open it in Telegram, press Start and send: /pair ${r.pairCode}` });
    } finally { setBusy(false); }
  };
  const tg = st && st.telegram;
  const state = !st ? 'Checking…'
    : tg.retrying ? `${tg.error || 'Cannot reach Telegram.'} Retrying every few seconds…`
    : tg.error ? `Telegram error: ${tg.error}`
    : !tg.hasToken ? 'No token saved yet. Paste it above and press Connect & test.'
    : !tg.running ? 'Not connected yet. Press Connect & test.'
    : !tg.paired ? <>Bot @{tg.botName} is online. In Telegram, open it, press Start and send: <b>/pair {tg.pairCode}</b></>
    : <>Connected to @{tg.botName}{tg.openChat ? ` · chat open: ${tg.openChat}` : ''}. <button type="button" className="link" onClick={() => window.api.remoteUnpair().then(setSt)}>Unpair</button></>;
  return (
    <>
      <Group title="Telegram">
        <SwitchRow label="Telegram bot" description="Chat with the assistant from Telegram, send it photos/files, and let it send files to you."
          checked={!!s.telegramEnabled} onChange={(v) => setS((x) => ({ ...x, telegramEnabled: v }))} />
        {s.telegramEnabled && (
          <>
            <Row stacked label="Bot token" description={s.hasTelegramToken ? 'A token is saved. Paste a new one to replace it; it is saved when you leave the field. Create a bot with @BotFather.' : 'Create a bot with @BotFather and paste its token. It is saved when you leave the field or press Enter.'}>
              <div className="pref-inline grow">
                <SecretInput clearOnCommit placeholder={s.hasTelegramToken ? '••••••••••••' : '123456789:AAH…'} aria-label="Telegram bot token"
                  onInput={(e) => setDraft(e.target.value)} onCommit={commitToken} />
                <button type="button" className="pref-btn primary" onClick={connect} disabled={busy || (!draft.trim() && !s.hasTelegramToken)}>{busy ? 'Connecting…' : 'Connect & test'}</button>
              </div>
            </Row>
            <Row label="Status" description={<span className={tg && tg.error ? 'pref-err-text' : ''}>{state}</span>} />
            {note && <Row description={<span className={note.bad ? 'pref-err-text' : 'pref-ok-text'}>{note.text}</span>} />}
          </>
        )}
      </Group>
      {s.telegramEnabled && tg && tg.paired && <Note>From Telegram: /chats opens a desktop chat and continues it there (new messages show up in the app), /search finds old chats, /skills lists skills.</Note>}
      {s.telegramEnabled && (
        <Group title="Phone chats">
          <Row stacked label="Project folder for phone chats" description="Files the assistant can read and write when you chat from your phone. Leave empty for none.">
            <div className="pref-inline grow">
              <input className="pref-input wide" value={s.remoteFolder || ''} onChange={(e) => setS((x) => ({ ...x, remoteFolder: e.target.value }))} placeholder="/path/to/folder" spellCheck={false} aria-label="Project folder for phone chats" />
              <button type="button" className="pref-btn" onClick={pick}>Choose…</button>
            </div>
          </Row>
          <SwitchRow label="Continue my most recent desktop chat" description="A message from your phone goes into the chat you used last on the desktop (within 12 hours) instead of opening a new one. /new starts a fresh chat, /open picks another."
            checked={s.remoteContinueLast !== false} onChange={(v) => setS((x) => ({ ...x, remoteContinueLast: v }))} />
          <SwitchRow label="Full control from the phone" description="Terminal plus screen, mouse and keyboard. On: you can drive your computer from Telegram and see live screenshots; send /screen for a snapshot. Anyone who gets into your paired Telegram account could do the same. Each task still asks you to approve on the phone."
            checked={!!s.remoteAllowDangerous} onChange={(v) => setS((x) => ({ ...x, remoteAllowDangerous: v }))} />
        </Group>
      )}
    </>
  );
}
