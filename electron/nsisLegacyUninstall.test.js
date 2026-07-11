'use strict';

// Guards electron/assets/installer.nsh: the hardcoded legacy uninstall GUIDs must
// stay in agreement with what electron-builder itself derives from each old appId,
// or the Windows installer would silently fail to remove those old-branded installs.
// The derivation (uuid5 of appId under electron-builder's namespace) is copied from
// app-builder-lib/out/targets/nsis/NsisTarget.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { UUID } = require('builder-util-runtime');

const ELECTRON_BUILDER_NS = UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3');
const guidFor = (appId) => UUID.v5(appId, ELECTRON_BUILDER_NS);

const nsh = fs.readFileSync(path.join(__dirname, 'assets', 'installer.nsh'), 'utf8');

// Older brands whose installs a fresh Suvo install must remove.
const LEGACY_APP_IDS = [
  'com.andrew1h1.lumenplayer',
  'com.andrew1h1.iptvplayer',
  'com.iptv.player',
];

const CURRENT_APP_ID = 'com.andrew1h1.suvo';

test('installer.nsh removes every legacy-branded install', () => {
  for (const appId of LEGACY_APP_IDS) {
    const guid = guidFor(appId);
    assert.ok(
      nsh.includes(guid),
      `installer.nsh must reference the uninstall GUID ${guid} for legacy appId ${appId}`
    );
  }
});

test('installer.nsh does not hardcode the current appId GUID', () => {
  // electron-builder already uninstalls the previous same-appId install, so listing
  // the current GUID here would make the installer try to uninstall itself.
  const guid = guidFor(CURRENT_APP_ID);
  assert.ok(
    !nsh.includes(guid),
    `installer.nsh must not reference the current appId GUID ${guid}`
  );
});
