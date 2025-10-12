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
import {
  updateMarkers,
  clearMarkers,
  isModalActiveForComposer,
} from "./markers.js";

const DEVTOOLS_KEY = "__VIB_ENHANCE_DEVTOOLS__";
const { ADAPTIVE_DEBOUNCE_MS } = ENH_CFG;

function computeImproveScore(text) {
  const clean = String(text || "").trim();
  if (!clean) return null;
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  const rand = (hash % 1000) / 999; // 0..1
  const length = clean.length;
  const lengthFactor = Math.max(0, Math.min(1, 220 / (length + 80)));
  const mix = Math.min(1, rand * 0.35 + lengthFactor * 0.65);
  const value = Math.round(67 + mix * 67);
  return Math.max(67, Math.min(134, value));
}

(function initEnhanceSkeleton() {
  if (window[ENH_ROOT_FLAG]) {
    console.info(`${LOG_PREFIX} already active`);
    return;
  }
  window[ENH_ROOT_FLAG] = true;

  mountHighlightHost();
  const hover = mountHoverModal();

  function queueOverlayRender(
    composer,
    text,
    spans,
    map,
    segments = [],
    meta = {}
  ) {
  if (!composer || !spans || !spans.length) {
    clearOverlay(composer);
    return;
  }
  const state = getComposerState(composer);
  if (!state) return;
  const spanMap = map ?? state.lastMap;
  updateMarkers({
    composer,
    text,
    spans,
    map: spanMap,
    segments,
    improveScore: meta.improveScore ?? state.improveScore ?? null,
    rawText: meta.text ?? state.lastText ?? "",
  });
}

  function clearOverlay(composer, { all = false } = {}) {
    const state = composer ? getComposerState(composer) : null;
    const modalActive =
      composer && !all ? isModalActiveForComposer(composer) : false;
    const stack = new Error().stack;
    console.log("[VG][modal] clearOverlay", {
      composer,
      all,
      statePresent: Boolean(state),
      modalActive,
      stack,
    });
    if (!all && modalActive) {
      console.log("[VG][modal] clearOverlay skipped due to active modal");
      return;
    }
    if (all) {
      console.log("[VG][modal] clearOverlay all reset");
    }
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
    const trimmedText = text.trim();
    const now = Date.now();
    const result = shouldTrigger({
      text,
      now,
      lastFireAt: state.lastFireAt,
    });
    state.lastEvaluatedAt = now;
    state.lastHash = text;
    if (result.trigger) {
      if (state.lastText !== trimmedText) {
        state.lastText = trimmedText;
        state.improveScore = computeImproveScore(trimmedText);
      }

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
        queueOverlayRender(composer, text, spans, map, segments, {
          improveScore: state.improveScore,
          text: state.lastText,
        });
      } else if (!isModalActiveForComposer(composer)) {
        clearOverlay(composer);
      }
      state.lastFireAt = now;
    } else {
      clearOverlay(composer);
      state.lastText = "";
      state.improveScore = null;
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
        queueOverlayRender(composer, text, spans, map, segments, {
          improveScore: state.improveScore,
          text: state.lastText,
        });
      } else if (!isModalActiveForComposer(composer)) {
        clearOverlay(composer);
      } else {
        console.log("[VG][modal] refreshOverlay skipped clear due to active modal");
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

  function ensureMutationObserver(composer) {
    if (!composer) return;
    if ("value" in composer) return; // textarea/input – no need
    const state = getComposerState(composer);
    if (!state || state.mutationObserver) return;
    try {
      const observer = new MutationObserver(() => refreshOverlay(composer));
      observer.observe(composer, {
        childList: true,
        subtree: false,
      });
      state.mutationObserver = observer;
    } catch (e) {
      console.debug(`${LOG_PREFIX} mutation observer failed`, e);
    }
  }

  const watcher = initComposerWatch({
    onComposerFound: (composer) => {
      evaluateComposer(composer);
      scheduleEvaluation(composer);
      ensureScrollObservers(composer);
      ensureMutationObserver(composer);
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
          state.lastText = "";
          state.improveScore = null;
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
          state.lastText = "";
          state.improveScore = null;
        }
      } else if (state) {
        state.lastMap = map;
      }
      evaluateComposer(composer);
      scheduleEvaluation(composer);
      ensureScrollObservers(composer);
      ensureMutationObserver(composer);
    },
    onComposerBlur: (composer) => {
      const activeEl = document.activeElement;
      const modalActive = isModalActiveForComposer(composer);
      console.log("[VG][modal] composer blur", {
        composer,
        modalActive,
        activeElement: activeEl,
        activeElementClass: activeEl?.className,
      });
      if (modalActive) {
        console.log("[VG][modal] composer blur suppressed due to active modal");
        return;
      }
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
