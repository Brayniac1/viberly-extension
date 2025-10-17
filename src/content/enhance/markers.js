// src/content/enhance/markers.js
// Renders floating markers above action/recipient/topic spans.

import { sendRuntimeMessage } from "./runtime.js";

const MARKER_HOST_ID = "__vib_marker_host__";
const MODAL_HOST_ID = "__vib_marker_modal_host__";
const MARKER_CLASS = "vib-marker-dot";
const UNDERLINE_CLASS = "vib-marker-underline";
const WRAPPER_CLASS = "vib-marker-hit";
const MODAL_CLASS = "vib-marker-modal";
const DOT_COLORS = {
  base: "#686EE3",
};
const MIRROR_ID = "__vib_marker_mirror__";

const DEBUG_MODAL =
  typeof window !== "undefined" && "VG_DEBUG_MODAL" in window
    ? Boolean(window.VG_DEBUG_MODAL)
    : false;
const modalDebugState = {
  locks: 0,
  pointerDown: false,
  wheelTimer: false,
  lastEvent: null,
};

function debugModal(...args) {
  if (!DEBUG_MODAL) return;
  try {
    if (typeof console.log === "function") {
      console.log("[VG][modal]", ...args);
    } else if (typeof console.debug === "function") {
      console.debug("[VG][modal]", ...args);
    }
  } catch {
    // no-op if console unavailable
  }
}

const composerMeta = new WeakMap();
let activeModal = null;
let hideModalTimer = null;
const modalLocks = new Set();
let modalPointerDown = false;
let docPointerUpHandler = null;
let docPointerDownHandler = null;
let modalWheelTimer = null;
let enhanceJobSeq = 0;
const hoverUnlockTimers = new WeakMap();
const hoverIntentTimers = new WeakMap();
const HOVER_INTENT_DELAY_MS = 200;

function updateComposerMeta(composer, patch = {}) {
  if (!composer) return null;
  const prev = composerMeta.get(composer) || {};
  const next = {
    ...prev,
    ...patch,
  };
  composerMeta.set(composer, next);
  return next;
}

function rerenderActiveModal(composer) {
  if (!activeModal || activeModal.composer !== composer) return;
  const { element } = activeModal;
  if (!element) return;
  renderModal(element, composer);
  requestAnimationFrame(() => positionActiveModal());
}

const composerIds = new WeakMap();
const composerById = new Map();
let markerSeq = 0;

function ensureHost(doc = document) {
  let host = doc.getElementById(MARKER_HOST_ID);
  if (!host) {
    host = doc.createElement("div");
    host.id = MARKER_HOST_ID;
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "0",
      height: "0",
      pointerEvents: "auto",
      zIndex: "2147483602",
    });
    doc.body.appendChild(host);
  }
  return host;
}

function ensureModalHost(doc = document) {
  let host = doc.getElementById(MODAL_HOST_ID);
  if (!host) {
    host = doc.createElement("div");
    host.id = MODAL_HOST_ID;
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "0",
      height: "0",
      pointerEvents: "auto",
      zIndex: "2147483603",
    });
    doc.body.appendChild(host);
  }
  return host;
}

function getActiveModalElement() {
  return activeModal?.element || null;
}

function getActiveTriggerElement() {
  return activeModal?.trigger || null;
}

function isWithinActiveModal(node) {
  const modal = getActiveModalElement();
  return !!(modal && node && (modal === node || modal.contains(node)));
}

function isWithinActiveTrigger(node) {
  const trigger = getActiveTriggerElement();
  return !!(trigger && node && (trigger === node || trigger.contains?.(node)));
}

