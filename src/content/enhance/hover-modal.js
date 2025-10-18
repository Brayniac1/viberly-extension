// src/content/enhance/hover-modal.js
// Hover modal skeleton for Phase 1 with a simple open/close logger.

import { ENH_CFG, ENHANCE_IDS, Z_INDEX_BASE, LOG_PREFIX } from "./config.js";

export function mountHoverModal(doc = document) {
  const existingHost = doc.getElementById(ENHANCE_IDS.modalHost);
  const host = existingHost || doc.createElement("div");
  host.id = ENHANCE_IDS.modalHost;
  if (!existingHost) {
    Object.assign(host.style, {
      position: "fixed",
      left: "0",
      top: "0",
      zIndex: String(Z_INDEX_BASE + 1),
      pointerEvents: "none",
    });
    doc.body.appendChild(host);
  }

  let modal = host.querySelector(`#${ENHANCE_IDS.modalId}`);
  if (!modal) {
    modal = doc.createElement("div");
    modal.id = ENHANCE_IDS.modalId;
    modal.hidden = true;
    Object.assign(modal.style, {
      minWidth: "140px",
      maxWidth: "220px",
      padding: "6px 12px",
      borderRadius: "8px",
      border: `1px solid ${ENH_CFG.COLORS.modalBorder}`,
      background: ENH_CFG.COLORS.modalBgDark,
      color: ENH_CFG.COLORS.item,
      font:
        "500 13px/1.3 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      boxShadow: "0 4px 8px rgba(0,0,0,.10)",
      pointerEvents: "auto",
    });
    modal.textContent = "Suggestions (stub)";
    host.appendChild(modal);
  }

  function openStub(rect) {
    if (rect) {
      modal.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(
        rect.top
      )}px)`;
    }
    modal.hidden = false;
    if (typeof window !== "undefined" && window.VG_INTENT_DEBUG) {
      console.debug(`${LOG_PREFIX} hover modal open (stub)`);
    }
  }

  function close() {
    modal.hidden = true;
  }

  function destroy() {
    host.remove();
  }

  return { host, modal, openStub, close, destroy };
}
