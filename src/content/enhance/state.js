// src/content/enhance/state.js
// Tracks per-composer enhance metadata (cooldowns, last text, debounce timers).

const composerState = new WeakMap();

export function getComposerState(composer) {
  if (!composer) return null;
  let state = composerState.get(composer);
  if (!state) {
    state = {
      lastEvaluatedAt: 0,
      lastFireAt: 0,
      cooldownUntil: 0,
      debounceTimer: null,
      lastHash: "",
      lastSpans: [],
      lastSegments: [],
      resizeObserver: null,
      scrollHandlers: [],
      lastMap: null,
    };
    composerState.set(composer, state);
  }
  return state;
}

export function clearComposerState(composer) {
  if (!composer) return;
  const state = composerState.get(composer);
  if (state?.debounceTimer) {
    clearTimeout(state.debounceTimer);
  }
  if (state?.resizeObserver) {
    try {
      state.resizeObserver.disconnect();
    } catch {}
  }
  if (state?.scrollHandlers?.length) {
    try {
      state.scrollHandlers.forEach(({ target, handler }) =>
        target.removeEventListener("scroll", handler, true)
      );
    } catch {}
  }
  if (state) {
    state.scrollHandlers = [];
    state.lastMap = null;
  }
  composerState.delete(composer);
}

export function setCooldown() {
  /* cooldown disabled for Phase 2 */
}