function ensureStyles(doc = document) {
  if (doc.getElementById(`${MARKER_HOST_ID}_style`)) return;
  const style = doc.createElement("style");
  style.id = `${MARKER_HOST_ID}_style`;
  style.textContent = `
    .${MARKER_CLASS}{
      position: relative;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${DOT_COLORS.base};
      box-shadow: 0 0 6px rgba(104, 110, 227, 0.35);
    }
    .${UNDERLINE_CLASS}{
      position: absolute;
      height: 2px;
      border-radius: 1px;
      background-image: repeating-linear-gradient(
        to right,
        rgba(104, 110, 227, 0.9) 0 5px,
        transparent 5px 9px
      );
      background-repeat: repeat-x;
      pointer-events: none;
    }
    .${WRAPPER_CLASS}{
      position: absolute;
      width: 18px;
      height: 18px;
      transform: translate(-50%, -105%);
      display: flex;
      align-items: flex-end;
      justify-content: center;
      pointer-events: auto;
      cursor: pointer;
    }
    .${WRAPPER_CLASS}:hover ${MARKER_CLASS}{
      box-shadow: 0 0 10px rgba(104, 110, 227, 0.65);
    }
    .${MODAL_CLASS}{
      position: fixed;
      min-width: 352px;
      max-width: 396px;
      max-height: 840px;
      background: rgba(18, 18, 24, 0.96);
      border: 1px solid rgba(104, 110, 227, 0.32);
      border-radius: 18px;
      box-shadow: 0 18px 42px rgba(0,0,0,0.45);
      padding: 18px 20px 16px;
      color: #f4f4f7;
      font-size: 13px;
      line-height: 1.55;
      z-index: 2147483604;
      backdrop-filter: blur(16px);
    }
    .${MODAL_CLASS}.hidden{
      opacity: 0;
      pointer-events: none;
    }
    .${MODAL_CLASS}-header{
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
      font-weight: 600;
      letter-spacing: 0.2px;
    }
    .${MODAL_CLASS}-icon{
      width: 26px;
      height: 26px;
      border-radius: 9px;
      background: rgba(104,110,227,0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${DOT_COLORS.base};
      font-size: 14px;
    }
    .${MODAL_CLASS}-meta{
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      font-weight: 500;
      margin-bottom: 12px;
    }
    .${MODAL_CLASS}-meta span:last-child{
      color: rgba(244,244,247,0.75);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }
    .${MODAL_CLASS}-body{
      background: rgba(46, 46, 60, 0.6);
      border: 1px solid rgba(104, 110, 227, 0.25);
      border-radius: 12px;
      padding: 12px 14px;
      max-height: 440px;
      overflow-y: auto;
      color: rgba(244, 244, 247, 0.92);
      margin-bottom: 16px;
      word-break: break-word;
    }
    .${MODAL_CLASS}-body.${MODAL_CLASS}-body-loading{
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 13px;
      color: rgba(244,244,247,0.85);
    }
    .${MODAL_CLASS}-loading-text{
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .${MODAL_CLASS}-body.${MODAL_CLASS}-body-loading .ellipsis::after{
      content: "";
      display: inline-block;
      width: 24px;
      animation: vibModalEllipsis 1.2s steps(4,end) infinite;
      text-align: left;
    }
    .${MODAL_CLASS}-body.${MODAL_CLASS}-body-error{
      color: rgba(255, 168, 168, 0.92);
    }
    .${MODAL_CLASS}-body .${MODAL_CLASS}-error-note{
      background: rgba(255, 84, 84, 0.12);
      border: 1px solid rgba(255, 120, 120, 0.28);
      color: rgba(255, 210, 210, 0.92);
      padding: 8px 10px;
      border-radius: 8px;
      margin-bottom: 10px;
      font-weight: 500;
    }
    .${MODAL_CLASS}-label{
      font-size: 11px;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: rgba(244, 244, 247, 0.45);
      margin: 0 0 6px;
    }
    .${MODAL_CLASS}-body::-webkit-scrollbar{
      width: 6px;
    }
    .${MODAL_CLASS}-body::-webkit-scrollbar-track{
      background: rgba(56,56,70,0.6);
    }
    .${MODAL_CLASS}-body::-webkit-scrollbar-thumb{
      background: rgba(104,110,227,0.45);
      border-radius: 3px;
    }
    .${MODAL_CLASS}-actions{
      display: flex;
      justify-content: space-between;
      gap: 9px;
    }
    .${MODAL_CLASS}-actions button{
      flex: 1;
      border-radius: 18px;
      padding: 6px 12px;
      font-weight: 600;
      font-size: 10px;
      letter-spacing: 0.4px;
      border: none;
      cursor: pointer;
      transition: transform 0.15s ease, background 0.15s ease, opacity 0.15s ease;
    }
    .${MODAL_CLASS}-actions button:hover{
      transform: translateY(-1px);
    }
    .${MODAL_CLASS}-actions button.dismiss{
      background: rgba(18,18,24,0.96);
      border: 1px solid rgba(52,52,65,0.85);
      color: rgba(200,200,210,0.7);
    }
    .${MODAL_CLASS}-actions button.enhance{
      background: ${DOT_COLORS.base};
      color: #111119;
      box-shadow: 0 12px 30px rgba(104,110,227,0.3);
    }
    .${MODAL_CLASS}-actions button:disabled{
      opacity: 0.55;
      cursor: default;
      transform: none;
      box-shadow: none;
    }
    .${MODAL_CLASS}-actions button:disabled:hover{
      transform: none;
    }
    @keyframes vibModalEllipsis{
      0%{ content:""; }
      25%{ content:"."; }
      50%{ content:".."; }
      75%{ content:"..."; }
      100%{ content:""; }
    }
  `;
  doc.head.appendChild(style);
}

function ensureMirror(composer) {
  const doc = composer.ownerDocument || document;
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
  const cs = window.getComputedStyle(composer);
  const rect = composer.getBoundingClientRect();
  Object.assign(mirror.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    font: cs.font,
    lineHeight: cs.lineHeight,
    padding: cs.padding,
    border: cs.border,
    boxSizing: cs.boxSizing,
  });
  return mirror;
}

function encode(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/ /g, "&nbsp;")
    .replace(/\n/g, "<br>");
}

function measureSpanRect(composer, text, span, map) {
  if (map && map.length) {
    const rect = measureSpanRectFromMap(composer, span, map);
    if (rect) return rect;
  }
  return measureSpanRectMirror(composer, text, span);
}

