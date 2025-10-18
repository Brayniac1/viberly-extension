// src/content/enhance/index.js
// Entry point for the Enhance underline skeleton (Phase 2 baseline) – rewritten
// to render markers directly from the latest composer snapshot.

import { ENH_CFG, ENH_ROOT_FLAG, LOG_PREFIX } from "./config.js";
import { mountHighlightHost } from "./highlight-dom.js";
import { mountHoverModal } from "./hover-modal.js";
import { initComposerWatch } from "./composer-watch.js";
import { shouldTrigger } from "./detect-intent.js";
import { readComposer } from "./read-composer.js";
import { extractSpans } from "./extract-spans.js";
import {
  activateSuggestionCooldown,
  clearComposerState,
  clearSuggestionCooldown,
  getComposerState,
  getSuggestionSentenceStage,
  isSuggestionCooldownActive,
  noteSuggestionTyping,
  setSuggestionSentenceStage,
} from "./state.js";
import {
  updateMarkers,
  clearMarkers,
  isModalActiveForComposer,
  getMarkerComposerId,
} from "./markers.js";
import {
  ensurePromptSuggestionUI,
  updatePromptSuggestionUI,
  clearPromptSuggestionUI,
} from "./prompt-suggestion-ui.js";
import { refreshSuggestion } from "./suggestion-engine.js";

const DEVTOOLS_KEY = "__VIB_ENHANCE_DEVTOOLS__";
const INTENT_DEBUG =
  typeof window !== "undefined" && Boolean(window.VG_INTENT_DEBUG);
function getHudComposerId(composer) {
  if (!composer) return "";
  return getMarkerComposerId(composer) || "";
}

function emitHudIntentState(composer, state, active) {
  if (!state) return;
  const prev = state.hudIntentActive || false;
  if (prev === active) return;
  state.hudIntentActive = active;
  const id = getHudComposerId(composer);
  try {
    if (INTENT_DEBUG) {
      console.debug("[VG][intent] hudIntentActive", {
        composerId: id,
        active,
        segments: Array.isArray(state.intentSegments)
          ? state.intentSegments.length
          : 0,
      });
    }
  } catch {}
  try {
    window.postMessage(
      {
        source: "VG",
        type: "HUD_INTENT_STATE",
        active,
        cmp: id,
      },
      "*"
    );
  } catch {}
}

function computeImproveScore(text) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  const rand = (hash % 1000) / 999;
  const length = clean.length;
  const lengthFactor = Math.max(0, Math.min(1, 220 / (length + 80)));
  const mix = Math.min(1, rand * 0.35 + lengthFactor * 0.65);
  const value = Math.round(67 + mix * 67);
  return Math.max(67, Math.min(134, value));
}

const SENTENCE_END_RE = /[.!?]/;
const SENTENCE_TRAILING_RE = /["')\]]/;

function isHistoryInputType(type = "") {
  return type === "historyUndo" || type === "historyRedo";
}

function isPasteInputType(type = "") {
  return /^insertFromPaste/.test(type);
}

function isParagraphInputType(type = "") {
  return type === "insertParagraph" || type === "insertLineBreak";
}

function extractInsertedText(previous = "", next = "") {
  if (typeof previous !== "string" || typeof next !== "string") return "";
  if (!next) return "";
  let start = 0;
  const minLen = Math.min(previous.length, next.length);
  while (start < minLen && previous[start] === next[start]) {
    start += 1;
  }
  let endPrev = previous.length - 1;
  let endNext = next.length - 1;
  while (endPrev >= start && endNext >= start && previous[endPrev] === next[endNext]) {
    endPrev -= 1;
    endNext -= 1;
  }
  return next.slice(start, endNext + 1);
}

function getComposerCaretOffset(composer) {
  if (!composer) return -1;
  if (
    "selectionStart" in composer &&
    typeof composer.selectionStart === "number"
  ) {
    try {
      return composer.selectionStart;
    } catch {
      return -1;
    }
  }
  try {
    const doc = composer.ownerDocument || document;
    const sel = doc.getSelection?.();
    if (!sel || sel.rangeCount === 0) return -1;
    const range = sel.getRangeAt(0);
    if (!composer.contains(range.startContainer)) return -1;
    const preRange = range.cloneRange();
    preRange.selectNodeContents(composer);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  } catch {
    return -1;
  }
}

function advanceSentenceStageForCooldown(state, text = "") {
  if (!state || !text || !isSuggestionCooldownActive(state)) return false;
  let stage = getSuggestionSentenceStage(state);
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") {
      stage = null;
      continue;
    }
    const isSentenceEnd = SENTENCE_END_RE.test(char);
    if (!stage) {
      if (isSentenceEnd) {
        stage = "punctuation";
      }
      continue;
    }
    if (stage === "punctuation") {
      if (isSentenceEnd) {
        stage = "punctuation";
        continue;
      }
      if (SENTENCE_TRAILING_RE.test(char)) {
        continue;
      }
      if (/\s/.test(char)) {
        stage = "afterSpace";
        continue;
      }
      stage = null;
      continue;
    }
    if (stage === "afterSpace") {
      if (/\s/.test(char)) {
        continue;
      }
      if (isSentenceEnd) {
        stage = "punctuation";
        continue;
      }
      setSuggestionSentenceStage(state, null);
      return true;
    }
  }
  setSuggestionSentenceStage(state, stage || null);
  return false;
}

