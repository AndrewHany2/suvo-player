const fs = require("node:fs");
const path = require("node:path");

const babel = require("@babel/core");

const distDir = path.join(__dirname, "dist");
const indexPath = path.join(distDir, "index.html");

// ── Vendor the playback engines as external scripts (kept OUT of the bundle) ──
// hls.js + mpegts.js (~816KB) are excluded from the TV bundle by metro.config's
// engine stub; the drivers load them from ./vendor/<file> on first play (see
// src/playback/drivers/engineLoader.js). Copy the UMD builds from node_modules
// into tv/dist/vendor/ so they resolve over file://. This runs before the
// obfuscator step, which skips the vendor/ dir (see scripts/collectJsFiles.js).
const vendorDir = path.join(distDir, "vendor");
fs.mkdirSync(vendorDir, { recursive: true });
for (const [from, to] of [
  ["hls.js/dist/hls.min.js", "hls.min.js"],
  ["mpegts.js/dist/mpegts.js", "mpegts.js"],
]) {
  const src = path.join(__dirname, "..", "node_modules", from);
  const dest = path.join(vendorDir, to);
  fs.copyFileSync(src, dest);
  console.log(`✓ Vendored ${to} (${(fs.statSync(dest).size / 1024).toFixed(0)}KB) → vendor/`);
}

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
  // Pin the syntax floor to the oldest Chromium we ship to (webOS ≈ 38). Metro
  // already downlevels most modern syntax, but its target is not this floor —
  // hand-picking 4 plugins leaves gaps (e.g. `**` exponentiation is Chromium
  // 52, class fields, etc.). preset-env with an explicit `chrome: '38'` target
  // pulls in EVERY syntax transform that floor needs, so nothing slips through.
  // No `useBuiltIns` → syntax transforms only, no core-js polyfills injected.
  presets: [["@babel/preset-env", { targets: { chrome: "38" }, bugfixes: true }]],
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

// ── Statically declare + warm the Aurora webfonts ───────────────────────────
// expo-font registers @font-face only at runtime, after the JS bundle mounts,
// with the default font-display:auto. On webOS the page loads from file:// and
// Chromium's "slow network" effective-connection-type heuristic then forces a
// fallback-first repaint (the "[Intervention] … Fallback font will be used"
// warnings) plus a late font swap once React mounts. We pre-empt both here, in
// the HTML the device parses first: declare each font statically in <head> with
// font-display:optional, then warm it with document.fonts.load() so the (local,
// bundled) .ttf is fetched at parse time and ready before first paint — the real
// font renders immediately, no swap, no warning. (App.js mirrors
// font-display:optional on the runtime face under __TV__ so the two @font-face
// rules agree rather than re-introducing `auto`.)
//
// NB: we deliberately do NOT use <link rel="preload" as="font" crossorigin>.
// On file:// the @font-face request is not made in CORS/anonymous mode, so a
// crossorigin preload never matches it ("credentials mode does not match" /
// "preloaded but not used") — it double-fetches and warns. document.fonts.load()
// triggers the face's own request, so it warms the exact resource the page uses.
const TV_FONTS = [
  { family: "SpaceGrotesk", dir: "assets/node_modules/@expo-google-fonts/space-grotesk/500Medium" },
  { family: "Inter", dir: "assets/node_modules/@expo-google-fonts/inter/400Regular" },
];
const faceRules = [];
const warmFamilies = [];
for (const { family, dir } of TV_FONTS) {
  let ttf = null;
  try {
    ttf = fs.readdirSync(path.join(distDir, dir)).find((f) => f.toLowerCase().endsWith(".ttf"));
  } catch {
    /* dir missing — fall through to the warning below */
  }
  if (!ttf) {
    console.warn(`⚠ Font asset for "${family}" not found under ${dir} — skipping @font-face`);
    continue;
  }
  const href = `./${dir}/${ttf}`;
  faceRules.push(`@font-face{font-family:"${family}";src:url("${href}") format("truetype");font-display:optional}`);
  warmFamilies.push(family);
}
if (faceRules.length) {
  // The face declares no font-weight, so it defaults to 400 — warm at 1em with
  // the default weight so the load request matches the registered face.
  const warm = warmFamilies.map((f) => `document.fonts.load('1em "${f}"')`).join(";");
  const fontHead =
    `<style id="tv-static-fonts">${faceRules.join("")}</style>` +
    `<script>try{${warm};}catch(e){}</script>`;
  // Inject right after the viewport meta so the faces exist and the warm-up runs
  // before the (large) CSS/JS — the fonts are in cache by first paint.
  html = html.replace(/(<meta name="viewport"[^>]*>)/, "$1" + fontHead);
  console.log(`✓ Statically declared + warmed ${faceRules.length} TV webfont(s) (font-display:optional)`);
}