function measureSpanRectMirror(composer, text, span) {
  const doc = composer.ownerDocument || document;
  const mirror = ensureMirror(composer);
  const before = encode(text.slice(0, span.start));
  const target = encode(text.slice(span.start, span.end) || " ");
  const after = encode(text.slice(span.end));
  mirror.innerHTML = `${before}<span class="vib-marker-measure">${target}</span>${after}`;
  const scrollTop = composer.scrollTop || 0;
  const scrollLeft = composer.scrollLeft || 0;
  mirror.scrollTop = scrollTop;
  mirror.scrollLeft = scrollLeft;
  const mirrorRect = mirror.getBoundingClientRect();
  const targetEl = mirror.querySelector(".vib-marker-measure");
  if (!targetEl) return null;
  const targetRect = targetEl.getBoundingClientRect();
  const composerRect = composer.getBoundingClientRect();
  return {
    left:
      composerRect.left + (targetRect.left - mirrorRect.left) - scrollLeft,
    top: composerRect.top + (targetRect.top - mirrorRect.top) - scrollTop,
    width: targetRect.width,
    height: targetRect.height,
  };
}

function measureSpanRectFromMap(composer, span, map) {
  const doc = composer.ownerDocument || document;
  const start = resolveMapEntry(map, span.start, 1);
  const end = resolveMapEntry(map, span.end - 1, -1);
  if (!start || !end) return null;
  try {
    const range = doc.createRange();
    const startOffset = Math.max(0, Math.min(start.offset, getNodeLength(start.node)));
    const endOffset = Math.max(0, Math.min(end.offset + 1, getNodeLength(end.node)));
    range.setStart(start.node, startOffset);
    range.setEnd(end.node, endOffset);
    const rects = range.getClientRects();
    if (!rects.length) return null;
    const first = rects[0];
    return {
      left: first.left,
      top: first.top,
      width: first.width,
      height: first.height,
    };
  } catch {
    return null;
  }
}

function resolveMapEntry(map, index, direction) {
  let i = index;
  while (i >= 0 && i < map.length) {
    const entry = map[i];
    if (entry && entry.node) {
      return { node: entry.node, offset: entry.offset };
    }
    i += direction;
  }
  return null;
}

function getNodeLength(node) {
  if (!node) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.data.length;
  const text = node.textContent || "";
  return text.length;
}

function getComposerId(composer) {
  let id = composerIds.get(composer);
  if (!id) {
    id = `cmp-${++markerSeq}`;
    composerIds.set(composer, id);
    composerById.set(id, composer);
  }
  return id;
}

function clearMarkersForComposer(host, composer, { preserveSuggestion = false } = {}) {
  const id = composerIds.get(composer);
  if (!id) return;
  const stack = new Error().stack;
  debugModal("clearMarkersForComposer:start", {
    composer,
    id,
    modalActive: activeModal?.composer === composer,
    stack,
  });
  host
    .querySelectorAll(
      `.${MARKER_CLASS}[data-cmp="${id}"], .${UNDERLINE_CLASS}[data-cmp="${id}"], .${WRAPPER_CLASS}[data-cmp="${id}"]`
    )
    .forEach((node) => {
      node.remove();
    });
  if (!preserveSuggestion) {
    if (activeModal?.composer === composer) {
      debugModal("clearMarkersForComposer:closing active modal", {
        composer,
        id,
        stack: new Error().stack,
      });
      hideSuggestionModal(true);
    }
    composerMeta.delete(composer);
    requestAnimationFrame(() => {
      const stillPresent = host.querySelector(
        `.${WRAPPER_CLASS}[data-cmp="${id}"]`
      );
      if (stillPresent) return;
      try {
        window.postMessage(
          {
            source: "VG",
            type: "HUD_INTENT_STATE",
            active: false,
            cmp: id,
          },
          "*"
        );
      } catch {}
    });
  }
}

const DOT_SIZE_BUCKETS = [6, 5, 4, 3];
const OPACITY_BUCKETS = [1, 0.75, 0.5];

function resolveSentenceIndex(span, segments) {
  if (!segments || !segments.length) return -1;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (span.start >= seg.start && span.start < seg.end) {
      return i;
    }
  }
  // If span starts after the last segment, treat it as the most recent
  if (span.start >= segments[segments.length - 1].start) {
    return segments.length - 1;
  }
  return -1;
}

function opacityForSentence(index, total) {
  if (index < 0 || total <= 0) return 1;
  const rank = total - 1 - index;
  if (rank <= 0) return 1;
  if (rank === 1) return 0.9;
  if (rank === 2) return 0.8;
  return 0.7;
}

function dotSizeForSentence(index, total) {
  if (index < 0 || total <= 0) return DOT_SIZE_BUCKETS[0];
  const rank = total - 1 - index;
  if (rank < DOT_SIZE_BUCKETS.length) {
    return DOT_SIZE_BUCKETS[rank];
  }
  return DOT_SIZE_BUCKETS[DOT_SIZE_BUCKETS.length - 1];
}

