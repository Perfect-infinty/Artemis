// Viewport position of the caret inside a <textarea>: the text is mirrored into a hidden div with the same box and typography.
const PROPS = ['direction', 'boxSizing', 'width', 'overflowX', 'overflowY', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize'];

export function getCaretCoordinates(ta, pos) {
  const cs = window.getComputedStyle(ta);
  const div = document.createElement('div');
  document.body.appendChild(div);
  const st = div.style;
  st.whiteSpace = 'pre-wrap'; st.wordWrap = 'break-word'; st.position = 'absolute'; st.visibility = 'hidden'; st.top = '0'; st.left = '0';
  PROPS.forEach((p) => { st[p] = cs[p]; });
  div.textContent = ta.value.substring(0, pos);
  const span = document.createElement('span');
  span.textContent = ta.value.substring(pos) || '.';
  div.appendChild(span);
  const rect = ta.getBoundingClientRect();
  const lh = parseInt(cs.lineHeight, 10) || 20;
  const out = { top: rect.top - ta.scrollTop + span.offsetTop + lh, left: rect.left - ta.scrollLeft + span.offsetLeft, lineHeight: lh };
  document.body.removeChild(div);
  return out;
}
