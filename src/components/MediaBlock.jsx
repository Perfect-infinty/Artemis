import React, { useEffect, useState } from 'react';
import { Icon } from './Icons.jsx';

const api = window.api;

export default function MediaBlock({ item }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false, made = '';
    api.loadMedia(item.path).then((r) => {
      if (off) return;
      if (!r) return setFailed(true);
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      made = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      setUrl(made);
    }).catch(() => setFailed(true));
    return () => { off = true; if (made) URL.revokeObjectURL(made); };
  }, [item.path]);
  return (
    <figure className="media">
      {failed ? <div className="notice">The generated file is no longer on this computer.</div>
        : !url ? <div className="media-load">Loading…</div>
        : item.kind === 'video' ? <video src={url} controls loop playsInline />
        : <img src={url} alt={item.prompt || 'generated image'} />}
      <figcaption>
        <span>{item.model}</span>
        {!failed && <button onClick={() => api.revealMedia(item.path)}><Icon name="folderOpen" size={14} /> Show in folder</button>}
      </figcaption>
    </figure>
  );
}
