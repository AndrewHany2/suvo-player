// electron-builder afterPack: flip security fuses on the packaged Electron
// binary. Disables run-as-node / inspector so the app can't be trivially
// relaunched as a raw Node REPL with your code. onlyLoadAppFromAsar binds the
// runtime to the packaged asar. Bar-raising, not real secrecy (spec §8).
//
// Also prunes the ~45MB of non-English Chromium locale packs Electron ships by
// default — the app is English-only, so every other locale.pak is dead weight.
// Runs before code-signing (pack → afterPack → sign), so removing files here
// doesn't invalidate the signature.
const path = require("node:path");
const fs = require("node:fs");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

// Keep English (base + regional + gendered variants like en_GB, en_NEUTER).
const KEEP_LOCALE = /^en([_-]|\.|$)/i;

// Delete every non-English *.pak locale file under `dir`. mac stacks them as
// <code>.lproj/locale.pak inside the framework Resources; win/linux drop them
// as <code>.pak in a flat locales/ dir. Handles both shapes.
function pruneLocales(dir) {
  let freed = 0;
  if (!fs.existsSync(dir)) return freed;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name.endsWith(".lproj")) {
      const code = entry.name.slice(0, -".lproj".length);
      const pak = path.join(full, "locale.pak");
      if (!KEEP_LOCALE.test(code) && fs.existsSync(pak)) {
        freed += fs.statSync(pak).size;
        fs.rmSync(full, { recursive: true, force: true });
      }
    } else if (entry.isFile() && entry.name.endsWith(".pak")) {
      const code = entry.name.slice(0, -".pak".length);
      if (!KEEP_LOCALE.test(code)) {
        freed += fs.statSync(full).size;
        fs.rmSync(full, { force: true });
      }
    }
  }
  return freed;
}

async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;
  const exeName = packager.appInfo.productFilename;
  // Linux sanitizes the executable name (see linux.executableName in
  // builder.json); .app/.exe on mac/win keep the product name.
  const appPath = {
    darwin: `${exeName}.app`,
    win32: `${exeName}.exe`,
    linux: packager.executableName,
  }[electronPlatformName];
  const electronBinary = path.join(appOutDir, appPath);

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });

  // Locale packs live in different places per platform.
  const localeDirs =
    electronPlatformName === "darwin"
      ? [
          path.join(
            appOutDir,
            appPath,
            "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources",
          ),
        ]
      : [path.join(appOutDir, "locales")];

  let freed = 0;
  for (const dir of localeDirs) freed += pruneLocales(dir);
  if (freed > 0) {
    console.log(
      `  • pruned non-English locales  freed=${(freed / 1e6).toFixed(1)}MB`,
    );
  }
}

// electron-builder calls the default export; the named exports are for tests.
module.exports = afterPack;
module.exports.pruneLocales = pruneLocales;
module.exports.KEEP_LOCALE = KEEP_LOCALE;
