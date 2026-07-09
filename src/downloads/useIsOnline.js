import { useEffect, useMemo, useState } from 'react';

export function resolveNetInfo() {
  try {
    const mod = require('@react-native-community/netinfo');
    return mod.default || mod;
  } catch {
    return null;
  }
}

export function deriveOnline(state) {
  return state?.isConnected !== false && state?.isInternetReachable !== false;
}

export function useIsOnline() {
  const netInfo = useMemo(() => resolveNetInfo(), []);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (!netInfo) return undefined;
    return netInfo.addEventListener((state) => setOnline(deriveOnline(state)));
  }, [netInfo]);
  return online;
}