// Patch CSSStyleSheet.insertRule to handle :focus-visible — webOS Chromium <86
// rejects this pseudo-class, causing hundreds of thrown errors per page load
// which burns CPU and prevents those style rules from applying (missing margins).
// We intercept at insertion time (Tamagui builds the selector dynamically, so
// a bundle string-replace can't catch it).
html = html.replace("</head>", `<script>
(function(){
  /* ── 1. insertRule patches ─────────────────────────────────────────────── */
  /* Gate the per-rule regex rewrites: skip them entirely on a Chromium new    */
  /* enough to support :focus-visible natively (>=86), which also implies      */
  /* native flex-gap (>=84). The selector() test itself needs >=83; any older  */
  /* engine — or a thrown check — falls through to applying the patches, so    */
  /* the unsupported-webOS path is unchanged. Avoids two .replace() passes on  */
  /* the hundreds of rules react-native-web inserts at mount on new targets.   */
  var nativeFocusVisible = false;
  try { nativeFocusVisible = !!(window.CSS && CSS.supports && CSS.supports('selector(:focus-visible)')); } catch(e) { nativeFocusVisible = false; }
  if (!nativeFocusVisible) {
    var orig = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function(rule, index) {
      try {
        var r = rule
          .replace(/:focus-visible/g, ":focus")
          .replace(/\bgap:([^;}"]+)/g, "column-gap:$1;row-gap:$1");
        return orig.call(this, r, index);
      } catch(e) { return 0; }
    };
  }
  window.__TV__ = true;

  /* ── 2. Flex-gap DOM polyfill ──────────────────────────────────────────── *
   * Tamagui caches CSS so insertRule may not fire for already-seen rules.   *
   * This polyfill detects whether column-gap works for flex at runtime and, *
   * if not, adds inline margins to children of every _gap-Npx container.   */
  // Resolve a flex container's gap (px) from, in order: the legacy Tamagui
  // _gap-Npx class, the inline style (the react-native-web primitives emit
  // style.gap — recognised but inert for flex on Chromium below 84), or the
  // computed row/column-gap. Returns null when there's no positive gap.
  function gapPx(el, cs) {
    var cn = el.className;
    if (typeof cn === 'string') { var m = cn.match(/_gap-([0-9]+)px/); if (m) return m[1] + 'px'; }
    var inl = el.style && (el.style.gap || el.style.columnGap || el.style.rowGap);
    if (inl) { var fi = parseFloat(inl); if (fi > 0) return fi + 'px'; }
    var g = cs.flexDirection.indexOf('col') !== -1 ? cs.rowGap : cs.columnGap;
    if (g && g !== 'normal') { var fc = parseFloat(g); if (fc > 0) return fc + 'px'; }
    return null;
  }
  function applyFlexGap(el) {
    if (!el || el.nodeType !== 1) return;
    var kids = el.children;
    /* Gap margins only ever land on the 2nd-and-later sibling, so a node with
       fewer than two children needs no getComputedStyle at all. This is the hot
       path: the O(*) subtree sweep (scanTree) and per-mutation focus/style
       changes hit mostly leaf nodes on a slow TV CPU, and getComputedStyle is
       the expensive call. A lone survivor is still cleared in case it kept a
       stale gap margin from when the container had more children. */
    if (!kids || kids.length < 2) {
      if (kids && kids.length === 1) {
        kids[0].style.marginLeft = '';
        kids[0].style.marginTop = '';
      }
      return;
    }
    var cs = getComputedStyle(el); // one read, reused by gapPx below
    if (cs.display.indexOf('flex') === -1) return; // grid gap works natively — leave it
    var v = gapPx(el, cs);
    if (!v) return;
    var col = cs.flexDirection.indexOf('col') !== -1;
    for (var i = 0; i < kids.length; i++) {
      kids[i].style.marginLeft = (!col && i > 0) ? v : '';
      kids[i].style.marginTop  = ( col && i > 0) ? v : '';
    }
  }

  function scanTree(root) {
    if (!root || root.nodeType !== 1) return;
    /* Try the node itself, then every candidate below it. applyFlexGap() no-ops
       unless the element is a real flex container with a positive gap, so it's
       safe to hand it extra elements. The '_gap-' (react-native-web) + inline
       '[style*=gap]' selectors MISS flex containers whose gap comes from a plain
       TV CSS class (.tvl-topbar, .tvl-det-hero-btns, .tvl-seasons-row, …) — on
       Chromium <84 those gaps don't render and were otherwise unpolyfilled — so
       also sweep the '.tvl-*' namespace that owns the 10-foot UI. */
    applyFlexGap(root);
    /* Universal sweep — EVERY element on EVERY TV page. Class/selector matching
       ('_gap-', inline, '.tvl-*') could only ever cover the containers we happen
       to name; a flex gap authored any other way (shared component, non-tvl
       class) would still collapse on Chromium <84. applyFlexGap() reads one
       computed style and returns immediately unless the element is a flex
       container with a positive gap, so the extra elements are cheap, and this
       only runs at all when the engine lacks native flex gap. */
    var all = root.getElementsByTagName('*');
    for (var i = 0; i < all.length; i++) applyFlexGap(all[i]);
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
        var mu = ms[i];
        if (mu.type === 'attributes') {
          /* A <dialog> opening (Accounts/Settings/confirm use showModal(), which
             flips the 'open' attribute with NO childList change) reveals content
             that was display:none while closed — and hidden content can't be
             gap-polyfilled reliably (computed gap is unavailable off the render
             tree on old Chromium). So RE-SCAN the whole subtree on 'open'. For a
             plain inline gap value change, recomputing the one container suffices. */
          if (mu.attributeName === 'open') scanTree(mu.target);
          else applyFlexGap(mu.target);
          continue;
        }
        /* childList: a container gained/lost children. Sibling margins depend on
           child index (first child gets none), so reapply the CONTAINER's gap
           (mu.target) — not just the added node — then scan any added subtrees
           for nested gap containers they bring in (RNW <Modal> portals appended
           to body, overlays, rails, re-rendered button rows). */
        applyFlexGap(mu.target);
        var nodes = mu.addedNodes;
        for (var j = 0; j < nodes.length; j++) scanTree(nodes[j]);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'open'] });
  });
})();
</script></head>`);

