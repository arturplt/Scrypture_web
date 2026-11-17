import { createRoot } from 'react-dom/client';
import './global.css';
import { App } from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { registerServiceWorker } from './pwa';

const root = createRoot(document.getElementById('root')!);
const path = location.pathname;

// Dev-only tools (UI kit, sprite atlas with uploads) are loaded dynamically and never ship in production builds.
if (import.meta.env.DEV && path.startsWith('/kit')) import('./pages/Kit').then(m => root.render(<m.Kit />));
else if (import.meta.env.DEV && path.startsWith('/urgency')) import('./pages/UrgencyLab').then(m => root.render(<m.UrgencyLab />));
else if (import.meta.env.DEV && path.startsWith('/anim')) import('./pages/AnimLab').then(m => root.render(<m.AnimLab />));
else if (import.meta.env.DEV && path.startsWith('/atlas')) import('./pages/Atlas').then(m => root.render(<m.Atlas />));
else root.render(<ErrorBoundary><App /></ErrorBoundary>);

registerServiceWorker();
