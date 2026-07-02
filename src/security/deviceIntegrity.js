// Device-integrity probe for native RN targets (iOS, Android). Returns
// { compromised }. jail-monkey is resolved lazily/guarded (like loadBrightness
// in the player) so a build without the native module simply reports
// not-compromised rather than crashing — consistent with the fail-open,
// soft-block policy. Server attestation is the authoritative check.
import { Platform } from "react-native";
import { evaluateIntegrity } from "./integrityPolicy.js";

function loadJailMonkey() {
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const mod = require("jail-monkey");
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

export async function getDeviceIntegrity() {
  const platform = Platform.OS; // 'ios' | 'android'
  let isJailBroken = false;
  try {
    const jm = loadJailMonkey();
    isJailBroken = jm?.isJailBroken?.() === true;
  } catch {
    isJailBroken = false; // fail-open
  }
  return evaluateIntegrity({ platform, isJailBroken });
}
