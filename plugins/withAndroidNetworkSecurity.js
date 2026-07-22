// Expo config plugin: ship a custom Android network security config so that
// (a) cleartext HTTP stays allowed (IPTV streams / playlists / EPG) and
// (b) user-installed CAs are dropped from the trust store for RELEASE builds,
// so a proxy CA can't transparently MITM the app's HTTPS traffic. Runs on
// `expo prebuild`; the committed android/ tree already carries the same file +
// manifest attribute for the direct `gradlew assembleRelease` build path, so
// keep the two in sync.
const {
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const NSC_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
  Android network security policy for Suvo. Generated to match
  plugins/withAndroidNetworkSecurity.js — edit the plugin, not this file, when
  regenerating via \`expo prebuild\`.

  - base-config cleartextTrafficPermitted="true": IPTV providers commonly serve
    streams / playlists / EPG over plain HTTP, so cleartext must stay allowed.
  - trust-anchors lists ONLY the system CA store; the "user" anchor is omitted.
    A user-installed CA (mitmproxy, Charles, Frida proxies) therefore cannot
    transparently intercept the app's HTTPS traffic — the usual first step in
    reverse-engineering the Supabase API (anon key, endpoints, device gate).
    Not unbreakable (a rooted device or patched APK can still MITM), but it
    stops casual proxy analysis.
  - debug-overrides re-adds the user anchor for debuggable builds ONLY, so local
    proxy debugging still works while release builds trust system CAs alone.
-->
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system" />
    </trust-anchors>
  </base-config>
  <debug-overrides>
    <trust-anchors>
      <certificates src="system" />
      <certificates src="user" />
    </trust-anchors>
  </debug-overrides>
</network-security-config>
`;

function withNscFile(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const xmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      await fs.promises.mkdir(xmlDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(xmlDir, "network_security_config.xml"),
        NSC_XML,
      );
      return cfg;
    },
  ]);
}

function withNscManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(
      cfg.modResults,
    );
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return cfg;
  });
}

module.exports = function withAndroidNetworkSecurity(config) {
  return withNscManifest(withNscFile(config));
};
