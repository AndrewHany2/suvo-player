// Web / Electron / TV: no jailbreak/root concept — always report
// not-compromised. Mirrors the native getDeviceIntegrity() shape so callers
// (useDeviceIntegrity) stay platform-agnostic.
const { evaluateIntegrity } = require("./integrityPolicy.js");

async function getDeviceIntegrity() {
  return evaluateIntegrity({ platform: "web" });
}

module.exports = { getDeviceIntegrity };
