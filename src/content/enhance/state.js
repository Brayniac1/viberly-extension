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
      lastRawText: "",
      lastCaret: -1,
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
      suggestionCooldown: {
        active: false,
        reason: "",
        triggeredAt: 0,
        baselineText: "",
        baselineCaret: -1,
      sentenceStage: null,
    },
    typedSinceSuggestion: 0,
    wordsTypedSinceSuggestion: 0,
    suggestionTypingBuffer: "",
    suggestionDismissTimer: null,
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
  if (state?.suggestionDismissTimer) {
    clearTimeout(state.suggestionDismissTimer);
    state.suggestionDismissTimer = null;
  }
  if (state) {
    state.scrollHandlers = [];
    state.mutationObserver = null;
    state.lastText = "";
    state.lastRawText = "";
    state.lastCaret = -1;
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
    state.suggestionCooldown = {
      active: false,
      reason: "",
      triggeredAt: 0,
      baselineText: "",
      baselineCaret: -1,
      sentenceStage: null,
    };
    state.typedSinceSuggestion = 0;
    state.wordsTypedSinceSuggestion = 0;
    state.suggestionTypingBuffer = "";
  }
  composerState.delete(composer);
}

export function resetSuggestionTyping(state) {
  if (!state) return;
  state.typedSinceSuggestion = 0;
  state.wordsTypedSinceSuggestion = 0;
  state.suggestionTypingBuffer = "";
  if (state.suggestionCooldown) {
    state.suggestionCooldown.sentenceStage = null;
  }
}

export function activateSuggestionCooldown(state, reason = "", context = {}) {
  if (!state) return;
  const baselineText =
    typeof context.text === "string" ? context.text : state.lastRawText || "";
  const baselineCaret =
    typeof context.caret === "number"
      ? context.caret
      : typeof state.lastCaret === "number"
      ? state.lastCaret
      : -1;
  state.suggestionCooldown = {
    active: true,
    reason: reason || state.suggestionCooldown?.reason || "",
    triggeredAt: Date.now(),
    baselineText,
    baselineCaret,
    sentenceStage: null,
  };
  resetSuggestionTyping(state);
}

export function clearSuggestionCooldown(state, reason = "") {
  if (!state) return;
  state.suggestionCooldown = {
    active: false,
    reason,
    triggeredAt: 0,
    baselineText: "",
    baselineCaret: -1,
    sentenceStage: null,
  };
  resetSuggestionTyping(state);
}

export function isSuggestionCooldownActive(state) {
  return Boolean(state?.suggestionCooldown?.active);
}

export function noteSuggestionTyping(state, text = "") {
  if (!state) return { charCount: 0, wordCount: 0 };
  const payload = typeof text === "string" ? text : "";
  if (payload) {
    const limited = (state.suggestionTypingBuffer + payload).slice(-200);
    state.suggestionTypingBuffer = limited;
    const nonWhitespace = payload.replace(/\s+/g, "");
    state.typedSinceSuggestion += nonWhitespace.length;
    const words = limited
      .split(/\s+/)
      .map((part) => part.trim())
      .filter((part) => /[\p{L}\p{N}]/u.test(part));
    state.wordsTypedSinceSuggestion = words.length;
  }
  return {
    charCount: state.typedSinceSuggestion,
    wordCount: state.wordsTypedSinceSuggestion,
  };
}

export function getSuggestionSentenceStage(state) {
  return state?.suggestionCooldown?.sentenceStage || null;
}

export function setSuggestionSentenceStage(state, stage) {
  if (!state || !state.suggestionCooldown) return;
  state.suggestionCooldown.sentenceStage = stage;
}
