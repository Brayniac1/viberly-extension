// src/content/enhance/prompt-suggestion-ui.js
// Renders the inline ghost suggestion and handles acceptance / cycling.

import { getComposerState } from "./state.js";
import {
  cycleSuggestion,
  markSuggestionAccepted,
  markSuggestionDismissed,
} from "./suggestion-engine.js";
const OVERLAY_CLASS = "vg-prompt-suggestion";
const OVERLAY_ID_PREFIX = "__vg_prompt_suggestion__";
const MIRROR_ID = "__vib_marker_mirror__";
const HIDE_AFTER_DISMISS_MS = 2000;
const MAX_INLINE_WORDS = 4;
const TOOLTIP_DELAY_MS = 150;
const MARKER_MODAL_CLASS = "vib-marker-modal";

const overlayMap = new WeakMap();
const tooltipMap = new WeakMap();

function clearHideTimer(data) {
  if (!data) return;
  if (data.hideTimer) {
    clearTimeout(data.hideTimer);
    data.hideTimer = null;
  }
}

function requestHide(data, composer) {
  if (!data) return;
  clearHideTimer(data);
  data.hideTimer = setTimeout(() => {
    data.hideTimer = null;
    hideSuggestionTooltip(composer, true);
  }, 200);
}

function lockTooltipData(data) {
  if (!data) return;
  data.lockDepth = (data.lockDepth || 0) + 1;
  clearHideTimer(data);
}

function unlockTooltipData(data, composer) {
  if (!data) return;
  if (data.lockDepth) data.lockDepth -= 1;
  if (!data.lockDepth) {
    requestHide(data, composer);
  }
}

