// Lightweight, dependency-free observability layer for the 6-platform app.
//
// It deliberately does NOT bundle a third-party crash SaaS (the app avoids such
// deps). Instead it normalizes events, keeps a bounded in-memory ring buffer for
// on-device retrieval/export, forwards to a pluggable sink, and always logs a
// structured line so failures are visible in dev / Electron devtools / adb
// logcat even with no remote sink. Point setSink() at Sentry, a Supabase table,
// or any transport later WITHOUT touching a single call site.
//
// Wired to:
//   - App-level <ErrorBoundary> (React render crashes) — src/components/ErrorBoundary.jsx
//   - global JS handlers (installGlobalHandlers, below)
//   - the resilient-playback onFatal seam (reportFatalPlayback) in the 3 hosts

import { Platform } from "react-native";
import { pushCapped, normalizeError, RING_MAX } from "./observabilityCore.js";

const ring = [];
let sink = null;
let installed = false;

/** Replace the default sink (console + ring). Pass a function; null resets. */
export function setSink(fn) {
  sink = typeof fn === "function" ? fn : null;
}

/** @returns {Array<object>} a shallow copy of recent events (oldest first). */
export function recentEvents() {
  return ring.slice();
}

function emit(level, kind, data) {
  const event = { level, kind, platform: Platform.OS, ...data };
  pushCapped(ring, event, RING_MAX);
  // Structured, always-on visibility. Never let logging throw.
  try {
    (level === "warn" ? console.warn : console.error)(`[obs] ${level}/${kind}`, event);
  } catch { /* noop */ }
  // A remote sink must never break the app.
  try { sink?.(event); } catch { /* noop */ }
  return event;
}

/** Report a caught/global JS error. `context` is merged into the event. */
export function reportError(error, context = {}) {
  return emit("error", context.kind || "js", { error: normalizeError(error), ...context });
}

/**
 * Report a fatal playback failure — the signal the recovery machine already
 * computes (GONE / AUTH_EXPIRED / …) and previously discarded.
 * @param {{ reason?: string, isLive?: boolean, streamId?: any }} context
 */
export function reportFatalPlayback(context = {}) {
  return emit("fatal", "playback", { ...context });
}

/**
 * Install process-wide handlers so an uncaught error/rejection is captured
 * instead of vanishing. Idempotent and safe on every platform: it feature-
 * detects each host's globals (RN ErrorUtils, web/Electron window events).
 */
export function installGlobalHandlers() {
  if (installed) return;
  installed = true;
  const g = /** @type {any} */ (globalThis);

  // React Native (iOS/Android): chain, don't replace, the existing handler so
  // the red-box / crash behavior is preserved.
  if (g.ErrorUtils && typeof g.ErrorUtils.getGlobalHandler === "function") {
    const prev = g.ErrorUtils.getGlobalHandler();
    g.ErrorUtils.setGlobalHandler((error, isFatal) => {
      reportError(error, { source: "globalHandler", isFatal: !!isFatal });
      if (typeof prev === "function") prev(error, isFatal);
    });
  }

  // Web / Electron renderer / TV.
  if (typeof g.addEventListener === "function") {
    g.addEventListener("error", (ev) => {
      reportError(ev?.error ?? ev?.message ?? "window error", { source: "window.onerror" });
    });
    g.addEventListener("unhandledrejection", (ev) => {
      reportError(ev?.reason ?? "unhandledrejection", { source: "unhandledrejection" });
    });
  }
}
