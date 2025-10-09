// src/content/enhance/read-composer.js
// Reads plain text from a composer element (textarea, input, or contenteditable).

import { isComposerElement } from "./composer-watch.js";

function readInput(el) {
  return { text: String(el.value || ""), el };
}

function readContentEditable(el) {
  try {
    const txt = el.innerText != null ? el.innerText : el.textContent || "";
    return { text: String(txt), el };
  } catch {
    return { text: String(el.textContent || ""), el };
  }
}

export function readComposer(el) {
  if (!isComposerElement(el)) {
    return { text: "", el: null };
  }
  if ("value" in el) return readInput(el);
  return readContentEditable(el);
}
