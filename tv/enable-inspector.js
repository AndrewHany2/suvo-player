// Enables the webOS TV Simulator's Web Inspector so it auto-opens on app
// launch. The simulator has no CLI inspect flag (unlike `ares-inspect` for a
// real device), so the only lever is the `auto-inspector` toggle in its
// per-user config. We flip it on here; `npm run sim:lg:inspect` then launches
// the simulator, which reads this config at startup and opens devtools.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WEBOS_TV_VERSION = "26"; // keep in sync with the `-s` arg in sim:lg

const configPath = path.join(
  os.homedir(),
  "Library/Application Support/webos-simulator",
  `webos-tv-simulator-${WEBOS_TV_VERSION}.json`,
);

if (!fs.existsSync(configPath)) {
  console.error(
    `Simulator config not found: ${configPath}\n` +
      `Launch the webOS TV ${WEBOS_TV_VERSION} Simulator once (npm run sim:lg) so it writes its config, then retry.`,
  );
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.settings = config.settings || {};
config.settings["auto-inspector"] = true;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

console.log("✓ Enabled simulator auto-inspector (Web Inspector opens on launch)");
