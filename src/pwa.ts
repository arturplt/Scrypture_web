/** Registers the offline service worker in production builds only (dev server must stay uncached). */
export const SW_UPDATED_EVENT = 'scrypture:sw-updated';

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // a controller that changes while the page is open means a new version took over: offer a reload (the first install is not an update)
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) dispatchEvent(new Event(SW_UPDATED_EVENT)); });
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(e => console.warn('Service worker failed', e)); });
}
