// src/content/enhance/state.js
// Tracks per-composer enhance metadata (cooldowns, last text, debounce timers).

const composerState = new WeakMap();

export function getComposerState(composer) {
  if (!composer) return null;
  let state = composerState.get(composer);
  if (!state) {
    state = {
      resizeObserver: null,
      scrollHandlers: [],
      mutationObserver: null,
      lastText: "",
      improveScore: null,
      intentSegments: [],
      intentSpans: [],
      lastMap: null,
      hudIntentActive: false,
      postInputTimer: null,
      postInputBaseline: "",
      postInputAttempts: 0,
      intentSummary: null,
      intentConfidence: 0,
      intentMatchedText: "",
      intentMatchedOffset: -1,
      intentDebug: {},
      suggestion: null,
      suggestionCandidates: [],
      suggestionIndex: -1,
      suggestionHiddenUntil: 0,
      suggestionHistory: [],
      suggestionEvalToken: 0,
    };
    composerState.set(composer, state);
  }
  return state;
}

export function clearComposerState(composer) {
  if (!composer) return;
  const state = composerState.get(composer);
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
  if (state?.mutationObserver) {
    try {
      state.mutationObserver.disconnect();
    } catch {}
  }
  if (state?.postInputTimer != null) {
    clearTimeout(state.postInputTimer);
    state.postInputTimer = null;
  }
  if (state) {
    state.scrollHandlers = [];
    state.mutationObserver = null;
    state.lastText = "";
    state.improveScore = null;
    state.intentSegments = [];
    state.intentSpans = [];
    state.lastMap = null;
    state.hudIntentActive = false;
    state.postInputBaseline = "";
    state.postInputAttempts = 0;
    state.intentSummary = null;
    state.intentConfidence = 0;
    state.intentMatchedText = "";
    state.intentMatchedOffset = -1;
    state.suggestion = null;
    state.suggestionCandidates = [];
    state.suggestionIndex = -1;
    state.suggestionHiddenUntil = 0;
    state.suggestionHistory = [];
    state.suggestionEvalToken = 0;
  }
  composerState.delete(composer);
}

export function setCooldown() {
  /* cooldown disabled for Phase 2 */
}
