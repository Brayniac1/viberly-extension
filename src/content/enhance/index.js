// src/content/enhance/index.js
// Entry point for the Enhance underline skeleton (Phase 2 baseline).

import { ENH_CFG, ENH_ROOT_FLAG, LOG_PREFIX } from "./config.js";
import { mountHighlightHost } from "./highlight-dom.js";
import { mountHoverModal } from "./hover-modal.js";
import { initComposerWatch } from "./composer-watch.js";
import { shouldTrigger } from "./detect-intent.js";
import { readComposer } from "./read-composer.js";
import { extractSpans } from "./extract-spans.js";
import { getComposerState } from "./state.js";
import { updateMarkers, clearMarkers } from "./markers.js";

const DEVTOOLS_KEY = "__VIB_ENHANCE_DEVTOOLS__";
const { ADAPTIVE_DEBOUNCE_MS } = ENH_CFG;

(function initEnhanceSkeleton() {
  if (window[ENH_ROOT_FLAG]) {
    console.info(`${LOG_PREFIX} already active`);
    return;
  }
  window[ENH_ROOT_FLAG] = true;

  const highlight = mountHighlightHost();
  const hover = mountHoverModal();

  function evaluateComposer(composer) {
    if (!composer) return null;
    const state = getComposerState(composer);
    const { text } = readComposer(composer);
    const now = Date.now();
    const result = shouldTrigger({
      text,
      now,
      lastFireAt: state.lastFireAt,
    });
    state.lastEvaluatedAt = now;
    state.lastHash = text;
    if (result.trigger) {
      highlight.applyFullUnderline(composer);
      const spans = extractSpans({
        text,
        matchedPhrase: result.matchedPhrase,
        matchedOffset: result.matchedOffset,
        maxLength: text.length,
      });
      updateMarkers({ composer, text, spans });
      state.lastFireAt = now;
    } else {
      highlight.clearUnderline(composer);
      clearMarkers(composer);
    }
    console.debug(`${LOG_PREFIX} intent result`, result);
    return result;
  }

  function scheduleEvaluation(composer) {
    if (!composer) return;
    const state = getComposerState(composer);
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      evaluateComposer(composer);
    }, ADAPTIVE_DEBOUNCE_MS);
  }

  const watcher = initComposerWatch({
    onComposerFound: scheduleEvaluation,
    onInput: scheduleEvaluation,
    onComposerBlur: (composer) => highlight.clearUnderline(composer),
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
    watcher.destroy();
    hover.destroy();
    highlight.clearAll();
    clearMarkers();
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
