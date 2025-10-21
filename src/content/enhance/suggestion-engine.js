// src/content/enhance/suggestion-engine.js
// Coordinates guard fetching and scoring to produce inline suggestions.

import {
  getGuardCache,
  recordGuardAcceptance,
  recordGuardRejection,
  recordGuardShown,
} from "./guard-cache.js";
import {
  deriveQueryFeatures,
  rankGuardSuggestions,
} from "./suggestion-matcher.js";
import {
  isSuggestionCooldownActive,
  resetSuggestionTyping,
} from "./state.js";

const SUGGESTION_DEBUG =
  typeof window !== "undefined" && Boolean(window.VG_DEBUG_SUGGESTIONS);

function getSuggestionLogBuffer() {
  if (!SUGGESTION_DEBUG || typeof window === "undefined") return null;
  const root = (window.__VG = window.__VG || {});
  if (!Array.isArray(root.__VG_SUGGEST_LOG__)) {
    root.__VG_SUGGEST_LOG__ = [];
  }
  return root.__VG_SUGGEST_LOG__;
}

function suggestionLog(label, payload) {
  if (!SUGGESTION_DEBUG) return;
  const buffer = getSuggestionLogBuffer();
  if (buffer) {
    buffer.push({
      ts: Date.now(),
      label,
      payload,
    });
    const MAX_ENTRIES = 200;
    if (buffer.length > MAX_ENTRIES) {
      buffer.splice(0, buffer.length - MAX_ENTRIES);
    }
  }
  try {
    console.log(`[VG][suggestion] ${label}`, payload);
  } catch {}
}

const DISPLAY_THRESHOLD = 0.28;
const MIN_CONFIDENCE = 0.48;
const MAX_CANDIDATES = 5;

let evalSeq = 0;

function flattenConstraintValues(constraints) {
  if (!constraints || typeof constraints !== "object") return [];
  const values = [];
  for (const key of Object.keys(constraints)) {
    const value = constraints[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (typeof item === "string") values.push(item);
      });
    } else if (typeof value === "string") {
      values.push(value);
    }
  }
  return values;
}

function buildLabelText(summary) {
  if (!summary) return "";
  const parts = [];
  if (summary.intent) parts.push(summary.intent);
  if (summary.object) parts.push(summary.object);
  else if (summary.topic) parts.push(summary.topic);
  if (Array.isArray(summary.components) && summary.components.length) {
    parts.push(summary.components.slice(0, 3).join(" "));
  }
  return parts.join(" ").trim();
}

function clearSuggestionState(state) {
  state.suggestion = null;
  state.suggestionCandidates = [];
  state.suggestionIndex = -1;
  resetSuggestionTyping(state);
}

