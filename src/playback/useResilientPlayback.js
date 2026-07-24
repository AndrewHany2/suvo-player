// @ts-check
/**
 * useResilientPlayback — the engine-agnostic host hook that wires a PlayerDriver
 * to the pure recoveryMachine.
 *
 * It owns what the pure reducer cannot: the React state, the retry timers
 * (SCHEDULE_RETRY -> setTimeout -> dispatch RETRY), executing effects against
 * the driver (RELOAD / SET_QUALITY_CAP / REFRESH_CREDENTIALS), offline/online
 * detection, and subscribing to driver events to feed the machine. It exposes a
 * small UI-facing surface for any player screen.
 *
 * This module must NEVER import expo-video or hls.js — only the driver it is
 * handed. The web player will reuse it with an hlsDriver.
 *
 * @typedef {import('./drivers/types.js').PlayerDriver} PlayerDriver
 * @typedef {import('./drivers/types.js').NormalizedError} NormalizedError
 */

import { useEffect, useReducer, useRef, useCallback, useMemo } from 'react';
import { initialState, reduce } from './recoveryMachine.js';

// Minimum spacing between PROGRESS dispatches (ms). Web/TV drivers emit
// onProgress on every 'timeupdate' (~4-6/sec); we collapse that to ~1 Hz to
// match the native 1s poll and stop the per-tick host re-render.
const PROGRESS_DISPATCH_MS = 900;

/**
 * Optionally resolve @react-native-community/netinfo if it is installed. The
 * dependency is not declared in package.json today, so we resolve it lazily and
 * fall back to a passed `isOnline` / no-op when it is absent. Wrapped so the
 * bundler never hard-fails on a missing module.
 *
 * @returns {null | { addEventListener: (cb: (s:any)=>void) => (()=>void) }}
 */
