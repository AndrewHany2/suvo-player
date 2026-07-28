// TV-build stand-in for hls.js / mpegts.js.
//
// The TV build (EXPO_PUBLIC_TV=1) resolves those packages HERE via
// metro.config.js, so the ~816KB of engine code stays OUT of the single-bundle
// cold-start parse on the weak webOS/Tizen JS engine. The real engines are then
// loaded from vendored <script> tags on first play (see engineLoader.js), which
// set globalThis.Hls / globalThis.mpegts.
//
// CommonJS `module.exports = null` (not `export default null`): so a literal
// `require('hls.js')` in engineLoader resolves cleanly to `null` on TV — the
// loader then falls through to the vendored-script path. Web/Electron builds
// leave EXPO_PUBLIC_TV unset and bundle the real engines unchanged.
module.exports = null;
