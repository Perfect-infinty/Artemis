// Human-friendly number handling for the usage-limit settings.
/** "500k", "1.5M", "2m", "250000", "1,000" -> tokens (0 when empty/invalid). */
export function parseTokens(str) {
  const m = /^\s*([\d.,]+)\s*([kKmMbB]?)\s*(?:tokens?)?\s*$/.exec(String(str ?? ''));
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!isFinite(n) || n < 0) return 0;
  const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
  return Math.round(n * mult);
}
/** 1500000 -> "1.5M", 500000 -> "500k", 0 -> "" */
export function fmtTokens(n) {
  n = Math.round(Number(n) || 0);
  if (n <= 0) return '';
  const f = (x, u) => String(Math.round(x * 1000) / 1000) + u;
  if (n >= 1e9) return f(n / 1e9, 'B');
  if (n >= 1e6) return f(n / 1e6, 'M');
  if (n >= 1e3) return f(n / 1e3, 'k');
  return String(n);
}
/** "$5", "5", "0.5", "$1,200.50" -> number (0 when empty/invalid). */
export function parseUsd(str) {
  const m = /^\s*\$?\s*([\d.,]+)\s*$/.exec(String(str ?? ''));
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
export const fmtUsdInput = (n) => (Number(n) > 0 ? String(Math.round(Number(n) * 100) / 100) : '');