function normalizeSegmentBounds(segment, textLength) {
  const segText = String(segment?.text || "");
  const start =
    typeof segment?.start === "number"
      ? Math.max(0, Math.min(textLength, segment.start))
      : Math.max(
          0,
          textLength ? textLength - segText.length : 0
        );
  const end =
    typeof segment?.end === "number"
      ? Math.max(start, Math.min(textLength, segment.end))
      : Math.min(textLength, start + segText.length);
  return {
    text: segText || "",
    start,
    end,
  };
}

function deriveIntentSnapshot(text) {
  const normalized = String(text || "");
  if (!normalized.trim()) {
    return {
      segments: [],
      summary: null,
      confidence: 0,
      matchedText: "",
      matchedOffset: -1,
    };
  }
  const result = shouldTrigger({
    text: normalized,
    now: Date.now(),
    lastFireAt: 0,
  });
  if (!result?.trigger) {
    return {
      segments: [],
      summary: null,
      confidence: 0,
      matchedText: result?.matchedPhrase || "",
      matchedOffset: typeof result?.matchedOffset === "number" ? result.matchedOffset : -1,
    };
  }

  let segments = [];
  if (Array.isArray(result.matchedSegments) && result.matchedSegments.length) {
    segments = result.matchedSegments.map((seg) =>
      normalizeSegmentBounds(seg, normalized.length)
    );
  } else if (result.matchedPhrase) {
    const fallbackStart = Math.max(0, result.matchedOffset ?? 0);
    const fallbackText = result.matchedPhrase.slice(0, 240);
    segments = [
      normalizeSegmentBounds(
        {
          text: fallbackText,
          start: fallbackStart,
          end: fallbackStart + fallbackText.length,
        },
        normalized.length
      ),
    ];
  }
  segments.sort((a, b) => a.start - b.start);
  return {
    segments,
    summary: result.intentSummary || null,
    confidence: result.intentSummary?.confidence || 0,
    matchedText: result.matchedPhrase || (segments[0]?.text || ""),
    matchedOffset:
      typeof result.matchedOffset === "number" ? result.matchedOffset : -1,
  };
}

function buildSpanList({ text, segments }) {
  if (!segments?.length) return [];
  const maxLength = text.length;
  const spans = [];
  for (const seg of segments) {
    const segText = seg.text || text.slice(seg.start, seg.end);
    const spanSet = extractSpans({
      text,
      matchedPhrase: segText,
      matchedOffset: seg.start,
      maxLength,
    });
    if (Array.isArray(spanSet) && spanSet.length) {
      spans.push(...spanSet);
    }
  }
  return spans;
}

function deriveConversationId() {
  try {
    const host = typeof location?.hostname === "string" ? location.hostname : "";
    const path =
      typeof location?.pathname === "string" && location.pathname
        ? location.pathname
        : "/";
    if (!host) return null;
    return `${host}${path ? `:${path}` : ""}`;
  } catch {
    return null;
  }
}

