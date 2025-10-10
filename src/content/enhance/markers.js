// src/content/enhance/markers.js
// Renders floating markers above action/recipient/topic spans.

const MARKER_HOST_ID = "__vib_marker_host__";
const MARKER_CLASS = "vib-marker-dot";
const UNDERLINE_CLASS = "vib-marker-underline";
const MIRROR_ID = "__vib_marker_mirror__";

const composerIds = new WeakMap();
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
      pointerEvents: "none",
      zIndex: "2147483602",
    });
    doc.body.appendChild(host);
  }
  return host;
}

function ensureStyles(doc = document) {
  if (doc.getElementById(`${MARKER_HOST_ID}_style`)) return;
  const style = doc.createElement("style");
  style.id = `${MARKER_HOST_ID}_style`;
  style.textContent = `
    .${MARKER_CLASS}{
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #a0a2da;
      box-shadow: 0 0 4px rgba(0,0,0,0.25);
      transform: translate(-50%, -100%);
    }
    .${MARKER_CLASS}[data-role="action"]{ background:#8e90d3; }
    .${MARKER_CLASS}[data-role="topic"]{ background:#b3b5e3; }
    .${MARKER_CLASS}[data-role="recipient"]{ background:#7f81c5; }
    .${UNDERLINE_CLASS}{
      position: absolute;
      height: 2px;
      border-radius: 1px;
      background-image: repeating-linear-gradient(
        to right,
        #a0a2da 0 5px,
        transparent 5px 9px
      );
      background-repeat: repeat-x;
      pointer-events: none;
      opacity: 0.95;
    }
    .${UNDERLINE_CLASS}[data-role="action"]{
      background-image: repeating-linear-gradient(
        to right,
        #8e90d3 0 5px,
        transparent 5px 9px
      );
    }
    .${UNDERLINE_CLASS}[data-role="topic"]{
      background-image: repeating-linear-gradient(
        to right,
        #b3b5e3 0 5px,
        transparent 5px 9px
      );
    }
    .${UNDERLINE_CLASS}[data-role="recipient"]{
      background-image: repeating-linear-gradient(
        to right,
        #7f81c5 0 5px,
        transparent 5px 9px
      );
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
  const mirrorRect = mirror.getBoundingClientRect();
  const targetEl = mirror.querySelector(".vib-marker-measure");
  if (!targetEl) return null;
  const targetRect = targetEl.getBoundingClientRect();
  const composerRect = composer.getBoundingClientRect();
  return {
    left: composerRect.left + (targetRect.left - mirrorRect.left),
    top: composerRect.top + (targetRect.top - mirrorRect.top),
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
  }
  return id;
}

function clearMarkersForComposer(host, composer) {
  const id = composerIds.get(composer);
  if (!id) return;
  host
    .querySelectorAll(
      `.${MARKER_CLASS}[data-cmp="${id}"], .${UNDERLINE_CLASS}[data-cmp="${id}"]`
    )
    .forEach((node) => {
      node.remove();
    });
}

export function updateMarkers({ composer, text, spans, map = null }) {
  if (!composer || !text) return;
  const doc = composer.ownerDocument || document;
  ensureStyles(doc);
  const host = ensureHost(doc);
  clearMarkersForComposer(host, composer);
  if (!spans || !spans.length) return;
  const id = getComposerId(composer);
  spans.forEach((span) => {
    const rect = measureSpanRect(composer, text, span, map);
    if (!rect) return;
    const role = span.role || "action";

    const dot = doc.createElement("div");
    dot.className = MARKER_CLASS;
    dot.dataset.role = role;
    dot.dataset.cmp = id;
    dot.style.left = `${rect.left + rect.width / 2}px`;
    dot.style.top = `${rect.top - (-2)}px`;
    host.appendChild(dot);
  });
}

export function clearMarkers(composer) {
  const doc = composer?.ownerDocument || document;
  const host = doc.getElementById(MARKER_HOST_ID);
  if (!host) return;
  if (!composer) {
    host.innerHTML = "";
    return;
  }
  clearMarkersForComposer(host, composer);
}
