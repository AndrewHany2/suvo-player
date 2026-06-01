const fs = require("fs");
const path = require("path");

const babel = require("@babel/core");

const distDir = path.join(__dirname, "dist");
const indexPath = path.join(distDir, "index.html");

// Find the main JS bundle
const staticJsDir = path.join(distDir, "_expo/static/js/web");
const files = fs.readdirSync(staticJsDir);
const mainBundle = files.find(
  (f) => f.startsWith("index-") && f.endsWith(".js"),
);

if (!mainBundle) {
  console.error("Could not find main bundle");
  process.exit(1);
}

const bundlePath = path.join(staticJsDir, mainBundle);

console.log(`Transpiling ${mainBundle} …`);

const code = fs.readFileSync(bundlePath, "utf8");

const result = babel.transformSync(code, {
  configFile: false,
  babelrc: false,
  plugins: [
    // Convert template literals to ES5 string concatenation
    [require("@babel/plugin-transform-template-literals"), { loose: true }],
    // Convert ?. optional chaining
    require("@babel/plugin-transform-optional-chaining"),
    // Convert ?? nullish coalescing
    require("@babel/plugin-transform-nullish-coalescing-operator"),
    // Convert &&=, ||=, ??= logical assignment operators
    require("@babel/plugin-transform-logical-assignment-operators"),
  ],
  // Preserve the existing source map comment if present
  sourceMaps: false,
  compact: true,
});

fs.writeFileSync(bundlePath, result.code, "utf8");
console.log("✓ Transpiled for older webOS Chromium");

// Patch index.html for LG TV
let html = fs.readFileSync(indexPath, "utf8");

// Add TV-specific meta tags
if (!html.includes("viewport-fit=cover")) {
  html = html.replace(
    '<meta name="viewport"',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"',
  );
}

// Set global TV flag
html = html.replace("</head>", "<script>window.__TV__ = true;</script></head>");

// Fix absolute paths to relative paths for LG TV
html = html.replaceAll('src="/_expo/', 'src="./_expo/');
html = html.replaceAll('href="/_expo/', 'href="./_expo/');
html = html.replaceAll('href="/favicon.ico"', 'href="./favicon.ico"');

fs.writeFileSync(indexPath, html, "utf8");
console.log("✓ Patched index.html for LG TV");
