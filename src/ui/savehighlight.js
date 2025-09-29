// src/ui/savehighlight.js
(() => {
  // Prevent double-injection (MV3 can re-run on SPA navigations)
  if (window.__VIB_SAVEHL_ACTIVE__) return;
  window.__VIB_SAVEHL_ACTIVE__ = true;

  const ID_HOST   = "__vib_savepill_host__";
  const ID_TOAST  = "__vib_savepill_toast__";
  const Z         = 2147483600;
  const PILL_TEXT = "Save to Viberly";

  // Do not show the Save pill in composers (editor inputs). Enhance owns that surface.
  const BLOCK_IN_COMPOSER = true;

  // Heuristics to identify “composer” nodes across sites
  const COMPOSER_SELECTORS = [
    'textarea',
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input[type="url"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '.ProseMirror',            // many rich text editors
    '.ql-editor',              // Quill
    '.monaco-editor',          // VS Code-style
    '[data-slate-editor="true"]'
  ];

  function isComposerElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      return ['text','search','email','url','tel','password'].includes(t);
    }
    const ce = el.getAttribute && el.getAttribute('contenteditable');
    if (ce && ce.toLowerCase() === 'true') return true;
    if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
    try {
      if (el.matches && COMPOSER_SELECTORS.some(sel => el.matches(sel))) return true;
    } catch {}
    return false;
  }

  function nodeIsInsideComposer(node) {
    for (let n = node; n; n = n.parentNode) {
      if (isComposerElement(n)) return true;
      if (n === document || n === document.documentElement) break;
    }
    const ae = document.activeElement;
    if (isComposerElement(ae)) return true;
    return false;
  }


  // Length guardrails (avoid noise / huge blobs)
  const MIN_LEN = 16;
  const MAX_LEN = 10000;

  // --- host container with Shadow DOM so site CSS can't break us
  let host = document.getElementById(ID_HOST);
  if (!host) {
    host = document.createElement("div");
    host.id = ID_HOST;
    Object.assign(host.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      width: "0",
      height: "0",
      zIndex: String(Z),
      pointerEvents: "none"
    });
    (document.documentElement || document.body).appendChild(host);
  }
  const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;


// --- pill button (hidden by default)
const pill = document.createElement("button");
pill.type = "button";
pill.textContent = PILL_TEXT;
Object.assign(pill.style, {
  position: "fixed",
  transform: "translate(-50%, -100%)", // position from bottom/right of selection rect
  padding: "8px 12px",
  borderRadius: "999px",
  font: "500 12px/1.2 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  background: "#1f2937",         // dark gray (default)
  color: "#fff",                 // white text
  border: "1px solid #374151",   // darker gray border
  boxShadow: "0 6px 18px rgba(0,0,0,.3)",
  cursor: "pointer",
  display: "none",
  pointerEvents: "auto",
  userSelect: "none",
  transition: "background-color .12s ease, color .12s ease, border-color .12s ease"
});
root.appendChild(pill);

// hover = purple
pill.addEventListener("mouseenter", () => {
  pill.style.background = "#7c3aed";
  pill.style.color = "#fff";
  pill.style.border = "1px solid #6b21a8";
});
pill.addEventListener("mouseleave", () => {
  pill.style.background = "#1f2937";   // back to dark gray
  pill.style.color = "#fff";
  pill.style.border = "1px solid #374151";
});


  // --- tiny toast
  let toastEl = null;
  function toast(msg, ms = 1400) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = ID_TOAST;
      Object.assign(toastEl.style, {
        position: "fixed",
        left: "50%",
        bottom: "28px",
        transform: "translateX(-50%)",
        padding: "10px 14px",
        borderRadius: "10px",
        background: "#0f1116",
        color: "#e5e7eb",
        border: "1px solid #242634",
        font: "500 12px/1.1 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        boxShadow: "0 8px 24px rgba(0,0,0,.35)",
        zIndex: String(Z),
        pointerEvents: "none",
        opacity: "0",
        transition: "opacity .15s ease",
      });
      root.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastEl.__hideTimer);
    toastEl.__hideTimer = setTimeout(() => (toastEl.style.opacity = "0"), ms);
  }

  // --- HUD status badge (anchored to the V pill iframe)
  const HUD_IFRAME_ID = "__vg_iframe_hud__";
  let hudBadge = null;
  let hudBadgeHideTimer = null;

  function ensureHudBadge() {
    if (hudBadge) return hudBadge;
    hudBadge = document.createElement("div");
    Object.assign(hudBadge.style, {
      position: "fixed",
      zIndex: String(Z),
      pointerEvents: "none",
      padding: "6px 10px",
      borderRadius: "999px",
      font: "600 11px/1 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      background: "#111827",
      color: "#e5e7eb",
      border: "1px solid #374151",
      boxShadow: "0 8px 24px rgba(0,0,0,.35)",
      opacity: "0",
      transition: "opacity .14s ease, transform .14s ease",
      transform: "translateY(-6px)"
    });
    root.appendChild(hudBadge);
    return hudBadge;
  }

  function getHudRect() {
    try {
      const hud = document.getElementById(HUD_IFRAME_ID);
      if (!hud || !hud.isConnected) return null;
      const r = hud.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const visible = r.bottom >= 0 && r.right >= 0 && r.top <= vh && r.left <= vw;
      if (!visible) return null;
      return r;
    } catch { return null; }
  }

  function positionBadgeByHud() {
    const r = getHudRect();
    if (!hudBadge || !r) {
      if (hudBadge) hudBadge.style.opacity = "0";
      return;
    }
    const gap = 8;
    const x = r.right + gap;
    const y = r.top + r.height / 2;
    hudBadge.style.left = Math.round(x) + "px";
    hudBadge.style.top  = Math.round(y) + "px";
    hudBadge.style.transform = "translateY(-50%)";
  }

