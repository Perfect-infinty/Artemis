import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev only: the React refresh preamble is an inline script, so the CSP meta tag in index.html needs 'unsafe-inline' under `vite`.
const devCsp = {
  name: 'artemis-dev-csp', apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
};

export default defineConfig({
  plugins: [react(), devCsp],
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: true }
});
