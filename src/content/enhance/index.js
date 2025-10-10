// src/content/enhance/index.js
// Entry point for the Enhance underline skeleton (Phase 2 baseline).

import { ENH_CFG, ENH_ROOT_FLAG, LOG_PREFIX } from "./config.js";
import { mountHighlightHost } from "./highlight-dom.js";
import { mountHoverModal } from "./hover-modal.js";
import { initComposerWatch } from "./composer-watch.js";
import { shouldTrigger } from "./detect-intent.js";
import { readComposer } from "./read-composer.js";
import { extractSpans } from "./extract-spans.js";
import { getComposerState, clearComposerState } from "./state.js";
import { updateMarkers, clearMarkers } from "./markers.js";

const DEVTOOLS_KEY = "__VIB_ENHANCE_DEVTOOLS__";
const { ADAPTIVE_DEBOUNCE_MS } = ENH_CFG;

(function initEnhanceSkeleton() {
  if (window[ENH_ROOT_FLAG]) {
    console.info(`${LOG_PREFIX} already active`);
    return;
  }
  window[ENH_ROOT_FLAG] = true;

  mountHighlightHost();
  const hover = mountHoverModal();

  function queueOverlayRender(composer, text, spans, map) {
    if (!composer || !spans || !spans.length) {
      clearOverlay(composer);
      return;
    }
    const state = getComposerState(composer);
    if (!state) return;
    const spanMap = map ?? state.lastMap;
    updateMarkers({ composer, text, spans, map: spanMap });
  }

  function clearOverlay(composer, { all = false } = {}) {
    const state = composer ? getComposerState(composer) : null;
    if (all) {
      clearMarkers();
    } else if (composer) {
      clearMarkers(composer);
    } else {
      clearMarkers();
    }
    if (state) {
      state.lastSpans = [];
      state.lastSegments = [];
      state.lastMap = null;
    }
  }

  function evaluateComposer(composer) {
    if (!composer) return null;
    const state = getComposerState(composer);
    const { text, map } = readComposer(composer);
    const now = Date.now();
    const result = shouldTrigger({
      text,
      now,
      lastFireAt: state.lastFireAt,
    });
    state.lastEvaluatedAt = now;
    state.lastHash = text;
    if (result.trigger) {
      const segments =
        Array.isArray(result.matchedSegments) && result.matchedSegments.length
          ? result.matchedSegments
          : result.matchedPhrase
          ? [
              {
                text: result.matchedPhrase,
                start: result.matchedOffset ?? 0,
              },
            ]
          : [];
      const spanSets = segments.map((seg) =>
        extractSpans({
          text,
          matchedPhrase: seg.text,
          matchedOffset: seg.start,
          maxLength: text.length,
        })
      );
      const spans = spanSets.flat();
      if (spans.length) {
        state.lastSpans = spans;
        state.lastSegments = segments;
        state.lastMap = map;
        queueOverlayRender(composer, text, spans, map);
      } else {
        clearOverlay(composer);
      }
      state.lastFireAt = now;
    } else {
      clearOverlay(composer);
    }
    console.debug(`${LOG_PREFIX} intent result`, result);
    return result;
  }

  function scheduleEvaluation(composer) {
    if (!composer) return;
    ensureResizeObserver(composer);
    refreshOverlay(composer);
    const state = getComposerState(composer);
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      evaluateComposer(composer);
      ensureScrollObservers(composer);
    }, ADAPTIVE_DEBOUNCE_MS);
  }

  function refreshOverlay(composer) {
    if (!composer) return;
    const state = getComposerState(composer);
    const segments = state?.lastSegments || [];
    if (!segments.length) return;
    try {
      const { text, map } = readComposer(composer);
      const spanSets = segments.map((seg) =>
        extractSpans({
          text,
          matchedPhrase: seg.text,
          matchedOffset: seg.start,
          maxLength: text.length,
        })
      );
      const spans = spanSets.flat();
      if (spans.length) {
        state.lastSpans = spans;
        state.lastMap = map;
        queueOverlayRender(composer, text, spans, map);
      } else {
        clearOverlay(composer);
      }
    } catch (e) {
      console.debug(`${LOG_PREFIX} overlay refresh failed`, e);
    }
  }

  function ensureResizeObserver(composer) {
    if (!composer) return;
    const state = getComposerState(composer);
    if (!state || state.resizeObserver || typeof ResizeObserver !== "function")
      return;
    try {
      const ro = new ResizeObserver(() => refreshOverlay(composer));
      ro.observe(composer);
      state.resizeObserver = ro;
    } catch (e) {
      console.debug(`${LOG_PREFIX} resize observer failed`, e);
    }
  }

  function ensureScrollObservers(composer) {
    if (!composer) return;
    const state = getComposerState(composer);
    if (!state) return;
    const handlers = state.scrollHandlers || [];
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
    if (handlers.length) return;
    const handler = () => refreshOverlay(composer);
    roots.forEach((target) => {
      try {
        target.addEventListener("scroll", handler, { passive: true, capture: true });
        handlers.push({ target, handler });
      } catch {}
    });
    state.scrollHandlers = handlers;
  }

  const watcher = initComposerWatch({
    onComposerFound: (composer) => {
      evaluateComposer(composer);
      scheduleEvaluation(composer);
      ensureScrollObservers(composer);
    },
    onInput: (composer) => {
      const state = getComposerState(composer);
      const { text, map } = readComposer(composer);
      const trimmed = text.trim();
      if (!trimmed) {
        clearOverlay(composer);
        if (state) {
          state.lastSpans = [];
          state.lastSegments = [];
          state.lastMap = null;
        }
        return;
      }
      const quick = shouldTrigger({
        text,
        now: Date.now(),
        lastFireAt: state?.lastFireAt ?? 0,
      });
      if (!quick.trigger) {
        clearOverlay(composer);
        if (state) {
          state.lastSpans = [];
          state.lastSegments = [];
          state.lastMap = null;
        }
      } else if (state) {
        state.lastMap = map;
      }
      evaluateComposer(composer);
      scheduleEvaluation(composer);
      ensureScrollObservers(composer);
    },
    onComposerBlur: (composer) => {
      clearOverlay(composer);
      clearComposerState(composer);
    },
  });

  function openModalTest() {
    const composer = watcher.getActiveComposer?.();
    const rect = composer?.getBoundingClientRect
      ? composer.getBoundingClientRect()
      : null;
    hover.openStub(rect);
    evaluateComposer(composer);
    if (typeof window.vgEnhanceComposerAll === "function") {
      console.debug(`${LOG_PREFIX} invoking vgEnhanceComposerAll() from stub`);
      window.vgEnhanceComposerAll();
    } else {
      console.info(
        `${LOG_PREFIX} vgEnhanceComposerAll() unavailable; stub open only`
      );
    }
  }

  function forceEval() {
    const composer = watcher.getActiveComposer?.();
    evaluateComposer(composer);
  }

  function teardown() {
    const active = watcher.getActiveComposer?.();
    watcher.destroy();
    hover.destroy();
    highlight.clearAll();
    if (active) {
      clearOverlay(active, { all: true });
      clearComposerState(active);
    } else {
      clearOverlay(null, { all: true });
    }
    delete window[ENH_ROOT_FLAG];
    console.info(`${LOG_PREFIX} skeleton torn down`);
  }

  const devtools = {
    openModalTest,
    forceEval,
    teardown,
    config: ENH_CFG,
    evaluateComposer,
  };

  window[DEVTOOLS_KEY] = devtools;

  console.info(
    `${LOG_PREFIX} skeleton ready → run window.${DEVTOOLS_KEY}.openModalTest()`
  );
})();