export async function refreshSuggestion({ composer, state, text }) {
  const summary = state.intentSummary || null;
  const segments = Array.isArray(state.intentSegments)
    ? state.intentSegments
    : [];
  const confidence = typeof state.intentConfidence === "number"
    ? state.intentConfidence
    : summary?.confidence || 0;

  if (state?.intentDebug && typeof state.intentDebug === "object") {
    state.intentDebug.lastRefresh = {
      timestamp: Date.now(),
      segments: segments.length,
      confidence,
    };
  }

  if (state.suggestionHiddenUntil && Date.now() < state.suggestionHiddenUntil) {
    clearSuggestionState(state);
    return null;
  }

  if (isSuggestionCooldownActive(state)) {
    clearSuggestionState(state);
    return null;
  }

  const intentUsable = segments.length > 0 && confidence >= MIN_CONFIDENCE;

  let labelText = buildLabelText(summary);
  let tailText =
    state.intentMatchedText ||
    (segments.length ? segments[0].text || "" : "");
  let forceFallback = false;

  if (!intentUsable || (!labelText && !tailText)) {
    forceFallback = true;
  }

  const queryTags = flattenConstraintValues(summary?.constraints);

  let query = deriveQueryFeatures({
    labelText,
    tailText,
    tags: queryTags,
  });

  const hasQueryTokens =
    (query.significantLabelTokens?.length || 0) +
      (query.significantTailTokens?.length || 0) +
      (query.tagTokens?.length || 0) >
    0;

  if (!hasQueryTokens || forceFallback) {
    const fallbackText =
      typeof text === "string" && text.trim().length
        ? text
        : state.lastRawText || "";
    const fallbackLabel = fallbackText.slice(0, 240);
    query = {
      ...deriveQueryFeatures({
        labelText: fallbackLabel,
        tailText: "",
        tags: [],
      }),
      isFallback: true,
      fallbackSource: "raw-text",
    };
  }
  if (state?.intentDebug) {
    state.intentDebug.lastRefresh.query = {
      labelText,
      tailText,
      tags: queryTags,
    };
  }
  suggestionLog("query", {
    labelText,
    tailText,
    tags: queryTags,
    confidence,
  });

  const evalToken = ++evalSeq;
  state.suggestionEvalToken = evalToken;

  const guards = await getGuardCache();
  if (state.suggestionEvalToken !== evalToken) {
    return state.suggestion;
  }

  if (!guards.length) {
    if (state?.intentDebug) {
      state.intentDebug.lastRefresh.reason = "no-guards";
    }
    clearSuggestionState(state);
    return null;
  }

  const ranked = rankGuardSuggestions({ guards, query });
  suggestionLog("ranked", {
    top: ranked.slice(0, 5).map((item) => ({
      id: item.guard.id,
      kind: item.guard.kind,
      score: Number(item.score.toFixed(3)),
      title: item.guard.title,
    })),
  });
  const filtered = ranked
    .filter((item) => item.score >= DISPLAY_THRESHOLD)
    .slice(0, MAX_CANDIDATES);

  if (!filtered.length) {
    if (state?.intentDebug) {
      state.intentDebug.lastRefresh.reason = "no-filtered";
      state.intentDebug.lastRefresh.top = ranked.slice(0, 3).map((item) => ({
        id: item.guard.id,
        title: item.guard.title,
        score: Number(item.score.toFixed(3)),
      }));
    }
    suggestionLog("filtered-empty", {
      threshold: DISPLAY_THRESHOLD,
      top: ranked.slice(0, 3).map((item) => ({
        id: item.guard.id,
        kind: item.guard.kind,
        score: Number(item.score.toFixed(3)),
        title: item.guard.title,
      })),
    });
    clearSuggestionState(state);
    return null;
  }

  state.suggestionCandidates = filtered;
  state.suggestionIndex = 0;

  const active = filtered[0];
  state.suggestion = {
    guard: active.guard,
    preview: active.guard.preview,
    score: active.score,
    breakdown: active.breakdown,
    query,
  };
  resetSuggestionTyping(state);

  recordGuardShown(active.guard.id);
  suggestionLog("suggestion", {
    id: active.guard.id,
    kind: active.guard.kind,
    score: Number(active.score.toFixed(3)),
    preview: active.guard.preview,
  });
  return state.suggestion;
}

export function cycleSuggestion(state, direction = 1) {
  if (!state || !Array.isArray(state.suggestionCandidates)) return null;
  const total = state.suggestionCandidates.length;
  if (!total) return null;
  const nextIndex = (state.suggestionIndex + direction + total) % total;
  state.suggestionIndex = nextIndex;

  const active = state.suggestionCandidates[nextIndex];
  if (!active) return null;

  state.suggestion = {
    guard: active.guard,
    preview: active.guard.preview,
    score: active.score,
    breakdown: active.breakdown,
    query: active.query || null,
  };
  resetSuggestionTyping(state);
  recordGuardShown(active.guard.id);
  return state.suggestion;
}

export function markSuggestionAccepted(state) {
  if (!state?.suggestion?.guard?.id) return;
  recordGuardAcceptance(state.suggestion.guard.id);
}

export function markSuggestionDismissed(state) {
  if (!state?.suggestion?.guard?.id) return;
  recordGuardRejection(state.suggestion.guard.id);
}