function applyIntentToComposer({ composer, text, map, segments, state }) {
  if (!composer || !state) return;
  const spans = buildSpanList({ text, segments });
  state.intentSegments = segments;
  state.intentSpans = spans;
  state.lastMap = map;
  const trimmed = text.trim();
  state.lastRawText = text;
  state.lastText = trimmed;
  state.improveScore = spans.length ? computeImproveScore(trimmed) : null;
  const composerId = getMarkerComposerId(composer);
  state.composerId = composerId;
  const conversationId = deriveConversationId();
  state.conversationId = conversationId;

  updateMarkers({
    composer,
    text,
    spans,
    map,
    segments,
    improveScore: state.improveScore,
    rawText: trimmed,
  });

  emitHudIntentState(composer, state, spans.length > 0);

  try {
    const root = (window.__VG = window.__VG || {});
    const tracker =
      root.intentTracker ||
      {
        cache: new WeakMap(),
        last: null,
        lastSentKey: null,
        lastSentAt: 0,
      };
    root.intentTracker = tracker;
    if (!tracker.cache) tracker.cache = new WeakMap();
    if (typeof tracker.lastSentKey === "undefined") tracker.lastSentKey = null;
    if (typeof tracker.lastSentAt !== "number") tracker.lastSentAt = 0;
    const isRich =
      !!composer?.isContentEditable ||
      composer?.getAttribute?.("contenteditable") === "true";
    const clonedSegments = Array.isArray(segments)
      ? segments.map((seg) => ({
          text: seg?.text ?? "",
          start: typeof seg?.start === "number" ? seg.start : 0,
          end: typeof seg?.end === "number" ? seg.end : 0,
        }))
      : [];
    const record = {
      composer,
      text,
      trimmedText: trimmed,
      segments: clonedSegments,
      spans,
      map,
      isRichText: isRich,
      updatedAt: Date.now(),
      composerId,
      conversationId,
    };
    tracker.cache.set(composer, record);
    tracker.last = record;
  } catch (err) {
      if (INTENT_DEBUG) {
        console.debug(`${LOG_PREFIX} intent tracker update failed`, err);
      }
  }
}

function updateComposerIntent(composer) {
  if (!composer) return;
  const state = getComposerState(composer);
  if (!state) return;
  const { text, map } = readComposer(composer);
  const snapshot = deriveIntentSnapshot(text);
  const segments = snapshot.segments;
  applyIntentToComposer({
    composer,
    text,
    map,
    segments,
    state,
  });
  state.intentSummary = snapshot.summary;
  state.intentConfidence = snapshot.confidence;
  state.intentMatchedText = snapshot.matchedText;
  state.intentMatchedOffset = snapshot.matchedOffset;
  if (INTENT_DEBUG) {
    state.intentDebug = {
      summary: snapshot.summary,
      confidence: snapshot.confidence,
      matchedText: snapshot.matchedText,
      matchedOffset: snapshot.matchedOffset,
    };
      if (INTENT_DEBUG) {
        console.debug("[VG][intent] snapshot", state.intentDebug);
      }
  }

  refreshSuggestion({ composer, state, text })
    .then(() => {
      updatePromptSuggestionUI(composer);
    })
    .catch((err) => {
      if (INTENT_DEBUG) {
        console.debug(`${LOG_PREFIX} suggestion refresh failed`, err);
      }
    });
}

function redrawComposerIntent(composer) {
  if (!composer) return;
  const state = getComposerState(composer);
  if (!state) return;
  const segments = state.intentSegments || [];
  const { text, map } = readComposer(composer);
  applyIntentToComposer({ composer, text, map, segments, state });
}

function ensureResizeObserver(composer) {
  if (!composer) return;
  const state = getComposerState(composer);
  if (!state || state.resizeObserver) return;
  if (typeof ResizeObserver !== "function") return;
  try {
    const ro = new ResizeObserver(() => redrawComposerIntent(composer));
    ro.observe(composer);
    state.resizeObserver = ro;
  } catch (err) {
    if (INTENT_DEBUG) {
      console.debug(`${LOG_PREFIX} resize observer failed`, err);
    }
  }
}

function ensureScrollObservers(composer) {
  if (!composer) return;
  const state = getComposerState(composer);
  if (!state) return;
  const handlers = state.scrollHandlers || [];
  if (handlers.length) return;

  const roots = new Set();
  let node = composer;
  while (node) {
    if (node === document || node === document.body) break;
    const style = node instanceof Element ? getComputedStyle(node) : null;
    if (style) {
      const overflowY = style.overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight
      ) {
        roots.add(node);
      }
    }
    node = node.parentNode || node.host || node.ownerDocument?.defaultView;
    if (node === document) break;
  }
  roots.add(window);
  const handler = () => redrawComposerIntent(composer);
  roots.forEach((target) => {
    try {
      target.addEventListener("scroll", handler, { passive: true, capture: true });
      handlers.push({ target, handler });
    } catch {}
  });
  state.scrollHandlers = handlers;
}

