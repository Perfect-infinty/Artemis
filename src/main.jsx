import React from 'react';
import { createRoot } from 'react-dom/client';
import 'highlight.js/styles/github-dark.css';
import './styles.css';
import App from './App.jsx';
import QuickChat from './QuickChat.jsx';
import PaletteWindow from './PaletteWindow.jsx';
import DialogHost from './components/DialogHost.jsx';
import SentinelWidget from './components/SentinelWidget.jsx';
import { TerminalWindow } from './components/Terminal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { applyCachedTheme } from './lib/themes.js';

applyCachedTheme(); // before the first paint: no flash of the default theme

const quick = window.location.hash === '#quick';
const paletteWin = window.location.hash === '#palette';
const widget = window.location.hash === '#sentinel';
const termId = window.location.hash.startsWith('#terminal=') ? window.location.hash.slice(10) : null;
import { installErrorLog } from './lib/log.js';
installErrorLog();
createRoot(document.getElementById('root')).render(<ErrorBoundary name="Artemis">{termId ? <TerminalWindow id={termId} /> : widget ? <SentinelWidget /> : <>{quick ? <QuickChat /> : paletteWin ? <PaletteWindow /> : <App />}<DialogHost /></>}</ErrorBoundary>);
