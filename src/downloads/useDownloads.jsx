import { createContext, useContext } from 'react';
import { useDownloadsController } from './downloadsController.js';

const DownloadsContext = createContext(null);

// Thin context wrapper. All state/effects/actions live in the headless
// useDownloadsController (a JSX-free module) so they can be unit-tested in
// node:test; this component only bridges that value into React context.
export function DownloadsProvider({ manager, api, documentDirectory, store, children }) {
  const value = useDownloadsController({ manager, api, documentDirectory, store });
  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads() {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error('useDownloads must be used within DownloadsProvider');
  return ctx;
}