function showHudStatus(text, variant = "neutral") {
  const b = ensureHudBadge();
  if (variant === "neutral") {
    b.style.background = "#111827";  // gray-900
    b.style.color = "#e5e7eb";       // gray-200
    b.style.border = "1px solid #374151";
  } else if (variant === "ok") {
    // Viberly purple for the Saved state
    b.style.background = "#7c3aed";  // brand purple
    b.style.color = "#ffffff";
    b.style.border = "1px solid #6b21a8"; // darker purple border
  } else if (variant === "err") {
    b.style.background = "#7f1d1d";
    b.style.color = "#fee2e2";
    b.style.border = "1px solid #b91c1c";
  }
  b.textContent = text;
  positionBadgeByHud();
  b.style.opacity = "1";
}

  function hideHudStatus(delayMs = 900) {
    clearTimeout(hudBadgeHideTimer);
    hudBadgeHideTimer = setTimeout(() => {
      try { if (hudBadge) hudBadge.style.opacity = "0"; } catch {}
    }, delayMs);
  }


  // --- selection helpers
function getSelectionInfo() {
  const sel = window.getSelection?.();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const text = String(sel).trim();
  if (text.length < MIN_LEN || text.length > MAX_LEN) return null;

  // If selection is inside a composer, do NOT show Save (Enhance owns that surface)
  if (BLOCK_IN_COMPOSER) {
    const anchor = sel.anchorNode || sel.focusNode || null;
    if (anchor && nodeIsInsideComposer(anchor)) return null;
  }


  const rng = sel.getRangeAt(0).cloneRange();
  let rect = null;

  // prefer last client rect if available
  const rects = typeof rng.getClientRects === "function" ? rng.getClientRects() : null;
  if (rects && rects.length) {
    rect = rects[rects.length - 1];
  } else {
    // fallback: insert a marker to get a rect
    const marker = document.createElement("span");
    marker.style.cssText = "display:inline-block;width:0;height:1px;";
    rng.collapse(false);
    rng.insertNode(marker);
    rect = marker.getBoundingClientRect();
    marker.remove();
  }
  if (!rect) return null;

  // check if selection is visible in viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isVisible =
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= vh &&
    rect.left <= vw;

  if (!isVisible) return null;

  // clamp within viewport
  const x = Math.min(Math.max(rect.right, 12), vw - 12);
  const y = Math.min(Math.max(rect.top, 24), vh - 12);

  return { text, x, y };
}


  function showPillAt(x, y) {
    pill.style.left = `${x}px`;
    pill.style.top = `${y - 8}px`; // hover just above the selection end
    pill.style.display = "inline-block";
  }
  function hidePill() {
    pill.style.display = "none";
  }

  // --- refresh pill on selection changes (debounced)
  let rafId = 0;
  function scheduleUpdate() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const info = getSelectionInfo();
      if (!info) return hidePill();
      lastText = info.text;
      showPillAt(info.x, info.y);
    });
  }

  // --- global listeners to trigger updates
  document.addEventListener("selectionchange", scheduleUpdate, { passive: true });
  document.addEventListener("mouseup", scheduleUpdate, { passive: true });
  document.addEventListener("keyup", (e) => {
    // only when selection keys likely used
    if (e.key === "Shift" || e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      scheduleUpdate();
    }
  }, { passive: true });

// on scroll/resize, recompute selection pill AND keep HUD badge anchored
window.addEventListener("scroll", () => { scheduleUpdate(); positionBadgeByHud(); }, { passive: true });
window.addEventListener("resize", () => { scheduleUpdate(); positionBadgeByHud(); }, { passive: true });


// clicking outside hides (shadow-safe: honor composedPath + host element)
document.addEventListener("mousedown", (e) => {
  try {
    const path = (e.composedPath && e.composedPath()) || [];
    const inside = path.includes(pill) || path.includes(host);
    if (inside) return; // don't hide when clicking the pill or its shadow host
  } catch {}
  hidePill();
});



// --- save handling (with HUD status badge) + robust BG messaging
let lastText = "";
pill.addEventListener("click", async () => {
  // Re-read the selection at click time; fall back to lastText captured by RAF
  const infoAtClick = (typeof getSelectionInfo === "function") ? getSelectionInfo() : null;
  const text = ((infoAtClick?.text ?? lastText) || "").trim();

  // Enforce minimum length with user feedback (prevents “dead” clicks)
  if (!text || text.length < MIN_LEN) {
    toast("Select at least 16 characters to save.");
    return;
  }

  toast("Saving…", 900);
  showHudStatus("Saving", "neutral");

  // Wrap sendMessage so MV3 callback -> Promise and we see lastError
  const resp = await new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: "VG_SAVE_HIGHLIGHT",
          payload: { text, source_host: location.host, source_url: location.href }
        },
        (r) => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.warn("[VG/savehighlight] sendMessage lastError:", err.message);
            resolve({ ok: false, error: "NO_BG_LISTENER" });
          } else {
            resolve(r || null);
          }
        }
      );
    } catch (e) {
      console.warn("[VG/savehighlight] sendMessage throw:", e);
      resolve({ ok: false, error: String(e?.message || e) });
    }
  });

  if (resp && resp.ok) {
    showHudStatus("Saved", "ok");
    hideHudStatus(900);
    hidePill();
  } else {
    const msg = resp?.error || "Save failed";
    console.warn("[VG/savehighlight] BG response error:", msg, "resp=", resp);
    showHudStatus("Failed", "err");
    hideHudStatus(1400);
    toast(msg, 1600);
  }
});



})();