function ensureMutationObserver(composer) {
  if (!composer) return;
  if ("value" in composer) return; // textarea/input – simple content
  const state = getComposerState(composer);
  if (!state || state.mutationObserver) return;
  try {
    const observer = new MutationObserver(() => updateComposerIntent(composer));
    observer.observe(composer, {
      childList: true,
      subtree: false,
    });
    state.mutationObserver = observer;
  } catch (err) {
    if (INTENT_DEBUG) {
      console.debug(`${LOG_PREFIX} mutation observer failed`, err);
    }
  }
}

function schedulePostInputRefresh(composer, previousText) {
  if (!composer) return;
  const state = getComposerState(composer);
  if (!state) return;
  if (state.postInputTimer != null) {
    clearTimeout(state.postInputTimer);
    state.postInputTimer = null;
  }
  state.postInputBaseline = previousText;
  state.postInputAttempts = 0;

  const runCheck = (delay) => {
    state.postInputTimer = setTimeout(() => {
      const currentState = getComposerState(composer);
      if (!currentState) return;
      currentState.postInputTimer = null;
      try {
        const { text } = readComposer(composer);
        const trimmedNext = text.trim();
        if (trimmedNext !== currentState.postInputBaseline) {
          updateComposerIntent(composer);
          currentState.postInputBaseline = trimmedNext;
          currentState.postInputAttempts = 0;
          return;
        }
        if (currentState.postInputAttempts < 1) {
          currentState.postInputAttempts += 1;
          runCheck(64);
        }
      } catch (err) {
        if (INTENT_DEBUG) {
          console.debug(`${LOG_PREFIX} post-input refresh failed`, err);
        }
      }
    }, delay);
  };

  runCheck(32);
}