function truncate(text, max) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}…`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPreviewText(raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/^[ \t]*#{1,6}\s*/gm, "")
    .replace(/^[ \t]*[-*]\s+/gm, "• ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/^\s+$/gm, "")
    .trimEnd();
}

function ensureTooltipStyles(doc) {
  if (doc.getElementById("__vg_prompt_tooltip_css")) return;
  const style = doc.createElement("style");
  style.id = "__vg_prompt_tooltip_css";
  style.textContent = `
    .vg-inline-actions{
      display:flex;
      gap:9px;
      justify-content:flex-end;
      margin-top: 8px;
    }
  `;
  style.textContent += `
    .vg-inline-suggestion p {
      margin: 0;
    }
    .vg-inline-suggestion p + p {
      margin-top: 10px;
    }
  `;
  doc.head.appendChild(style);
}

function ensureTooltip(doc) {
  let tooltip = tooltipMap.get(doc);
  if (tooltip) return tooltip;
  ensureTooltipStyles(doc);
  tooltip = doc.createElement("div");
  tooltip.className = `${MARKER_MODAL_CLASS} vg-inline-suggestion hidden`;
  tooltip.style.position = "fixed";
  tooltip.style.opacity = "0";
  tooltip.style.pointerEvents = "none";
  tooltip.style.zIndex = "2147483605";

  const headerEl = doc.createElement("div");
  headerEl.className = `${MARKER_MODAL_CLASS}-header`;
  const iconEl = doc.createElement("div");
  iconEl.className = `${MARKER_MODAL_CLASS}-icon`;
  iconEl.textContent = "✦";
  const headerText = doc.createElement("div");
  headerText.textContent = "Suggestion";
  headerEl.append(iconEl, headerText);

  const metaEl = doc.createElement("div");
  metaEl.className = `${MARKER_MODAL_CLASS}-meta`;
  const metaLeft = doc.createElement("span");
  metaLeft.textContent = "INSERT PROMPT";
  const metaRight = doc.createElement("span");
  metaRight.style.fontSize = "9.5px";
  metaRight.style.color = "rgba(190,195,220,0.65)";
  metaRight.style.textTransform = "none";
  metaRight.style.letterSpacing = "0.3px";
  metaEl.append(metaLeft, metaRight);

  const labelEl = doc.createElement("div");
  labelEl.className = `${MARKER_MODAL_CLASS}-label`;
  labelEl.textContent = "";

  const bodyEl = doc.createElement("div");
  bodyEl.className = `${MARKER_MODAL_CLASS}-body`;
  bodyEl.style.whiteSpace = "pre-wrap";
  bodyEl.style.lineHeight = "1.55";

  const footerEl = doc.createElement("div");
  footerEl.className = `${MARKER_MODAL_CLASS}-actions vg-inline-actions`;
  footerEl.innerHTML = `
    <button class="dismiss vg-inline-dismiss">Dismiss</button>
    <button class="enhance vg-inline-insert">Insert</button>
  `;

  tooltip.append(headerEl, metaEl, labelEl, bodyEl, footerEl);
  tooltip._parts = {
    metaRight,
    labelEl,
    bodyEl,
    footerEl,
  };

  tooltip.addEventListener("pointerenter", () => {
    const cmp = tooltip._currentComposer;
    if (!cmp) return;
    const data = overlayMap.get(cmp);
    lockTooltipData(data);
  });

  tooltip.addEventListener("pointerleave", (event) => {
    if (event?.buttons) return;
    const cmp = tooltip._currentComposer;
    if (!cmp) return;
    const data = overlayMap.get(cmp);
    if (!data) return;
    const next = event?.relatedTarget;
    const doc = cmp.ownerDocument || document;
    const activeTooltip = tooltipMap.get(doc);
    if (next && (activeTooltip?.contains(next) || data.el.contains(next))) {
      return;
    }
    unlockTooltipData(data, cmp);
  });

  doc.body.appendChild(tooltip);
  tooltipMap.set(doc, tooltip);
  return tooltip;
}

function ensureOverlay(composer) {
  let data = overlayMap.get(composer);
  if (data) return data;

  const doc = composer.ownerDocument || document;
  const overlay = doc.createElement("div");
  overlay.className = OVERLAY_CLASS;
  overlay.id = `${OVERLAY_ID_PREFIX}${Math.random().toString(16).slice(2)}`;
  Object.assign(overlay.style, {
    position: "fixed",
    pointerEvents: "none",
    opacity: "0",
    transition: "opacity 120ms ease",
    zIndex: "2147483604",
    color: "rgba(210,215,230,0.7)",
    fontStyle: "italic",
    whiteSpace: "pre",
    maxWidth: "60vw",
  });

  const textEl = doc.createElement("span");
  overlay.appendChild(textEl);
  doc.body.appendChild(overlay);

  const keyHandler = (event) => handleKeyDown(event, composer);
  composer.addEventListener("keydown", keyHandler, true);

  const handleEnter = () => {
    lockTooltipData(data);
    scheduleTooltip(composer, TOOLTIP_DELAY_MS);
  };
  const handleLeave = (event) => {
    if (event?.buttons) return;
    const next = event?.relatedTarget;
    const tooltip = tooltipMap.get(doc);
    if (tooltip && next && tooltip.contains(next)) {
      return;
    }
    unlockTooltipData(data, composer);
  };
  overlay.addEventListener("pointerenter", handleEnter);
  overlay.addEventListener("mouseenter", handleEnter);
  overlay.addEventListener("pointerleave", handleLeave);
  overlay.addEventListener("mouseleave", handleLeave);

  data = {
    el: overlay,
    textEl,
    keyHandler,
    visible: false,
    hoverTimer: null,
    hideTimer: null,
    composer,
    docKeyHandler: null,
    docPointerHandler: null,
  };
  overlayMap.set(composer, data);
  return data;
}

function hideOverlay(data, composer) {
  if (!data || !data.el) return;
  data.el.style.opacity = "0";
  data.el.style.pointerEvents = "none";
  data.visible = false;
  if (data.hoverTimer) {
    clearTimeout(data.hoverTimer);
    data.hoverTimer = null;
  }
  clearHideTimer(data);
  data.lockDepth = 0;
  data.fullPreview = "";
  hideSuggestionTooltip(composer || data.composer || null, false);
}

function applyFontStyles(target, composer) {
  const cs = composer.ownerDocument?.defaultView?.getComputedStyle(composer);
  if (!cs) return;
  target.style.font = cs.font;
  target.style.fontSize = cs.fontSize;
  target.style.lineHeight = cs.lineHeight;
  target.style.letterSpacing = cs.letterSpacing;
  target.style.color = "rgba(210,215,230,0.72)";
}

function buildGhostText(state) {
  const suggestion = state?.suggestion;
  if (!suggestion || !suggestion.preview) return { inline: "", full: "" };
  const preview = suggestion.preview;
  const tail = suggestion.query?.tailText ?? state.intentMatchedText ?? "";
  const tailLower = (tail || "").toLowerCase();
  const previewLower = preview.toLowerCase();
  let overlap = 0;
  const maxOverlap = Math.min(tailLower.length, previewLower.length);
  for (let i = maxOverlap; i > 0; i--) {
    if (tailLower.endsWith(previewLower.slice(0, i))) {
      overlap = i;
      break;
    }
  }
  let remainder = preview.slice(overlap).replace(/^\s+/, "");
  if (!remainder) return { inline: "", full: "" };

  const tailTrimmed = tail.trimEnd();
  const endsSentence = /[.!?]\s*$/.test(tailTrimmed);
  if (!endsSentence) {
    remainder =
      remainder.charAt(0).toLowerCase() + remainder.slice(1);
    remainder = ` ${remainder}`;
  } else if (!tailTrimmed.endsWith(" ") && !remainder.startsWith(" ")) {
    remainder = ` ${remainder}`;
  }
  const trimmedCore = remainder.trim();
  if (!trimmedCore) {
    return { inline: remainder, full: remainder };
  }
  const words = trimmedCore.split(/\s+/);
  let inlineCore = trimmedCore;
  if (words.length > MAX_INLINE_WORDS) {
    inlineCore = `${words.slice(0, MAX_INLINE_WORDS).join(" ")}…`;
  }
  const inline = remainder.startsWith(" ") ? ` ${inlineCore}` : inlineCore;
  return { inline, full: remainder };
}

function getContentEditableCaretRect(composer) {
  const doc = composer.ownerDocument || document;
  const sel = doc.getSelection && doc.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  if (!composer.contains(range.startContainer)) return null;
  range.collapse(false);
  let rect = range.getClientRects()[0];
  if (!rect) {
    const marker = doc.createElement("span");
    marker.textContent = "\u200b";
    range.insertNode(marker);
    rect = marker.getBoundingClientRect();
    marker.parentNode?.removeChild(marker);
  }
  return rect || null;
}

function ensureMirror(textarea) {
  const doc = textarea.ownerDocument || document;
  let mirror = doc.getElementById(MIRROR_ID);
  if (!mirror) {
    mirror = doc.createElement("div");
    mirror.id = MIRROR_ID;
    Object.assign(mirror.style, {
      position: "absolute",
      visibility: "hidden",
      whiteSpace: "pre-wrap",
      wordWrap: "break-word",
      pointerEvents: "none",
    });
    doc.body.appendChild(mirror);
  }
  const cs = doc.defaultView?.getComputedStyle(textarea);
  const rect = textarea.getBoundingClientRect();
  Object.assign(mirror.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    font: cs?.font || "",
    lineHeight: cs?.lineHeight || "",
    padding: cs?.padding || "",
    border: cs?.border || "",
    boxSizing: cs?.boxSizing || "border-box",
  });
  return mirror;
}

function encodeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;")
    .replace(/\n/g, "<br>");
}

function getTextareaCaretRect(textarea) {
  if (!("selectionEnd" in textarea)) return null;
  const mirror = ensureMirror(textarea);
  const value = textarea.value || "";
  const caret = textarea.selectionEnd ?? value.length;
  const before = encodeHtml(value.slice(0, caret));
  const after = encodeHtml(value.slice(caret));
  mirror.innerHTML = `${before}<span class="vg-caret-marker">\u200b</span>${after}`;
  mirror.scrollTop = textarea.scrollTop;
  mirror.scrollLeft = textarea.scrollLeft;
  const caretEl = mirror.querySelector(".vg-caret-marker");
  if (!caretEl) return null;
  const caretRect = caretEl.getBoundingClientRect();
  return caretRect || null;
}

function getCaretRect(composer) {
  if ("selectionEnd" in composer && typeof composer.selectionEnd === "number") {
    return getTextareaCaretRect(composer);
  }
  return getContentEditableCaretRect(composer);
}

function handleKeyDown(event, composer) {
  const state = getComposerState(composer);
  if (!state?.suggestion) return;

  if (
    event.key === "Tab" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    acceptSuggestion(composer, state);
    return;
  }

  if (event.key === "Tab" && event.ctrlKey) {
    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    const next = cycleSuggestion(state, direction);
    if (!next) {
      state.suggestion = null;
      state.suggestionCandidates = [];
      state.suggestionIndex = -1;
    }
    requestAnimationFrame(() => updatePromptSuggestionUI(composer));
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    dismissSuggestion(composer, state);
  }
}

function dismissSuggestion(composer, state) {
  if (!state?.suggestion) return;
  markSuggestionDismissed(state);
  state.suggestionHiddenUntil = Date.now() + HIDE_AFTER_DISMISS_MS;
  state.suggestion = null;
  state.suggestionCandidates = [];
  state.suggestionIndex = -1;
  const data = overlayMap.get(composer);
  hideOverlay(data, composer);
}

function insertTextFallback(composer, text) {
  if (!text) return false;
  if ("value" in composer) {
    try {
      composer.focus();
    } catch {}
    const start =
      typeof composer.selectionStart === "number"
        ? composer.selectionStart
        : composer.value.length;
    const end =
      typeof composer.selectionEnd === "number"
        ? composer.selectionEnd
        : start;
    const before = composer.value.slice(0, start);
    const after = composer.value.slice(end);
    const prefix = before && !/\n\n$/.test(before) ? "\n\n" : "";
    const suffix = after && !after.startsWith("\n") ? "\n\n" : "\n";
    const next = `${before}${prefix}${text}${suffix}${after}`;
    composer.value = next;
    const caret =
      before.length + prefix.length + text.length + suffix.length;
    composer.setSelectionRange?.(caret, caret);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  const target = composer;
  const doc = target.ownerDocument || document;
  const sel = doc.getSelection && doc.getSelection();
  try {
    target.focus();
  } catch {}
  if (!sel || !sel.rangeCount || !target.contains(sel.anchorNode)) {
    const range = doc.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const frag = doc.createDocumentFragment();
  frag.appendChild(doc.createTextNode(text));
  frag.appendChild(doc.createTextNode("\n\n"));
  range.insertNode(frag);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function applyGuardToComposer(composer, guardBody) {
  if (!guardBody) return false;
  if (
    typeof window !== "undefined" &&
    typeof window.setComposerGuardAndCaret === "function"
  ) {
    try {
      const ok = window.setComposerGuardAndCaret(guardBody);
      if (ok) return true;
    } catch {}
  }
  return insertTextFallback(composer, guardBody);
}

function acceptSuggestion(composer, state) {
  const guard = state?.suggestion?.guard;
  if (!guard) return;
  markSuggestionAccepted(state);
  state.suggestionHistory.push({
    id: guard.id,
    acceptedAt: Date.now(),
  });
  state.suggestionHiddenUntil = Date.now() + HIDE_AFTER_DISMISS_MS;
  state.suggestion = null;
  state.suggestionCandidates = [];
  state.suggestionIndex = -1;

  try {
    composer.focus?.();
  } catch {}
  applyGuardToComposer(composer, guard.body || "");

  const data = overlayMap.get(composer);
  hideOverlay(data, composer);
}

export function ensurePromptSuggestionUI(composer) {
  ensureOverlay(composer);
}

export function updatePromptSuggestionUI(composer) {
  const state = getComposerState(composer);
  const data = ensureOverlay(composer);
  const suggestion = state?.suggestion;

  if (
    !suggestion ||
    (state.suggestionHiddenUntil &&
      Date.now() < state.suggestionHiddenUntil)
  ) {
    hideOverlay(data, composer);
    return;
  }

  if (
    composer.ownerDocument?.activeElement !== composer &&
    !composer.contains(
      composer.ownerDocument?.activeElement || null
    )
  ) {
    hideOverlay(data, composer);
    return;
  }

  const ghost = buildGhostText(state);
  if (!ghost.inline) {
    hideOverlay(data, composer);
    return;
  }

  const caretRect = getCaretRect(composer);
  if (!caretRect) {
    hideOverlay(data, composer);
    return;
  }

  const composerRect = composer.getBoundingClientRect();
  const availableWidth = composerRect.right - caretRect.right - 6;
  if (availableWidth <= 12) {
    hideOverlay(data, composer);
    return;
  }

  applyFontStyles(data.el, composer);
  data.textEl.textContent = ghost.inline;
  data.el.style.maxWidth = `${availableWidth}px`;
  const left = Math.min(caretRect.right + 2, composerRect.right - 4);
  const top = Math.min(
    caretRect.top,
    composerRect.bottom - (caretRect.height || 16)
  );
  data.el.style.left = `${left}px`;
  data.el.style.top = `${top}px`;
  data.el.style.opacity = "1";
  data.el.style.pointerEvents = "auto";
  data.visible = true;
  data.fullPreview = ghost.full;
  data.title = suggestion.guard?.title || "Suggested prompt";
  data.guardBody = suggestion.guard?.body || "";

  if (data.el.matches(":hover")) {
    scheduleTooltip(composer, 0);
  }
}

export function clearPromptSuggestionUI(composer) {
  const data = overlayMap.get(composer);
  hideOverlay(data, composer);
}

function scheduleTooltip(composer, delay) {
  const state = getComposerState(composer);
  const data = overlayMap.get(composer);
  if (!state?.suggestion || !data?.visible) return;
  if (data.hoverTimer) {
    clearTimeout(data.hoverTimer);
  }
  data.hoverTimer = setTimeout(() => {
    data.hoverTimer = null;
    showSuggestionTooltip(composer);
  }, delay);
}

function showSuggestionTooltip(composer) {
  const state = getComposerState(composer);
  const data = overlayMap.get(composer);
  if (!state?.suggestion || !data?.visible) return;

  const doc = composer.ownerDocument || document;
  const tooltip = ensureTooltip(doc);
  const guard = state.suggestion.guard || {};
  const title = guard.title || data.title || "Suggested prompt";
  const preview = guard.preview || data.fullPreview || "";
  const guardBody = guard.body || data.guardBody || "";

  const parts = tooltip._parts || {};
  if (parts.metaRight) parts.metaRight.textContent = "Press Tab to insert • Ctrl+Tab to cycle";
  if (parts.labelEl) parts.labelEl.textContent = truncate(title || "Suggested Prompt", 64);
  if (parts.bodyEl) {
    const formatted = formatPreviewText(guardBody || preview);
    const blocks = formatted
      .replace(/\r\n/g, "\n")
      .split(/\n\s*\n/)
      .filter(Boolean)
      .map((block) =>
        `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`
      )
      .join("");
    parts.bodyEl.innerHTML = blocks || `<p>${escapeHtml(formatted)}</p>`;
  }
  if (parts.footerEl) {
    const dismissBtn = parts.footerEl.querySelector(".vg-inline-dismiss");
    const insertBtn = parts.footerEl.querySelector(".vg-inline-insert");
    if (dismissBtn) {
      dismissBtn.onclick = (evt) => {
        evt.stopPropagation();
        dismissSuggestion(composer, state);
      };
    }
    if (insertBtn) {
      insertBtn.onclick = (evt) => {
        evt.stopPropagation();
        acceptSuggestion(composer, state);
      };
    }
  }

  const overlayRect = data.el.getBoundingClientRect();
  const padding = 12;
  tooltip.style.opacity = "1";
  tooltip.classList.remove("hidden");
  tooltip.style.pointerEvents = "auto";
  
  let left = overlayRect.left;
  let top = overlayRect.bottom + 8;
  const tooltipRect = tooltip.getBoundingClientRect();
  if (left + tooltipRect.width + padding > window.innerWidth) {
    left = Math.max(padding, window.innerWidth - tooltipRect.width - padding);
  }
  if (top + tooltipRect.height + padding > window.innerHeight) {
    top = overlayRect.top - tooltipRect.height - 8;
  }
  if (top < padding) top = padding;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  if (data.docKeyHandler) {
    doc.removeEventListener("keydown", data.docKeyHandler, true);
  }
  if (data.docPointerHandler) {
    doc.removeEventListener("pointerdown", data.docPointerHandler, true);
  }
  const keyHandler = (event) => {
    if (event?.key === "Escape") {
      hideSuggestionTooltip(composer, false);
    }
  };
  const pointerHandler = (event) => {
    const target = event?.target;
    if (!target) return;
    if (tooltip.contains(target) || data.el.contains(target)) return;
    hideSuggestionTooltip(composer, false);
  };
  doc.addEventListener("keydown", keyHandler, true);
  doc.addEventListener("pointerdown", pointerHandler, true);
  data.docKeyHandler = keyHandler;
  data.docPointerHandler = pointerHandler;
  tooltip._currentComposer = composer;
  lockTooltipData(data);
}

function hideSuggestionTooltip(composer, cancelTimer) {
  if (composer) {
    const data = overlayMap.get(composer);
    if (data) {
      if (cancelTimer && data.hoverTimer) {
        clearTimeout(data.hoverTimer);
        data.hoverTimer = null;
      }
      if (data.hideTimer) {
        clearTimeout(data.hideTimer);
        data.hideTimer = null;
      }
      const doc = composer.ownerDocument || document;
      if (data.docKeyHandler) {
        doc.removeEventListener("keydown", data.docKeyHandler, true);
        data.docKeyHandler = null;
      }
      if (data.docPointerHandler) {
        doc.removeEventListener("pointerdown", data.docPointerHandler, true);
        data.docPointerHandler = null;
      }
      const tooltip = tooltipMap.get(doc);
      if (tooltip) {
        tooltip.style.opacity = "0";
        tooltip.classList.add("hidden");
        tooltip.style.pointerEvents = "none";
        tooltip._currentComposer = null;
      }
      return;
    }
  }
  tooltipMap.forEach((tooltip) => {
    tooltip.style.opacity = "0";
    tooltip.classList.add("hidden");
    tooltip.style.pointerEvents = "none";
    tooltip._currentComposer = null;
  });
  overlayMap.forEach((data, cmp) => {
    if (!data) return;
    const doc = (cmp && cmp.ownerDocument) || document;
    if (data.docKeyHandler) {
      doc.removeEventListener("keydown", data.docKeyHandler, true);
      data.docKeyHandler = null;
    }
    if (data.docPointerHandler) {
      doc.removeEventListener("pointerdown", data.docPointerHandler, true);
      data.docPointerHandler = null;
    }
    clearHideTimer(data);
    data.lockDepth = 0;
  });
}