export function updateMarkers({
  composer,
  text,
  spans,
  map = null,
  segments = [],
  improveScore = null,
  rawText = "",
}) {
  if (!composer) return;
  const doc = composer.ownerDocument || document;
  ensureStyles(doc);
  const host = ensureHost(doc);
  const hasSpans = Array.isArray(spans) && spans.length > 0;
  clearMarkersForComposer(host, composer, { preserveSuggestion: hasSpans });
  if (!hasSpans) return;
  const id = getComposerId(composer);
  try {
    window.postMessage(
      {
        source: "VG",
        type: "HUD_INTENT_STATE",
        active: true,
        cmp: id,
      },
      "*"
    );
  } catch {}

  const prevMeta = composerMeta.get(composer) || {};
  const normalizedText = String(rawText || "");
  const textChanged = normalizedText !== (prevMeta.text || "");
  const nextMeta = updateComposerMeta(composer, {
    score:
      typeof improveScore === "number" ? improveScore : prevMeta.score ?? null,
    text: normalizedText,
    doc,
    status: textChanged ? "idle" : prevMeta.status || "idle",
    enhancedText: textChanged ? null : prevMeta.enhancedText ?? null,
    enhancedTextRaw: textChanged ? null : prevMeta.enhancedTextRaw ?? null,
    error: textChanged ? null : prevMeta.error ?? null,
    jobId: textChanged ? 0 : prevMeta.jobId ?? 0,
  });
  if (textChanged) {
    rerenderActiveModal(composer);
  } else if (activeModal?.composer === composer && nextMeta.status === "idle") {
    rerenderActiveModal(composer);
  }

  spans.forEach((span) => {
    const rect = measureSpanRect(composer, text, span, map);
    if (!rect) return;
    const role = span.role || "action";
    const sentenceIndex = resolveSentenceIndex(span, segments);
    const opacity = opacityForSentence(sentenceIndex, segments.length);
    const dotSize = dotSizeForSentence(sentenceIndex, segments.length);
    const composerRect = composer.getBoundingClientRect();
    const relativeTop = rect.top - composerRect.top;
    const relativeBottom = relativeTop + rect.height;
    if (relativeBottom < 0 || relativeTop > composerRect.height) {
      return;
    }
    const relativeLeft = rect.left - composerRect.left;
    const relativeRight = relativeLeft + rect.width;
    if (relativeRight < 0 || relativeLeft > composerRect.width) {
      return;
    }

    const wrapper = doc.createElement("div");
    wrapper.className = WRAPPER_CLASS;
    wrapper.dataset.cmp = id;
    wrapper.style.left = `${rect.left + rect.width / 2}px`;
    wrapper.style.top = `${rect.top - (-3.5)}px`;
    wrapper.style.opacity = String(Math.max(opacity, 0.35));
    host.appendChild(wrapper);

    const dot = doc.createElement("div");
    dot.className = MARKER_CLASS;
    dot.dataset.role = role;
    dot.dataset.cmp = id;
    dot.style.width = `${dotSize}px`;
    dot.style.height = `${dotSize}px`;
    dot.style.opacity = String(opacity);
    wrapper.appendChild(dot);

    const cancelPendingUnlock = () => {
      const timer = hoverUnlockTimers.get(wrapper);
      if (timer) {
        clearTimeout(timer);
        hoverUnlockTimers.delete(wrapper);
      }
    };
    const cancelHoverIntent = () => {
      const timer = hoverIntentTimers.get(wrapper);
      if (timer) {
        clearTimeout(timer);
        hoverIntentTimers.delete(wrapper);
      }
    };
    const triggerModalOpen = (reason = "intent-delay") => {
      cancelHoverIntent();
      cancelPendingUnlock();
      debugModal("wrapper:open", { wrapper, composer, reason });
      lockModal(wrapper);
      showSuggestionModal(composer, wrapper);
    };

    const handleEnter = (event) => {
      const buttons =
        typeof event?.buttons === "number" ? event.buttons : 0;
      debugModal("wrapper:pointerenter", {
        wrapper,
        composer,
        buttons,
        type: event?.type,
      });
      cancelPendingUnlock();
      cancelHoverIntent();
      if (buttons > 0) {
        debugModal("wrapper:pointerenter skipped due to buttons", {
          buttons,
        });
        return;
      }
      const timer = setTimeout(() => {
        triggerModalOpen("intent-delay");
      }, HOVER_INTENT_DELAY_MS);
      hoverIntentTimers.set(wrapper, timer);
    };
    const handleLeave = (event) => {
      const nextTarget = event?.relatedTarget;
      debugModal("wrapper:pointerleave", {
        wrapper,
        relatedTarget: nextTarget,
        coords: event ? { x: event.clientX, y: event.clientY } : null,
      });
      cancelHoverIntent();
      if (isWithinActiveModal(nextTarget)) return;
      cancelPendingUnlock();
      const timer = setTimeout(() => {
        hoverUnlockTimers.delete(wrapper);
        const modalEl = getActiveModalElement();
        const hoveringWrapper = wrapper?.matches?.(":hover");
        const hoveringModal = modalEl?.matches?.(":hover");
        if (hoveringWrapper || hoveringModal) {
          debugModal("wrapper:pointerleave cancel unlock due to hover");
          return;
        }
        unlockModal(wrapper);
      }, 120);
      hoverUnlockTimers.set(wrapper, timer);
    };
    const handlePointerDown = (event) => {
      if (event?.button !== 0 && event?.button !== undefined) return;
      debugModal("wrapper:pointerdown", {
        wrapper,
        composer,
        button: event?.button,
      });
      triggerModalOpen("pointerdown");
    };
    wrapper.addEventListener("pointerenter", handleEnter);
    wrapper.addEventListener("mouseenter", handleEnter);
    wrapper.addEventListener("pointerleave", handleLeave);
    wrapper.addEventListener("mouseleave", handleLeave);
    wrapper.addEventListener("pointerdown", handlePointerDown);
  });

}