(function initEnhanceSkeleton() {
  if (window[ENH_ROOT_FLAG]) {
    if (INTENT_DEBUG) {
      console.info(`${LOG_PREFIX} already active`);
    }
    return;
  }
  window[ENH_ROOT_FLAG] = true;

  const highlight = mountHighlightHost();
  const hover = mountHoverModal();

  const watcher = initComposerWatch({
    onComposerFound: (composer) => {
      ensurePromptSuggestionUI(composer);
      updateComposerIntent(composer);
      ensureResizeObserver(composer);
      ensureScrollObservers(composer);
      ensureMutationObserver(composer);
      updatePromptSuggestionUI(composer);
    },
    onInput: (composer, event) => {
      const state = getComposerState(composer);
      if (!state) return;
      const previousTrimmed = state.lastText || "";
      const previousRawText = state.lastRawText || "";
      const previousCaret =
        typeof state.lastCaret === "number" ? state.lastCaret : -1;
      const { text: currentRawRaw = "" } = readComposer(composer);
      const currentRawText = normalizeVisibleText(currentRawRaw);
      const previousNormalized = normalizeVisibleText(previousRawText);
      const currentCaret = getComposerCaretOffset(composer);
      const hadSuggestion = Boolean(state.suggestion);
      const cooldownActiveBefore = isSuggestionCooldownActive(state);
      const inputType = event?.inputType || "";
      const undoRedo = isHistoryInputType(inputType);
      const pasteEvent = isPasteInputType(inputType);
      const paragraphEvent = isParagraphInputType(inputType);
      const composing = Boolean(event?.isComposing);
      let insertedText = "";

      const deletionEvent =
        !undoRedo &&
        !pasteEvent &&
        !composing &&
        ((typeof inputType === "string" && inputType.startsWith("delete")) ||
          currentRawText.length < previousNormalized.length);

      const becameEmpty =
        !undoRedo &&
        !pasteEvent &&
        !composing &&
        !currentRawText.length;

      if ((deletionEvent || becameEmpty) && hadSuggestion) {
        state.suggestion = null;
        state.suggestionCandidates = [];
        state.suggestionIndex = -1;
        state.suggestionEvalToken = 0;
        state.suggestionHiddenUntil = Date.now() + 400;
        clearPromptSuggestionUI(composer);
      }

      if ((hadSuggestion || cooldownActiveBefore) && !undoRedo && !composing) {
        insertedText = extractInsertedText(previousRawText, currentRawText);

        if (hadSuggestion && !cooldownActiveBefore && !pasteEvent) {
          const { charCount, wordCount } = noteSuggestionTyping(
            state,
            insertedText
          );
          if (charCount >= 10 || wordCount >= 2) {
            activateSuggestionCooldown(state, "typing", {
              text: previousRawText,
              caret: previousCaret,
            });
          }
        }

        if (cooldownActiveBefore && !pasteEvent) {
          // Skip cooldown expiry adjustments for paste events; they often replace large blocks.
          const paragraphTriggered =
            paragraphEvent || (insertedText && insertedText.includes("\n"));
          const baselineText = state.suggestionCooldown?.baselineText || "";
          const baselineCaret =
            typeof state.suggestionCooldown?.baselineCaret === "number"
              ? state.suggestionCooldown.baselineCaret
              : -1;
          const progressedBeyondBaseline =
            currentRawText.length > baselineText.length ||
            (baselineCaret >= 0 && currentCaret > baselineCaret);

          if (paragraphTriggered) {
            clearSuggestionCooldown(state, "paragraph");
          } else if (insertedText && progressedBeyondBaseline) {
            const cleared = advanceSentenceStageForCooldown(state, insertedText);
            if (cleared) {
              clearSuggestionCooldown(state, "sentence");
            }
          }
        }
      }

      state.lastCaret = currentCaret;

      updateComposerIntent(composer);
      ensureResizeObserver(composer);
      ensureScrollObservers(composer);
      ensureMutationObserver(composer);
      schedulePostInputRefresh(composer, previousTrimmed);
      updatePromptSuggestionUI(composer);
    },
    onComposerBlur: (composer) => {
      const state = getComposerState(composer);
      const modalActive = isModalActiveForComposer(composer);
      if (INTENT_DEBUG) {
      if (INTENT_DEBUG) {
        console.log("[VG][modal] composer blur", {
          composer,
          modalActive,
          activeElement: document.activeElement,
        });
      }
      }
      if (modalActive) {
        if (INTENT_DEBUG) {
        if (INTENT_DEBUG) {
          console.log(
            "[VG][modal] composer blur suppressed due to active modal"
          );
        }
        }
        return;
      }
      const hasIntent = Boolean(state?.intentSegments?.length);
      emitHudIntentState(composer, state, hasIntent);
      if (state) {
        state.suggestion = null;
        state.suggestionCandidates = [];
        state.suggestionIndex = -1;
        state.suggestionEvalToken = 0;
      }
      clearPromptSuggestionUI(composer);
    },
  });

  function openModalTest() {
    const composer = watcher.getActiveComposer?.();
    const rect = composer?.getBoundingClientRect
      ? composer.getBoundingClientRect()
      : null;
    if (rect) {
      hover.openStub(rect);
    }
    updateComposerIntent(composer);
    if (typeof window.vgEnhanceComposerAll === "function") {
      if (INTENT_DEBUG) {
        console.debug(`${LOG_PREFIX} invoking vgEnhanceComposerAll() from stub`);
      }
      window.vgEnhanceComposerAll();
    } else {
      if (INTENT_DEBUG) {
        console.info(
          `${LOG_PREFIX} vgEnhanceComposerAll() unavailable; stub open only`
        );
      }
    }
  }

  function forceEval() {
    const composer = watcher.getActiveComposer?.();
    updateComposerIntent(composer);
  }

  function teardown() {
    const active = watcher.getActiveComposer?.();
    watcher.destroy();
    hover.destroy();
    highlight.clearAll();
    clearMarkers();
    if (active) {
      clearComposerState(active);
    }
    delete window[ENH_ROOT_FLAG];
    if (INTENT_DEBUG) {
      console.info(`${LOG_PREFIX} skeleton torn down`);
    }
  }

  const devtools = {
    openModalTest,
    forceEval,
    teardown,
    config: ENH_CFG,
    updateComposerIntent,
  };

  window[DEVTOOLS_KEY] = devtools;

  console.info(
    `${LOG_PREFIX} skeleton ready → run window.${DEVTOOLS_KEY}.openModalTest()`
  );
})();
  function normalizeVisibleText(text = "") {
    return String(text || "")
      .replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF]/g, "")
      .trim();
  }
