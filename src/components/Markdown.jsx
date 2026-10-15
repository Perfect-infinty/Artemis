import React, { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { splitThink } from '../lib/think.mjs';

function CodeBlock({ children }) {
  const ref = useRef(null);
  const [copied, setCopied] = useState(false);
  const child = React.Children.toArray(children)[0];
  const cls = child?.props?.className || '';
  const lang = (cls.match(/language-([\w-]+)/) || [])[1] || 'code';
  const copy = () => {
    navigator.clipboard.writeText(ref.current?.innerText || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="codeblock">
      <div className="code-head"><span>{lang}</span><button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button></div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

const components = {
  pre: CodeBlock,
  a: ({ href, children }) => <a href={href} onClick={(e) => { if (/^https?:\/\//i.test(href || '')) { e.preventDefault(); window.dispatchEvent(new CustomEvent('aid-browser-open', { detail: href })); } }}>{children}</a>,
  table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>
};

function Body({ text }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** A model's <think> block: collapsed, opens on click. */
function Think({ text, done, streaming }) {
  const live = streaming && !done;
  return (
    <details className={`think ${live ? 'live' : ''}`}>
      <summary>{live ? 'Thinking…' : 'Thought process'}</summary>
      <div className="think-body">{text || '…'}</div>
    </details>
  );
}

export default function Markdown({ text, streaming }) {
  if (!/<\/?think(ing)?>/i.test(String(text || ''))) return <Body text={text} />;
  return (
    <>
      {splitThink(text).map((p, i) => (p.type === 'think'
        ? <Think key={i} text={p.text} done={p.done} streaming={streaming} />
        : (p.text.trim() ? <Body key={i} text={p.text} /> : null)))}
    </>
  );
}
