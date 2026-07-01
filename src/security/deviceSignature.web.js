// Device signature for the web-export targets: webOS TV, Samsung Tizen,
// Electron, and browser. Returns { primary, platform, secondary }.
//
//   primary   the access anchor: Electron machine-id, else a persisted UUID.
//             On TV/Electron there is no hardware root of trust, so this is a
//             stable-but-spoofable value (documented ceiling).
//   secondary informational composite fingerprint (never gates access).
const { fingerprintHash } = require("./secondaryFingerprint.js");

function detectPlatform(g) {
  if (g?.electronAPI?.machineId) return "electron";
  if (g?.tizen) return "tizen";
  if (g?.webOS) return "webos";
  return "browser";
}

function ensureUuid(ls, gen) {
  const KEY = "iptv_device_uuid";
  let v = ls.getItem(KEY);
  if (!v) {
    v = gen();
    ls.setItem(KEY, v);
  }
  return v;
}

function collectHints(g) {
  const nav = g?.navigator || {};
  const scr = g?.screen || {};
  return {
    cores: nav.hardwareConcurrency,
    ram: nav.deviceMemory,
    ua: nav.userAgent,
    lang: nav.language,
    screen:
      scr.width && scr.height
        ? `${scr.width}x${scr.height}x${scr.colorDepth || ""}`
        : undefined,
    tizenDuid: g?.tizen?.systeminfo ? "tizen" : undefined,
  };
}

async function getDeviceSignature() {
  const g = globalThis;
  const platform = detectPlatform(g);
  let primary;
  if (platform === "electron") {
    primary = await g.electronAPI.machineId();
  } else {
    const gen = () =>
      g.crypto?.randomUUID
        ? g.crypto.randomUUID()
        : String(Date.now()) + Math.random();
    primary = ensureUuid(g.localStorage, gen);
  }
  const secondary = fingerprintHash(collectHints(g));
  return { primary, platform, secondary };
}

module.exports = {
  detectPlatform,
  ensureUuid,
  collectHints,
  getDeviceSignature,
};