export function clearMarkers(composer) {
  const doc = composer?.ownerDocument || document;
  const host = doc.getElementById(MARKER_HOST_ID);
  if (!host) return;
  debugModal("clearMarkers:start", {
    composer,
    hasComposer: Boolean(composer),
    modalActive: Boolean(activeModal),
    stack: new Error().stack,
  });
  if (!composer) {
    host.innerHTML = "";
    debugModal("clearMarkers:global reset -> hide modal");
    hideSuggestionModal(true);
    return;
  }
  clearMarkersForComposer(host, composer);
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatModalText(raw) {
  const clean = String(raw || "").trim();
  if (!clean) return "<em>No prompt text available.</em>";
  return escapeHtml(clean).replace(/\n/g, "<br>");
}

function stripPromptNameBlock(s) {
  if (!s) return s;
  let txt = s;
  const idx = txt.toLowerCase().indexOf("custom prompt:");
  if (idx >= 0) {
    txt = txt.slice(idx + "custom prompt:".length);
  }
  txt = txt.replace(/^\s*custom\s+prompt\s+name:\s*.*$/gim, "").trim();
  return txt;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function prettifyParagraphs(s) {
  if (!s) return s;
  let t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/\s*-\s+/g, (match) => match.replace(/^\s*/, " - "));
  t = t.replace(/(^|\n)\s*(\d+\)\s+)/g, (_m, p1, p2) => `${p1}\n${p2}`);
  const headings = [
    "Objective —",
    "Scope & Constraints —",
    "Safety & Conflicts —",
    "Verification —",
    "Output Format —",
  ];
  for (const h of headings) {
    const re = new RegExp(`(^|\\n)\\s*(${escapeRegExp(h)})`, "g");
    t = t.replace(re, (_m, p1, p2) => `${p1}\n${p2}`);
  }
  t = t
    .split("\n")
    .map((line) => {
      if (/^\s*-\s+/.test(line)) return line;
      line = line.replace(/:\s*(?:[-–—]\s*){1,}/g, " — ");
      line = line.replace(/(?:\s*[-–—]\s*){2,}/g, " ");
      line = line.replace(/\s*[-–—]\s*$/g, "");
      line = line.replace(/\s{2,}/g, " ");
      return line;
    })
    .join("\n");
  t = t.replace(/(?:^|\n)\s*-\s+/g, (m) => m.replace(/\s*-\s+/, "- "));
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

function formatEnhancedForComposer(enhanced) {
  let out = stripPromptNameBlock(enhanced);
  out = prettifyParagraphs(out);
  return out;
}

function escapeHTML(value) {
  return escapeHtml(value);
}

function formatEnhancedToHTML(enhanced) {
  const txt = formatEnhancedForComposer(enhanced);
  const blocks = txt.split(/\n{2,}/);
  const out = [];
  for (const rawBlock of blocks) {
    const block = rawBlock.trimEnd();
    if (!block) continue;
    const lines = block.split(/\n/);
    const isList = lines.length > 1 && lines.every((l) => /^\s*-\s+/.test(l));
    if (isList) {
      const items = lines.map((l) => l.replace(/^\s*-\s+/, "").trim());
      out.push(
        "<ul>" +
          items.map((li) => `<li>${escapeHTML(li)}</li>`).join("") +
          "</ul>"
      );
      continue;
    }
    const looksHeading = /—\s*$/.test(lines[0].trim());
    if (looksHeading && lines.length === 1) {
      const h = lines[0].trim();
      out.push(`<p><strong>${escapeHTML(h)}</strong></p>`);
      continue;
    }
    const inner = lines.map(escapeHTML).join("<br>");
    out.push(`<p>${inner}</p>`);
  }
  return out.join("\n<p><br></p>\n");
}

function showSuggestionModal(composer, targetEl) {
  if (hideModalTimer) {
    clearTimeout(hideModalTimer);
    hideModalTimer = null;
  }
  debugModal("showSuggestionModal:start", {
    composer,
    target: targetEl,
    metaAvailable: composerMeta.has(composer),
  });
  const meta = composerMeta.get(composer);
  if (!meta || !meta.text) return;
  const { doc, score, text } = meta;
  const modalHost = ensureModalHost(doc);

  let modal = modalHost.querySelector(`.${MODAL_CLASS}`);
  if (!modal) {
    modal = doc.createElement("div");
    modal.className = `${MODAL_CLASS} hidden`;
    modalHost.appendChild(modal);
    const handleEnter = (event) => {
      debugModal("modal:pointerenter", {
        type: event?.type,
        relatedTarget: event?.relatedTarget,
      });
      lockModal(modal);
    };
    const handleLeave = (event) => {
      if (modalPointerDown) return;
      const next =
        event?.relatedTarget ||
        (event ? doc.elementFromPoint(event.clientX, event.clientY) : null);
      debugModal("modal:pointerleave", {
        type: event?.type,
        relatedTarget: event?.relatedTarget,
        next,
        pointerDown: modalPointerDown,
        coords: event ? { x: event.clientX, y: event.clientY } : null,
      });
      if (isWithinActiveModal(next)) return;
      unlockModal(modal);
      if (isWithinActiveTrigger(next)) return;
      const trigger = getActiveTriggerElement();
      if (trigger) {
        unlockModal(trigger);
      }
    };
    const handlePointerDown = () => {
      modalPointerDown = true;
      modalDebugState.pointerDown = true;
      modalDebugState.lastEvent = "pointerdown";
      debugModal("modal:pointerdown");
      lockModal(modal);
      if (!docPointerUpHandler) {
        docPointerUpHandler = (evt) => {
          modalPointerDown = false;
          modalDebugState.pointerDown = false;
          modalDebugState.lastEvent = "pointerup";
          const target = evt?.target;
          if (!isWithinActiveModal(target) && !isWithinActiveTrigger(target)) {
            unlockModal(modal);
          } else {
            lockModal(modal);
            scheduleHideModal();
          }
          if (docPointerUpHandler) {
            doc.removeEventListener("pointerup", docPointerUpHandler, true);
            docPointerUpHandler = null;
            debugModal("modal:pointerup handler removed");
          }
        };
        doc.addEventListener("pointerup", docPointerUpHandler, true);
        debugModal("modal:pointerup handler attached");
      }
      if (!docPointerDownHandler) {
        docPointerDownHandler = (evt) => {
          const target = evt?.target;
          if (!isWithinActiveModal(target) && !isWithinActiveTrigger(target)) {
            debugModal("doc:pointerdown outside modal", { target });
            hideSuggestionModal(true);
          }
        };
        doc.addEventListener("pointerdown", docPointerDownHandler, true);
        debugModal("modal:pointerdown outside handler attached");
      }
    };
    const handleWheel = () => {
      lockModal(modal);
      debugModal("modal:wheel", {
        wheelTimerActive: Boolean(modalWheelTimer),
      });
      if (modalWheelTimer) {
        clearTimeout(modalWheelTimer);
        modalWheelTimer = null;
      }
      modalWheelTimer = setTimeout(() => {
        modalWheelTimer = null;
        modalDebugState.wheelTimer = false;
        modalDebugState.lastEvent = "wheel-timeout";
        debugModal("modal:wheel timeout -> unlock");
        unlockModal(modal);
      }, 1000);
      modalDebugState.wheelTimer = true;
      modalDebugState.lastEvent = "wheel";
      scheduleHideModal();
    };
    modal.addEventListener("pointerenter", handleEnter);
    modal.addEventListener("mouseenter", handleEnter);
    modal.addEventListener("pointerleave", handleLeave);
    modal.addEventListener("mouseleave", handleLeave);
    modal.addEventListener("pointerdown", handlePointerDown);
    modal.addEventListener("wheel", handleWheel, { passive: true });
  } else {
    modal.classList.add("hidden");
  }

  renderModal(modal, composer);

  modal.classList.remove("hidden");
  modal.style.opacity = "1";
  modal.style.pointerEvents = "auto";
  debugModal("showSuggestionModal:rendered", {
    modal,
    score,
    textLength: text?.length ?? 0,
  });

  activeModal = { element: modal, composer, trigger: targetEl, doc };
  positionActiveModal();
  debugModal("showSuggestionModal:active", {
    locks: modalLocks.size,
    pointerDown: modalPointerDown,
  });
}

function lockModal(source) {
  modalLocks.add(source);
  modalDebugState.locks = modalLocks.size;
  modalDebugState.lastEvent = "lock";
  debugModal("lockModal", {
    source,
    lockCount: modalLocks.size,
    pointerDown: modalPointerDown,
    wheelTimerActive: Boolean(modalWheelTimer),
  });
  if (hideModalTimer) {
    clearTimeout(hideModalTimer);
    hideModalTimer = null;
    debugModal("lockModal:cleared hide timer");
  }
}

function unlockModal(source) {
  modalLocks.delete(source);
  modalDebugState.locks = modalLocks.size;
  modalDebugState.lastEvent = "unlock";
  debugModal("unlockModal", {
    source,
    lockCount: modalLocks.size,
    pointerDown: modalPointerDown,
    wheelTimerActive: Boolean(modalWheelTimer),
  });
  if (!modalLocks.size) {
    scheduleHideModal();
  }
}

function scheduleHideModal(force = false) {
  if (hideModalTimer) clearTimeout(hideModalTimer);
  if (!force && (modalLocks.size || modalPointerDown)) {
    debugModal("scheduleHideModal:skipped", {
      force,
      lockCount: modalLocks.size,
      pointerDown: modalPointerDown,
    });
    return;
  }
  hideModalTimer = setTimeout(() => {
    debugModal("hide timer fired", {
      force,
      lockCount: modalLocks.size,
      pointerDown: modalPointerDown,
    });
    hideSuggestionModal();
  }, force ? 0 : 160);
  debugModal("scheduleHideModal:set", {
    force,
    lockCount: modalLocks.size,
    pointerDown: modalPointerDown,
  });
}

function hideSuggestionModal(immediate = false) {
  if (hideModalTimer) {
    clearTimeout(hideModalTimer);
    hideModalTimer = null;
  }
  if (!activeModal) return;
  const { element, doc } = activeModal;
  if (!element) return;
  debugModal("hideSuggestionModal", {
    immediate,
    lockCount: modalLocks.size,
    pointerDown: modalPointerDown,
  });
  modalLocks.clear();
  modalDebugState.locks = 0;
  modalPointerDown = false;
  modalDebugState.pointerDown = false;
  if (modalWheelTimer) {
    clearTimeout(modalWheelTimer);
    modalWheelTimer = null;
    modalDebugState.wheelTimer = false;
    debugModal("hideSuggestionModal:cleared wheel timer");
  }
  if (docPointerUpHandler && doc) {
    doc.removeEventListener("pointerup", docPointerUpHandler, true);
    docPointerUpHandler = null;
    debugModal("hideSuggestionModal:removed pointerup handler");
  }
  if (docPointerDownHandler && doc) {
    doc.removeEventListener("pointerdown", docPointerDownHandler, true);
    docPointerDownHandler = null;
    debugModal("hideSuggestionModal:removed pointerdown handler");
  }
  if (immediate) {
    element.remove();
  } else {
    element.classList.add("hidden");
    setTimeout(() => {
      if (element.parentNode) element.parentNode.removeChild(element);
    }, 160);
  }
  activeModal = null;
}

function buildModalContent(meta = {}) {
  const {
    score = null,
    text = "",
    status = "idle",
    enhancedText = "",
    error = null,
  } = meta;
  const scoreLabel = typeof score === "number" ? `${score}%` : "—";
  const label =
    status === "success" ? "Enhanced Prompt" : "Current Prompt";
  const bodyClasses = [`${MODAL_CLASS}-body`];
  let bodyHtml = "";

  if (status === "loading") {
    bodyClasses.push(`${MODAL_CLASS}-body-loading`);
    bodyHtml = `<div class="${MODAL_CLASS}-loading-text">Enhancing<span class="ellipsis"></span></div>`;
  } else if (status === "success") {
    bodyHtml = formatModalText(enhancedText);
  } else if (status === "error") {
    bodyClasses.push(`${MODAL_CLASS}-body-error`);
    const msg = escapeHtml(error || "Enhance failed. Try again.");
    bodyHtml = `<div class="${MODAL_CLASS}-error-note">${msg}</div>${formatModalText(text)}`;
  } else {
    bodyHtml = formatModalText(text);
  }

  const primaryLabel = status === "success" ? "Replace" : "Enhance";
  const primaryRole = status === "success" ? "replace" : "enhance";
  const primaryDisabled = status === "loading";
  const primaryDisabledAttr = primaryDisabled ? "disabled" : "";

  return `
    <div class=\"${MODAL_CLASS}-header\">
      <div class=\"${MODAL_CLASS}-icon\">✦</div>
      <div>Suggestion</div>
    </div>
    <div class=\"${MODAL_CLASS}-meta\">
      <span>Enhance Prompt</span>
      <span>Improve Response ${scoreLabel}</span>
    </div>
    <div class=\"${MODAL_CLASS}-label\">${label}</div>
    <div class=\"${bodyClasses.join(" ")}\">${bodyHtml}</div>
    <div class=\"${MODAL_CLASS}-actions\">
      <button class=\"dismiss\">Dismiss</button>
      <button class=\"enhance\" data-role=\"${primaryRole}\" ${primaryDisabledAttr}>${primaryLabel}</button>
    </div>
  `;
}

function renderModal(modal, composer) {
  if (!modal || !composer) return;
  const meta = composerMeta.get(composer);
  if (!meta) return;
  modal.innerHTML = buildModalContent(meta);
  wireModalActions(modal, composer);
}

function positionActiveModal() {
  if (!activeModal) return;
  const { element: modal, trigger } = activeModal;
  if (!modal || !trigger) return;
  const padding = 20;
  const targetRect = trigger.getBoundingClientRect();
  const offsetWidth = modal.offsetWidth;
  const offsetHeight = modal.offsetHeight;

  let left = targetRect.right + 16;
  let top = targetRect.top - offsetHeight / 2;

  if (left + offsetWidth + padding > window.innerWidth) {
    left = Math.max(
      padding,
      targetRect.left - offsetWidth - 16
    );
  }
  if (left < padding) left = padding;

  if (top + offsetHeight + padding > window.innerHeight) {
    top = Math.max(
      padding,
      window.innerHeight - offsetHeight - padding
    );
  } else if (top < padding) {
    top = padding;
  }

  modal.style.left = `${left}px`;
  modal.style.top = `${top}px`;
}

function wireModalActions(modal, composer) {
  const doc = composer.ownerDocument || document;
  const dismissBtn = modal.querySelector("button.dismiss");
  const primaryBtn = modal.querySelector("button.enhance");
  const meta = composerMeta.get(composer) || {};

  dismissBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    hideSuggestionModal(true);
  });

  if (!primaryBtn) return;
  if (primaryBtn.disabled) return;

  primaryBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const role = primaryBtn.dataset.role || "enhance";
    if (role === "replace") {
      handleReplaceRequest(composer);
    } else {
      startEnhanceFlow(composer, doc);
    }
  });
}

