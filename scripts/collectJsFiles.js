const path = require("node:path");

// Recursively collect .js files under rootDir. `.js.map` is excluded because
// its name ends with ".map", not ".js". fs is injected for testing; defaults
// to the real module.
function collectJsFiles(rootDir, fs = require("node:fs")) {
  const out = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectJsFiles(full, fs));
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

module.exports = { collectJsFiles };
