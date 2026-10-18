import React, { useEffect, useRef, useState } from 'react';

/** A chat title that fades in when it changes (not on first render). The animation is CSS (.title-swap) and off with reduced motion. */
export default function TitleText({ text, className = '', ...rest }) {
  const last = useRef(text);
  const [n, setN] = useState(0);
  useEffect(() => { if (last.current !== text) { last.current = text; setN((x) => x + 1); } }, [text]);
  return <span key={n} className={`${className}${n ? ' title-swap' : ''}`} {...rest}>{text}</span>;
}
