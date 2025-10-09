// src/content/enhance/highlight-dom.js
// Applies role-based inline highlights inside composer nodes.

import { ENHANCE_IDS, Z_INDEX_BASE } from "./config.js";

const SPAN_CLASS = "vib-underline";
const STYLE_ID = "__vib_enh_style__";
const INPUT_CLASS = "vib-underline-input";

function ensureHost(doc = document) {
  let host = doc.getElementById(ENHANCE_IDS.underlineHost);
  if (!host) {
    host = doc.createElement("div");
    host.id = ENHANCE_IDS.underlineHost;
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: "0",
      height: "0",
      pointerEvents: "none",
      zIndex: String(Z_INDEX_BASE),
    });
    doc.body.appendChild(host);
  }
  return host;
}

function ensureStyles(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${SPAN_CLASS}{
      border-bottom: 1.5px dashed var(--vib-underline, #a0a2da);
      padding-bottom: 1px;
    }
    .${SPAN_CLASS}[data-role="action"]{ border-color: var(--vib-underline-action, #8e90d3); }
    .${SPAN_CLASS}[data-role="topic"]{ border-color: var(--vib-underline-topic, #b3b5e3); }
    .${SPAN_CLASS}[data-role="recipient"]{ border-color: var(--vib-underline-recipient, #a0a2da); }
    textarea.${INPUT_CLASS}, input.${INPUT_CLASS}{
      box-shadow: inset 0 -1.5px var(--vib-underline, #a0a2da);
    }
  `;
  doc.head.appendChild(style);
}

function replaceWithChildren(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
  parent.normalize();
}

function collectTextNodes(el) {
  const doc = el.ownerDocument || document;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  const nodes = [];
  let node;
  let offset = 0;
  while ((node = walker.nextNode())) {
    const length = node.textContent.length;
    nodes.push({ node, start: offset, end: offset + length });
    offset += length;
  }
  return nodes;
}

function wrapRange(el, span, doc) {
  const { start, end, role } = span;
  if (end <= start) return;
  const nodes = collectTextNodes(el);
  nodes.forEach(({ node, start: nodeStart, end: nodeEnd }) => {
    if (end <= nodeStart || start >= nodeEnd) return;
    const range = doc.createRange();
    const localStart = Math.max(start, nodeStart) - nodeStart;
    const localEnd = Math.min(end, nodeEnd) - nodeStart;
    range.setStart(node, localStart);
    range.setEnd(node, localEnd);
    const wrapper = doc.createElement("span");
    wrapper.className = SPAN_CLASS;
    wrapper.dataset.role = role || "action";
    range.surroundContents(wrapper);
  });
}

export function mountHighlightHost(doc = document) {
  ensureHost(doc);
  ensureStyles(doc);

  function applyHighlights(composerEl, spans) {
    if (!composerEl) return;
    clearHighlights(composerEl);
    if (!spans || !spans.length) return;
    if ("value" in composerEl) {
      composerEl.classList.add(INPUT_CLASS);
      return;
    }
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    sorted.forEach((span) => wrapRange(composerEl, span, doc));
  }

  function clearHighlights(composerEl) {
    if (!composerEl) return;
    if ("value" in composerEl) {
      composerEl.classList.remove(INPUT_CLASS);
      return;
    }
    const underlines = composerEl.querySelectorAll(`span.${SPAN_CLASS}`);
    underlines.forEach(replaceWithChildren);
  }

  function destroy() {
    // no-op placeholder for parity
  }

  return {
    applyHighlights,
    clearHighlights,
    destroy,
  };
}
