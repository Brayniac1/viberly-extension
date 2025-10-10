// src/content/enhance/highlight-dom.js
// Applies the dashed underline class without mutating composer text.

import { ENHANCE_IDS, Z_INDEX_BASE } from "./config.js";

const TOKEN_CLASS = "vib-underline";
const STYLE_ID = "__vib_enh_styles__";

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
    .${TOKEN_CLASS}{
      text-decoration-line: underline;
      text-decoration-style: dashed;
      text-decoration-color: #a0a2da;
      text-decoration-thickness: 1.5px;
      text-underline-offset: 3px;
    }
  `;
  doc.head.appendChild(style);
}

export function mountHighlightHost(doc = document) {
  ensureHost(doc);
  ensureStyles(doc);

  function applyFullUnderline(composerEl) {
    if (!composerEl) return;
    composerEl.classList.add(TOKEN_CLASS);
  }

  function clearUnderline(composerEl) {
    if (!composerEl) return;
    composerEl.classList.remove(TOKEN_CLASS);
  }

  function clearAll() {
    doc.querySelectorAll(`.${TOKEN_CLASS}`).forEach((node) => {
      node.classList.remove(TOKEN_CLASS);
    });
  }

  return {
    applyFullUnderline,
    clearUnderline,
    clearAll,
  };
}
