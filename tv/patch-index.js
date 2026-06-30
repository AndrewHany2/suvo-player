const fs = require("node:fs");
const path = require("node:path");

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

// ── Make bundled asset URLs relative (fonts, images) ────────────────────────
// Expo emits asset URIs as absolute "/assets/…". On a webOS app (and the TV
// simulator) the page loads from file:///…/index.html, so "/assets/…" resolves
// to the filesystem root (file:///assets/…) and 404s — leaving fonts/images
// missing. The patched index.html already uses "./_expo/…"; mirror that here by
// stripping the leading slash so asset URLs resolve against the index.html dir.
const assetRefs = (result.code.match(/(["'`])\/assets\//g) || []).length;
result.code = result.code.replace(/(["'`])\/assets\//g, "$1assets/");

fs.writeFileSync(bundlePath, result.code, "utf8");
console.log("✓ Transpiled for older webOS Chromium");
console.log(`✓ Rewrote ${assetRefs} absolute /assets/ ref(s) to relative for file:// loading`);

// ── Inline CSS custom properties (var(--a-*)) to literal values ──────────────
// webOS/Tizen Chromium honours standalone var() (e.g. `background:var(--x)`) but
// DROPS the whole declaration when a var() sits inside a multi-value shorthand
// (e.g. `padding:24px var(--a-inset)`), collapsing every screen inset to 0. The
// source keeps the `--a-*` token layer for one-source-of-truth authoring; here
// we resolve them to literals at build time so the device never sees a var().
const cssDir = path.join(distDir, "_expo/static/css");
if (fs.existsSync(cssDir)) {
  const cssFiles = fs.readdirSync(cssDir).filter((f) => f.endsWith(".css"));
  // Build the --a-* token map from the :root block(s) across all CSS files.
  const tokens = {};
  for (const f of cssFiles) {
    const css = fs.readFileSync(path.join(cssDir, f), "utf8");
    const rootMatch = css.match(/:root\s*\{([^}]*)\}/g) || [];
    for (const block of rootMatch) {
      const decls = block.replace(/^:root\s*\{/, "").replace(/\}$/, "");
      for (const decl of decls.split(";")) {
        const m = decl.match(/^\s*(--a-[a-z0-9-]+)\s*:\s*(.+)\s*$/i);
        if (m) tokens[m[1]] = m[2].trim();
      }
    }
  }
  const tokenCount = Object.keys(tokens).length;
  let patchedFiles = 0;
  let replaced = 0;
  // Resolve var(--a-name) and var(--a-name, fallback) to the literal value.
  // Loop until stable in case a token value itself references another var().
  const resolve = (css) => {
    let prev;
    do {
      prev = css;
      css = css.replace(/var\(\s*(--a-[a-z0-9-]+)\s*(?:,[^)]*)?\)/gi, (full, name) => {
        if (tokens[name] != null) { replaced++; return tokens[name]; }
        return full;
      });
    } while (css !== prev);
    return css;
  };
  for (const f of cssFiles) {
    const p = path.join(cssDir, f);
    const css = fs.readFileSync(p, "utf8");
    if (!css.includes("var(--a-")) continue;
    const out = resolve(css);
    if (out !== css) { fs.writeFileSync(p, out, "utf8"); patchedFiles++; }
  }
  console.log(`✓ Inlined ${replaced} var(--a-*) refs (${tokenCount} tokens) across ${patchedFiles} CSS file(s) for older webOS Chromium`);
}

// Patch index.html for LG TV
let html = fs.readFileSync(indexPath, "utf8");

// Set viewport to 1280px design width — TV browser scales up to fill 1920px (1.5×)
html = html.replace(
  /<meta name="viewport"[^>]*>/,
  '<meta name="viewport" content="width=1280,initial-scale=1,viewport-fit=cover">',
);

// Patch CSSStyleSheet.insertRule to handle :focus-visible — webOS Chromium <86
// rejects this pseudo-class, causing hundreds of thrown errors per page load
// which burns CPU and prevents those style rules from applying (missing margins).
// We intercept at insertion time (Tamagui builds the selector dynamically, so
// a bundle string-replace can't catch it).
html = html.replace("</head>", `<script>
(function(){
  /* ── 1. insertRule patches ─────────────────────────────────────────────── */
  var orig = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function(rule, index) {
    try {
      var r = rule
        .replace(/:focus-visible/g, ":focus")
        .replace(/\bgap:([^;}"]+)/g, "column-gap:$1;row-gap:$1");
      return orig.call(this, r, index);
    } catch(e) { return 0; }
  };
  window.__TV__ = true;

  /* ── 2. Flex-gap DOM polyfill ──────────────────────────────────────────── *
   * Tamagui caches CSS so insertRule may not fire for already-seen rules.   *
   * This polyfill detects whether column-gap works for flex at runtime and, *
   * if not, adds inline margins to children of every _gap-Npx container.   */
  // Resolve a flex container's gap (px) from, in order: the legacy Tamagui
  // _gap-Npx class, the inline style (the react-native-web primitives emit
  // style.gap — recognised but inert for flex on Chromium below 84), or the
  // computed row/column-gap. Returns null when there's no positive gap.
  function gapPx(el) {
    var cn = el.className;
    if (typeof cn === 'string') { var m = cn.match(/_gap-([0-9]+)px/); if (m) return m[1] + 'px'; }
    var inl = el.style && (el.style.gap || el.style.columnGap || el.style.rowGap);
    if (inl) { var fi = parseFloat(inl); if (fi > 0) return fi + 'px'; }
    var cs0 = getComputedStyle(el);
    var g = cs0.flexDirection.indexOf('col') !== -1 ? cs0.rowGap : cs0.columnGap;
    if (g && g !== 'normal') { var fc = parseFloat(g); if (fc > 0) return fc + 'px'; }
    return null;
  }
  function applyFlexGap(el) {
    if (!el || el.nodeType !== 1) return;
    var cs = getComputedStyle(el);
    if (cs.display.indexOf('flex') === -1) return; // grid gap works natively — leave it
    var v = gapPx(el);
    if (!v) return;
    var col = cs.flexDirection.indexOf('col') !== -1;
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].style.marginLeft = (!col && i > 0) ? v : '';
      kids[i].style.marginTop  = ( col && i > 0) ? v : '';
    }
  }

  function scanTree(root) {
    if (!root || root.nodeType !== 1) return;
    var all = root.querySelectorAll('[class*="_gap-"],[style*="gap"]');
    for (var i = 0; i < all.length; i++) applyFlexGap(all[i]);
    var rs = root.getAttribute && root.getAttribute('style');
    if ((typeof root.className === 'string' && root.className.indexOf('_gap-') >= 0) ||
        (rs && rs.indexOf('gap') >= 0))
      applyFlexGap(root);
  }

  window.addEventListener('load', function() {
    /* Test whether column-gap actually works for flex on this Chromium */
    var probe = document.createElement('div');
    var c1    = document.createElement('div');
    var c2    = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:-999px;display:flex;column-gap:10px';
    c1.style.width = c2.style.width = '1px';
    probe.appendChild(c1); probe.appendChild(c2);
    document.body.appendChild(probe);
    var ok = Math.round(c2.getBoundingClientRect().left - c1.getBoundingClientRect().left) >= 10;
    document.body.removeChild(probe);
    if (ok) return; /* CSS gap/column-gap works — no DOM polyfill needed */

    scanTree(document.body);
    new MutationObserver(function(ms) {
      for (var i = 0; i < ms.length; i++) {
        var nodes = ms[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) scanTree(nodes[j]);
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
</script></head>`);

// Fix absolute paths to relative paths for LG TV
html = html.replaceAll('src="/_expo/', 'src="./_expo/');
html = html.replaceAll('href="/_expo/', 'href="./_expo/');
html = html.replaceAll('href="/favicon.ico"', 'href="./favicon.ico"');

fs.writeFileSync(indexPath, html, "utf8");
console.log("✓ Patched index.html for LG TV");
