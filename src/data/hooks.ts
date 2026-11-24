import { useSyncExternalStore } from 'react';
import { createStore } from './store';
import type { AppState } from './state';

/** App-wide singleton backed by localStorage. */
export const store = createStore();
export const actions = store.actions;
export const persistent = store.persistent;

export function useAppState<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
export const useEvents = () => useSyncExternalStore(store.subscribe, store.getEvents);
export const useUndo = () => useSyncExternalStore(store.subscribe, store.getUndo);
export const useSaveBlocked = () => useSyncExternalStore(store.subscribe, store.isSaveBlocked);
