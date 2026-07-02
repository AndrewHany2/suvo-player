import { useEffect, useState } from "react";
// Resolves to deviceIntegrity.js (native) or deviceIntegrity.web.js (web).
import { getDeviceIntegrity } from "./deviceIntegrity";

// Returns true once a native jailbreak/root signal is detected; false
// everywhere else (web/Electron/TV) and until the async probe resolves.
// Fail-open: probe errors leave it false.
export function useDeviceIntegrity() {
  const [compromised, setCompromised] = useState(false);
  useEffect(() => {
    let alive = true;
    getDeviceIntegrity()
      .then((r) => {
        if (alive) setCompromised(!!r.compromised);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return compromised;
}