function startEnhanceFlow(composer, doc) {
  const meta = composerMeta.get(composer) || {};
  if (meta.status === "loading") return;
  const text = String(meta.text || "").trim();
  if (text.length < 16) {
    updateComposerMeta(composer, {
      status: "error",
      error: "Prompt is too short to enhance.",
    });
    rerenderActiveModal(composer);
    return;
  }

  const jobId = ++enhanceJobSeq;
  updateComposerMeta(composer, {
    status: "loading",
    error: null,
    jobId,
  });
  rerenderActiveModal(composer);

  const hostDoc = doc || composer.ownerDocument || document;
  try {
    hostDoc.dispatchEvent(
      new CustomEvent("VIB_ENHANCE_MODAL_ENHANCE", {
        detail: { composer, text },
      })
    );
  } catch {}

  callBackgroundEnhance(text).then((resp) => {
    const current = composerMeta.get(composer);
    if (!current || current.jobId !== jobId) return;
    if (!resp || !resp.ok || !resp.text) {
      updateComposerMeta(composer, {
        status: "error",
        error: resp?.error || "Enhance failed. Try again.",
        jobId,
      });
      rerenderActiveModal(composer);
      return;
    }
    const enhancedRaw = String(resp.text || "");
    const formatted = formatEnhancedForComposer(enhancedRaw);
    updateComposerMeta(composer, {
      status: "success",
      error: null,
      enhancedTextRaw: enhancedRaw,
      enhancedText: formatted,
      jobId,
    });
    rerenderActiveModal(composer);
  }).catch((err) => {
    const current = composerMeta.get(composer);
    if (!current || current.jobId !== jobId) return;
    updateComposerMeta(composer, {
      status: "error",
      error: err?.message || "Enhance failed. Try again.",
      jobId,
    });
    rerenderActiveModal(composer);
  });
}

