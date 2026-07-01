const fs = require("node:fs");
const JavaScriptObfuscator = require("javascript-obfuscator");
const { OBFUSCATE_OPTIONS } = require("./obfuscateConfig.js");
const { collectJsFiles } = require("./collectJsFiles.js");

function obfuscateCode(source) {
  return JavaScriptObfuscator.obfuscate(source, OBFUSCATE_OPTIONS).getObfuscatedCode();
}

// Obfuscate every .js under `dir` in place. Throws (fails the build) on the
// first file that cannot be obfuscated — never ships un-obfuscated silently.
function run(dir, deps = {}) {
  const _fs = deps.fs ?? fs;
  const _collect = deps.collect ?? collectJsFiles;
  const _obf = deps.obfuscateCode ?? obfuscateCode;
  const files = _collect(dir, _fs);
  for (const file of files) {
    const src = _fs.readFileSync(file, "utf8");
    _fs.writeFileSync(file, _obf(src));
  }
  return files.length;
}

module.exports = { obfuscateCode, run };

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node scripts/obfuscate.js <build-output-dir>");
    process.exit(1);
  }
  try {
    const n = run(dir);
    console.log(`obfuscated ${n} .js file(s) in ${dir}`);
  } catch (e) {
    console.error(`obfuscation failed: ${e.message}`);
    process.exit(1);
  }
}
