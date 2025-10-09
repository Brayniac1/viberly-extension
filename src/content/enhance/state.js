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
  composerState.delete(composer);
}

export function setCooldown() {
  /* cooldown disabled for Phase 2 */
}