function callBackgroundEnhance(text) {
  const message = {
    type: "VG_AI_ENHANCE",
    payload: { text, surface: "composer" },
  };
  return sendRuntimeMessage(message).then((resp) => resp || null);
}

function handleReplaceRequest(composer) {
  const meta = composerMeta.get(composer);
  if (!meta || !meta.enhancedTextRaw) return;
  const applied = applyEnhancedToComposer(composer, meta.enhancedTextRaw);
  if (applied) {
    updateComposerMeta(composer, {
      status: "idle",
      text: meta.enhancedText || formatEnhancedForComposer(meta.enhancedTextRaw),
      enhancedText: null,
      enhancedTextRaw: null,
      error: null,
      jobId: 0,
    });
    hideSuggestionModal(true);
  }
}

function applyEnhancedToComposer(composer, enhancedRaw) {
  if (!composer || !enhancedRaw) return false;
  const formattedPlain = formatEnhancedForComposer(enhancedRaw);
  if ("value" in composer) {
    try {
      composer.focus?.();
      composer.value = formattedPlain;
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (e) {
      console.warn("[VG][modal] replace input failed:", e);
      return false;
    }
  }
  try {
    composer.focus?.();
    const html = formatEnhancedToHTML(enhancedRaw);
    composer.innerHTML = html;
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch (e) {
    console.warn("[VG][modal] rich text replace failed, falling back to plain text:", e);
    try {
      composer.textContent = formattedPlain;
      composer.dispatchEvent(new Event("input", { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (err) {
      console.warn("[VG][modal] plain-text fallback failed:", err);
      return false;
    }
  }
}

export function isModalActiveForComposer(composer) {
  return Boolean(activeModal && activeModal.composer === composer);
}

export function getMarkerComposerId(composer) {
  return getComposerId(composer);
}

function handleHudRequests(event) {
  const msg = event?.data || {};
  if (!msg || msg.source !== "VG") return;
  if (msg.type === "OPEN_SUGGESTION_MODAL") {
    const id = String(msg.cmp || "");
    if (!id) return;
    const composer = composerById.get(id);
    if (!composer) return;
    const doc = composer.ownerDocument || document;
    const wrapper = doc.querySelector(
      `.${WRAPPER_CLASS}[data-cmp="${id}"]`
    );
    if (wrapper) {
      showSuggestionModal(composer, wrapper);
    }
  }
}

window.addEventListener("message", handleHudRequests);
