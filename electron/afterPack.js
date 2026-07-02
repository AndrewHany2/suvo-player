// electron-builder afterPack: flip security fuses on the packaged Electron
// binary. Disables run-as-node / inspector so the app can't be trivially
// relaunched as a raw Node REPL with your code. onlyLoadAppFromAsar binds the
// runtime to the packaged asar. Bar-raising, not real secrecy (spec §8).
const path = require("node:path");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");

module.exports = async function afterPack(context) {
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
};