function resolveNetInfo() {
  try {
    const mod = require('@react-native-community/netinfo');
    return mod?.default ?? mod ?? null;
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} ResilientPlaybackApi
 * @property {string} status         - Machine state: idle|loading|playing|buffering|recovering|fatal.
 * @property {boolean} isRecovering  - True while reconnecting (show the badge).
 * @property {boolean} isFatal       - True when playback is dead (show error + Retry).
 * @property {string} [fatalReason]  - Reason from GO_FATAL ('GONE'|'AUTH_EXPIRED'|'UNPLAYABLE'), if any.
 * @property {string} [errorMessage] - Raw engine/provider error text, if any (for the fatal panel).
 * @property {number} [errorStatus]  - HTTP status parsed from the error, if any (e.g. 406).
 * @property {string} qualityCap     - Current quality cap value.
 * @property {() => void} retry      - Manual retry: clears fatal and reloads from saved position/edge.
 * @property {number} currentTime    - Last known playback position (seconds).
 * @property {number} duration       - Total duration (seconds); Infinity/NaN for live.
 */

/**
 * @param {Object} params
 * @param {PlayerDriver} params.driver           - The engine adapter (expoVideoDriver / hlsDriver).
 * @param {{uri: string, [k:string]: any}|null} params.source - Source descriptor to (re)load.
 * @param {boolean} [params.isLive=false]        - Live vs VOD (drives edge-resync vs resume).
 * @param {number}  [params.startTime=0]         - VOD resume position in seconds.
 * @param {string}  [params.manualCap]           - User-pinned quality ceiling.
 * @param {(reason: string) => void} [params.onFatal] - Called once when the machine goes fatal.
 * @param {() => (void|Promise<void>)} [params.refreshCredentials] - Refresh stream URL/creds on AUTH.
 * @param {boolean} [params.isOnline]            - Online signal used when NetInfo is unavailable.
 * @returns {ResilientPlaybackApi}
 */
export function useResilientPlayback({
  driver,
  source,
  isLive = false,
  startTime = 0,
  manualCap,
  onFatal,
  refreshCredentials,
  isOnline,
}) {
  const [machine, dispatch] = useReducer(
    (state, event) => reduce(state, event).state,
    undefined,
    () => initialState({ isLive, startTime, qualityCap: manualCap || 'auto', manualCap })
  );

  // We need the effects list too (the reducer above only returns state), so run
  // reduce again through a wrapper dispatch that also executes effects. Keep the
  // latest machine state and the driver in refs so callbacks stay stable.
  const machineRef = useRef(machine);
  machineRef.current = machine;
  const driverRef = useRef(driver);
  driverRef.current = driver;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const onFatalRef = useRef(onFatal);
  onFatalRef.current = onFatal;
  const refreshRef = useRef(refreshCredentials);
  refreshRef.current = refreshCredentials;

  const retryTimerRef = useRef(/** @type {any} */ (null));
  const fatalNotifiedRef = useRef(false);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  /**
   * Execute a single effect emitted by the pure reducer against the host/driver.
   * @param {{type:string, [k:string]:any}} effect
   */
  const runEffect = useCallback(
    (effect) => {
      const d = driverRef.current;
      const s = machineRef.current;
      switch (effect.type) {
        case 'SCHEDULE_RETRY': {
          clearRetryTimer();
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            send({ type: 'RETRY' });
          }, effect.delayMs);
          break;
        }
        case 'RELOAD': {
          const src = sourceRef.current;
          if (d && src) {
            const startAt = effect.toLiveEdge
              ? undefined
              : typeof effect.seekTo === 'number'
                ? effect.seekTo
                : 0;
            d.load(src, { isLive: s.isLive, startTime: startAt });
          }
          break;
        }
        case 'SET_QUALITY_CAP':
          d?.setQualityCap?.(effect.cap);
          break;
        case 'REFRESH_CREDENTIALS':
          try {
            const r = refreshRef.current?.();
            // If refresh returns a promise we don't await it here; the machine
            // already scheduled a retry which will pick up the refreshed source
            // (the screen updates `source`, mirrored into sourceRef).
            if (r && typeof r.then === 'function') r.catch(() => {});
          } catch {
            /* noop */
          }
          break;
        case 'GO_FATAL':
          // UI surfaces fatal via the machine state; notify the host once.
          if (!fatalNotifiedRef.current) {
            fatalNotifiedRef.current = true;
            try {
              onFatalRef.current?.(effect.reason);
            } catch {
              /* noop */
            }
          }
          break;
        case 'CANCEL_RETRY':
          // The stream recovered on its own — drop the pending retry timer so it
          // can't fire a stale RELOAD and bounce us into a reload loop.
          clearRetryTimer();
          break;
        case 'SHOW_RECONNECTING':
        case 'HIDE_RECONNECTING':
          // Reflected by machine state (recovering); no imperative work needed.
          break;
        default:
          break;
      }
    },
    // `send` is a forward reference (declared below) invoked lazily inside
    // setTimeout. It can't go in these deps — it's in the TDZ when this array is
    // evaluated — and it doesn't need to: send depends on this stable runEffect,
    // so its identity never changes. This breaks the send<->runEffect cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearRetryTimer]
  );

  // The real dispatch: run the pure reducer, commit state, then execute effects.
  const send = useCallback(
    /** @param {{type:string, [k:string]:any}} event */
    (event) => {
      const { state, effects } = reduce(machineRef.current, event);
      machineRef.current = state;
      dispatch(event); // commit to React state via the same reducer
      for (const effect of effects) runEffect(effect);
    },
    [runEffect]
  );

  // Keep fatalNotified in sync: clear it whenever we leave the fatal state so a
  // future fatal re-notifies.
  useEffect(() => {
    if (machine.state !== 'fatal') fatalNotifiedRef.current = false;
    // Defense in depth: once we're healthily playing, no retry should be
    // pending. The machine already emits CANCEL_RETRY on self-recovery; this
    // guarantees a stale timer can never survive into playback regardless of
    // which event drove the transition.
    if (machine.state === 'playing') clearRetryTimer();
  }, [machine.state, clearRetryTimer]);

  // ── Initial / source-change LOAD ────────────────────────────────────────────
  const sourceKey = source?.uri ?? null;
  useEffect(() => {
    if (!driver || !source) return;
    // Reset the machine for the new source and load it.
    send({ type: 'RESET' });
    send({ type: 'LOAD' });
    driver.load(source, { isLive, startTime });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // ── Driver event subscriptions ──────────────────────────────────────────────
  useEffect(() => {
    if (!driver) return undefined;
    const unsubs = [];

    unsubs.push(
      driver.onStatus((status) => {
        if (status?.state === 'playing') send({ type: 'PLAYING' });
        else if (status?.state === 'loading') send({ type: 'LOADED' });
        // 'error' is handled by onError so we can normalize the payload.
      })
    );
    // Throttle PROGRESS to ~1 Hz *only while steadily playing*. Web/TV drivers
    // bind onProgress to the media element's 'timeupdate' (fires ~4-6/sec), and
    // the PROGRESS-while-playing reducer branch allocates a fresh state every
    // call (savedTime advances), so an unthrottled feed forces a host re-render
    // 4-6x/sec during steady playback on the weak webOS/Tizen CPU. The native
    // driver already polls at 1s; this makes web/TV symmetric.
    // CRITICAL: only collapse ticks in the 'playing' state. While
    // recovering/buffering, an advancing PROGRESS is what proves the stream
    // came back and fires CANCEL_RETRY — dropping it would let a stale RELOAD
    // fire. Those states pass through immediately.
    let lastProgressAt = 0;
    unsubs.push(
      driver.onProgress((t) => {
        if (machineRef.current?.state === 'playing') {
          const now = Date.now();
          if (now - lastProgressAt < PROGRESS_DISPATCH_MS) return;
          lastProgressAt = now;
        }
        send({ type: 'PROGRESS', currentTime: t });
      })
    );
    unsubs.push(driver.onStall(() => send({ type: 'STALL' })));
    unsubs.push(driver.onError((err) => send({ type: 'ERROR', raw: err })));

    return () => {
      for (const u of unsubs) {
        try {
          u?.();
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver]);

  // ── Offline / online wiring ──────────────────────────────────────────────────
  const netInfo = useMemo(() => resolveNetInfo(), []);
  useEffect(() => {
    if (!netInfo?.addEventListener) return undefined;
    const unsub = netInfo.addEventListener((state) => {
      const online = state?.isConnected !== false && state?.isInternetReachable !== false;
      send({ type: online ? 'ONLINE' : 'OFFLINE' });
    });
    return () => {
      try {
        unsub?.();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netInfo]);

  // Fallback path: when NetInfo is absent, react to a passed isOnline boolean.
  const isOnlineRef = useRef(isOnline);
  useEffect(() => {
    if (netInfo) return; // NetInfo owns the signal when present.
    if (typeof isOnline !== 'boolean') return;
    if (isOnlineRef.current === isOnline) return;
    isOnlineRef.current = isOnline;
    send({ type: isOnline ? 'ONLINE' : 'OFFLINE' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, netInfo]);

  // ── Cleanup all timers on unmount ────────────────────────────────────────────
  useEffect(() => () => clearRetryTimer(), [clearRetryTimer]);

  // ── Public manual retry ──────────────────────────────────────────────────────
  const retry = useCallback(() => {
    clearRetryTimer();
    fatalNotifiedRef.current = false;
    // RESET clears fatal/attempts; LOAD + a fresh driver.load reloads from the
    // saved position (VOD) or live edge.
    const s = machineRef.current;
    send({ type: 'RESET' });
    send({ type: 'LOAD' });
    const d = driverRef.current;
    const src = sourceRef.current;
    if (d && src) {
      d.load(src, {
        isLive: s.isLive,
        startTime: s.isLive ? undefined : s.savedTime || startTime,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearRetryTimer]);

  return {
    status: machine.state,
    isRecovering: machine.state === 'recovering' || machine.state === 'buffering',
    isFatal: machine.state === 'fatal',
    // Fatal failure detail for the UI (classified reason + the raw
    // engine/provider message + parsed HTTP status). Null until GO_FATAL.
    fatalReason: machine.fatalError?.reason,
    errorMessage: machine.fatalError?.message,
    errorStatus: machine.fatalError?.httpStatus,
    qualityCap: machine.qualityCap,
    retry,
    currentTime: machine.savedTime,
    duration: driver ? driver.duration() : NaN,
  };
}

export default useResilientPlayback;
