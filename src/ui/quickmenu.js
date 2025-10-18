// src/ui/quickmenu.js
(() => {
  // make APP/Z/MENU_DX available if the big script defined them, else safe defaults
  const { APP, Z, MENU_DX } = window.__VG_CONSTS || {
    APP: "vibeguardian",
    Z: 2147483600,
    MENU_DX: 0,
  };

  /* ===============================
     Phase 0 — Feature flag + messages
     =============================== */
  // Global feature flags (default OFF). Dev can override with browser.storage.local.
  try {
    window.__VG_FEATURES = window.__VG_FEATURES || {};
  } catch {}
  try {
    // default false unless explicitly enabled in storage
    if (typeof window.__VG_FEATURES.screenshot_enabled !== "boolean") {
      window.__VG_FEATURES.screenshot_enabled = true;
    }
    // Dev override: browser.storage.local.set({ vg_feat_screenshot: true|false })
    browser?.storage?.local?.get?.(["vg_feat_screenshot"]).then((o) => {
      if (typeof o?.vg_feat_screenshot === "boolean") {
        try {
          window.__VG_FEATURES.screenshot_enabled = o.vg_feat_screenshot;
        } catch {}
      }
    });
  } catch {
    /* no-op */
  }

  // Canonical message names for the screenshot flow (used in later phases)
  const VG_MSG = {
    SCREENSHOT_BEGIN: "VG_SCREENSHOT_BEGIN", // user clicked Screenshot button → open overlay
    SCREENSHOT_CANCEL: "VG_SCREENSHOT_CANCEL", // overlay dismissed
    SCREENSHOT_CAPTURED: "VG_SCREENSHOT_CAPTURED", // capture done; Blob/data ready
    SCREENSHOT_INSERT: "VG_SCREENSHOT_INSERT", // run DnD/attach/paste pipeline
    SCREENSHOT_TELEMETRY: "VG_SCREENSHOT_TELEMETRY", // lightweight logging
  };
  /* ===== End Phase 0 insert ===== */

  // --- Quick Menu ↔ pill anchor constants
  const IFRAME_ID = "__vg_iframe_hud__";
  const MENU_GAP = 8; // vertical gap above pill
  let __vgQM_RAF = 0; // rAF handle while anchoring

  // ===== DEBUG logger (diagnostics only; safe no-op if console unavailable) =====
  const __VG_QM_DEBUG = true;
  function __qmLog(...args) {
    try {
      __VG_QM_DEBUG && console.debug("[VG][QM]", ...args);
    } catch {}
  }

  // === Small icon helpers (no circular browser; used by header "+" and row "eye") ===
  function makeIconBtn({ id, title, html, onClick, variant }) {
    const b = document.createElement("button");
    if (id) b.id = id;
    b.type = "button";
    b.title = title || "";
    b.style.cssText = [
      "width:28px",
      "height:28px",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "background:transparent",
      "border:0",
      "padding:0",
      "cursor:pointer",
      "color:#cfd4ff", // default icon tint
    ].join(";");
    b.innerHTML = html;
    if (typeof onClick === "function") b.addEventListener("click", onClick);
    const svg = b.querySelector("svg");
    if (svg) svg.style.display = "block";

    // 🔵 NEW: purple hover for preview variant
    if (variant === "preview") {
      b.addEventListener("mouseenter", () => {
        b.style.color = "#8B5CF6";
      });
      b.addEventListener("mouseleave", () => {
        b.style.color = "#cfd4ff";
      });
    }

    return b;
  }

  // ---- Loader helpers (one-time CSS + builder) ----
  function __vgEnsureLoaderCSS() {
    if (document.getElementById("vg-qm-loader-style")) return;
    const st = document.createElement("style");
    st.id = "vg-qm-loader-style";
    st.textContent = `
      @keyframes vgspin { to { transform: rotate(360deg); } }
  
  .vg-qm-loader {
    display:flex;
    flex-direction: column;         /* stack spinner above text */
    align-items: center;            /* horizontal center */
    justify-content: center;        /* vertical center */
    gap:10px;
  
    width:100%;
    min-height:80px;                /* gives vertical room so it doesn’t collapse */
    padding:16px;
  
    border:1px solid #2a2a33;
    border-radius:10px;
    background:#0c0e13;
    color:#cbd5e1;
    font:14px/1.35 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
    text-align:center;
  }
  
      .vg-qm-spinner {
        width:16px; height:16px; border-radius:50%;
        border:2px solid #7c3aed;       /* purple */
        border-top-color: transparent;  /* arc effect */
        animation: vgspin .8s linear infinite;
        flex:0 0 auto;
      }
    `;
    document.head.appendChild(st);
  }
  function __vgMakeLoader(label = "Loading…") {
    __vgEnsureLoaderCSS();
    const row = document.createElement("div");
    row.className = "vg-qm-loader";
    const dot = document.createElement("div");
    dot.className = "vg-qm-spinner";
    const text = document.createElement("div");
    text.textContent = String(label);
    row.appendChild(dot);
    row.appendChild(text);
    return row;
  }

  // --- Quick Menu base styles (muted text etc.) ---
  function __vgEnsureQMStyles() {
    if (document.getElementById("vg-qm-style")) return;
    const st = document.createElement("style");
    st.id = "vg-qm-style";
    st.textContent = `
      /* Scope to the Quick Menu only */
      #vg-quick-menu .muted {
        color: #a1a1aa;
        font: 12px/1.35 Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
      }
    `;
    document.head.appendChild(st);
  }

  // Purple plus (standalone, no circle) — larger for better legibility
  const SVG_PLUS_PURPLE = `
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" style="display:block">
    <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="#8B5CF6"></path>
  </svg>`;

  // Eye icon (pixel-perfect, scalable). Stroke scales crisply; centered.
  // Source style inspired by Feather Icons.
  const SVG_EYE = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
       fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round"
       vector-effect="non-scaling-stroke" preserveAspectRatio="xMidYMid meet"
       style="display:block">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>`;

  // Minimal camera icon (for Screenshot button)
  const SVG_CAMERA = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
       fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round"
       style="display:block" preserveAspectRatio="xMidYMid meet">
    <path d="M3 7h4l2-2h6l2 2h4v12H3z"></path>
    <circle cx="12" cy="13" r="4"></circle>
  </svg>`;

  // Chat bubble icon (used by AI Chat button)
  const SVG_CHAT_BUBBLE = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
       fill="none" stroke="currentColor" stroke-width="1.75"
       stroke-linecap="round" stroke-linejoin="round"
       preserveAspectRatio="xMidYMid meet" style="display:block">
    <rect x="4" y="4" width="16" height="12" rx="3" ry="3" vector-effect="non-scaling-stroke"></rect>
    <path d="M8 16 L4 20 L4 16" vector-effect="non-scaling-stroke"></path>
  </svg>`;

  /* ==== OPEN LISTENER — canonical: VG_QM_TOGGLE ==== */
  if (!window.__VG_QM_WIRED__) {
    window.__VG_QM_WIRED__ = true;

    // PING responder so BG can verify the script is loaded (for on-demand injection)
    browser.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "VG_PING_QM") {
        try {
          sendResponse({ qm: true });
        } catch {}
        return true;
      }
    });

    // runtime message path (from BG relay)
    browser.runtime?.onMessage.addListener((msg) => {
      if (!msg) return;

      // Paywall relay → render modal in this tab
      if (msg.type === "VG_PAYWALL_SHOW") {
        const opts = msg.payload || {};
        (async () => {
          try {
            const mod = await import(
              browser.runtime.getURL("src/ui/paywall.js")
            );
            const api = mod?.default?.show ? mod.default : mod;
            (api?.show || mod?.show)?.(opts);
          } catch (e) {
            console.warn("[VG/QM] paywall load failed", e);
          }
        })();
        return;
      }

      if (msg.type !== "VG_QM_TOGGLE") return;

      // If already open → close (true toggle)
      const openEl = document.getElementById("vg-quick-menu");
      if (openEl) {
        try {
          if (typeof window.__VG_QM_CLOSE === "function")
            window.__VG_QM_CLOSE();
          else {
            openEl.remove();
            window.__VG_LAST_MENU_CLOSE = performance.now();
          }
        } catch {}
        return;
      }

      const sinceClose = performance.now() - (window.__VG_LAST_MENU_CLOSE || 0);
      if (sinceClose < 120) return;

      const r = __vgPillRect();
      if (r) {
        try {
          openQuickMenu(r);
        } catch (e) {
          console.warn("[VG/QM] open failed", e);
        }
      } else {
        setTimeout(() => {
          const r2 = __vgPillRect();
          if (r2) {
            try {
              openQuickMenu(r2);
            } catch (e) {
              console.warn("[VG/QM] open failed (retry)", e);
            }
          } else {
            const size = 36;
            const synth = {
              left: Math.round(innerWidth / 2 - size / 2),
              top: Math.max(100, Math.round(innerHeight - 120)),
              width: size,
              height: size,
              right: 0,
              bottom: 0,
            };
            console.debug(
              "[VG/QM] no HUD iframe; opening with synthetic rect",
              synth
            );
            try {
              openQuickMenu(synth);
            } catch (e) {
              console.warn("[VG/QM] open failed (synth)", e);
            }
          }
        }, 150);
      }
    });

    // optional window bridge (for any window.postMessage callers)
    window.addEventListener("message", (ev) => {
      const m = ev?.data || {};
      if (m && m.source === "VG" && m.type === "VG_QM_TOGGLE") {
        const r = __vgPillRect();
        if (r) {
          try {
            openQuickMenu(r);
          } catch (e) {
            console.warn("[VG/QM] open failed (bridge)", e);
          }
        }
      }
    });
  }
  /* ==== end OPEN LISTENER ==== */

  function __vgPillRect() {
    const f = document.getElementById(IFRAME_ID);
    if (!f || !f.isConnected) return null;
    const r = f.getBoundingClientRect();
    if (!Number.isFinite(r.left) || r.width <= 0 || r.height <= 0) return null;
    return r;
  }
  function __vgOnscreen(r) {
    const vw = window.innerWidth,
      vh = window.innerHeight;
    return !(r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw);
  }

  /* ==== Quick Menu dependency shim (from old content script) ==== */
  /* Put this near the top of src/ui/quickmenu.js (after APP/Z/MENU_DX shim). */

  // Map DB row -> local item shape the menu expects
  function __toLocalGuard(row) {
    const name = row.title || row.name || "Custom Prompt";
    const tags = Array.isArray(row.tags)
      ? row.tags
      : Array.isArray(row.labels)
      ? row.labels
      : [];
    const status = row.status || row.state || "inactive";
    return {
      id: row.id,
      name,
      body: row.body || row.text || "",
      tags,
      status,
      createdAt: new Date(row.created_at || Date.now()).getTime(),
      updatedAt: new Date(row.updated_at || Date.now()).getTime(),
    };
  }

  // --- site relevance helpers (used by CG_list sorting) ---

  // List custom prompts via Background (SoT) → fetch ALL, then sort by site relevance

  // ----- Host-gated insertion helpers: Bolt / Cursor overrides; others use shallow DOM -----

  // Generic, non-breaking preflight that prefers DB composer_selector (if any).
  // Returns true on success; false so existing paths run unchanged.
  function __vgTryInsertViaDBSelector(text) {
    const sel =
      (window.__VG_DB_PLACEMENT &&
        window.__VG_DB_PLACEMENT.composer_selector) ||
      "";
    if (!sel) return false;

    let el = null;
    try {
      el = document.querySelector(sel);
    } catch {}
    if (!el) return false;

    const t = String(text || "");

    // Path A: <textarea>/<input type="text">
    if ("value" in el) {
      try {
        el.focus();
      } catch {}
      const cur = String(el.value || "");
      const start = Number.isFinite(el.selectionStart)
        ? el.selectionStart
        : cur.length;
      const end = Number.isFinite(el.selectionEnd) ? el.selectionEnd : start;

      const before = cur.slice(0, start);
      const after = cur.slice(end);
      const needsSep = !!before && !/\n\n$/.test(before);
      const insert = (needsSep ? "\n\n" : "") + t;
      const next = before + insert + after;

      try {
        const desc = Object.getOwnPropertyDescriptor(
          Object.getPrototypeOf(el),
          "value"
        );
        if (desc && typeof desc.set === "function") desc.set.call(el, next);
        else el.value = next;
      } catch {
        el.value = next;
      }

      const caret = (before + insert).length;
      try {
        el.setSelectionRange(caret, caret);
      } catch {}

      try {
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            composed: true,
          })
        );
      } catch {}
      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {}
      queueMicrotask(() => {
        try {
          el.focus();
        } catch {}
      });
      return true;
    }

    // Path B: contentEditable / ProseMirror
    const ce = el.isContentEditable
      ? el
      : el.closest && el.closest('[contenteditable="true"]');
    if (ce) {
      // Focus the exact node we matched and put caret at end
      try {
        ce.focus();
        const doc = ce.ownerDocument || document;
        const sel = doc.getSelection && doc.getSelection();
        if (sel) {
          const r = doc.createRange();
          r.selectNodeContents(ce);
          r.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      } catch {}

      // 1) Perplexity: execCommand works reliably
      try {
        if (
          document.execCommand &&
          document.execCommand("insertText", false, t)
        ) {
          ce.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
      } catch {}

      // 2) Fallback: beforeinput(insertText)
      try {
        const ev = new InputEvent("beforeinput", {
          inputType: "insertText",
          data: t,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        const ok = ce.dispatchEvent(ev);
        if (ok !== false) {
          ce.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
      } catch {}

      // 3) Last resort: Range insertion
      try {
        const doc = ce.ownerDocument || document;
        const sel = doc.getSelection && doc.getSelection();
        const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        if (r) {
          const node = doc.createTextNode(t);
          r.insertNode(node);
          const after = doc.createRange();
          after.setStartAfter(node);
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
          ce.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        }
      } catch {}
    }

    return false;

    return false;
  }

  (function () {
    const IS_BOLT = /(^|\.)bolt\.new$/.test(location.hostname);

    const IS_CURSOR = /(^|\.)cursor\.com$|(^|\.)cursor\.so$/.test(
      location.hostname
    );

    // Shallow DOM setter (Replit/Lovable-safe)
    function __vgSetValue(el, value) {
      try {
        const proto = Object.getPrototypeOf(el);
        const desc = proto
          ? Object.getOwnPropertyDescriptor(proto, "value")
          : null;
        if (desc && typeof desc.set === "function") desc.set.call(el, value);
        else el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
        try {
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } catch {}
      }
    }

    if (IS_BOLT) {
      // ===== Bolt: prefer DB composer_selector; then site logic =====
      window.vgInsertPrompt = function (text) {
        // New: generic preflight (no-op if selector missing or doesn’t match)
        if (
          typeof __vgTryInsertViaDBSelector === "function" &&
          __vgTryInsertViaDBSelector(text)
        )
          return true;

        try {
          if (
            window.__VG_COMPOSER_INSERT &&
            window.__VG_COMPOSER_INSERT(String(text || ""))
          )
            return true;
        } catch {}
        const target = vgFindComposerRoot();
        return vgInsertTextSmart(
          target.ownerDocument || document,
          String(text || "")
        );
      };

      window.setComposerGuardAndCaret = function (text /*, marker */) {
        // New: same preflight here
        if (
          typeof __vgTryInsertViaDBSelector === "function" &&
          __vgTryInsertViaDBSelector(text)
        )
          return true;

        try {
          if (
            window.__VG_COMPOSER_INSERT &&
            window.__VG_COMPOSER_INSERT(String(text || ""))
          )
            return true;
        } catch {}
        const targetRoot = vgFindComposerRoot();
        return vgInsertTextSmart(
          targetRoot.ownerDocument || document,
          String(text || "")
        );
      };
    } else if (IS_CURSOR) {
      // ===== Cursor: target chat composer + use execCommand('insertText') deterministically =====
      function __cursorComposer() {
        return (
          document.querySelector('main [contenteditable="true"]') ||
          document.querySelector(
            '[data-testid="composer"] [contenteditable="true"]'
          ) ||
          document.querySelector('[contenteditable="true"]')
        );
      }

      // Insert (append at caret). Reliable on Cursor.
      window.vgInsertPrompt = function (text) {
        const el = __cursorComposer();
        if (!el) {
          alert("Couldn't find the chat input.");
          return false;
        }
        const t = String(text || "");
        try {
          el.focus();
        } catch {}

        // Ensure caret is inside composer and collapsed
        try {
          const doc = el.ownerDocument || document;
          const sel = doc.getSelection && doc.getSelection();
          if (sel) {
            if (sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
              const r = doc.createRange();
              r.selectNodeContents(el);
              r.collapse(false); // end
              sel.removeAllRanges();
              sel.addRange(r);
            } else {
              const r = sel.getRangeAt(0);
              r.collapse(false);
              sel.removeAllRanges();
              sel.addRange(r);
            }
          }
        } catch {}

        try {
          if (document.execCommand) {
            document.execCommand("insertText", false, t);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
          }
        } catch {}

        // Fallback: range insertion
        try {
          const doc = el.ownerDocument || document;
          const sel = doc.getSelection && doc.getSelection();
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0);
            const node = doc.createTextNode(t);
            r.insertNode(node);
            const after = doc.createRange();
            after.setStartAfter(node);
            after.collapse(true);
            sel.removeAllRanges();
            sel.addRange(after);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
          }
        } catch {}
        return false;
      };

      // Insert custom prompt at *caret* (never select-all/replace)
      window.setComposerGuardAndCaret = function (text /*, marker */) {
        const el = __cursorComposer();
        if (!el) return false;
        const t = String(text || "");
        try {
          el.focus();
        } catch {}

        const doc = el.ownerDocument || document;
        const sel = doc.getSelection && doc.getSelection();
        if (sel) {
          if (sel.rangeCount === 0 || !el.contains(sel.anchorNode)) {
            const r = doc.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
          } else {
            const r = sel.getRangeAt(0);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
          }
        }

        // Add a blank line before inserting if there is prior text and no trailing blank line
        let needsSep = false;
        try {
          const cur = String(el.innerText || el.textContent || "");
          needsSep = !!cur && !/\n\n$/.test(cur);
        } catch {}
        const payload = (needsSep ? "\n\n" : "") + t;

        try {
          if (document.execCommand) {
            document.execCommand("insertText", false, payload);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
          }
        } catch {}

        // Fallback: range insertion
        try {
          const r =
            (doc.getSelection && doc.getSelection()?.getRangeAt(0)) || null;
          const node = doc.createTextNode(payload);
          if (r) r.insertNode(node);
          const after = doc.createRange();
          after.setStartAfter(node);
          after.collapse(true);
          const s2 = doc.getSelection();
          s2.removeAllRanges();
          s2.addRange(after);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        } catch {}
        return false;
      };
    } else {
      // ===== Non-Bolt, Non-Cursor (Replit, Lovable, Base44, ChatGPT/ProseMirror, etc.) =====

      // Detect ProseMirror (safe + non-fragile)
      function __isProseMirror(el) {
        if (!el) return false;
        const hasPM = (n) =>
          !!(n && n.classList && n.classList.contains("ProseMirror"));
        return (
          hasPM(el) || hasPM(el.parentElement) || !!el.closest?.(".ProseMirror")
        );
      }

      // React-safe setter for textarea/input (native setter + input/change)
      function __setReactValue(el, value) {
        try {
          const proto = Object.getPrototypeOf(el);
          const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && typeof desc.set === "function") desc.set.call(el, value);
          else el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } catch {
          el.value = value;
          try {
            el.dispatchEvent(new Event("input", { bubbles: true }));
          } catch {}
        }
      }

      // ProseMirror-friendly insertion (also safe for generic contentEditable) — extended with paste fallbacks
      function __pmInsert(el, text) {
        if (!el) {
          __qmLog("pmInsert: no element");
          return false;
        }
        const doc = el.ownerDocument || document;
        __qmLog("pmInsert: begin", {
          id: el.id,
          cls: el.className,
          ce: el.isContentEditable,
        });

        // Focus + move caret to end
        try {
          el.focus();
        } catch (e) {
          __qmLog("pmInsert: focus error", e);
        }
        try {
          const sel = doc.getSelection && doc.getSelection();
          if (sel) {
            const r = doc.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
          }
        } catch (e) {
          __qmLog("pmInsert: caret error", e);
        }

        // Optional blank-line separator
        let payload = String(text || "");
        try {
          const cur = String(el.innerText || el.textContent || "");
          if (cur && !/\n\n$/.test(cur)) payload = "\n\n" + payload;
        } catch {}

        // 1) execCommand('insertText')
        try {
          if (
            document.execCommand &&
            document.execCommand("insertText", false, payload)
          ) {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            __qmLog("pmInsert: execCommand success");
            return true;
          }
        } catch (e) {
          __qmLog("pmInsert: execCommand error", e);
        }

        // 2) beforeinput InputEvent (insertText)
        try {
          const ev = new InputEvent("beforeinput", {
            inputType: "insertText",
            data: payload,
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          const ok = el.dispatchEvent(ev);
          if (ok !== false) {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            __qmLog("pmInsert: beforeinput success");
            return true;
          }
        } catch (e) {
          __qmLog("pmInsert: beforeinput error", e);
        }

        // 3) Raw Range insertion
        try {
          const sel = doc.getSelection && doc.getSelection();
          const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
          if (r) {
            const node = doc.createTextNode(payload);
            r.insertNode(node);
            const after = doc.createRange();
            after.setStartAfter(node);
            after.collapse(true);
            sel.removeAllRanges();
            sel.addRange(after);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            __qmLog("pmInsert: range success");
            return true;
          }
        } catch (e) {
          __qmLog("pmInsert: range error", e);
        }

        // 4) Synthetic "paste" event with DataTransfer (PM prefers paste)
        try {
          if (typeof DataTransfer === "function") {
            const dt = new DataTransfer();
            dt.setData("text/plain", payload);
            const pasteEv = new ClipboardEvent("paste", {
              bubbles: true,
              cancelable: true,
            });
            Object.defineProperty(pasteEv, "clipboardData", { get: () => dt });
            const okPaste = el.dispatchEvent(pasteEv);
            if (okPaste !== false) {
              __qmLog("pmInsert: synthetic paste success");
              return true;
            }
          }
        } catch (e) {
          __qmLog("pmInsert: synthetic paste error", e);
        }

        // 5) Last resort: write to clipboard then execCommand('paste') (requires permission)
        try {
          if (navigator.clipboard?.writeText) {
            return navigator.clipboard
              .writeText(payload)
              .then(() => {
                try {
                  if (document.execCommand && document.execCommand("paste")) {
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    __qmLog("pmInsert: clipboard+paste success");
                    return true;
                  }
                } catch (e) {
                  __qmLog("pmInsert: clipboard paste exec error", e);
                }
                __qmLog("pmInsert: clipboard+paste unsupported");
                return false;
              })
              .catch((e) => {
                __qmLog("pmInsert: clipboard writeText error", e);
                return false;
              });
          }
        } catch (e) {
          __qmLog("pmInsert: clipboard block", e);
        }

        __qmLog("pmInsert: all methods failed");
        return false;
      }

      // Insert at caret (textarea/input/CE/ProseMirror) — logs + retry if DOM is mid-reflow
      window.vgInsertPrompt =
        window.vgInsertPrompt ||
        function (text) {
          // New: try DB composer_selector first (falls back if not available)
          if (
            typeof __vgTryInsertViaDBSelector === "function" &&
            __vgTryInsertViaDBSelector(text)
          )
            return true;

          // Prefer activeElement if it's a contentEditable; else fall back to known selectors

          const activeCE =
            document.activeElement && document.activeElement.isContentEditable
              ? document.activeElement
              : null;
          const el =
            activeCE ||
            document.querySelector("div#prompt-textarea.ProseMirror") ||
            document.querySelector(
              'textarea, input[type="text"], [contenteditable="true"], [role="textbox"][contenteditable="true"]'
            );

          if (!el) {
            alert("Couldn't find the chat input.");
            __qmLog("insert: no target");
            return false;
          }

          const t = String(text || "");
          __qmLog("insert: target", {
            tag: el.tagName,
            id: el.id,
            cls: el.className,
            ce: el.isContentEditable,
          });

          // Textarea/Input → React-safe setter
          if ("value" in el) {
            try {
              el.focus();
            } catch {}
            const start = Number.isFinite(el.selectionStart)
              ? el.selectionStart
              : (el.value || "").length;
            const end = Number.isFinite(el.selectionEnd)
              ? el.selectionEnd
              : start;
            const before = (el.value || "").slice(0, start);
            const after = (el.value || "").slice(end);
            const needsSep = before.length > 0 && !/\n\n$/.test(before);
            const insert = (needsSep ? "\n\n" : "") + t;
            const next = before + insert + after;
            __setReactValue(el, next);
            const caret = (before + insert).length;
            try {
              el.setSelectionRange(caret, caret);
            } catch {}
            __qmLog("insert: textarea success");
            return true;
          }

          // contentEditable path (ProseMirror-aware)
          const target = el.isContentEditable
            ? el
            : el.closest && el.closest('[contenteditable="true"]');
          if (!target) {
            __qmLog("insert: no CE container");
            return false;
          }

          if (__isProseMirror(target)) {
            const ok = __pmInsert(target, t);
            __qmLog("insert: PM path", ok);
            if (ok) return true;

            // Retry once next frame — PM sometimes swaps nodes after focus/hydration
            return new Promise((res) =>
              requestAnimationFrame(() => res(__pmInsert(target, t)))
            ).then((r) => {
              __qmLog("insert: PM retry", r);
              return r;
            });
          }

          // Generic CE fallback (range insert)
          try {
            const doc = target.ownerDocument || document;
            try {
              target.focus();
            } catch {}
            const sel = doc.getSelection && doc.getSelection();

            if (
              !sel ||
              sel.rangeCount === 0 ||
              !target.contains(sel.anchorNode)
            ) {
              const r = doc.createRange();
              r.selectNodeContents(target);
              r.collapse(false);
              sel?.removeAllRanges();
              sel?.addRange(r);
            } else {
              const r = sel.getRangeAt(0);
              r.collapse(false);
              sel.removeAllRanges();
              sel.addRange(r);
            }

            let needsSep = false;
            try {
              const rBefore = sel.getRangeAt(0).cloneRange();
              rBefore.setStart(target, 0);
              const txtBefore = rBefore.toString();
              needsSep = !!txtBefore && !/\n\n$/.test(txtBefore);
            } catch {}

            const frag = doc.createDocumentFragment();
            if (needsSep) frag.appendChild(doc.createTextNode("\n\n"));
            const node = doc.createTextNode(t);
            frag.appendChild(node);

            const r = sel.getRangeAt(0);
            r.insertNode(frag);

            const afterNode = doc.createRange();
            afterNode.setStartAfter(node);
            afterNode.collapse(true);
            sel.removeAllRanges();
            sel.addRange(afterNode);

            target.dispatchEvent(new Event("input", { bubbles: true }));
            target.dispatchEvent(new Event("change", { bubbles: true }));
            __qmLog("insert: generic CE success");
            return true;
          } catch (e) {
            const cur = String(target.innerText || target.textContent || "");
            const next = (cur ? cur.trimEnd() + "\n\n" : "") + t;
            target.innerText = next;
            try {
              target.dispatchEvent(new Event("input", { bubbles: true }));
            } catch {}
            __qmLog("insert: CE last-resort append");
            return true;
          }
        };

      // Insert custom prompt at caret (textarea/input/CE/ProseMirror) — verified change & better targeting
      window.setComposerGuardAndCaret =
        window.setComposerGuardAndCaret ||
        function (text /*, marker */) {
          const t = String(text || "");

          // 1) Prefer the currently focused CE (usually the visible ChatGPT PM editor)
          const active = document.activeElement;
          const isCE = !!(active && active.isContentEditable);
          let el = isCE ? active : null;

          // 2) If no focused CE, choose the PM editor closest to the Send button (ChatGPT-safe)
          if (!el) {
            const send = document.querySelector(
              'button:has(svg[aria-label="Send message"]), button[data-testid="send-button"]'
            );
            const candidates = [
              // ChatGPT ProseMirror editors
              ...document.querySelectorAll(
                'div.ProseMirror[contenteditable="true"]'
              ),
              // Generic contentEditable textboxes
              ...document.querySelectorAll(
                '[role="textbox"][contenteditable="true"]'
              ),
              ...document.querySelectorAll('[contenteditable="true"]'),
              // Plain inputs/textarea as a last resort
              ...document.querySelectorAll('textarea, input[type="text"]'),
            ];
            if (candidates.length) {
              if (send) {
                const sy = send.getBoundingClientRect().y;
                candidates.sort(
                  (a, b) =>
                    Math.abs(a.getBoundingClientRect().y - sy) -
                    Math.abs(b.getBoundingClientRect().y - sy)
                );
              }
              el = candidates[0];
            }
          }

          if (!el) return false;

          // 3) Textarea/Input → React-safe splice at caret
          if ("value" in el) {
            try {
              el.focus();
            } catch {}
            const start = Number.isFinite(el.selectionStart)
              ? el.selectionStart
              : (el.value || "").length;
            const end = Number.isFinite(el.selectionEnd)
              ? el.selectionEnd
              : start;
            const before = (el.value || "").slice(0, start);
            const after = (el.value || "").slice(end);
            const needsSep = (before || after) && !/\n\n$/.test(before);
            const insert = (needsSep ? "\n\n" : "") + t;
            const next = before + insert + after;

            try {
              const proto =
                el.tagName === "TEXTAREA"
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
              const desc = Object.getOwnPropertyDescriptor(proto, "value");
              desc?.set?.call(el, next);
            } catch {
              el.value = next;
            }

            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            const caret = (before + insert).length;
            try {
              el.setSelectionRange(caret, caret);
            } catch {}
            return true;
          }

          // 4) contentEditable (prefer ProseMirror path) — verify DOM actually changed
          const target = el.isContentEditable
            ? el
            : el.closest && el.closest('[contenteditable="true"]');
          if (!target) return false;

          const beforeText = target.textContent || "";

          const ok = (function run() {
            // ProseMirror path uses the robust helper
            if (
              (target.classList && target.classList.contains("ProseMirror")) ||
              !!target.closest?.(".ProseMirror")
            ) {
              return !!__pmInsert(target, t);
            }

            // Generic CE fallback
            try {
              const doc = target.ownerDocument || document;
              try {
                target.focus();
              } catch {}
              const sel = doc.getSelection && doc.getSelection();

              if (
                !sel ||
                sel.rangeCount === 0 ||
                !target.contains(sel.anchorNode)
              ) {
                const r = doc.createRange();
                r.selectNodeContents(target);
                r.collapse(false);
                sel?.removeAllRanges();
                sel?.addRange(r);
              } else {
                const r = sel.getRangeAt(0);
                r.collapse(false);
                sel.removeAllRanges();
                sel.addRange(r);
              }

              let needsSep = false;
              try {
                const rBefore = sel.getRangeAt(0).cloneRange();
                rBefore.setStart(target, 0);
                const txtBefore = rBefore.toString();
                needsSep = !!txtBefore && !/\n\n$/.test(txtBefore);
              } catch {}

              const frag = doc.createDocumentFragment();
              if (needsSep) frag.appendChild(doc.createTextNode("\n\n"));
              const node = doc.createTextNode(t);
              frag.appendChild(node);

              const r = sel.getRangeAt(0);
              r.insertNode(frag);

              const afterNode = doc.createRange();
              afterNode.setStartAfter(node);
              afterNode.collapse(true);
              sel.removeAllRanges();
              sel.addRange(afterNode);

              target.dispatchEvent(new Event("input", { bubbles: true }));
              target.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            } catch {
              const cur = String(target.innerText || target.textContent || "");
              const next = (cur ? cur.trimEnd() + "\n\n" : "") + t;
              target.innerText = next;
              try {
                target.dispatchEvent(new Event("input", { bubbles: true }));
              } catch {}
              return true;
            }
          })();

          // ✅ Treat “inserted into wrong/hidden node” as failure so callers can retry elsewhere
          const afterText = target.textContent || "";
          return ok && afterText !== beforeText;
        };
    }
  })();

  // Upgrade nag (no-op if not present)
  window.maybePromptUpgrade = window.maybePromptUpgrade || (async () => {});

  /* ==== end shim ==== */

  // === Composer targeting + smart insertion (Cursor-safe, host-gated) ===
  function vgFindComposerRoot() {
    const fromDB =
      (window.__VG_DB_PLACEMENT &&
        window.__VG_DB_PLACEMENT.composer_selector) ||
      "";
    const host = String(location.hostname || "").toLowerCase();
    const IS_CURSOR = /(^|\.)cursor\.com$|(^|\.)cursor\.so$/.test(host);

    // Cursor-only: prefer chat composer FIRST, then Monaco as fallback
    const ORDER_CURSOR = [
      '[data-testid="composer"] [contenteditable="true"]',
      'textarea[placeholder*="Ask Cursor"]',
      'main [contenteditable="true"]',
      ".monaco-editor textarea.inputarea", // fallback to Monaco only if no chat composer
      "textarea",
      'input[type="text"]',
    ];

    // Default order (unchanged for all other hosts)
    const ORDER_DEFAULT = [
      ".monaco-editor textarea.inputarea", // Monaco first only outside Cursor
      'textarea[placeholder*="Ask Cursor"]',
      '[data-testid="composer"] [contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      'main [contenteditable="true"]',
      "textarea",
      'input[type="text"]',
    ];

    const DEFAULTS = (IS_CURSOR ? ORDER_CURSOR : ORDER_DEFAULT).join(",");
    const sel =
      fromDB && String(fromDB).trim() ? fromDB + "," + DEFAULTS : DEFAULTS;
    return document.querySelector(sel) || document.body;
  }

  function vgInsertTextSmart(rootEl, text) {
    if (!text) return false;
    const root = rootEl || document;
    const host = String(location.hostname || "").toLowerCase();
    const isCursor = /(^|\.)cursor\.com$|(^|\.)cursor\.so$/.test(host);

    // 1) Cursor/Monaco path ONLY on Cursor hosts (cursor.com / cursor.so)
    if (isCursor) {
      const monacoTA = root.querySelector?.(
        ".monaco-editor textarea.inputarea"
      );
      if (monacoTA) {
        try {
          monacoTA.focus();
        } catch {}

        try {
          const ev = new InputEvent("beforeinput", {
            inputType: "insertText",
            data: String(text || ""),
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          const ok = monacoTA.dispatchEvent(ev);
          if (ok !== false) return true;
        } catch (_) {}

        try {
          if (
            document.execCommand &&
            document.execCommand("insertText", false, String(text || ""))
          )
            return true;
        } catch (_) {}

        try {
          (function __copyViaHidden(t) {
            const ta = document.createElement("textarea");
            ta.style.cssText =
              "position:fixed;left:-9999px;top:-9999px;opacity:0;";
            ta.value = String(t || "");
            document.body.appendChild(ta);
            ta.select();
            try {
              document.execCommand("copy");
            } catch {}
            document.body.removeChild(ta);
          })(String(text || ""));
          monacoTA.focus();
          if (document.execCommand && document.execCommand("paste"))
            return true;
        } catch (_) {}

        try {
          const ev2 = new InputEvent("beforeinput", {
            inputType: "insertFromPaste",
            data: String(text || ""),
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          const ok2 = monacoTA.dispatchEvent(ev2);
          if (ok2 !== false) return true;
        } catch (_) {}

        try {
          const sel = monacoTA.ownerDocument.getSelection?.();
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0);
            const node = document.createTextNode(String(text || ""));
            r.insertNode(node);
            r.setStartAfter(node);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
          } else {
            monacoTA.appendChild(document.createTextNode(String(text || "")));
          }
          monacoTA.dispatchEvent(new Event("input", { bubbles: true }));
          return true;
        } catch (_) {}
        // fall through
      }
    }

    // 2) contentEditable path — reuse caret inserter for consistent behavior
    const ce = root.querySelector?.(
      '[contenteditable="true"], [role="textbox"][contenteditable="true"]'
    );
    if (ce) {
      try {
        return window.setComposerGuardAndCaret(String(text || ""));
      } catch (_) {
        /* fall through */
      }
    }

    // 3) <textarea>/<input> path — splice at selection
    const ti = root.querySelector?.('textarea, input[type="text"]');
    if (ti) {
      try {
        try {
          ti.focus();
        } catch {}
        const start = Number.isFinite(ti.selectionStart)
          ? ti.selectionStart
          : (ti.value || "").length;
        const end = Number.isFinite(ti.selectionEnd) ? ti.selectionEnd : start;
        const before = (ti.value || "").slice(0, start);
        const after = (ti.value || "").slice(end);
        const needsSepBefore = before.length > 0 && !/\n\n$/.test(before);
        const insert = (needsSepBefore ? "\n\n" : "") + String(text || "");
        const next = before + insert + after;

        const proto =
          ti.tagName === "TEXTAREA"
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        desc?.set?.call(ti, next);
        ti.dispatchEvent(new Event("input", { bubbles: true }));
        ti.dispatchEvent(new Event("change", { bubbles: true }));

        const caret = (before + insert).length;
        try {
          ti.setSelectionRange(caret, caret);
        } catch {}
        return true;
      } catch (_) {
        /* fall through */
      }
    }

    try {
      return document.execCommand("insertText", false, String(text || ""));
    } catch (_) {}
    return false;
  }

  // --- BG messaging with one retry if SW was asleep ---
  async function sendBG(type, payload, timeoutMs = 1500) {
    function ask() {
      return new Promise((res) => {
        let done = false;
        const to = setTimeout(() => {
          if (!done) res("__TIMEOUT__");
        }, timeoutMs);
        try {
          browser.runtime
            .sendMessage({ type, ...(payload || {}) })
            .then((r) => {
              done = true;
              clearTimeout(to);
              if (browser.runtime.lastError) return res("__NO_RECEIVER__");
              res(r);
            });
        } catch {
          res("__NO_RECEIVER__");
        }
      });
    }
    let r = await ask();
    if (r === "__NO_RECEIVER__" || r === "__TIMEOUT__") {
      // try to re-seed tokens (covers SW restart)
      try {
        const {
          data: { session },
        } = await (window.VG?.auth?.getSession?.() ?? {
          data: { session: null },
        });
        if (session?.access_token && session?.refresh_token) {
          await new Promise((res) =>
            browser.runtime
              .sendMessage({
                type: "SET_SESSION",
                access_token: session.access_token,
                refresh_token: session.refresh_token,
              })
              .then(() => res())
          );
        }
      } catch {}
      r = await ask(); // one retry
    }
    return r;
  }

  /* === NEW: ensure BG worker is signed in using SoT tokens before any DB read === */
  async function __vgEnsureBGSessionFromSoT() {
    try {
      const sot = await new Promise((res) =>
        browser.storage.local
          .get("VG_SESSION")
          .then((o) => res(o?.VG_SESSION || null))
      );
      if (
        !sot ||
        !sot.access_token ||
        !sot.refresh_token ||
        !Number.isFinite(sot.expires_at)
      ) {
        return false; // nothing to seed
      }
      const r = await sendBG(
        "SET_SESSION",
        {
          access_token: sot.access_token,
          refresh_token: sot.refresh_token,
          expires_at: sot.expires_at,
          userId: sot.userId || null,
          email: sot.email || null,
        },
        1500
      );
      return !!(r && r.ok);
    } catch {
      return false;
    }
  }

  function shouldBlockAutoGuardAtLimit(guard, gate) {
    if (!guard) return false;
    const auto =
      guard.autoGenerated === true ||
      guard.auto_generated === true ||
      String(guard.autoGeneratedSource || guard.auto_generated_source || "").length > 0;
    if (!auto) return false;
    const userEdited =
      Boolean(guard.userModifiedAt) || Boolean(guard.user_modified_at);
    if (userEdited) return false;
    const summary = gate?.summary;
    if (!summary) return false;
    const used = Number(summary.used);
    const limit = Number(summary.limit);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit === Infinity) {
      return false;
    }
    return used >= limit;
  }

  // === Fetch all Custom Prompts from Background (SoT) — no sorting/filtering ===
  async function CG_list() {
    // seed the BG service worker with tokens from SoT first (MV3 can be asleep)
    await __vgEnsureBGSessionFromSoT();

    try {
      const resp = await sendBG("VG_LIST_CUSTOM_PROMPTS");
      if (resp && resp.ok && Array.isArray(resp.items)) {
        return resp.items.filter(
          (row) => String(row?.status || "").toLowerCase() === "active"
        );
      }
    } catch (_) {}
    return [];
  }

  async function __vgFetchTeamPrompts() {
    try {
      const resp = await sendBG("GET_TEAM_PROMPTS"); // BG scopes to the signed-in user’s team
      if (resp?.ok && Array.isArray(resp.prompts)) return resp.prompts;
    } catch {}
    return [];
  }

  /* ==== Quick Adds + Library shim (restores Your Quick Adds section) ==== */

  // ---- Favorites (Quick Add) storage ----
  // DB-backed favorites, with local fallback only if DB is unavailable
  const VG_QA_KEY = "vg_quick_add_prompts";

  async function qaGetLocal() {
    return new Promise((res) =>
      browser.storage.local
        .get([VG_QA_KEY])
        .then((o) => res(o[VG_QA_KEY] || []))
    );
  }
  async function qaSetLocal(ids) {
    return new Promise((res) =>
      browser.storage.local.set({ [VG_QA_KEY]: ids }).then(res)
    );
  }

  window.vgQAGet =
    window.vgQAGet ||
    (async () => {
      try {
        const r = await sendBG("VG_LIST_QA_FAVORITES");
        if (r?.ok && Array.isArray(r.data)) {
          const ids = r.data.map((row) => row.prompt_id);
          try {
            await qaSetLocal(ids);
          } catch {}
          return ids;
        }
      } catch (e) {
        console.warn(
          "[VG][qm] vgQAGet bridge failed → falling back to local",
          e
        );
      }
      return qaGetLocal();
    });

  window.vgQAToggle =
    window.vgQAToggle ||
    (async (id) => {
      try {
        const cur = await window.vgQAGet();
        const isFav = cur.includes(id);
        const r = await sendBG(
          isFav ? "VG_DELETE_QA_FAVORITE" : "VG_UPSERT_QA_FAVORITE",
          { prompt_id: id }
        );

        if (r?.ok) {
          const next = isFav ? cur.filter((x) => x !== id) : [...cur, id];
          try {
            await qaSetLocal(next);
          } catch {}
          try {
            document.dispatchEvent(
              new CustomEvent("vg-qa-updated", { detail: { ids: next } })
            );
          } catch {}
          return !isFav;
        }
      } catch (_) {}
      // local fallback
      const cur = await qaGetLocal();
      const has = cur.includes(id);
      const next = has ? cur.filter((x) => x !== id) : [...cur, id];
      await qaSetLocal(next);
      try {
        document.dispatchEvent(
          new CustomEvent("vg-qa-updated", { detail: { ids: next } })
        );
      } catch {}
      return !has;
    });

  // ---- Prompt Library boot (fills window.__VG_PROMPT_LIBRARY) ----
  const VG_LIB_CACHE_KEY = "vg_prompts_cache"; // { items, cached_at }
  const VG_LIB_TTL_MS = 24 * 60 * 60 * 1000; // 24h

  function __vgGetCache() {
    return new Promise((res) =>
      browser.storage.local
        .get([VG_LIB_CACHE_KEY])
        .then((o) => res(o[VG_LIB_CACHE_KEY] || null))
    );
  }
  function __vgSetCache(payload) {
    return new Promise((res) =>
      browser.storage.local
        .set({ [VG_LIB_CACHE_KEY]: payload })
        .then(() => res())
    );
  }
  async function __vgFetchPromptsViaBackground() {
    try {
      const resp = await sendBG("FETCH_PROMPTS");
      if (!resp || resp.ok !== true)
        return { ok: false, error: resp?.error || "Fetch failed" };
      return { ok: true, items: resp.items || [] };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  async function __vgLoadPromptLibrary(force = false) {
    const cached = await __vgGetCache();
    const fresh =
      cached && !force && Date.now() - (cached.cached_at || 0) < VG_LIB_TTL_MS;
    if (fresh) return cached.items;

    const r = await __vgFetchPromptsViaBackground();
    if (r.ok) {
      await __vgSetCache({ items: r.items, cached_at: Date.now() });
      return r.items;
    }
    // fallback to empty if background not available (keeps UI stable)
    return [];
  }

  // Boot once per page if the library isn’t present yet.
  (async () => {
    if (Array.isArray(window.__VG_PROMPT_LIBRARY)) return; // already booted elsewhere
    try {
      const items = await __vgLoadPromptLibrary(false);
      window.__VG_PROMPT_LIBRARY = items.map((p) => ({
        id: p.id || p.name,
        "Prompt Name": p.name,
        Type: p.type,
        Subcategory: p.subcategory,
        Labels: Array.isArray(p.labels) ? p.labels : [],
        "Prompt Text": p.prompt_text,
      }));
      try {
        document.dispatchEvent(new CustomEvent("vg-lib-ready"));
      } catch {}
    } catch {
      window.__VG_PROMPT_LIBRARY = [];
    }
  })();
  /* ==== end Quick Adds + Library shim ==== */

  const QUICK_TEXTS = {
    // Settings‑aligned guards
    UI: `FORBIDDEN — DESIGN / UI CHANGES
        - Do NOT alter layout, spacing, padding, margin, positioning, breakpoints, or grid/flex structure.
        - Do NOT add/remove/modify CSS, Tailwind classes, CSS variables/tokens, inline styles, or theme values.
        - Do NOT change colors, typography (font, size, weight, line-height, letter-spacing), shadows, borders, radii, or animations/transitions.
        - Do NOT insert/remove/move DOM elements for visual effect; no wrappers, containers, or markup reshuffles for style only.
        - Do NOT change icons, images, illustrations, or asset references; do NOT swap SVG paths or viewBox.
        - Do NOT rename or reorganize design-related class names, data-* attributes, or ARIA used for styling.
        - If any design change appears necessary to satisfy the request, STOP and state the conflict and options.
        Treat all UI/UX as LOCKED unless explicitly instructed with exact diffs.`,

    COPY: `FORBIDDEN — TEXT / COPY CHANGES
        - Do NOT change wording, labels, placeholders, button text, helper text, tooltips, titles, headings, alt text, or ARIA labels.
        - Do NOT rewrite, rephrase, shorten, expand, localize, or "improve clarity".
        - Do NOT alter capitalization, punctuation, emojis, or grammar unless explicitly instructed with exact text.
        Copy is LOCKED. If text must change, STOP and request the exact new text.`,

    LOGIC: `FORBIDDEN — LOGIC / BEHAVIOR CHANGES
        - Do NOT modify control flow, conditions, loops, state machines, or side effects.
        - Do NOT change function signatures, return types, event handling, debouncing/throttling, or timing.
        - Do NOT add/remove network calls, storage access, or permissions; do NOT change endpoints, params, or headers.
        - Do NOT alter data transforms, parsing/validation, or error handling semantics.
        - Do NOT add new dependencies or upgrade versions.
        Behavior is LOCKED. Keep all execution paths identical outside the explicit scope.`,

    STRICT: `SCOPE LIMIT — ONLY TOUCH LISTED FILES
        - Only edit files explicitly listed under ALLOWED TOUCH POINTS.
        - If another file is required, add it under "REQUESTED ADDITIONS" with reason and STOP for approval.
        - Do NOT create, move, or delete files outside this list.
        - Output exact file+line diffs for every touched file.`,

    NOREF: `FORBIDDEN — REFACTORS
        - Do NOT rename files, symbols, or modules; do NOT move code across files.
        - Do NOT extract/inline functions, split/merge components, or change folder structure.
        - Do NOT "clean up", reformat, reorder imports, or apply style/lint fixes unless required by the change.
        - Keep dead code and comments untouched unless the request explicitly includes them.
        No refactoring unless explicitly requested with exact diffs.`,

    WIRE: `CONFIG / WIRING — WHEN ADDING NEW FUNCTIONS
        - Ensure exports/imports are added where required (index barrels included).
        - Register routes/handlers, DI container bindings, schedulers, background jobs, and feature flags as applicable.
        - Update initialization hooks and capability gates.
        - Provide a WIRING CHECKLIST:
          • export/import done
          • route/handler registered
          • DI binding added
          • feature flag added
          • init hook updated
        Mark non-applicable items as "N/A" with a one-line reason.`,

    POL: `DATABASE/RLS & SERVICE-ROLE SAFETY
        - List every table/view touched. For each: required role (user/service-role), RLS on/off, and the policy name used.
        - Do NOT weaken policies. If a minimal new policy is required, propose the smallest possible policy in a separate diff block.
        - Include a POLICY SIMULATION with one ALLOWED and one BLOCKED example (row-level predicates shown).
        - Confirm no service-role secrets are exposed client-side.`,

    DATA: `DATA ALIGNMENT & SCHEMA CONTRACTS
        - Validate field names, types, nullability, enums, and relations across all boundaries.
        - Confirm request/response shapes and status codes; note any deviations.
        - If a schema change is required, provide: forward migration, rollback script, and a one-line backfill plan.
        - Output a DATA CONTRACT CHECKLIST (inputs, outputs, errors, versioning).`,

    QA: `MANDATORY SELF-AUDIT — "DID YOU DO WHAT YOU SAID YOU WOULD DO?"
        - Trigger: If the user asks "did you do what you said you would do?", you MUST run this audit and return the sections below.
        - Do not claim completion unless every item has concrete evidence (file+line + test/proof).
  
        1) Restate the Plan (Verbatim)
        - Reproduce the exact plan you committed to earlier as a numbered list (1..N). If no plan exists, synthesize a minimal plan from your diffs.
  
        2) Plan-by-Plan Verification Table
        For each plan item i:
        - Status: [Done | Partially done | Not done]
        - Evidence: file:line pointers + minimal diff or code block proving the change
        - Proof: how you verified it (test, run, log, screenshot, API call) + result
        - Gaps/Fixes: what is missing or wrong and the smallest diff to correct it
  
        3) Acceptance & Guardrail Conformance
        - Confirm you respected all active guards (design/copy/logic/strict/noref/etc.).
        - If any guard would be violated to fulfill the request, STOP and list the conflict + options.
  
        4) Error & Oversight Audit
        - List mistakes/oversights you found (syntax, wiring, RLS, service-role use, data alignment, API contracts).
        - Root cause (1 line each): why it happened and how to prevent repeat.
  
        5) Coverage Summary
        - Completion % by category: logic, wiring/config, policies/RLS, data model/contracts, tests/docs.
        - Risk notes (anything brittle, untested, or flaky).
  
        6) New Plan to 100% (Smallest Diffs First)
        - Provide a short, ordered plan to fix misses and mistakes.
        - For each step: files/lines to touch, minimal change description, expected outcome.
        - If any step needs new files/permissions/policies, mark as "NEEDS APPROVAL" with reason.
  
        7) Next Action
        - If fixes are allowed under current guards: apply them now and re-run the self-audit.
        - If not allowed: STOP and await approval with your smallest-diff plan ready.`,

    BASIC: `SAFETY + CONFLICT + OUTPUT (BASELINE)
        SAFETY
        - Keep unrelated behavior identical. Make only the smallest necessary edits.
        - Provide explicit diffs; avoid hidden changes.
  
        CONFLICT CHECK
        - Before executing, check for conflicts with active guardrails.
        - If a conflict exists, STOP and list options.
  
        OUTPUT FORMAT
        - For each file change:
          START FILE: <relative-path>
          <minimal diff or full replacement>
          END FILE
        - After files: include WIRING CHECKLIST, POLICY SIMULATION, and DATA CONTRACT CHECKLIST.`,

    // Back-compat keys used by Quick Add & presets
    FORBIDDEN: `FORBIDDEN — GLOBAL SUMMARY
        - No design/UI changes.
        - No copy/text changes.
        - No refactors.
        - Do not touch files outside ALLOWED TOUCH POINTS.
        See specific guard sections (UI, COPY, NOREF, STRICT) for strict rules.`,

    SAFETY: `SAFETY
        - Keep unrelated behavior identical. Make only the smallest necessary edits.
        - Provide explicit diffs; avoid hidden changes.`,

    CONFLICT: `CONFLICT CHECK
        - Before executing, check for conflicts with active guardrails.
        - If a conflict exists, STOP and list options.`,

    CONFIG: `CONFIG / WIRING (REFERENCE)
        - Exports/imports updated
        - Routes/handlers registered
        - DI bindings added
        - Feature flags added
        - Init hooks updated
        Provide the WIRING CHECKLIST with statuses for each item.`,

    DB: `DATABASE/RLS & SERVICE-ROLE SAFETY
        (Use POL key content.)`,

    OUTPUT: `OUTPUT FORMAT
        - For each file: START FILE / diff / END FILE.
        - Then include WIRING CHECKLIST, POLICY SIMULATION, DATA CONTRACT CHECKLIST.`,

    // Alias used by "ALL" quick add (built elsewhere)
    ALL: null,
  };

  try {
    window.__VG_QUICK_TEXTS = QUICK_TEXTS;
  } catch {}

  function buildBasicProtections() {
    return [QUICK_TEXTS.SAFETY, QUICK_TEXTS.CONFLICT, QUICK_TEXTS.OUTPUT].join(
      "\n\n"
    );
  }
  function buildAllProtections() {
    return [
      QUICK_TEXTS.FORBIDDEN,
      QUICK_TEXTS.SAFETY,
      QUICK_TEXTS.CONFLICT,
      QUICK_TEXTS.CONFIG,
      QUICK_TEXTS.DB,
      QUICK_TEXTS.DATA,
      QUICK_TEXTS.OUTPUT,
      QUICK_TEXTS.QA,
    ].join("\n\n");
  }

  // Map Settings > Basic ids → Quick Menu Standard Guard ids
  // (left = settings id; right = quick menu id)
  const __VG_PROT_TO_QG = {
    basic: "basic", // BASIC GUARDS
    ui: "UI",
    copy: "COPY",
    logic: "LOGIC",
    strict: "STRICT",
    noref: "NOREF",
    wire: "CONFIG", // "Wire-Up New Code Paths" → CONFIG / WIRING
    pol: "DB", // Database/RLS → DATABASE POLICIES
    data: "DATA",
    qa: "QA",
  };

  // Read the saved "which protections are ON" from storage (set by settings.js)
  async function __vgStorageArea() {
    try {
      await browser.storage.sync.get(null);
      return browser.storage.sync;
    } catch {
      return browser.storage.local;
    }
  }
  async function __vgLoadActiveProtIds() {
    const area = await __vgStorageArea();
    const obj = await area.get("sb_protections_on");
    const arr = obj["sb_protections_on"];
    return Array.isArray(arr) ? arr : [];
  }
  async function __vgActiveQuickGuardIds() {
    const prot = await __vgLoadActiveProtIds();
    return new Set(prot.map((id) => __VG_PROT_TO_QG[id]).filter(Boolean));
  }

  const QUICK_GUARDS = [
    { id: "ALL", name: "ALL GUARDS" },
    { id: "basic", name: "BASIC GUARDS" },
    { id: "UI", name: "RESTRICT DESIGN CHANGES" },
    { id: "COPY", name: "RESTRICT TEXT CHANGES" },
    { id: "LOGIC", name: "RESTRICT LOGIC CHANGES" },
    { id: "STRICT", name: "ONLY TOUCH LISTED FILES" },
    { id: "NOREF", name: "NO REFACTORS" },
    { id: "CONFIG", name: "CONFIG / WIRING" },
    { id: "DB", name: "DATABASE POLICIES" },
    { id: "DATA", name: "DATA CONTRACTS & MIGRATIONS" },
    { id: "OUTPUT", name: "OUTPUT FORMAT" },
    { id: "QA", name: "DOUBLE-CHECK REVIEW" },
    { id: "FORBIDDEN", name: "FORBIDDEN" }, // optional: keep at end
  ];

  function openQuickMenu(pillRect) {
    document.getElementById("vg-quick-menu")?.remove();

    // Ensure base QM styles (muted text, etc.)
    __vgEnsureQMStyles();

    // --- normalize incoming rect values (avoid NaN/undefined during first frame) ---
    const prLeft = Number(pillRect?.left) || 0;

    const prTop = Number(pillRect?.top) || 0;
    const prWidth = Number(pillRect?.width) || 0;
    const centerX = Math.round(prLeft + prWidth / 2); // horizontal anchor

    const wrap = document.createElement("div");
    wrap.id = "vg-quick-menu";
    Object.assign(wrap.style, {
      position: "fixed",
      left: "0px", // provisional; we’ll set final left right after mount
      top: "0px", // provisional; we’ll set final top right after mount
      width: "480px",
      background: "#0f1116",
      color: "#e5e7eb",
      border: "1px solid #2a2a33",
      borderRadius: "12px",
      boxShadow: "0 20px 60px rgba(0,0,0,.5)",
      zIndex: String(Z + 1),
      overflow: "hidden",
    });

    // Absolute header that always stays on top AND hides the scrollbar behind it
    const header = document.createElement("div");
    header.textContent = "Quick Menu";
    Object.assign(header.style, {
      position: "absolute",
      top: "0",
      left: "0",
      height: "38px",
      display: "flex",
      alignItems: "center",
      padding: "0 14px",
      font: "600 15px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif",
      color: "#cbd5e1",
      background: "#0f1116",
      borderBottom: "1px solid #22232b",
      zIndex: 3,
      boxShadow: "0 6px 12px rgba(0,0,0,.25)",
      pointerEvents: "none",
    });

    const hdrActions = document.createElement("div");
    Object.assign(hdrActions.style, {
      position: "absolute",
      right: "8px",
      top: "0px", // span the full header height
      height: "38px", // same as header height
      display: "flex",
      alignItems: "center", // center all icons vertically
      gap: "6px",
      pointerEvents: "auto", // header itself has pointerEvents:none, so make this clickable
    });

    function mkCircleBtn({ id, title, svg }) {
      const btn = document.createElement("button");
      btn.id = id;
      btn.title = title;
      Object.assign(btn.style, {
        width: "24px",
        height: "24px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "9999px",
        background: "#1f1f26",
        border: "1px solid #2a2a33",
        color: "#a1a1aa", // icon uses currentColor (flat gray)
        cursor: "pointer",
        outline: "none",
        padding: "0",
        transition:
          "transform .12s ease, color .12s ease, background .12s ease, border-color .12s ease",
      });

      btn.innerHTML = svg;

      // keep inline SVG from baseline-jitter; not required but nicer
      const svgEl = btn.querySelector("svg");
      if (svgEl) svgEl.style.display = "block";

      // hover/focus → purple icon + slightly darker button
      const on = () => {
        btn.style.background = "#242733";
        btn.style.borderColor = "#3a3a46";
        btn.style.color = "#7c3aed";
      };
      const off = () => {
        btn.style.background = "#1f1f26";
        btn.style.borderColor = "#2a2a33";
        btn.style.color = "#a1a1aa";
      };

      btn.addEventListener("mouseenter", on);
      btn.addEventListener("mouseleave", off);
      btn.addEventListener("focus", on);
      btn.addEventListener("blur", off);

      return btn;
    }

    // AI Chat (left) — chat bubble icon
    const chatBtn = mkCircleBtn({
      id: "vg-ai-chat-btn",
      title: "AI Chat",
      svg: SVG_CHAT_BUBBLE,
    });

    // AI Enhance (right) — sparkle icon
    const enhanceBtn = mkCircleBtn({
      id: "vg-ai-enhance-btn",
      title: "AI Enhance",
      svg: `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
             preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <g vector-effect="non-scaling-stroke" shape-rendering="geometricPrecision">
            <path d="M12 3 L14.5 9.5 L21 12 L14.5 14.5 L12 21 L9.5 14.5 L3 12 L9.5 9.5 Z"></path>
            <path d="M18 6 L19 8.5 L21.5 9.5 L19 10.5 L18 13 L17 10.5 L14.5 9.5 L17 8.5 Z"></path>
            <path d="M6 12 L6.7 13.8 L8.5 14.5 L6.7 15.2 L6 17 L5.3 15.2 L3.5 14.5 L5.3 13.8 Z"></path>
          </g>
        </svg>`,
    });

    // Bug Buster button (parked; kept for future reactivation)
    const bugBtnCircle = mkCircleBtn({
      id: "vg-bugbuster-btn",
      title: "Bug Buster",
      svg: `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
             stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"
             preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <g vector-effect="non-scaling-stroke" shape-rendering="geometricPrecision">
            <circle cx="12" cy="7" r="2"></circle>
            <ellipse cx="12" cy="14" rx="4" ry="5"></ellipse>
            <line x1="12" y1="9"  x2="12" y2="19"></line>
            <line x1="8"  y1="11" x2="4"  y2="10"></line>
            <line x1="8"  y1="14" x2="4"  y2="14"></line>
            <line x1="8"  y1="17" x2="4"  y2="18"></line>
            <line x1="16" y1="11" x2="20" y2="10"></line>
            <line x1="16" y1="14" x2="20" y2="14"></line>
            <line x1="16" y1="17" x2="20" y2="18"></line>
            <line x1="10.5" y1="5" x2="9"  y2="3"></line>
            <line x1="13.5" y1="5" x2="15" y2="3"></line>
          </g>
        </svg>`,
    });
    // NOTE: bugBtnCircle is intentionally not added to hdrActions so the feature stays parked.

    // Lazy-load ai-chat.js, then open the modal and close the menu
    chatBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (typeof window.openAiChatModal !== "function") {
          await import(browser.runtime.getURL("src/ui/ai-chat.js"));
        }
        try {
          closeMenu();
        } catch {}
        window.openAiChatModal();
      } catch (err) {
        console.warn("[VG] AI Chat load failed", err);
      }
    });

    // Optional: prefetch on first hover to make initial open snappier
    chatBtn.addEventListener(
      "mouseenter",
      () => {
        if (typeof window.openAiChatModal !== "function") {
          import(browser.runtime.getURL("src/ui/ai-chat.js")).catch(() => {});
        }
      },
      { once: true }
    );

    // AI Enhance → enhancehighlight engine
    enhanceBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        closeMenu();
      } catch {}
      try {
        if (typeof window.vgEnhanceComposerAll !== "function") {
          await import(browser.runtime.getURL("src/ui/enhancehighlight.js"));
        }
        await window.vgEnhanceComposerAll?.();
      } catch (err) {
        console.warn("[VG] AI Enhance load/exec failed", err);
      }
    });

    // Prefetch enhance engine on hover
    enhanceBtn.addEventListener(
      "mouseenter",
      () => {
        if (typeof window.vgEnhanceComposerAll !== "function") {
          import(browser.runtime.getURL("src/ui/enhancehighlight.js")).catch(
            () => {}
          );
        }
      },
      { once: true }
    );

    hdrActions.appendChild(chatBtn);
    hdrActions.appendChild(enhanceBtn);

    /* === Phase 2: Screenshot button → overlay stub (lazy-loaded) === */
    let shotBtn = null;
    if (window.__VG_FEATURES?.screenshot_enabled === true) {
      shotBtn = mkCircleBtn({
        id: "vg-screenshot-btn",
        title: "Screenshot",
        svg: SVG_CAMERA,
      });

      shotBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          closeMenu();
        } catch {}
        try {
          if (typeof window.openScreenshotOverlay !== "function") {
            await import(browser.runtime.getURL("src/ui/screenshot.js"));
          }
          window.openScreenshotOverlay?.();
        } catch (err) {
          console.warn("[VG] screenshot overlay load failed", err);
        }
      });

      // Add between Bug and the Dashboard (+) button
      hdrActions.appendChild(shotBtn);
    }

    header.appendChild(hdrActions);

    // ➕ Dashboard opener — purple "+" (larger; hover ring); same behavior
    const gearBtn = makeIconBtn({
      id: "vg-settings-btn",
      title: "Dashboard",
      html: SVG_PLUS_PURPLE,
      onClick: async (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (typeof window.openModal === "function") {
          window.openModal("advanced");
          return;
        }
        if (typeof window.__SB_OPEN_MODAL === "function") {
          window.__SB_OPEN_MODAL("advanced");
          return;
        }

        try {
          await import(browser.runtime.getURL("src/ui/settings.js"));
          const fn = window.openModal || window.__SB_OPEN_MODAL;
          if (typeof fn === "function") {
            fn("advanced");
            return;
          }
          console.warn("[VG] settings module loaded but no opener was exposed");
        } catch (err) {
          console.warn("[VG] lazy import of settings failed", err);
        }
      },
    });

    // Enlarge hit-area and keep the ring inside the 38px header line box
    Object.assign(gearBtn.style, {
      boxSizing: "border-box", // include border in the total box
      width: "36px", // fits inside 38px header with 1px border on each side
      height: "36px",
      borderRadius: "9999px",
      border: "1px solid transparent",
      background: "transparent",
      lineHeight: "0",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      transition:
        "background .12s ease, border-color .12s ease, transform .12s ease",
    });

    // Subtle hover/focus ring that does NOT exceed the header
    const plusOn = () => {
      gearBtn.style.background = "rgba(139, 92, 246, 0.08)"; // lighter wash
      gearBtn.style.borderColor = "rgba(139, 92, 246, 0.28)"; // softer ring
    };
    const plusOff = () => {
      gearBtn.style.background = "transparent";
      gearBtn.style.borderColor = "transparent";
    };
    gearBtn.addEventListener("mouseenter", plusOn);
    gearBtn.addEventListener("mouseleave", plusOff);
    gearBtn.addEventListener("focus", plusOn);
    gearBtn.addEventListener("blur", plusOff);

    // append "+" after bug
    hdrActions.appendChild(gearBtn);

    // --- Hover tooltips for header buttons (AI Chat / Bug Buster)
    (function addHeaderTooltips() {
      // one tooltip element reused for both buttons
      const tip = document.createElement("div");
      Object.assign(tip.style, {
        position: "absolute",
        padding: "6px 8px",
        background: "#0f1116",
        border: "1px solid #2a2a33",
        color: "#e5e7eb",
        font: '12px/1.2 Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
        borderRadius: "8px",
        boxShadow: "0 10px 30px rgba(0,0,0,.5)",
        pointerEvents: "none",
        zIndex: 10,
        whiteSpace: "nowrap",
        opacity: "0",
        transform: "translateY(-4px)",
        transition: "opacity .12s ease, transform .12s ease",
      });
      wrap.appendChild(tip);

      function positionFor(target) {
        // place the tooltip centered under the button, clamped to wrap
        const b = target.getBoundingClientRect();
        const w = wrap.getBoundingClientRect();
        const left = b.left - w.left + b.width / 2 - tip.offsetWidth / 2;
        const top = b.bottom - w.top + 6;
        tip.style.left =
          Math.max(6, Math.min(left, wrap.clientWidth - tip.offsetWidth - 6)) +
          "px";
        tip.style.top = top + "px";
      }

      function attach(target, label) {
        if (!target) return;
        target.removeAttribute("title"); // ← kill native browser tooltip
        target.setAttribute("aria-label", label); // a11y (screen readers)
        target.addEventListener("mouseenter", () => {
          tip.textContent = label;
          // make sure size is computed before positioning
          tip.style.opacity = "0";
          tip.style.display = "block";
          // next frame to get offsetWidth
          requestAnimationFrame(() => {
            positionFor(target);
            tip.style.opacity = "1";
            tip.style.transform = "translateY(0)";
          });
        });
        target.addEventListener("mouseleave", () => {
          tip.style.opacity = "0";
          tip.style.transform = "translateY(-4px)";
          // hide after fade so it doesn’t block clicks
          setTimeout(() => {
            tip.style.display = "none";
          }, 120);
        });
        target.addEventListener("focus", () => {
          tip.textContent = label;
          tip.style.display = "block";
          positionFor(target);
          tip.style.opacity = "1";
          tip.style.transform = "translateY(0)";
        });
        target.addEventListener("blur", () => {
          tip.style.opacity = "0";
          tip.style.transform = "translateY(-4px)";
          setTimeout(() => {
            tip.style.display = "none";
          }, 120);
        });
        window.addEventListener("resize", () => {
          if (tip.style.display === "block") positionFor(target);
        });
      }

      attach(chatBtn, "AI Chat");
      attach(enhanceBtn, "AI Enhance");
      if (shotBtn) attach(shotBtn, "Screenshot"); // Phase 1 tooltip
      attach(gearBtn, "Dashboard");
    })();

    // A small overlay strip that covers the scrollbar lane for the header height
    const scrollbarCover = document.createElement("div");
    Object.assign(scrollbarCover.style, {
      position: "absolute",
      top: "0",
      right: "0",
      height: "38px",
      width: "0px", // will be set to scrollbar width dynamically
      background: "#0f1116",
      borderBottom: "1px solid #22232b",
      zIndex: 4,
      pointerEvents: "none",
    });

    // Measure scrollbar width and adjust the header and cover
    const updateHeaderWidth = () => {
      const sbw = wrap.offsetWidth - wrap.clientWidth; // scrollbar width
      header.style.right = sbw + "px"; // leave space for scrollbar
      scrollbarCover.style.width = sbw + "px"; // cover the scrollbar lane
    };

    updateHeaderWidth();
    window.addEventListener("resize", updateHeaderWidth, { passive: true });

    // Append header overlays
    wrap.appendChild(header);
    wrap.appendChild(scrollbarCover);

    // --- Ensure dark scrollbars CSS exists (WebKit + Firefox) ---
    (function ensureQMDarkScrollbars() {
      if (document.getElementById("vg-qm-scrollbars")) return;
      const st = document.createElement("style");
      st.id = "vg-qm-scrollbars";
      st.textContent = `
          .vg-qm-scroll{ scrollbar-width:thin; scrollbar-color:#2a2a33 #0c0e13; }
          .vg-qm-scroll::-webkit-scrollbar{ width:10px; height:10px; }
          .vg-qm-scroll::-webkit-scrollbar-track{ background:#0c0e13; border-radius:8px; }
          .vg-qm-scroll::-webkit-scrollbar-thumb{ background:#2a2a33; border-radius:8px; border:2px solid #0c0e13; }
          .vg-qm-scroll::-webkit-scrollbar-thumb:hover{ background:#3a3a45; }
        `;
      document.head.appendChild(st);
    })();

    // Fixed menu height so the top never moves.
    // (The list scrolls *inside*.)
    const MENU_HEIGHT = 450; // px

    // Scroll area sits UNDER the header; fixed height
    const scroller = document.createElement("div");
    scroller.className = "vg-qm-scroll"; // ← dark scrollbar rules
    Object.assign(scroller.style, {
      height: MENU_HEIGHT + "px",
      overflow: "auto",
      padding: "10px",
      paddingTop: "38px", // exact header height; no gap
      // Firefox-only props also set inline to be extra sure
      scrollbarWidth: "thin",
      scrollbarColor: "#2a2a33 #0c0e13",
    });

    // --- Search (live filter) ---
    const searchWrap = document.createElement("div");
    searchWrap.style.cssText = `
      position: sticky;
      top: 0;               /* stick to top of scroller */
      background: #0f1116;  /* solid mask */
      padding: 8px 0 10px;  /* a bit more breathing room */
      z-index: 6;           /* above rows and equal/above header shadow */
      box-shadow: 0 6px 12px rgba(0,0,0,.25); /* subtle divider under search */
    `;

    // Ensure header sits above everything else
    header.style.zIndex = "7";
    scrollbarCover.style.zIndex = "7";

    // And keep the scroller content from peeking above:
    scroller.style.background = "#0f1116";

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Search prompts…";
    searchInput.style.cssText = `
      width: 100%;
      height: 28px;
      border-radius: 8px;
      border: 1px solid #2a2a33;
      background: #0c0e13;
      color: #e5e7eb;
      font: 14px/1.25 Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      padding: 4px 8px;
      outline: none;
    `;

    searchWrap.appendChild(searchInput);
    scroller.appendChild(searchWrap);
    // Do not auto-focus; user can click to search. Keeps caret in the composer.

    // wire input
    searchInput.addEventListener("input", () => applyFilter(searchInput.value));

    // section-aware filter data + helpers (declare BEFORE we add rows)
    const allFilterables = [];
    const norm = (s) => (s || "").toLowerCase();

    const sections = {
      custom: { header: null, sep: null },
      team: { header: null, sep: null }, // ← NEW
      standard: { header: null, sep: null },
      quick: { header: null, sepAbove: null, sepBelow: null },
    };

    function addFilterable(row, name, section) {
      row.dataset.fname = norm(name);
      if (section) row.dataset.section = section;
      allFilterables.push(row);
    }

    function applyFilter(q) {
      const n = norm(q);
      let visible = 0,
        visCustom = 0,
        visTeam = 0,
        visStd = 0,
        visQuick = 0; // ← NEW visTeam

      allFilterables.forEach((row) => {
        const show = !n || row.dataset.fname.includes(n);
        row.style.display = show ? "flex" : "none";
        if (show) {
          visible++;
          if (row.dataset.section === "custom") visCustom++;
          if (row.dataset.section === "team") visTeam++; // ← NEW
          if (row.dataset.section === "standard") visStd++;
          if (row.dataset.section === "quick") visQuick++;
        }
      });

      if (sections.custom.header)
        sections.custom.header.style.display = visCustom ? "" : "none";
      if (sections.custom.sep)
        sections.custom.sep.style.display = visCustom ? "" : "none";
      if (sections.team?.header)
        sections.team.header.style.display = visTeam ? "" : "none"; // ← NEW
      if (sections.team?.sep)
        sections.team.sep.style.display = visTeam ? "" : "none"; // ← NEW
      if (sections.standard.header)
        sections.standard.header.style.display = visStd ? "" : "none";
      if (sections.quick.header)
        sections.quick.header.style.display = visQuick ? "" : "none";
      if (sections.quick.sepAbove)
        sections.quick.sepAbove.style.display = visQuick ? "" : "none";
      if (sections.quick.sepBelow)
        sections.quick.sepBelow.style.display = visQuick ? "" : "none";
    }

    // === Preview Modal (shared by Quick Adds / Custom Prompts) ===
    function formatPromptPreviewText(raw) {
      const text = String(raw || "");
      if (!text) return "";
      return text
        .replace(/\r\n/g, "\n")
        .replace(/^[ \t]*#{1,6}\s*/gm, "") // strip Markdown headings
        .replace(/^[ \t]*[-*]\s+/gm, "• ") // convert bullet markers
        .replace(/\*\*(.*?)\*\*/g, "$1") // bold markers
        .replace(/__(.*?)__/g, "$1")
        .replace(/\*(.*?)\*/g, "$1") // italics
        .replace(/`{1,3}([^`]+)`{1,3}/g, "$1") // inline code
        .replace(/^\s+$/gm, "") // remove whitespace-only lines
        .trimEnd();
    }

    function openPromptPreview(opts) {
      const title = String(opts?.title || "Preview");
      const body = String(opts?.body || "");

      // Close any existing
      closePromptPreview();

      // Backdrop
      const back = document.createElement("div");
      back.style.cssText = [
        "position:fixed",
        "inset:0",
        "background:rgba(0,0,0,.45)",
        "display:flex",
        "align-items:flex-start",
        "justify-content:center",
        `z-index:${Z + 10}`,
      ].join(";");

      // Modal
      const modal = document.createElement("div");
      modal.style.cssText = [
        "margin-top:8vh",
        "background:#111318",
        "color:#E6E7EB",
        "border:1px solid #2A2D36",
        "border-radius:12px",
        "width:min(720px,92vw)",
        "box-shadow:0 10px 40px rgba(0,0,0,.5)",
      ].join(";");

      // NEW: tag the backdrop and set an "open" flag used by Quick Menu closers
      back.id = "vgqm-preview-backdrop";
      try {
        window.__VG_PREVIEW_OPEN = true;
      } catch {}

      // NEW: capture-phase handler to prevent Quick Menu's capture closers
      back.addEventListener(
        "pointerdown",
        (e) => {
          e.stopPropagation(); // stop at capture so QM’s capture listener never sees it
        },
        true
      );

      // NEW: clicking the backdrop closes the preview (bubble is fine now)
      back.addEventListener("click", (e) => {
        e.stopPropagation();
        closePromptPreview();
      });

      // Keep clicks inside modal from reaching the backdrop
      modal.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      // NEW: backdrop click closes; clicks inside modal do NOT bubble to backdrop
      back.addEventListener("click", closePromptPreview);
      modal.addEventListener("click", (e) => {
        e.stopPropagation();
      });

      // Header
      const header = document.createElement("header");
      header.style.cssText = [
        "display:flex",
        "align-items:center",
        "justify-content:space-between",
        "padding:14px 16px",
        "border-bottom:1px solid #23252E",
        "font-weight:600",
      ].join(";");
      const hLeft = document.createElement("div");
      hLeft.textContent = title;
      const hBtn = makeIconBtn({
        title: "Close",
        html: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        onClick: closePromptPreview,
      });
      header.appendChild(hLeft);
      header.appendChild(hBtn);

      // Body (auto-height up to 70vh → avoids scrolling when possible)
      const bodyEl = document.createElement("div");
      bodyEl.style.cssText =
        "padding:16px;white-space:pre-wrap;line-height:1.5;max-height:70vh;overflow:auto;";
      bodyEl.textContent = formatPromptPreviewText(body);

      const footer = document.createElement("footer");
      // Layout: [Close] ………………… [Edit] [Insert]
      footer.style.cssText =
        "display:flex;gap:8px;justify-content:flex-start;padding:12px 16px;border-top:1px solid #23252E;";

      // Close (left)
      const btnClose = document.createElement("button");
      btnClose.className = "vgqm-btn";
      btnClose.textContent = "Close";
      btnClose.style.cssText =
        "padding:8px 12px;border-radius:10px;border:1px solid #2A2D36;background:#151821;color:#E6E7EB;cursor:pointer;";
      btnClose.addEventListener("click", closePromptPreview);

      // Spacer pushes the right-side group to the far edge
      const spacer = document.createElement("div");
      spacer.style.flex = "1";

      // Edit (neutral, subtle; sits to the left of Insert)
      const btnEdit = document.createElement("button");
      btnEdit.className = "vgqm-btn";
      btnEdit.textContent = "Edit";
      btnEdit.style.cssText =
        "padding:8px 12px;border-radius:10px;border:1px solid #2A2D36;background:#1f1f26;color:#E6E7EB;cursor:pointer;";
      btnEdit.addEventListener("click", async () => {
        try {
          if (typeof opts?.onEdit === "function") {
            await opts.onEdit();
          } else {
            // Fallback route: open Dashboard → My Prompts and ask it to open the Edit modal
            routeToEditPrompt(
              String(opts?.id || ""),
              String(opts?.title || ""),
              String(opts?.body || "")
            );
          }
        } catch {}
        closePromptPreview();
      });

      // Insert (far right, purple)
      const btnInsert = document.createElement("button");
      btnInsert.className = "vgqm-btn primary";
      btnInsert.textContent = "Insert";
      btnInsert.style.cssText =
        "padding:8px 12px;border-radius:10px;border:1px solid #8B5CF6;background:#8B5CF6;color:#0B0C10;font-weight:600;cursor:pointer;";
      btnInsert.addEventListener("click", async () => {
        try {
          await opts?.onInsert?.();
        } catch {}
        closePromptPreview();
      });

      footer.appendChild(btnClose);
      footer.appendChild(spacer);
      footer.appendChild(btnEdit);
      footer.appendChild(btnInsert);

      modal.appendChild(header);
      modal.appendChild(bodyEl);
      modal.appendChild(footer);

      // Keyboard UX
      back.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closePromptPreview();
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          try {
            opts?.onInsert?.();
          } catch {}
          closePromptPreview();
        }
      });

      back.appendChild(modal);
      document.body.appendChild(back);
      back.focus?.();
    }

    try {
      window.__VG_OPEN_PROMPT_PREVIEW = openPromptPreview;
    } catch {}

    function closePromptPreview() {
      try {
        window.__VG_PREVIEW_OPEN = false;
      } catch {}
      const el = document.getElementById("vgqm-preview-backdrop");
      if (el) {
        try {
          el.remove();
        } catch {}
      }
    }

    // Route to Dashboard → My Prompts and open the Edit modal with seed
    function routeToEditPrompt(id, name, body) {
      (async () => {
        // Ensure the Dashboard module is loaded
        if (
          typeof window.openModal !== "function" &&
          typeof window.__SB_OPEN_MODAL !== "function"
        ) {
          try {
            await import(browser.runtime.getURL("src/ui/settings.js"));
          } catch (_) {}
        }

        // Open Dashboard on "My Prompts"
        try {
          (window.openModal || window.__SB_OPEN_MODAL)?.("advanced");
        } catch (_) {}

        // Wait for modal host, then ask it to open Edit with our data
        const HOST_ID =
          (window.__VG_CONSTS?.APP || "vibeguardian") + "-modal-host";
        let tries = 0;
        const t = setInterval(() => {
          const host = document.getElementById(HOST_ID);
          if (host && host.shadowRoot) {
            clearInterval(t);
            try {
              document.dispatchEvent(
                new CustomEvent("vg-edit-prompt", {
                  detail: {
                    id: String(id || ""),
                    name: String(name || ""),
                    body: String(body || ""),
                  },
                })
              );
            } catch (_) {}
          } else if (++tries > 60) {
            // ~3s
            clearInterval(t);
          }
        }, 50);
      })();
    }

    // --- Hover/focus affordance without blurring text ---
    function __vgDecorateRowInteractivity(row) {
      if (!row) return;

      // Make keyboard focusable
      row.tabIndex = 0;

      // Ensure we can absolutely position the FX layer
      if (row.style.position !== "relative") row.style.position = "relative";

      // Create an underlay that we animate (text stays crisp)
      let fx = row.querySelector(":scope > .vg-row-fx");
      if (!fx) {
        fx = document.createElement("div");
        fx.className = "vg-row-fx";
        Object.assign(fx.style, {
          position: "absolute",
          inset: "0",
          borderRadius: getComputedStyle(row).borderRadius || "8px",
          pointerEvents: "none",
          // Start state
          transform: "scale(1)",
          boxShadow: "none",
          border: "1px solid transparent",
          // Smooth but lightweight transition
          transition:
            "transform .12s ease, box-shadow .12s ease, border-color .12s ease",
        });
        // Put it behind content
        row.prepend(fx);
      }

      // We can still tint the actual row border (doesn't blur text)
      const on = () => {
        fx.style.transform = "scale(1.02)"; // scale the underlay only
        fx.style.boxShadow = "0 0 0 1px rgba(124,58,237,.35) inset";
        fx.style.borderColor = "#7c3aed";
        row.style.borderColor = "#7c3aed";
      };
      const off = () => {
        fx.style.transform = "scale(1)";
        fx.style.boxShadow = "none";
        fx.style.borderColor = "transparent";
        row.style.borderColor = "#22232b";
      };

      // Respect reduced motion (disable the scale)
      const reduceMotion =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        fx.style.transition = "border-color .12s ease, box-shadow .12s ease";
        const onNoScale = () => {
          fx.style.boxShadow = "0 0 0 1px rgba(124,58,237,.35) inset";
          fx.style.borderColor = "#7c3aed";
          row.style.borderColor = "#7c3aed";
        };
        const offNoScale = () => {
          fx.style.boxShadow = "none";
          fx.style.borderColor = "transparent";
          row.style.borderColor = "#22232b";
        };
        row.addEventListener("mouseenter", onNoScale);
        row.addEventListener("mouseleave", offNoScale);
        row.addEventListener("focus", onNoScale);
        row.addEventListener("blur", offNoScale);
        return;
      }

      row.addEventListener("mouseenter", on);
      row.addEventListener("mouseleave", off);
      row.addEventListener("focus", on);
      row.addEventListener("blur", off);
    }

    // === Your Quick Adds (from Library) at the top of the menu ===
    (() => {
      // 0) Paint the section shell immediately
      const sepAboveQA = document.createElement("div");
      sepAboveQA.style.cssText =
        "margin:8px 0 6px;height:1px;background:#22232b";
      scroller.appendChild(sepAboveQA);
      sections.quick.sepAbove = sepAboveQA;

      const head = document.createElement("div");
      head.textContent = "My Quick Adds";
      head.style.cssText =
        "font:500 10px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#cbd5e1;margin:2px 2px 8px";
      scroller.appendChild(head);
      sections.quick.header = head;

      const qaRoot = document.createElement("div");
      qaRoot.id = "vg-qm-qa-root";
      scroller.appendChild(qaRoot);

      const sepBelowQA = document.createElement("div");
      sepBelowQA.style.cssText =
        "margin:8px 0 6px;height:1px;background:#22232b";
      scroller.appendChild(sepBelowQA);
      sections.quick.sepBelow = sepBelowQA;

      // 1) Single render function (idempotent)
      async function renderQuickAdds() {
        try {
          qaRoot.innerHTML = ""; // clear

          // a) Get current favorites
          const favIds = await vgQAGet();

          // b) Need Library rows to resolve ids -> prompts
          const lib = Array.isArray(window.__VG_PROMPT_LIBRARY)
            ? window.__VG_PROMPT_LIBRARY
            : [];

          if (!lib.length) {
            qaRoot.appendChild(__vgMakeLoader("Loading your Quick Adds…"));
            return;
          }

          const byId = new Map(lib.map((p) => [String(p.id), p]));
          const favs = favIds.map((id) => byId.get(String(id))).filter(Boolean);

          if (!favs.length) {
            const empty = document.createElement("div");
            empty.className = "muted";
            empty.textContent =
              "No quick adds yet. Open the Marketplace and click “Quick Add”.";
            qaRoot.appendChild(empty);
            return;
          }

          // c) Build rows (UNCHANGED logic from your original)
          favs.forEach((p) => {
            const row = document.createElement("div");
            row.style.cssText =
              "position:relative;display:flex;align-items:center;gap:6px;padding:6px 4px;border-radius:8px;border:1px solid #22232b;margin-bottom:6px;background:#0c0e13;min-width:0;overflow:hidden;";
            __vgDecorateRowInteractivity(row);

            const label = document.createElement("div");
            label.textContent = p["Prompt Name"];
            label.style.cssText =
              "flex:1;min-width:0;font-size:14px;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

            const btn = makeIconBtn({
              id: null,
              title: "Preview",
              html: SVG_EYE,
              variant: "preview", // 🔵 NEW: enables purple hover
              onClick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                openPromptPreview({
                  id: String(p.id || ""),
                  title: String(p["Prompt Name"] || "Preview"),
                  body: String(p["Prompt Text"] || ""),
                  onInsert: async () => {
                    await insertQuickAdd();
                  },
                  onEdit: async () => {
                    routeToEditPrompt(
                      String(p.id || ""),
                      String(p["Prompt Name"] || ""),
                      String(p["Prompt Text"] || "")
                    );
                  },
                });
              },
            });

            btn.setAttribute("data-vg-origin", "qa");
            btn.setAttribute("data-vg-id", String(p.id));

            async function insertQuickAdd() {
              __qmLog("QA insert: preflight", { pid: String(p.id) });
              try {
                const gate = await sendBG("VG_CAN_INSERT_QUICK", {
                  prompt_id: String(p.id),
                });
                if (
                  gate &&
                  gate.ok === false &&
                  (gate.reason === "QUICK_ADD_LIMIT" ||
                    gate.reason === "CUSTOM_GUARD_LIMIT")
                ) {
                  __qmLog(
                    "QA insert: BLOCKED by plan limit; paywall should pop"
                  );
                  return;
                }
              } catch (e) {
                __qmLog("QA insert: pre-flight threw", e);
                return;
              }

              __qmLog("QA insert: start", { pid: String(p.id) });
              const text = p["Prompt Text"] || "";
              let ok = false;
              try {
                ok = !!window.vgInsertPrompt(text);
              } catch (e) {
                __qmLog("QA insert: vgInsertPrompt threw", e);
                ok = false;
              }
              if (!ok) {
                __qmLog("QA insert: first attempt failed → retry rAF");
                await new Promise((res) => requestAnimationFrame(res));
                try {
                  document
                    .querySelector("div#prompt-textarea.ProseMirror")
                    ?.focus();
                } catch {}
                try {
                  ok = !!window.vgInsertPrompt(text);
                } catch (e) {
                  __qmLog("QA insert: retry threw", e);
                  ok = false;
                }
                __qmLog("QA insert: retry result", ok);
              }
              (async () => {
                try {
                  const r = await sendBG("VG_LOG_QUICK_USE", {
                    prompt_id: String(p.id),
                  });
                  __qmLog("QA insert: usage log result", r && r.ok);
                } catch (e) {
                  __qmLog("QA insert: usage log error", e);
                }
              })();
              try {
                await window.maybePromptUpgrade?.();
              } catch {}
              document.getElementById("vg-quick-menu")?.remove();
            }

            row.style.cursor = "pointer";
            row.addEventListener("click", (e) => {
              if (e.target && e.target.closest("button") === btn) return;
              e.preventDefault();
              e.stopPropagation();
              insertQuickAdd();
            });

            row.appendChild(label);
            row.appendChild(btn);
            qaRoot.appendChild(row);
            addFilterable(row, p["Prompt Name"] || "", "quick");
          });
        } catch (e) {
          console.warn("[VG] quick-add favorites render failed", e);
          qaRoot.innerHTML = `<div class="muted">Couldn’t load Quick Adds.</div>`;
        }
      }

      // 2) First paint now; if Library isn’t ready, we’ll show “Loading…”
      renderQuickAdds();

      // 3) Re-render when the Library or favorites change
      const onLibReady = () => {
        try {
          renderQuickAdds();
        } catch {}
      };
      const onLibUpdated = () => {
        try {
          renderQuickAdds();
        } catch {}
      };
      const onQAUpdated = () => {
        try {
          renderQuickAdds();
        } catch {}
      };

      document.addEventListener("vg-lib-ready", onLibReady, { once: true }); // first boot
      document.addEventListener("vg-lib-updated", onLibUpdated);
      document.addEventListener("vg-qa-updated", onQAUpdated);
    })();

    // Container that will hold all built-in (standard) guards.
    // We’ll append a header to this only if customs exist.
    const builtinsSection = document.createElement("div");
    scroller.appendChild(builtinsSection);

    /* ---------- CUSTOM PROMPTS (TOP) ---------- */
    (async () => {
      try {
        // Fetch ALL of the user's custom prompts from Background (SoT)
        let customs = [];
        try {
          customs = await CG_list(); // returns [{ id, name, body, ... }]
        } catch (_) {
          customs = [];
        }

        // If you prefer to normalize shape strictly, uncomment:
        // customs = Array.isArray(customs) ? customs.map(__toLocalGuard) : [];

        // Prepare fragment early; both header and empty state append to it
        const frag = document.createDocumentFragment();

        // Section header (always render)
        {
          const head = document.createElement("div");
          head.textContent = "My Custom Prompts";
          head.style.cssText =
            "font:500 10px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#cbd5e1;margin:2px 2px 8px";
          sections.custom.header = head; // <-- register header
          frag.appendChild(head);
        }

        // Empty state if there are no custom guards (keep header visible)
        if (!Array.isArray(customs) || customs.length === 0) {
          // wrapper row: text left, button right
          const row = document.createElement("div");
          row.style.cssText =
            "display:flex;align-items:center;justify-content:space-between;" +
            "gap:10px;padding:6px 2px 8px;";

          // left label
          const empty = document.createElement("div");
          empty.textContent = "No custom prompts yet";
          empty.style.cssText =
            "color:#a1a1aa;font:12px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;";

          // open settings → Advanced (Custom Guards)
          async function openSettingsAdvanced() {
            if (typeof window.openModal === "function")
              return void window.openModal("advanced");
            if (typeof window.__SB_OPEN_MODAL === "function")
              return void window.__SB_OPEN_MODAL("advanced");
            try {
              await import(browser.runtime.getURL("src/ui/settings.js"));
              const fn = window.openModal || window.__SB_OPEN_MODAL;
              if (typeof fn === "function") return void fn("advanced");
              console.warn(
                "[VG] settings module loaded but no opener was exposed"
              );
            } catch (err) {
              console.warn("[VG] lazy import of settings failed", err);
            }
          }

          // right button
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = "Create";
          btn.title = "Create a custom prompt";
          btn.style.cssText =
            "flex:0 0 auto;padding:4px 10px;border-radius:8px;border:0;cursor:pointer;" +
            "background:#7c3aed;color:#fff;font:600 12px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;";
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            openSettingsAdvanced();
          });

          row.appendChild(empty);
          row.appendChild(btn);
          frag.appendChild(row);

          // Make empty state part of the 'custom' section so it hides when searching
          addFilterable(row, "", "custom");

          // mount and exit
          scroller.insertBefore(frag, searchWrap.nextSibling);
          return;
        } // <-- CLOSE the `if (!customs.length)` block

        // Newest first (optional)
        customs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        // Rows
        customs.forEach((cg) => {
          const row = document.createElement("div");
          row.style.cssText =
            "position:relative;display:flex;align-items:center;gap:6px;padding:6px 4px;border-radius:8px;" +
            "border:1px solid #22232b;margin-bottom:6px;background:#0c0e13;min-width:0;overflow:hidden;";

          row.style.cursor = "pointer";

          // NEW: subtle hover/focus affordance to match header buttons
          __vgDecorateRowInteractivity(row);

          const label = document.createElement("div");
          label.textContent = cg.name || "Custom Prompt";

          label.title = cg.name || "Custom Prompt";
          label.style.cssText =
            "flex:1;min-width:0;font-size:14px;color:#e5e7eb;white-space:nowrap;" +
            "overflow:hidden;text-overflow:ellipsis;";

          const btn = makeIconBtn({
            id: null,
            title: "Preview",
            html: SVG_EYE,
            variant: "preview", // ← enable purple hover
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              openPromptPreview({
                id: String(cg.id || ""),
                title: String(cg.name || "Preview"),
                body: String(cg.body || ""),
                onInsert: async () => {
                  await insertCustom();
                },
                onEdit: async () => {
                  routeToEditPrompt(
                    String(cg.id || ""),
                    String(cg.name || ""),
                    String(cg.body || "")
                  );
                },
              });
            },
          });

          // ONE helper both row and button call — preflight gate with guard_id, then insert, then log
          async function insertCustom() {
            if (!cg.body || !cg.body.trim()) {
              console.warn("[VG][qm] CG body empty; inert row:", cg);
              return;
            }

            // 🔒 Pre-flight: ask Background if we can insert THIS guard (two-step rule)
            try {
              const gate = await sendBG("VG_CAN_INSERT_CUSTOM", {
                guard_id: String(cg.id),
              });
              console.log("[VG][quickmenu] custom insert gate check", {
                guardId: String(cg.id),
                gate,
              });
              if (shouldBlockAutoGuardAtLimit(cg, gate)) {
                __qmLog("CG insert: auto-generated limit enforced", {
                  guardId: String(cg.id),
                  summary: gate?.summary,
                });
                try {
                  await sendBG("VG_PAYWALL_SHOW", {
                    reason: "custom_guard_limit",
                    source: "auto_guard_quickmenu",
                  });
                } catch {}
                return;
              }
              if (
                gate &&
                gate.ok === false &&
                gate.reason === "CUSTOM_GUARD_LIMIT"
              ) {
                __qmLog("CG insert: BLOCKED by plan limit; paywall should pop");
                // BG already sent VG_PAYWALL_SHOW to this tab; do NOT insert.
                return;
              }
            } catch (e) {
              __qmLog("CG insert: pre-flight threw", e);
              // Be conservative: stop to avoid exceeding plan if we can't verify gate
              return;
            }

            __qmLog("CG insert: start", { guard_id: String(cg.id) });

            // 1) Try the same path Quick Add uses first (more reliable on ChatGPT PM)
            let placed = false;
            try {
              placed = !!window.vgInsertPrompt(cg.body);
            } catch (e) {
              __qmLog("CG insert: vgInsertPrompt threw", e);
              placed = false;
            }

            // 1b) Fallback to the legacy caret path if needed
            if (!placed) {
              __qmLog("CG insert: vgInsertPrompt failed → try caret path");
              try {
                placed = !!setComposerGuardAndCaret(cg.body, "");
              } catch (e) {
                __qmLog("CG insert: caret insert threw", e);
                placed = false;
              }
            }

            // 2) Retry once next frame with explicit focus if still not placed
            if (!placed) {
              __qmLog("CG insert: first attempts failed → retry rAF");
              await new Promise((res) => requestAnimationFrame(res));
              try {
                const pm = document.querySelector(
                  "div#prompt-textarea.ProseMirror"
                );
                if (pm) {
                  try {
                    pm.focus();
                  } catch {}
                }
              } catch {}
              try {
                placed = !!window.vgInsertPrompt(cg.body);
              } catch (e) {
                __qmLog("CG insert: retry threw", e);
                placed = false;
              }
              __qmLog("CG insert: retry result", placed);
            }

            // 3) Fire-and-forget usage log
            (async () => {
              try {
                const r = await sendBG("VG_LOG_GUARD_USE", {
                  guard_id: String(cg.id),
                });
                __qmLog("CG insert: usage log result", r && r.ok);
              } catch (e) {
                __qmLog("CG insert: usage log error", e);
              }
            })();

            try {
              await maybePromptUpgrade();
            } catch {}
            document.getElementById("vg-quick-menu")?.remove();
          }

          // Row click → INSERT (eye handles preview)
          row.addEventListener("click", (e) => {
            if (e.target && e.target.closest("button") === btn) return;
            e.preventDefault();
            e.stopPropagation();
            insertCustom();
          });

          // NOTE:
          // - Do NOT add another row click that calls insertCustom()
          // - Do NOT add a btn.addEventListener here; the eye button already opens preview via makeIconBtn onClick above.

          row.appendChild(label);
          row.appendChild(btn);
          addFilterable(row, cg.name || "Custom Prompt", "custom");
          frag.appendChild(row);
        }); // <-- CLOSES: customs.forEach((cg) => { ... })

        // --- separator under Custom Guards (header is rendered by renderStandardGuards) ---
        {
          const sep = document.createElement("div");
          sep.style.cssText = "margin:8px 0 6px;height:1px;background:#22232b";
          sections.custom.sep = sep; // <-- register sep (hide with header)
          frag.appendChild(sep);

          // NEW: stable “end of customs” anchor — Team section will insert AFTER this
          const customEnd = document.createElement("div");
          customEnd.id = "vg-qm-custom-end";
          frag.appendChild(customEnd);
          sections.custom.end = customEnd;
        }

        // Mount customs + header just below the search bar
        scroller.insertBefore(frag, searchWrap.nextSibling);
      } catch (_e) {
        // fail-silent; just don't render the section
      }
    })();

    /* ---------- TEAM PROMPTS (between Custom Prompts and Quick Adds) ---------- */
    (async () => {
      try {
        const items = await __vgFetchTeamPrompts();
        if (!items.length) return; // no section if none

        // Choose a stable anchor: end-of-customs > customs sep > customs header > search bar
        const anchor =
          sections.custom?.end ||
          sections.custom?.sep ||
          sections.custom?.header ||
          searchWrap;

        // Header
        const head = document.createElement("div");
        head.textContent = "Team Prompts";
        head.style.cssText =
          "font:500 10px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#cbd5e1;margin:2px 2px 8px";
        sections.team.header = head;

        // Newest first
        items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

        const frag = document.createDocumentFragment();

        for (const tp of items) {
          const row = document.createElement("div");
          row.style.cssText =
            "position:relative;display:flex;align-items:center;gap:6px;padding:6px 4px;border-radius:8px;" +
            "border:1px solid #22232b;margin-bottom:6px;background:#0c0e13;min-width:0;overflow:hidden;";
          row.style.cursor = "pointer";
          __vgDecorateRowInteractivity(row);

          const label = document.createElement("div");
          label.textContent = tp.name || "Team Prompt";
          label.title = tp.name || "Team Prompt";
          label.style.cssText =
            "flex:1;min-width:0;font-size:14px;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

          const eye = makeIconBtn({
            title: "Preview",
            html: SVG_EYE,
            variant: "preview", // ← enable purple hover
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              openPromptPreview({
                id: String(tp.id || ""),
                title: String(tp.name || "Preview"),
                body: String(tp.body || ""),
                onInsert: async () => {
                  await insertTeam(tp);
                },
              });
            },
          });

          async function insertTeam(item) {
            if (!item?.body?.trim()) return;
            try {
              const gate = await sendBG("VG_CAN_INSERT_CUSTOM", {
                guard_id: String(item.id),
              });
              console.log("[VG][quickmenu] team insert gate check", {
                guardId: String(item.id),
                gate,
              });
              if (shouldBlockAutoGuardAtLimit(item, gate)) {
                __qmLog("Team insert: auto-generated limit enforced", {
                  guardId: String(item.id),
                  summary: gate?.summary,
                });
                try {
                  await sendBG("VG_PAYWALL_SHOW", {
                    reason: "custom_guard_limit",
                    source: "auto_guard_team",
                  });
                } catch {}
                return;
              }
              if (
                gate &&
                gate.ok === false &&
                gate.reason === "CUSTOM_GUARD_LIMIT"
              ) {
                __qmLog(
                  "Team insert: BLOCKED by plan limit; paywall should pop"
                );
                return;
              }
            } catch {
              return;
            }

            let placed = false;
            try {
              placed = !!window.vgInsertPrompt(item.body);
            } catch {
              placed = false;
            }
            if (!placed) {
              await new Promise((r) => requestAnimationFrame(r));
              try {
                placed = !!window.vgInsertPrompt(item.body);
              } catch {
                placed = false;
              }
            }

            (async () => {
              try {
                await sendBG("VG_LOG_GUARD_USE", { guard_id: String(item.id) });
              } catch {}
            })();

            try {
              await maybePromptUpgrade();
            } catch {}
            document.getElementById("vg-quick-menu")?.remove();
          }

          row.addEventListener("click", (e) => {
            if (e.target && e.target.closest("button") === eye) return;
            e.preventDefault();
            e.stopPropagation();
            insertTeam(tp);
          });

          row.appendChild(label);
          row.appendChild(eye);
          frag.appendChild(row);

          addFilterable(row, tp.name || "Team Prompt", "team");
        }

        const sep = document.createElement("div");
        sep.style.cssText = "margin:8px 0 6px;height:1px;background:#22232b";
        sections.team.sep = sep;

        // INSERT in a guaranteed order: header → rows → separator (all after the anchor)
        scroller.insertBefore(head, anchor.nextSibling);
        scroller.insertBefore(frag, head.nextSibling);
        scroller.insertBefore(sep, frag.nextSibling);
      } catch (e) {
        console.warn("[VG] team prompts render failed", e);
      }
    })();

    /* ---------- BUILT-IN GUARDS (BELOW) ---------- */
    async function renderStandardGuards() {
      try {
        builtinsSection.innerHTML = "";
      } catch {}
      return; // no-op: Standard section removed from Quick Menu
    }

    // Initial paint
    // renderStandardGuards();

    // Repaint when Settings saves/changes the active set
    document.addEventListener("vg-standard-guards-updated", () => {
      try {
        renderStandardGuards();
      } catch {}
    });

    wrap.appendChild(scroller);
    document.body.appendChild(wrap);

    // --- final placement (re-read LIVE pill rect; clamp to viewport) ---
    requestAnimationFrame(() => {
      // 1) Get the pill's *current* rect AFTER layout/transform
      const pill = document
        .getElementById(APP + "-pill-host")
        ?.shadowRoot?.getElementById("vg-pill");
      const r = pill?.getBoundingClientRect?.() || {
        left: prLeft,
        top: prTop,
        width: prWidth,
        height: 0,
      };

      // 2) Horizontal: center over pill, optional MENU_DX, clamp inside viewport
      const HALF = 240; // half of new width (480 / 2)
      const MARGIN = 6;
      const cx = Math.round(r.left + r.width / 2);

      // Shift menu more to the left by subtracting an extra offset (tune this)
      const EXTRA_SHIFT = 60; // try 60px; adjust up/down if needed

      const leftPx = Math.max(
        MARGIN,
        Math.min(cx + MENU_DX - HALF - EXTRA_SHIFT, innerWidth - 480 - MARGIN)
      );
      wrap.style.left = leftPx + "px";

      // 3) Vertical: 8px above pill, clamped to 12px from top
      const h = wrap.offsetHeight || 0;
      const topPx = Math.max(12, Math.round(r.top - h - 8));
      wrap.style.top = topPx + "px";
    });

    // 🔁 make the menu follow the pill while open
    __vgStartAnchorToPill(wrap);

    // Close helpers (outside click + Escape), robust against stopPropagation
    const closeMenu = () => {
      window.__VG_LAST_MENU_CLOSE = performance.now();
      try {
        document.removeEventListener("pointerdown", onDocPointerDown, true);
      } catch {}
      try {
        document.removeEventListener("click", onDocClick, true);
      } catch {}
      try {
        window.removeEventListener("keydown", onKeyDown, true);
      } catch {}
      try {
        __vgStopAnchorToPill();
      } catch {} // ← stop rAF + viewport listeners
      try {
        wrap.remove();
      } catch {}
      // clear exported closer after tear-down
      try {
        delete window.__VG_QM_CLOSE;
      } catch {}
    };

    // export the real closer for toggle & other callers
    try {
      window.__VG_QM_CLOSE = closeMenu;
    } catch {}

    const eventInsideWrap = (ev) => {
      // Use composedPath to handle Shadow DOM properly
      const path = ev.composedPath ? ev.composedPath() : [];
      if (path && path.length) return path.includes(wrap);
      // Fallback
      return wrap.contains(ev.target);
    };

    function onDocPointerDown(ev) {
      // If preview is open, never close the Quick Menu from document clicks
      if (window.__VG_PREVIEW_OPEN) return;
      // Also ignore clicks on the preview backdrop explicitly
      if (document.getElementById("vgqm-preview-backdrop")?.contains(ev.target))
        return;
      if (!eventInsideWrap(ev)) closeMenu();
    }

    function onDocClick(ev) {
      if (window.__VG_PREVIEW_OPEN) return;
      if (document.getElementById("vgqm-preview-backdrop")?.contains(ev.target))
        return;
      if (!eventInsideWrap(ev)) closeMenu();
    }

    function onKeyDown(ev) {
      if (ev.key === "Escape") closeMenu();
    }

    // Install after mount to avoid closing from the opening click
    setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointerDown, true); // capture beats stopPropagation
      document.addEventListener("click", onDocClick, true); // safety net for non-pointer inputs
      window.addEventListener("keydown", onKeyDown, true); // Esc to close
    }, 0);
  }
  window.openQuickMenu = openQuickMenu;

  // =========================
  // Anchoring: Quick Menu → pill
  // =========================
  function __vgPositionMenu(wrap) {
    const r = __vgPillRect();
    if (!r || !__vgOnscreen(r)) return false;

    // center horizontally over the pill; reuse existing constants
    const HALF = 240; // 480 / 2
    const MARGIN = 6;
    const EXTRA_SHIFT = 60;

    const cx = Math.round(r.left + r.width / 2);
    const leftPx = Math.max(
      MARGIN,
      Math.min(cx + MENU_DX - HALF - EXTRA_SHIFT, innerWidth - 480 - MARGIN)
    );

    // vertical: keep above the pill with a gap; clamp to top margin
    const h = wrap.offsetHeight || 0;
    const topPx = Math.max(12, Math.round(r.top - h - MENU_GAP));

    wrap.style.left = leftPx + "px";
    wrap.style.top = topPx + "px";
    return true;
  }

  function __vgStartAnchorToPill(wrap) {
    if (!wrap) return;
    if (__vgQM_RAF) {
      cancelAnimationFrame(__vgQM_RAF);
      __vgQM_RAF = 0;
    }

    const tick = () => {
      __vgQM_RAF = 0;
      if (!__vgPositionMenu(wrap)) {
        // pill gone/offscreen → close menu
        try {
          wrap.remove();
        } catch {}
        return;
      }
      __vgQM_RAF = requestAnimationFrame(tick);
    };
    __vgQM_RAF = requestAnimationFrame(tick);

    // track visual viewport changes too (mobile zoom, etc.)
    const onVV = () => __vgPositionMenu(wrap);
    try {
      window.visualViewport?.addEventListener("resize", onVV, {
        passive: true,
      });
    } catch {}
    try {
      window.visualViewport?.addEventListener("scroll", onVV, {
        passive: true,
      });
    } catch {}
    wrap.__vg_vv_off = () => {
      try {
        window.visualViewport?.removeEventListener("resize", onVV, {
          passive: true,
        });
      } catch {}
      try {
        window.visualViewport?.removeEventListener("scroll", onVV, {
          passive: true,
        });
      } catch {}
    };
  }

  function __vgStopAnchorToPill() {
    if (__vgQM_RAF) cancelAnimationFrame(__vgQM_RAF);
    __vgQM_RAF = 0;
    try {
      const wrap = document.getElementById("vg-quick-menu");
      wrap?.__vg_vv_off?.();
    } catch {}
  }

  // === Debug: global click logger to see which + button is firing ===
  try {
    window.__VG_CLICK_TAP__ &&
      document.removeEventListener("click", window.__VG_CLICK_TAP__, true);
    window.__VG_CLICK_TAP__ = function (ev) {
      const t = ev.composedPath ? ev.composedPath()[0] : ev.target;
      const btn = t?.closest?.("button");
      if (!btn) return;
      const origin = btn.getAttribute("data-vg-origin");
      const pid = btn.getAttribute("data-vg-id") || btn.getAttribute("data-id");
      if (origin) {
        console.log("[VG][tap]", { origin, pid, btn });
      }
    };
    document.addEventListener("click", window.__VG_CLICK_TAP__, true);
  } catch {}

  // === Debug: global click logger to see which + button is firing ===
  try {
    window.__VG_CLICK_TAP__ &&
      document.removeEventListener("click", window.__VG_CLICK_TAP__, true);
    window.__VG_CLICK_TAP__ = function (ev) {
      const t = ev.composedPath ? ev.composedPath()[0] : ev.target;
      const btn = t?.closest?.("button");
      if (!btn) return;
      const origin = btn.getAttribute("data-vg-origin");
      const pid = btn.getAttribute("data-vg-id") || btn.getAttribute("data-id");
      if (origin) {
        console.log("[VG][tap]", { origin, pid, btn });
      }
    };
    document.addEventListener("click", window.__VG_CLICK_TAP__, true);
  } catch {}
})();
