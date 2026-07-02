// Pure device-integrity (jailbreak/root) policy. Native-only concept:
// web / Electron / TV are never "compromised" (no jailbreak notion there).
//
// Fail-open by design: this drives a SOFT-block (warn + refuse playback), so an
// unknown/false/missing signal must NOT block — false positives would lock out
// legitimate users. The authoritative integrity check is server-side
// attestation (App Attest / Play Integrity), not this local heuristic.
//
//   platform      Platform.OS: 'ios' | 'android' | 'web' | ...
//   isJailBroken  jail-monkey result (native only), else undefined
function evaluateIntegrity({ platform, isJailBroken }) {
  const native = platform === "ios" || platform === "android";
  if (!native) return { compromised: false };
  return { compromised: isJailBroken === true };
}

module.exports = { evaluateIntegrity };
