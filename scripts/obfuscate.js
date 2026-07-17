const fs = require("node:fs");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { getPreset } = require("./obfuscateConfig.js");
const { collectJsFiles } = require("./collectJsFiles.js");

// Obfuscate a source string using the named target profile ("web" | "tv").
function obfuscateCode(source, profile = "web") {
  return JavaScriptObfuscator.obfuscate(source, getPreset(profile)).getObfuscatedCode();
}

// Obfuscate every .js under `dir` in place using `profile`. Throws (fails the
// build) on the first file that cannot be obfuscated — never ships
// un-obfuscated silently.
function run(dir, profile = "web", deps = {}) {
  const _fs = deps.fs ?? fs;
  const _collect = deps.collect ?? collectJsFiles;
  const _obf = deps.obfuscateCode ?? obfuscateCode;
  const files = _collect(dir, _fs);
  for (const file of files) {
    const src = _fs.readFileSync(file, "utf8");
    _fs.writeFileSync(file, _obf(src, profile));
  }
  return files.length;
}

module.exports = { obfuscateCode, run };

if (require.main === module) {
  const dir = process.argv[2];
  const profile = process.argv[3] || "web";
  if (!dir) {
    console.error("usage: node scripts/obfuscate.js <build-output-dir> [web|tv]");
    process.exit(1);
  }
  try {
    const n = run(dir, profile);
    console.log(`obfuscated ${n} .js file(s) in ${dir} [profile: ${profile}]`);
  } catch (e) {
    console.error(`obfuscation failed: ${e.message}`);
    process.exit(1);
  }
}
