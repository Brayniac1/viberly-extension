// src/content/enhance/read-composer.js
// Reads plain text from a composer element (textarea, input, or contenteditable).

import { isComposerElement } from "./composer-watch.js";

function readInput(el) {
  return { text: String(el.value || ""), el, map: null };
}

function readContentEditable(el) {
  try {
    const txt = el.innerText != null ? el.innerText : el.textContent || "";
    const map = buildDomMap(el, String(txt));
    return { text: String(txt), el, map };
  } catch {
    return { text: String(el.textContent || ""), el, map: null };
  }
}

function buildDomMap(root, text) {
  const doc = root.ownerDocument || document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const map = new Array(text.length);
  let node = walker.nextNode();
  let offset = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") {
      map[i] = null;
      continue;
    }
    while (node) {
      const content = node.textContent || "";
      if (offset >= content.length) {
        node = walker.nextNode();
        offset = 0;
        continue;
      }
      const nodeChar = content[offset];
      if (nodeChar === char) {
        map[i] = { node, offset };
        offset++;
        break;
      }
      offset++;
    }
    if (!node) break;
  }
  return map;
}

export function readComposer(el) {
  if (!isComposerElement(el)) {
    return { text: "", el: null, map: null };
  }
  if ("value" in el) return readInput(el);
  return readContentEditable(el);
}
