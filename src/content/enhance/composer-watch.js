// src/content/enhance/composer-watch.js
// Observes composer focus/input signals and reports via callbacks.

import { COMPOSER_SELECTORS, LOG_PREFIX } from "./config.js";

function shouldDebug() {
  return typeof window !== "undefined" && Boolean(window.VG_INTENT_DEBUG);
}

function safeLower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function isComposerElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = safeLower(el.getAttribute("type") || "text");
    return ["text", "search", "email", "url", "tel", "password"].includes(type);
  }
  const ce = safeLower(el.getAttribute?.("contenteditable") || "");
  if (ce === "true") return true;
  if (safeLower(el.getAttribute?.("role") || "") === "textbox") return true;
  try {
    if (el.matches && COMPOSER_SELECTORS.some((sel) => el.matches(sel))) {
      return true;
    }
  } catch {}
  return false;
}

export function initComposerWatch({
  doc = document,
  onComposerFound = () => {},
  onComposerBlur = () => {},
  onInput = () => {},
} = {}) {
  let activeComposer = null;

  function setActive(el) {
    if (el === activeComposer) return;
    activeComposer = el;
    if (el) {
      if (shouldDebug()) {
        console.debug(`${LOG_PREFIX} composer detected`, el);
      }
      onComposerFound(el);
    }
  }

  function handleFocus(event) {
    const target = event.target;
    if (isComposerElement(target)) {
      setActive(target);
    }
  }

  function handleBlur(event) {
    if (event.target === activeComposer) {
      if (shouldDebug()) {
        console.debug(`${LOG_PREFIX} composer blur`, activeComposer);
      }
      onComposerBlur(activeComposer);
      activeComposer = null;
    }
  }

  function handleInput(event) {
    if (!isComposerElement(event.target)) return;
    if (activeComposer !== event.target) {
      setActive(event.target);
    }
    onInput(event.target, event);
  }

  doc.addEventListener("focusin", handleFocus, true);
  doc.addEventListener("focusout", handleBlur, true);
  doc.addEventListener("input", handleInput, true);

  if (isComposerElement(doc.activeElement)) {
    setActive(doc.activeElement);
  }

  if (shouldDebug()) {
    console.info(`${LOG_PREFIX} composer watcher initialized`);
  }

  function destroy() {
    doc.removeEventListener("focusin", handleFocus, true);
    doc.removeEventListener("focusout", handleBlur, true);
    doc.removeEventListener("input", handleInput, true);
    activeComposer = null;
  }

  return {
    destroy,
    getActiveComposer: () => activeComposer,
  };
}