// Fix absolute paths to relative paths for LG TV
html = html.replaceAll('src="/_expo/', 'src="./_expo/');
html = html.replaceAll('href="/_expo/', 'href="./_expo/');
html = html.replaceAll('href="/favicon.ico"', 'href="./favicon.ico"');

// ── Strip redundant CSS preload hints ──────────────────────────────────────
// expo emits a `<link rel="preload" as="style">` paired with every stylesheet.
// On file:// (no network round-trip or connection setup) a preload buys zero
// parallelism over the stylesheet <link> itself — it's pure parse/lookup
// overhead and a double declaration. Drop the preloads; keep the stylesheets.
const preloadCount = (html.match(/<link rel="preload"[^>]*as="style"[^>]*>/g) || []).length;
html = html.replace(/<link rel="preload"[^>]*as="style"[^>]*>/g, "");
console.log(`✓ Stripped ${preloadCount} redundant CSS preload hint(s)`);

// ── Neutral boot splash ─────────────────────────────────────────────────────
// Centered spinner on the app background, injected INSIDE #root so it paints
// during bundle parse and is cleared automatically when React first renders
// into #root. Deliberately auth-agnostic: a neutral spinner only — never a
// main-nav skeleton that could flash a signed-in state before auth resolves.
// Pairs with the React authLoading splash so there's no visual jump. Uses
// explicit top/left/right/bottom (not `inset`, which is Chromium 87+).
const bootSplash =
  '<div id="tv-boot-splash" style="position:fixed;top:0;left:0;right:0;bottom:0;' +
  'display:flex;align-items:center;justify-content:center;background:#0A0E1A;z-index:2147483647">' +
  '<div style="width:48px;height:48px;border:4px solid #28324E;border-top-color:#6C5CE7;' +
  'border-radius:50%;animation:tvbootspin .8s linear infinite"></div></div>' +
  '<style>@keyframes tvbootspin{to{transform:rotate(360deg)}}</style>';
html = html.replace('<div id="root"></div>', '<div id="root">' + bootSplash + '</div>');

fs.writeFileSync(indexPath, html, "utf8");
console.log("✓ Patched index.html for LG TV");
