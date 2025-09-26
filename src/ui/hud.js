// src/hud.js
(() => {
  const APP = "viberly";
  const IFRAME_ID = "__vg_iframe_hud__";

  // --- Bridge: when iframe posts PILL_CLICK, ask BG (SoT) → open login popup if idle
  if (!window.__VG_PILL_CLICK_WIRED__) {
    // ---- Shared insertion helpers (text already handled via vgInsertPrompt; add image) ----
    (function initVgInsertImageOnce() {
      if (window.vgInsertImage) return;

      async function dataURLtoFile(dataUrl, filename = "screenshot.png") {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return new File([blob], filename, { type: blob.type || "image/png" });
      }
      function findComposer() {
        const ae = document.activeElement;
        if (
          ae &&
          (ae.isContentEditable ||
            ae.tagName === "TEXTAREA" ||
            ae.tagName === "INPUT")
        )
          return ae;
        return (
          document.querySelector('[contenteditable="true"]') ||
          document.querySelector("textarea") ||
          document.querySelector('input[type="text"], input[type="search"]') ||
          document.body
        );
      }
      function tryPaste(el, file) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const ev = new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: dt,
          });
          const result = el.dispatchEvent(ev);

          // For rich editors, also check if the event was actually processed
          // by looking for image elements that might have been inserted
          if (result && el.isContentEditable) {
            // Give the editor a moment to process the paste
            setTimeout(() => {
              const images = el.querySelectorAll("img");
              if (images.length === 0) {
                // If no images were inserted, the paste likely failed
                console.debug(
                  "[VG][hud] Paste event dispatched but no images found"
                );
              }
            }, 100);
          }

          return result;
        } catch {
          return false;
        }
      }
      function tryDrop(el, file) {
        try {
          const dt = new DataTransfer();
          dt.items.add(file);
          const r = el.getBoundingClientRect?.() || {
            left: 0,
            top: 0,
            width: 0,
            height: 0,
          };
          const ev = new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientX: r.left + (r.width ? r.width / 2 : 10),
            clientY: r.top + (r.height ? r.height / 2 : 10),
            dataTransfer: dt,
          });
          const result = el.dispatchEvent(ev);

          // For rich editors, also check if the event was actually processed
          if (result && el.isContentEditable) {
            // Give the editor a moment to process the drop
            setTimeout(() => {
              const images = el.querySelectorAll("img");
              if (images.length === 0) {
                // If no images were inserted, the drop likely failed
                console.debug(
                  "[VG][hud] Drop event dispatched but no images found"
                );
              }
            }, 100);
          }

          return result;
        } catch {
          return false;
        }
      }
      function fallbackLink(el, url) {
        try {
          const text = `![screenshot](${url})`;
          if (el.isContentEditable) {
            const n = document.createTextNode(text + " ");
            const sel = window.getSelection();
            const rg = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
            if (rg) {
              rg.deleteContents();
              rg.insertNode(n);
              rg.setStartAfter(n);
              rg.setEndAfter(n);
              sel.removeAllRanges();
              sel.addRange(rg);
            } else {
              el.appendChild(n);
            }
          } else if ("value" in el) {
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;
            el.value = el.value.slice(0, start) + text + el.value.slice(end);
            el.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            navigator.clipboard?.writeText?.(text);
          }
        } catch {}
      }

      // Expose: same pattern as vgInsertPrompt used by AI-Chat
      window.vgInsertImage = async function vgInsertImage(
        dataUrl,
        filename = `screenshot-${Date.now()}.png`
      ) {
        try {
          const file = await dataURLtoFile(dataUrl, filename);
          const target = findComposer();
          target?.focus?.();
          let ok = false;
          if (target) ok = tryPaste(target, file);
          if (!ok && target) {
            const el = target.isContentEditable
              ? target
              : document.querySelector('[contenteditable="true"]') || target;
            ok = tryDrop(el, file);
          }
          if (!ok) {
            // Check if this is a simple text editor that should get fallback
            const isSimpleTextEditor =
              target &&
              (target.tagName === "TEXTAREA" ||
                target.tagName === "INPUT" ||
                // Only use fallback for basic contenteditable that's not in a rich editor container
                (target.isContentEditable &&
                  !target.closest(
                    '[data-testid*="composer"], [class*="composer"], [class*="editor"], [class*="input"], [class*="chat"], [class*="message"], [class*="prompt"], [role="textbox"], [class*="rich"], [class*="wysiwyg"]'
                  ) &&
                  !target.closest("form"))); // Avoid form-based rich editors

            if (isSimpleTextEditor) {
              console.debug(
                "[VG][hud] Using fallback for simple text editor:",
                target.tagName,
                target.className
              );
              fallbackLink(target, dataUrl);
              ok = true; // Consider text fallback as success
            } else {
              // For rich editors (ChatGPT, Claude, etc.), don't use fallback - let it fail
              // This prevents base64 text insertion in rich editors
              console.debug(
                "[VG][hud] Rich editor detected, no fallback used:",
                target.tagName,
                target.className,
                target.closest(
                  '[class*="composer"], [class*="editor"], [class*="chat"]'
                )?.className
              );
              ok = false;
            }
          }
          return ok;
        } catch (e) {
          console.warn("[VG][hud] vgInsertImage failed:", e);
          return false;
        }
      };
    })();

    window.__VG_PILL_CLICK_WIRED__ = true;

    // thresholds for click-hold
    const HOLD_MS = 160;
    const MOVE_PX = 4;

    // arm/start state (scoped to this listener)
    let __arm = null; // { t, x, y }  - iframe coords at pointerdown
    let __ref = null; // { left, top } - frame rect at ARM (top coords)
    let __started = false; // did we actually start a drag?

    const topPointFromRef = (x, y) => {
      const left = __ref?.left ?? 0;
      const top = __ref?.top ?? 0;
      return { X: left + x, Y: top + y };
    };

    window.addEventListener("message", (ev) => {
      const m = ev?.data || {};
      if (!m || m.source !== "VG") return;

      // Single-click → open
      if (m.type === "PILL_CLICK") {
        try {
          chrome.runtime.sendMessage({ type: "AUTH_STATUS" }, (snap) => {
            const signed = !!snap?.signedIn;
            if (!signed) {
              chrome.runtime.sendMessage({ type: "OPEN_POPUP" }, () => {});
            } else {
              chrome.runtime.sendMessage({ type: "VG_QM_TOGGLE" }, () => {});
            }
          });
        } catch {}
        return;
      }

      // Click-hold: ARM (record only; do NOT start drag yet)
      if (m.type === "DRAG_ARM") {
        const f = document.getElementById("__vg_iframe_hud__");
        const r = f?.getBoundingClientRect();
        __arm = { t: Date.now(), x: m.x, y: m.y };
        __ref = r ? { left: r.left, top: r.top } : { left: 0, top: 0 };
        __started = false;
        return;
      }

      // Click-hold: MOVE (delta-based; fallback to absolute if old message arrives)
      if (m.type === "DRAG_MOVE_DELTA" || m.type === "DRAG_MOVE") {
        if (!__arm) return;

        // Start drag once either time or movement threshold is met
        if (!__started) {
          const held = Date.now() - __arm.t >= HOLD_MS;
          const dx0 = m.dx !== undefined ? m.dx : m.x - __arm.x;
          const dy0 = m.dy !== undefined ? m.dy : m.y - __arm.y;
          const moved = dx0 * dx0 + dy0 * dy0 >= MOVE_PX * MOVE_PX;
          if (!(held || moved)) return;

          __vgEnsureDragShield__();
          // Prime from the exact down point (no synthetic events)
          const pd0 = topPointFromRef(__arm.x, __arm.y);
          try {
            window.__VG_DRAG_BEGIN_FROM_TOP__?.(pd0.X, pd0.Y);
          } catch {}

          // Silence iframe clicks for the whole drag
          try {
            document
              .getElementById("__vg_iframe_hud__")
              ?.contentWindow?.postMessage(
                { source: "VG", type: "DRAG_SILENCE" },
                "*"
              );
          } catch {}

          // ✅ Mark external-delta drag active (so native pointermove path is ignored)
          window.__VG_EXT_DRAG_ACTIVE__ = true;

          // Cache start point for delta moves
          window.__VG_PD0__ = pd0; // { X, Y }
          __started = true;
        } // <-- add this line (closes: if (!__started) {)

        // Live move: add delta to the primed down point; move pill directly
        const base = window.__VG_PD0__ || topPointFromRef(__arm.x, __arm.y);
        const dx = m.dx !== undefined ? m.dx : m.x - __arm.x;
        const dy = m.dy !== undefined ? m.dy : m.y - __arm.y;
        try {
          window.__VG_DRAG_MOVE_FROM_TOP__?.(base.X + dx, base.Y + dy);
        } catch {}
        return;
      }

      // Click-hold: END (delta-based) or legacy DISARM
      if (m.type === "DRAG_END" || m.type === "DRAG_DISARM") {
        const started = __started;
        __started = false;

        // ✅ We already finalized via external path — disable native path
        window.__VG_EXT_DRAG_ACTIVE__ = false;
        window.__VG_SUPPRESS_NEXT_POINTERUP__ = true;

        // Unsilence iframe click; end overlay drag NOW
        try {
          document
            .getElementById("__vg_iframe_hud__")
            ?.contentWindow?.postMessage(
              { source: "VG", type: "DRAG_UNSILENCE" },
              "*"
            );
        } catch {}
        try {
          window.__VG_DRAG_END_INERT__?.();
        } catch {}

        // Finalize/save only if a drag actually started
        if (started) {
          try {
            const frame = document.getElementById("__vg_iframe_hud__");
            if (!frame) throw new Error("no frame");

            // Final absolute top-left of the iframe after this drag
            const fr = frame.getBoundingClientRect();
            const size = Math.round(fr.width || fr.height || 36);

            const vw =
              window.innerWidth || document.documentElement.clientWidth || 0;
            const vh =
              window.innerHeight || document.documentElement.clientHeight || 0;

            // Decide the nearest viewport corner by the pill’s center
            const cx = fr.left + size / 2;
            const cy = fr.top + size / 2;
            const d = {
              tl: Math.hypot(cx - 0, cy - 0),
              tr: Math.hypot(cx - vw, cy - 0),
              bl: Math.hypot(cx - 0, cy - vh),
              br: Math.hypot(cx - vw, cy - vh),
            };
            const corner = Object.entries(d).sort((a, b) => a[1] - b[1])[0][0]; // tl|tr|bl|br

            // Compute viewport-relative offsets for window-fixed placement.
            // Convention: with right/bottom anchoring, offsets are negative inside the viewport.
            let dxPx = 0,
              dyPx = 0;
            if (corner === "tl") {
              dxPx = fr.left;
              dyPx = fr.top;
            }
            if (corner === "tr") {
              dxPx = fr.left + size - vw;
              dyPx = fr.top;
            }
            if (corner === "bl") {
              dxPx = fr.left;
              dyPx = fr.top + size - vh;
            }
            if (corner === "br") {
              dxPx = fr.left + size - vw;
              dyPx = fr.top + size - vh;
            }

            const host = location.hostname.toLowerCase().replace(/^www\./, "");
            const path = location.pathname || "/";

            // Persist override as WINDOW-FIXED by setting anchor_corner + dx/dy
            chrome.runtime.sendMessage(
              {
                type: "VG_SAVE_PILL_POS",
                host,
                path,
                dx: Math.round(dxPx),
                dy: Math.round(dyPx),
                anchor_corner: corner,
              },
              () => void chrome.runtime.lastError
            );

            // Update local placement immediately so next paint uses window-fixed
            const p = window.__VG_DB_PLACEMENT || {};
            window.__VG_DB_PLACEMENT = {
              ...p,
              dx: Math.round(dxPx),
              dy: Math.round(dyPx),
              anchor_corner: corner,
            };

            // Bake the visual delta into absolute left/top so there’s no flicker
            try {
              const dx = m.dx !== undefined ? m.dx : m.x - (__arm?.x || 0);
              const dy = m.dy !== undefined ? m.dy : m.y - (__arm?.y || 0);
              window.__VG_BAKE_TRANSFORM__?.(dx, dy);
            } catch {}
          } catch {}
        }

        // clear arm ref and make shield inert
        __arm = null;
        try {
          const s = window.__VG_DRAG_SHIELD__;
          if (s) {
            s.style.pointerEvents = "none";
            s.style.width = "0px";
            s.style.height = "0px";
            s.style.cursor = "grab";
          }
        } catch {}
        return;
      }
    });
  }

  // --- Safe helpers (prevents NaN/0 collapse) ---
  const VG_DEFAULT_PILL_SIZE = 36;
  function vgSafeSize(v, fb = VG_DEFAULT_PILL_SIZE) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n <= 128 ? Math.round(n) : fb;
  }

  function vgSafeNum(v, fb = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }

  function vgSafeGutter(v, fb = 14) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 200 ? n : fb;
  }

  // ---- Drag helper: ensure an overlay exists and moves the pill live while dragging
  function __vgEnsureDragShield__() {
    try {
      if (window.__VG_DRAG_SHIELD__) {
        const f = document.getElementById("__vg_iframe_hud__");
        if (!f) return;
        const r = f.getBoundingClientRect();
        const s = window.__VG_DRAG_SHIELD__;
        s.style.left = Math.round(r.left) + "px";
        s.style.top = Math.round(r.top) + "px";
        s.style.width = Math.round(r.width) + "px";
        s.style.height = Math.round(r.height) + "px";
        return;
      }

      const shield = document.createElement("div");
      shield.id = "__vg_drag_shield__";
      shield.style.cssText = [
        "position:fixed",
        "left:0",
        "top:0",
        "width:0",
        "height:0",
        "z-index:2147483601",
        "pointer-events:none",
        "background:transparent",
        "cursor:grab",
        "display:block",
      ].join(";");
      document.documentElement.appendChild(shield);
      window.__VG_DRAG_SHIELD__ = shield;

      let dragging = false;
      let startX = 0,
        startY = 0;
      let startLeft = 0,
        startTop = 0;
      let frameStartLeft = 0,
        frameStartTop = 0;

      const frameEl = () => document.getElementById("__vg_iframe_hud__");

      const syncShieldToFrame = () => {
        const f = frameEl();
        if (!f) return;
        const r = f.getBoundingClientRect();
        shield.style.left = Math.round(r.left) + "px";
        shield.style.top = Math.round(r.top) + "px";
        shield.style.width = Math.round(r.width) + "px";
        shield.style.height = Math.round(r.height) + "px";
      };

      const enableShield = () => {
        syncShieldToFrame();
        shield.style.pointerEvents = "auto";
        shield.style.cursor = "grab";
      };
      const disableShield = () => {
        shield.style.pointerEvents = "none";
        shield.style.width = "0px";
        shield.style.height = "0px";
      };

      const onKey = (e) => {
        if (e.key === "Shift")
          e.type === "keydown" ? enableShield() : disableShield();
      };
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("keyup", onKey, true);

      const align = () => syncShieldToFrame();
      window.addEventListener("scroll", align, true);
      window.addEventListener("resize", align, true);
      window.visualViewport?.addEventListener("resize", align, {
        passive: true,
      });
      window.visualViewport?.addEventListener("scroll", align, {
        passive: true,
      });

      shield.addEventListener(
        "pointerdown",
        (ev) => {
          try {
            const r = shield.getBoundingClientRect();
            const fr = frameEl()?.getBoundingClientRect();
            dragging = true;
            startLeft = r.left;
            startTop = r.top;
            frameStartLeft = fr ? fr.left : startLeft;
            frameStartTop = fr ? fr.top : startTop;
            startX = ev.clientX;
            startY = ev.clientY;
            shield.style.cursor = "grabbing";

            // pause sticky so it doesn’t fight drag
            try {
              vgStopSticky();
            } catch {}
            // also stop the in-frame sticky cleanup if present
            try {
              frameEl()?.__VG_STICKY_CLEANUP__?.();
            } catch {}

            ev.preventDefault();
          } catch {}
        },
        true
      );

      // rAF-coalesced mover (single driver during drag)
      let __vgMoveRAF = 0,
        __vgMoveX = 0,
        __vgMoveY = 0;
      window.__VG_DRAG_MOVE_FROM_TOP__ = function (X, Y) {
        try {
          if (!dragging) return false;
          __vgMoveX = X;
          __vgMoveY = Y;
          if (!__vgMoveRAF) {
            __vgMoveRAF = requestAnimationFrame(() => {
              __vgMoveRAF = 0;
              const dx = Math.round(__vgMoveX - startX);
              const dy = Math.round(__vgMoveY - startY);

              // compositor-only movement
              shield.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

              const f = frameEl();
              if (f) f.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
            });
          }
          return true;
        } catch {
          return false;
        }
      };

      // BEGIN drag from absolute top-window coords (no synthetic events)
      window.__VG_DRAG_BEGIN_FROM_TOP__ = function (X, Y) {
        try {
          // align shield to current iframe rect
          syncShieldToFrame();
          const r = shield.getBoundingClientRect();
          const fr = frameEl()?.getBoundingClientRect();

          dragging = true;

          // Baselines we will translate FROM
          startLeft = r.left;
          startTop = r.top;
          frameStartLeft = fr ? fr.left : startLeft;
          frameStartTop = fr ? fr.top : startTop;
          startX = X;
          startY = Y;

          // Pin positions once; animate via transform only (compositor-friendly)
          shield.style.left = Math.round(startLeft) + "px";
          shield.style.top = Math.round(startTop) + "px";
          shield.style.transform = "translate3d(0,0,0)";
          shield.style.willChange = "transform";
          shield.style.pointerEvents = "auto";
          shield.style.cursor = "grabbing";

          const f = frameEl();
          if (f) {
            f.style.left = Math.round(frameStartLeft) + "px";
            f.style.top = Math.round(frameStartTop) + "px";
            f.style.right = "auto";
            f.style.bottom = "auto";
            f.style.display = "block";
            f.style.transform = "translate3d(0,0,0)";
            f.style.willChange = "transform";
          }

          try {
            vgStopSticky();
          } catch {}
          try {
            frameEl()?.__VG_STICKY_CLEANUP__?.();
          } catch {}
          return true;
        } catch {
          return false;
        }
      };

      // END drag and make overlay inert (called on DRAG_END)
      window.__VG_DRAG_END_INERT__ = function () {
        try {
          dragging = false;
          shield.style.pointerEvents = "none";
          shield.style.width = "0px";
          shield.style.height = "0px";
          shield.style.cursor = "grab";
        } catch {}
      };

      // Bake current transform into left/top and clear transforms
      window.__VG_BAKE_TRANSFORM__ = function (dx, dy) {
        try {
          // Bake the iframe
          const f = frameEl && frameEl();
          if (f) {
            const finalLeft = Math.round(frameStartLeft + dx);
            const finalTop = Math.round(frameStartTop + dy);
            f.style.left = finalLeft + "px";
            f.style.top = finalTop + "px";
            f.style.transform = "none";
            f.style.willChange = "auto";
          }
          // Bake the shield (harmless even if we hide it right after)
          shield.style.left = Math.round(startLeft + dx) + "px";
          shield.style.top = Math.round(startTop + dy) + "px";
          shield.style.transform = "none";
          shield.style.willChange = "auto";
        } catch {}
      };

      window.addEventListener(
        "pointermove",
        (ev) => {
          // ✅ When external-delta drag is active, ignore native pointermove here
          if (window.__VG_EXT_DRAG_ACTIVE__) return;

          // If not dragging yet, but iframe armed us and the button is held, start the drag now.
          if (!dragging) {
            if (window.__VG_DRAG_ARMED__ && ev.buttons & 1) {
              // prime from current geometry
              syncShieldToFrame();
              const r = shield.getBoundingClientRect();
              const fr = frameEl()?.getBoundingClientRect();

              dragging = true;
              startLeft = r.left;
              startTop = r.top;
              frameStartLeft = fr ? fr.left : startLeft;
              frameStartTop = fr ? fr.top : startTop;
              startX = ev.clientX;
              startY = ev.clientY;
              shield.style.cursor = "grabbing";

              // don't fight sticky while dragging
              try {
                vgStopSticky();
              } catch {}

              // tell iframe to swallow the click after the drag
              try {
                frameEl()?.contentWindow?.postMessage(
                  { source: "VG", type: "DRAG_CONFIRMED" },
                  "*"
                );
              } catch {}
            } else {
              return; // not dragging and not armed → ignore
            }
          }

          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;

          // move shield
          shield.style.left = Math.round(startLeft + dx) + "px";
          shield.style.top = Math.round(startTop + dy) + "px";

          // move pill live
          const f = frameEl();
          if (f) {
            f.style.left = Math.round(frameStartLeft + dx) + "px";
            f.style.top = Math.round(frameStartTop + dy) + "px";
            f.style.right = "auto";
            f.style.bottom = "auto";
            f.style.transform = "none";
            f.style.display = "block";
          }
        },
        true
      );

      window.addEventListener(
        "pointerup",
        (ev) => {
          window.__VG_DRAG_ARMED__ = false;

          // ✅ If we already finalized externally, swallow this native pointerup
          if (window.__VG_SUPPRESS_NEXT_POINTERUP__) {
            window.__VG_SUPPRESS_NEXT_POINTERUP__ = false;
            return;
          }

          // If we never actually entered dragging, just make the shield inert and exit
          if (!dragging) {
            try {
              const s = window.__VG_DRAG_SHIELD__;
              if (s) {
                s.style.pointerEvents = "none";
                s.style.width = "0px";
                s.style.height = "0px";
                s.style.cursor = "grab";
              }
            } catch {}
            return;
          }

          dragging = false;
          shield.style.cursor = "grab";

          try {
            const frame = document.getElementById("__vg_iframe_hud__");
            if (!frame) throw new Error("no frame");

            // Absolute rect after drop
            const fr = frame.getBoundingClientRect();
            const size = Math.round(fr.width || fr.height || 36);

            const vw =
              window.innerWidth || document.documentElement.clientWidth || 0;
            const vh =
              window.innerHeight || document.documentElement.clientHeight || 0;

            // Nearest corner by pill center
            const cx = fr.left + size / 2;
            const cy = fr.top + size / 2;
            const d = {
              tl: Math.hypot(cx - 0, cy - 0),
              tr: Math.hypot(cx - vw, cy - 0),
              bl: Math.hypot(cx - 0, cy - vh),
              br: Math.hypot(cx - vw, cy - vh),
            };
            const corner = Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];

            // Viewport-relative offsets for window-fixed placement
            let dxStore = 0,
              dyStore = 0;
            if (corner === "tl") {
              dxStore = fr.left;
              dyStore = fr.top;
            }
            if (corner === "tr") {
              dxStore = fr.left + size - vw;
              dyStore = fr.top;
            }
            if (corner === "bl") {
              dxStore = fr.left;
              dyStore = fr.top + size - vh;
            }
            if (corner === "br") {
              dxStore = fr.left + size - vw;
              dyStore = fr.top + size - vh;
            }

            const host = location.hostname.toLowerCase().replace(/^www\./, "");
            const path = location.pathname || "/";

            chrome.runtime.sendMessage(
              {
                type: "VG_SAVE_PILL_POS",
                host,
                path,
                dx: Math.round(dxStore),
                dy: Math.round(dyStore),
                anchor_corner: corner,
              },
              () => void chrome.runtime.lastError
            );

            const p = window.__VG_DB_PLACEMENT || {};
            window.__VG_DB_PLACEMENT = {
              ...p,
              dx: Math.round(dxStore),
              dy: Math.round(dyStore),
              anchor_corner: corner,
            };

            // Bake visual transform (we still have dxPx/dyPx from native path)
            const dxPx = ev.clientX - startX;
            const dyPx = ev.clientY - startY;
            try {
              window.__VG_BAKE_TRANSFORM__?.(dxPx, dyPx);
            } catch {}
          } catch {}

          syncShieldToFrame();

          // make overlay inert after drop
          try {
            shield.style.pointerEvents = "none";
            shield.style.width = "0px";
            shield.style.height = "0px";
          } catch {}
        },
        true
      );

      // initial align
      syncShieldToFrame();
    } catch {}
  }

  // ==== Resolve-then-lock (no flicker, no mid-session jumps) ====
  const __VG_RESOLVE_MAX_MS__ = 2000; // settle window (no UI shown)

  const __VG_STABLE_TICKS__ = 5; // must succeed N consecutive ticks
  const __VG_RESOLVE_TICK_MS__ = 100; // probe cadence during settle

  let __vg_locked__ = false;
  let __vg_locked_route__ = null;

  function __vgRouteKey__() {
    return `${location.host}::${location.pathname}::${location.search}`;
  }
  function __vgUnlockIfRouteChanged__() {
    const k = __vgRouteKey__();
    if (__vg_locked_route__ !== k) {
      __vg_locked__ = false;
      __vg_locked_route__ = k;
    }
  }

  // --------------------------
  // INIT: create HUD iframe
  // --------------------------
  window.__VG_INIT_HUD__ = function initHUD(opts) {
    const { iconIdle, iconActive, signedIn } = opts || {};

    // Seed from BG SoT so first paint matches reality (no storage/auth reads here)
    try {
      chrome.runtime.sendMessage({ type: "AUTH_STATUS" }, (snap) => {
        window.__VG_SIGNED_IN_GLOBAL = !!snap?.signedIn;
        // (No DOM write here; HUD_READY handler below will do the first PAINT_AUTH)
      });
    } catch {}

    // Create or reuse iframe (size from DB if present; safe default otherwise)
    let frame = document.getElementById(IFRAME_ID);
    if (!frame) {
      const initialSize = vgSafeSize(window.__VG_DB_PLACEMENT?.pill_size);
      frame = document.createElement("iframe");
      frame.id = IFRAME_ID;
      frame.title = "Viberly";
      frame.style.cssText = [
        "position:fixed",
        "left:auto",
        "right:auto",
        "top:auto",
        "bottom:auto", // neutral
        `width:${initialSize}px`,
        `height:${initialSize}px`,
        "border:0",
        "background:transparent",
        "z-index:2147483600",
        "pointer-events:auto",
        "border-radius:0px", // <-- add
        "overflow:visible", // <-- keep hidden
        "display:none",
        "visibility:visible",
        "opacity:1",
        "box-shadow:none", // optional clarity
      ].join(";");

      // CSP: we only postMessage; no DOM access needed
      frame.sandbox = "allow-scripts";

      // Mount to <body> (more stable on SPAs)
      (document.body || document.documentElement).appendChild(frame);

      // (removed: keep-alive style enforcer)
      const idle = iconIdle || "";
      const active = iconActive || "";
      frame.__VG_ICONS__ = { iconIdle: idle, iconActive: active };

      // Load packaged HTML (no inline JS) → CSP-safe
      frame.src = chrome.runtime.getURL("src/ui/hud_frame.html");

      // Always repaint auth state whenever the iframe reloads (e.g., after tab idle/discard)
      frame.addEventListener("load", () => {
        const icons = frame.__VG_ICONS__ || {};
        const iconIdle =
          icons.iconIdle || chrome.runtime.getURL("assets/inactive-pill.svg");
        const iconActive =
          icons.iconActive || chrome.runtime.getURL("assets/active-pill.svg");
        const p = window.__VG_DB_PLACEMENT || {};
        const pillSize = vgSafeSize(p.pill_size);
        try {
          frame.contentWindow?.postMessage(
            {
              source: "VG",
              type: "PAINT_AUTH",
              signedIn: !!window.__VG_SIGNED_IN_GLOBAL,
              size: pillSize,
              pillSize,
              iconIdle,
              iconActive,
            },
            "*"
          );
        } catch {}
      });

      // Handshake: when HUD is ready, paint + place strictly from DB
      const handleHudReady = (ev) => {
        const msg = ev?.data || {};
        if (msg && msg.source === "VG" && msg.type === "HUD_READY") {
          // Paint immediately so the icon shows even if DB placement isn't ready yet.
          const icons = frame.__VG_ICONS__ || {};
          const iconIdle =
            icons.iconIdle || chrome.runtime.getURL("assets/inactive-pill.svg");
          const iconActive =
            icons.iconActive || chrome.runtime.getURL("assets/active-pill.svg");

          const p = window.__VG_DB_PLACEMENT || {};
          const pillSize = vgSafeSize(p.pill_size);

          try {
            frame.contentWindow?.postMessage(
              {
                source: "VG",
                type: "PAINT_AUTH",
                signedIn: !!window.__VG_SIGNED_IN_GLOBAL,
                size: pillSize,
                pillSize,
                iconIdle,
                iconActive,
              },
              "*"
            );
          } catch {}
        }
      };
      window.addEventListener("message", handleHudReady);
    } // <- close: if (!frame) { ... }
  }; // <- close: window.__VG_INIT_HUD__ = function ...

  // ---------------------------------------------------------
  // PLACE: position HUD relative to DB-defined prompt window
  // ---------------------------------------------------------
  window.__VG_PLACE_HUD__IMPL__ = function placeHUDImpl(placement, opts = {}) {
    if (!placement) return;
    const p = placement;

    const frame = document.getElementById(IFRAME_ID);
    if (!frame) return;

    // Do NOT auto-hide each pass; only change display when we succeed/fail below.

    const dx = vgSafeNum(p.dx, 0);
    const dy = vgSafeNum(p.dy, 0);
    const gutter = vgSafeGutter(p.gutter, 14);
    const pillSize = vgSafeSize(p.pill_size);

    function setStyle(el, prop, val) {
      if (el.style[prop] !== val) el.style[prop] = val;
    }

    // Repaint size + auth in the iframe
    try {
      const signed = !!window.__VG_SIGNED_IN_GLOBAL;
      const stored = frame.__VG_ICONS__ || {};
      const iconIdle =
        stored.iconIdle || chrome.runtime.getURL("assets/inactive-pill.svg");
      const iconActive =
        stored.iconActive || chrome.runtime.getURL("assets/active-pill.svg");

      frame.contentWindow?.postMessage(
        {
          source: "VG",
          type: "PAINT_AUTH",
          signedIn: signed,
          size: pillSize,
          pillSize,
          iconIdle,
          iconActive,
        },
        "*"
      );
    } catch {}

    // === If a user override set a window corner, always place window-fixed ===
    if (p && typeof p.anchor_corner === "string" && p.anchor_corner) {
      __VG_PLACE_WINDOW_FIXED__(p); // anchors to viewport; ignores page scroll
      // No sticky observers for window-fixed
      return true;
    }

    // --- Sticky re-placement on scroll/resize/layout ---
    function vgGetScrollParent(el) {
      let p = el && el.parentElement;
      while (p) {
        const s = getComputedStyle(p);
        if (
          /(auto|scroll|overlay)/.test(s.overflowY) ||
          /(auto|scroll|overlay)/.test(s.overflowX) ||
          /(auto|scroll|overlay)/.test(s.overflow)
        ) {
          return p;
        }
        p = p.parentElement;
      }
      return null;
    }

    function vgStartSticky(pObj, anchorEl) {
      // Window-fixed placements should not attach any page/anchor observers
      if (
        pObj &&
        typeof pObj.anchor_corner === "string" &&
        pObj.anchor_corner
      ) {
        vgStopSticky();
        return;
      }

      vgStopSticky(); // clear any previous watchers

      frame.__VG_LAST_P__ = pObj;
      frame.__VG_ANCHOR__ = anchorEl || null;

      const anchorDoc = (anchorEl && anchorEl.ownerDocument) || document;
      const anchorWin = anchorDoc.defaultView || window;
      const host = String(location.hostname || "").toLowerCase();
      const isCursor = /(^|\.)cursor\.com$|(^|\.)cursor\.so$/.test(host);

      let rafId = null;
      const schedule = () => {
        if (rafId != null) return;
        rafId = anchorWin.requestAnimationFrame(() => {
          rafId = null;
          if (
            typeof window.__VG_PLACE_HUD__IMPL__ === "function" &&
            frame.__VG_LAST_P__
          ) {
            window.__VG_PLACE_HUD__IMPL__(frame.__VG_LAST_P__);
          }
        });
      };

      // 1) Scroll/resize on the correct window
      anchorWin.addEventListener("scroll", schedule, { passive: true });
      anchorWin.addEventListener("resize", schedule, { passive: true });

      // 2) visualViewport changes
      let vv = anchorWin.visualViewport;
      const onVVResize = () => schedule();
      if (vv) {
        vv.addEventListener("resize", onVVResize, { passive: true });
        vv.addEventListener("scroll", onVVResize, { passive: true });
      }

      // 3) Scrollable ancestor near the anchor (composer container), if any
      const sp = vgGetScrollParent(anchorEl);
      if (sp) sp.addEventListener("scroll", schedule, { passive: true });

      // 4) ResizeObserver on ANCHOR
      let roAnchor = null;
      if (anchorWin.ResizeObserver && anchorEl) {
        roAnchor = new anchorWin.ResizeObserver(schedule);
        try {
          roAnchor.observe(anchorEl);
        } catch {}
      }

      // 5) ResizeObserver on DOC / BODY
      let roDoc = null;
      if (anchorWin.ResizeObserver) {
        roDoc = new anchorWin.ResizeObserver(schedule);
        try {
          roDoc.observe(anchorDoc.documentElement);
        } catch {}
        try {
          roDoc.observe(anchorDoc.body);
        } catch {}
      }

      // 5.5) Nearest layout container
      let roContainer = null;
      try {
        const container =
          (anchorEl &&
            anchorEl.closest(
              "form,[data-testid*='composer'],[class*='composer'],[class*='footer'],[class*='toolbar'],main,[role='main'],[class*='Layout'],[class*='Shell'],[class*='Container']"
            )) ||
          anchorDoc.body;
        if (anchorWin.ResizeObserver && container) {
          roContainer = new anchorWin.ResizeObserver(schedule);
          roContainer.observe(container);
        }
      } catch {}

      // 5.6) If anchor is inside an inner iframe, watch the outer frame element from top window
      let roOuterFrame = null;
      try {
        const outerFrameEl =
          anchorDoc.defaultView && anchorDoc.defaultView.frameElement;
        if (outerFrameEl && window.ResizeObserver) {
          roOuterFrame = new window.ResizeObserver(schedule);
          roOuterFrame.observe(outerFrameEl);
        }
      } catch {}

      // 5.7) Also watch top-level visualViewport
      let topVV = window.visualViewport;
      const onTopVV = () => schedule();
      if (topVV) {
        topVV.addEventListener("resize", onTopVV, { passive: true });
        topVV.addEventListener("scroll", onTopVV, { passive: true });
      }

      // 6) MutationObserver — on Cursor, include 'style' because they shift with transforms
      let mo = null;
      try {
        const root = anchorDoc.documentElement || anchorDoc;
        const opts = { childList: true, subtree: true, attributes: true };
        if (!isCursor) opts.attributeFilter = ["class", "data-state"];
        mo = new anchorWin.MutationObserver(() => schedule());
        mo.observe(root, opts);
      } catch {}

      // 7) NEW: Cursor generic input listeners + short RAF sampler to catch position shifts
      let onAnyInput = null,
        rafUntil = 0,
        rafHandle = null;
      const tick = () => {
        // sample the current anchor’s rect; if it changed, schedule()
        try {
          const a = frame.__VG_ANCHOR__;
          if (a && a.getBoundingClientRect) {
            const r = a.getBoundingClientRect();
            // write into frame for quick dev checks (optional)
            frame.__VG_LAST_ANCHOR_RECT__ = {
              left: r.left,
              top: r.top,
              w: r.width,
              h: r.height,
            };
          }
        } catch {}
        if (performance.now() < rafUntil) {
          rafHandle = anchorWin.requestAnimationFrame(tick);
        } else {
          rafHandle = null;
        }
        schedule();
      };

      if (isCursor) {
        onAnyInput = () => {
          rafUntil = performance.now() + 1000; // 1s after the last keystroke/paste/scroll
          if (!rafHandle) rafHandle = anchorWin.requestAnimationFrame(tick);
          schedule();
        };

        const targets = [anchorEl, anchorEl?.parentElement, anchorDoc].filter(
          Boolean
        );
        const types = [
          "input",
          "keyup",
          "keydown",
          "paste",
          "cut",
          "compositionend",
          "wheel",
          "pointerup",
        ];
        try {
          targets.forEach((t) =>
            types.forEach((type) => t.addEventListener(type, onAnyInput, true))
          );
        } catch {}
      }

      // store cleanup
      frame.__VG_STICKY_CLEANUP__ = () => {
        try {
          anchorWin.removeEventListener("scroll", schedule, { passive: true });
          anchorWin.removeEventListener("resize", schedule, { passive: true });
          if (vv) {
            vv.removeEventListener("resize", onVVResize, { passive: true });
            vv.removeEventListener("scroll", onVVResize, { passive: true });
          }
          if (sp) sp.removeEventListener("scroll", schedule, { passive: true });
          if (roAnchor) roAnchor.disconnect();
          if (roDoc) roDoc.disconnect();
          if (roContainer) roContainer.disconnect();
          if (roOuterFrame) roOuterFrame.disconnect();
          if (topVV) {
            topVV.removeEventListener("resize", onTopVV, { passive: true });
            topVV.removeEventListener("scroll", onTopVV, { passive: true });
          }
          if (mo) mo.disconnect();

          // NEW: Cursor cleanup
          if (isCursor && onAnyInput) {
            const targets = [
              anchorEl,
              anchorEl?.parentElement,
              anchorDoc,
            ].filter(Boolean);
            const types = [
              "input",
              "keyup",
              "keydown",
              "paste",
              "cut",
              "compositionend",
              "wheel",
              "pointerup",
            ];
            targets.forEach((t) =>
              types.forEach((type) =>
                t.removeEventListener(type, onAnyInput, true)
              )
            );
            if (rafHandle) anchorWin.cancelAnimationFrame(rafHandle);
          }

          if (rafId != null) anchorWin.cancelAnimationFrame(rafId);
        } catch {}
      };
    }

    function vgStopSticky() {
      try {
        frame.__VG_STICKY_CLEANUP__ && frame.__VG_STICKY_CLEANUP__();
      } catch {}
      frame.__VG_STICKY_CLEANUP__ = null;
      frame.__VG_LAST_P__ = null;
      frame.__VG_ANCHOR__ = null;
    }

    // ---- Scoped placement helpers (composer, send, iframe) ----
    function pickRootByIframeSelector(sel) {
      if (!sel) return { doc: document, win: window, frameEl: null };
      const f = document.querySelector(sel);
      if (!f) return { doc: document, win: window, frameEl: null };
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (d && d.location?.origin === location.origin) {
          return { doc: d, win: f.contentWindow || window, frameEl: f };
        }
      } catch {}
      return { doc: document, win: window, frameEl: null };
    }

    function visible(el) {
      if (!el || el.nodeType !== 1) return false;
      const st = getComputedStyle(el);
      if (
        st.display === "none" ||
        st.visibility === "hidden" ||
        +st.opacity === 0
      )
        return false;
      const r = el.getBoundingClientRect();
      return (
        r.width > 40 && r.height > 20 && r.bottom > 0 && r.top < innerHeight
      );
    }

    function findComposerScoped(doc, selector, slot) {
      let nodes = [];
      if (selector) {
        try {
          nodes = Array.from(doc.querySelectorAll(selector));
        } catch {}
      }
      if (!nodes.length) {
        nodes = Array.from(
          doc.querySelectorAll(
            "textarea,[role='textbox'],[contenteditable='true'],[contenteditable=''],.ProseMirror"
          )
        );
      }
      const vis = nodes.filter(visible);
      if (!vis.length) return null;
      const idx =
        String(slot || "primary").toLowerCase() === "secondary" &&
        vis.length > 1
          ? 1
          : 0;
      return vis[idx] || vis[0];
    }

    function findSendButtonScoped(doc, composer, sendSelector) {
      const container =
        composer.closest(
          "form,[data-testid*='composer'],[class*='composer'],[class*='footer'],[class*='toolbar']"
        ) ||
        composer.parentElement ||
        doc;

      if (sendSelector) {
        try {
          const cands = Array.from(
            container.querySelectorAll(sendSelector)
          ).filter(visible);
          if (cands.length)
            return cands.sort(
              (a, b) =>
                b.getBoundingClientRect().right -
                a.getBoundingClientRect().right
            )[0];
        } catch {}
      }
      const fallback = Array.from(
        container.querySelectorAll(
          "button[aria-label='Send'],[data-testid='send-button'],button[type='submit'],button:has(svg[aria-label='Send'])"
        )
      ).filter(visible);
      if (fallback.length)
        return fallback.sort(
          (a, b) =>
            b.getBoundingClientRect().right - a.getBoundingClientRect().right
        )[0];
      return null;
    }

    // === NEW: microphone button finder (identical shape to send, different defaults) ===
    function findMicButtonScoped(doc, composer, micSelector) {
      const container =
        composer.closest(
          "form,[data-testid*='composer'],[class*='composer'],[class*='footer'],[class*='toolbar']"
        ) ||
        composer.parentElement ||
        doc;

      if (micSelector) {
        try {
          const cands = Array.from(
            container.querySelectorAll(micSelector)
          ).filter(visible);
          if (cands.length)
            return cands.sort(
              (a, b) =>
                b.getBoundingClientRect().right -
                a.getBoundingClientRect().right
            )[0];
        } catch {}
      }
      const fallback = Array.from(
        container.querySelectorAll(
          "button[aria-label='Mic'], button[aria-label='Microphone'], [data-testid*='mic']"
        )
      ).filter(visible);
      if (fallback.length)
        return fallback.sort(
          (a, b) =>
            b.getBoundingClientRect().right - a.getBoundingClientRect().right
        )[0];
      return null;
    }

    // === NEW: plus button finder (same shape; conservative fallbacks) ===
    // === plus button finder (site selector → attribute fallbacks → tiny geometry rescue) ===
    function findPlusButtonScoped(doc, composer, plusSelector) {
      const container =
        composer.closest(
          "form,[data-testid*='composer'],[class*='composer'],[class*='footer'],[class*='toolbar']"
        ) ||
        composer.parentElement ||
        doc;

      // 0) Site-specific selector from DB (unchanged behavior)
      if (plusSelector) {
        try {
          const cands = Array.from(
            container.querySelectorAll(plusSelector)
          ).filter(visible);
          if (cands.length) {
            return cands.sort(
              (a, b) =>
                b.getBoundingClientRect().right -
                a.getBoundingClientRect().right
            )[0];
          }
        } catch {}
      }

      // 1) Attribute-based fallbacks (unchanged pattern; adds 'attach' aliases)
      const fallback = Array.from(
        container.querySelectorAll(
          "button[aria-label='Add'], button[aria-label='New'], button[title='Add'], button[title='New'], " +
            "[data-testid*='add'], [data-testid*='new'], button[aria-label*='attach' i], button[title*='attach' i]"
        )
      ).filter(visible);
      if (fallback.length) {
        return fallback.sort(
          (a, b) =>
            b.getBoundingClientRect().right - a.getBoundingClientRect().right
        )[0];
      }

      // 2) NEW: geometry fallback — ONLY if nothing matched above.
      // Some UIs render an unlabeled ~27×27 paperclip. Our global `visible()` (width>40) hides it.
      // Use a looser visibility check here, scoped to the composer row.
      try {
        const win = doc.defaultView || window;
        const loVisible = (el) => {
          if (!el || el.nodeType !== 1) return false;
          const st = (el.ownerDocument?.defaultView || window).getComputedStyle(
            el
          );
          if (
            st.display === "none" ||
            st.visibility === "hidden" ||
            +st.opacity === 0
          )
            return false;
          const r = el.getBoundingClientRect();
          const ih = win.innerHeight || window.innerHeight;
          return r.width > 12 && r.height > 12 && r.bottom > 0 && r.top < ih;
        };

        const compR = composer.getBoundingClientRect();
        const bandTop = compR.top - 10,
          bandBot = compR.bottom + 10;

        const cands = Array.from(
          container.querySelectorAll("button,[role='button']")
        )
          .filter(loVisible)
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          // same vertical band as the composer input
          .filter((o) => o.r.bottom > bandTop && o.r.top < bandBot)
          // the attach icon is the leftmost control in the row
          .sort((a, b) => a.r.left - b.r.left);

        if (cands.length) return cands[0].el;
      } catch {}

      return null;
    }

    // --- Convert inner-frame coords to top-level coords (adds the frame's offset chain)
    function getIframeOffset(frameEl) {
      if (!frameEl) return { ox: 0, oy: 0 };
      try {
        let ox = 0,
          oy = 0;
        let cur = frameEl;
        // accumulate offsets in case of nested panes/iframes
        while (cur) {
          const r = cur.getBoundingClientRect();
          ox += r.left;
          oy += r.top;
          const win = cur.ownerDocument?.defaultView;
          cur =
            win && win.frameElement && win.frameElement !== cur
              ? win.frameElement
              : null;
        }
        return { ox, oy };
      } catch {
        return { ox: 0, oy: 0 };
      }
    }

    // ==== Window-fixed fallback (bottom-right of viewport) ====
    function __VG_PLACE_WINDOW_FIXED__(placement = {}) {
      const pillSize = vgSafeSize(placement.pill_size);
      const dx = vgSafeNum(placement.dx, 0);
      const dy = vgSafeNum(placement.dy, 0);
      const corner = String(placement.anchor_corner || "br").toLowerCase(); // tl|tr|bl|br
      const frame = document.getElementById(IFRAME_ID);
      if (!frame) return false;

      if (!frame.isConnected)
        (document.documentElement || document.body).appendChild(frame);

      try {
        const icons = frame.__VG_ICONS__ || {};
        frame.contentWindow?.postMessage(
          {
            source: "VG",
            type: "PAINT_AUTH",
            signedIn: !!window.__VG_SIGNED_IN_GLOBAL,
            size: pillSize,
            pillSize,
            iconIdle:
              icons.iconIdle ||
              chrome.runtime.getURL("assets/inactive-pill.svg"),
            iconActive:
              icons.iconActive ||
              chrome.runtime.getURL("assets/active-pill.svg"),
          },
          "*"
        );
      } catch {}

      // base corner
      let left = "auto",
        right = "auto",
        top = "auto",
        bottom = "auto";
      switch (corner) {
        case "tl":
          left = "0px";
          top = "0px";
          break;
        case "tr":
          right = "0px";
          top = "0px";
          break;
        case "bl":
          left = "0px";
          bottom = "0px";
          break;
        case "br":
        default:
          right = "0px";
          bottom = "0px";
          break;
      }

      frame.style.position = "fixed";
      frame.style.left = left;
      frame.style.right = right;
      frame.style.top = top;
      frame.style.bottom = bottom;
      frame.style.width = `${pillSize}px`;
      frame.style.height = `${pillSize}px`;
      frame.style.display = "block";
      frame.style.transform = `translate(${Math.round(dx)}px, ${Math.round(
        dy
      )}px)`; // ← apply nudges
      return true;
    }

    try {
      window.__VG_PLACE_WINDOW_FIXED__ = __VG_PLACE_WINDOW_FIXED__;
    } catch {}

    // --- Prefer a stable container around the composer (form/footer/toolbar) for centering
    function getAnchorRectForComposer(doc, composer) {
      const container =
        composer.closest(
          "form,[data-testid*='composer'],[class*='composer'],[class*='footer'],[class*='toolbar']"
        ) ||
        composer.parentElement ||
        composer;
      return container.getBoundingClientRect();
    }

    // === Replit home detector (host + path scoped) ===
    function isReplitHome() {
      try {
        const h = String(location.hostname || "").toLowerCase();
        const pa = String(location.pathname || "/");
        return /(^|\.)replit\.com$/.test(h) && (pa === "/" || pa === "");
      } catch {
        return false;
      }
    }

    // === Find the “Web app / Data app / Game / Web app (Python)” chip row ===
    function findChipsRow(doc) {
      const LABELS = [
        /^web app$/i,
        /^data app$/i,
        /^game$/i,
        /^web app\s*\(python\)$/i,
      ];
      const text = (el) =>
        (el.textContent || el.getAttribute("aria-label") || "").trim();
      const btns = Array.from(
        doc.querySelectorAll('button,[role="button"]')
      ).filter((b) => LABELS.some((r) => r.test(text(b))));
      if (btns.length < 2) return null;

      // lowest common ancestor of those buttons
      const path = (n) => {
        const a = [];
        for (let p = n; p; p = p.parentElement) a.push(p);
        return a;
      };
      const paths = btns.map(path);
      for (const n of paths[0]) if (paths.every((p) => p.includes(n))) return n;
      return btns[0].parentElement || null;
    }

    // === Place pill INSIDE the chip row’s bottom-right corner, with DB dx/dy nudges ===
    function placeAnchorRowBR(doc, frameElForOffset) {
      // host HUD under <html> so transforms/overflow cannot move it
      try {
        if (frame.parentElement !== document.documentElement)
          document.documentElement.appendChild(frame);
      } catch {}

      const row = findChipsRow(doc);
      if (!row) return;

      const r = row.getBoundingClientRect();
      const { ox, oy } = getIframeOffset(frameElForOffset);
      const vv = window.visualViewport;
      const voX = vv?.offsetLeft || 0;
      const voY = vv?.offsetTop || 0;

      const pillSize = vgSafeSize(p.pill_size);
      const dx = vgSafeNum(p.dx, 0);
      const dy = vgSafeNum(p.dy, 0);

      const x = r.right - pillSize + ox + voX + dx; // inside BR
      const y = r.bottom - pillSize + oy + voY + dy;

      setStyle(frame, "left", Math.round(x) + "px");
      setStyle(frame, "top", Math.round(y) + "px");
      setStyle(frame, "right", "auto");
      setStyle(frame, "bottom", "auto");
      setStyle(frame, "transform", "none");
      setStyle(frame, "width", pillSize + "px");
      setStyle(frame, "height", pillSize + "px");
      setStyle(frame, "display", "block");
    }

    // ---- Strategies (no internal fallbacks) ----
    function placeCenterBelow(doc, frameElForOffset) {
      const comp = findComposerScoped(doc, p.composer_selector, p.slot);
      if (!comp) return;

      const host = String(location.hostname || "").toLowerCase();
      const isCursor = /(^|\.)cursor\.com$|(^|\.)cursor\.so$/.test(host);

      // Prefer Monaco's visible editor if present; otherwise the nearest stable wrapper
      const monacoEditor = comp.matches?.(".monaco-editor textarea.inputarea")
        ? comp.closest(".monaco-editor")
        : null;

      const stableWrap =
        comp.closest(
          "form," +
            "[data-testid*='composer']," +
            "[class*='composer']," +
            "[class*='footer']," +
            "[class*='toolbar']," +
            "div.relative," + // Cursor often wraps with Tailwind "relative"
            "[class*='Prompt']," +
            "[class*='Editor']," +
            "[class*='Input']"
        ) ||
        comp.parentElement ||
        comp;

      const geomEl = isCursor ? monacoEditor || stableWrap : comp;

      const rX = getAnchorRectForComposer(doc, geomEl);
      const rY = geomEl.getBoundingClientRect();

      const { ox, oy } = getIframeOffset(frameElForOffset);
      const vv = window.visualViewport;
      const voX = vv?.offsetLeft || 0;
      const voY = vv?.offsetTop || 0;

      const x = rX.left + rX.width / 2 + ox + voX;
      const y = rY.bottom + vgSafeGutter(p.gutter, 14) + oy + voY;

      setStyle(frame, "left", Math.round(x + vgSafeNum(p.dx, 0)) + "px");
      setStyle(frame, "top", Math.round(y + vgSafeNum(p.dy, 0)) + "px");
      setStyle(frame, "right", "auto");
      setStyle(frame, "bottom", "auto");
      setStyle(frame, "transform", "translate(-50%, 0)");
      setStyle(frame, "width", vgSafeSize(p.pill_size) + "px");
      setStyle(frame, "height", vgSafeSize(p.pill_size) + "px");
      setStyle(frame, "display", "block");
    }

    function placeSendLeft(doc, frameElForOffset, opts = {}) {
      // Accept an explicit button element; only fall back to queries if missing.
      let send = opts.sendEl || null;
      let comp = opts.compEl || null;

      if (!send) {
        // Optional: try composer-scoped query if caller didn't supply the button.
        if (!comp) comp = findComposerScoped(doc, p.composer_selector, p.slot);
        if (comp) send = findSendButtonScoped(doc, comp, p.send_selector);
      }
      if (!send) return;

      const r = send.getBoundingClientRect();

      const { ox, oy } = getIframeOffset(frameElForOffset);
      const vv = window.visualViewport;
      const voX = vv?.offsetLeft || 0;
      const voY = vv?.offsetTop || 0;

      const x = r.left - gutter + ox + voX;
      const y = r.top + r.height / 2 + oy + voY;

      setStyle(frame, "left", Math.round(x + dx) + "px");
      setStyle(frame, "top", Math.round(y + dy) + "px");
      setStyle(frame, "right", "auto");
      setStyle(frame, "bottom", "auto");
      setStyle(frame, "transform", "translate(-100%, -50%)");
      setStyle(frame, "width", pillSize + "px");
      setStyle(frame, "height", pillSize + "px");
      setStyle(frame, "display", "block");
    }

    // === anchor-exact — use the *exact* element (no wrapper heuristics); returns boolean ===
    function placeAnchorExact(doc, frameElForOffset, pObj) {
      const pLocal = pObj || {};
      const sel = String(
        pLocal.send_selector || pLocal.composer_selector || ""
      ).trim();
      if (!sel) return false;

      let el = null;

      // NEW: support pseudo selector "text=..." (strict, case-insensitive match)
      // Only checks common clickable elements to avoid perf issues.
      if (sel.startsWith("text=")) {
        const needle = sel.slice(5).trim().toLowerCase();
        try {
          const pool = Array.from(
            doc.querySelectorAll('button,[role="button"],a')
          );
          el =
            pool.find((node) => {
              const label = (
                node.getAttribute("aria-label") ||
                node.textContent ||
                ""
              )
                .trim()
                .toLowerCase();
              return label === needle && visible(node);
            }) || null;
        } catch (_) {
          /* no-op */
        }
      }

      // Existing path: treat as a normal CSS selector if not found via text=
      if (!el) {
        try {
          const nodes = Array.from(doc.querySelectorAll(sel)).filter(visible);
          if (nodes.length) el = nodes[nodes.length - 1]; // prefer rightmost/last visible
        } catch (e) {
          console.warn("[VG][anchor-exact] bad selector:", sel, e.message);
          return false;
        }
      }

      if (!el) return false;

      const r = el.getBoundingClientRect();
      const { ox, oy } = getIframeOffset(frameElForOffset);
      const vv = window.visualViewport;
      const voX = vv?.offsetLeft || 0;
      const voY = vv?.offsetTop || 0;

      const size = vgSafeSize(pLocal.pill_size);
      const dx = vgSafeNum(pLocal.dx, 0);
      const dy = vgSafeNum(pLocal.dy, 0);

      // Right-edge, vertically centered (dx/dy nudge from DB)
      const x = r.right + ox + voX + dx;
      const y = r.top + r.height / 2 + oy + voY + dy;

      setStyle(frame, "left", Math.round(x - size / 2) + "px");
      setStyle(frame, "top", Math.round(y - size / 2) + "px");
      setStyle(frame, "right", "auto");
      setStyle(frame, "bottom", "auto");
      setStyle(frame, "transform", "none");
      setStyle(frame, "width", size + "px");
      setStyle(frame, "height", size + "px");
      setStyle(frame, "display", "block");

      vgStartSticky(pLocal, el);
      return true;
    }

    // (removed: do not mutate global placement; let DB row define strategy)

    // Clean up any prior rAF/DevTools anchor so code paths don't fight
    try {
      document.getElementById("__vb_anchor_style__")?.remove();
    } catch {}
    try {
      frame.__VB_ANCHOR_CLEANUP__?.();
    } catch {}

    // Always host HUD iframe under <html> (avoid transformed/scroll parents)
    try {
      if (frame.parentElement !== document.documentElement)
        document.documentElement.appendChild(frame);
    } catch {}

    // Apply using optional iframe scope from DB
    const { doc, frameEl } = pickRootByIframeSelector(p.iframe_selector || "");

    // Strict DB control: do NOTHING unless the DB-defined anchor exists.
    const strat = String(p.pick_strategy ?? p.strategy ?? "").toLowerCase();

    // helper: try once; return true if placed
    const tryPlaceOnce = () => {
      // 1) Force chip-row anchor on Replit HOME (host replit.com + path "/")
      if (isReplitHome()) {
        const row = findChipsRow(doc);
        if (!row) return false;
        const localFrame =
          row?.ownerDocument?.defaultView?.frameElement || frameEl || null;
        placeAnchorRowBR(doc, localFrame);
        vgStartSticky(p, row);
        return true;
      }

      // 2) Normal center-below path
      if (strat === "center-below") {
        const comp = findComposerScoped(doc, p.composer_selector, p.slot);
        if (!comp) return false;
        const host = String(location.hostname || "").toLowerCase();
        const isCursor = /(^|\.)cursor\.com$|(^|\.)cursor\.so$/.test(host);
        const monacoEditor = comp.matches?.(".monaco-editor textarea.inputarea")
          ? comp.closest(".monaco-editor")
          : null;
        const stableWrap =
          comp.closest(
            "form,[data-testid*='composer'],[class*='composer'],[class*='footer'],[class*='toolbar'],div.relative,[class*='Prompt'],[class*='Editor'],[class*='Input']"
          ) ||
          comp.parentElement ||
          comp;
        const anchorForSticky = isCursor ? monacoEditor || stableWrap : comp;
        const localFrame =
          anchorForSticky?.ownerDocument?.defaultView?.frameElement ||
          frameEl ||
          null;
        placeCenterBelow(doc, localFrame);
        vgStartSticky(p, anchorForSticky);
        return true;
      }

      // 3) DB-requested chip-row anchor (use on any page you set in the table)
      if (strat === "anchor-row-br") {
        const row = findChipsRow(doc);
        if (!row) return false;
        const localFrame =
          row?.ownerDocument?.defaultView?.frameElement || frameEl || null;
        placeAnchorRowBR(doc, localFrame);
        vgStartSticky(p, row);
        return true;
      }

      // 3b) NEW: exact anchor (opt-in via DB)
      if (strat === "anchor-exact") {
        const local = pickRootByIframeSelector(p.iframe_selector || "");
        const ok = placeAnchorExact(local.doc, local.frameEl, p); // returns boolean
        return !!ok; // only report success when we actually placed
      }

      // 3c) send-button — anchor on the button; composer is optional
      if (strat === "send-button") {
        let send = null;
        try {
          send = p.send_selector ? doc.querySelector(p.send_selector) : null;
        } catch (_) {}
        let comp = null;
        if (!send) {
          comp = findComposerScoped(doc, p.composer_selector, p.slot);
          if (comp) send = findSendButtonScoped(doc, comp, p.send_selector);
        }
        if (!send) return false;

        const localFrame =
          send?.ownerDocument?.defaultView?.frameElement || frameEl || null;
        placeSendLeft(doc, localFrame, { sendEl: send, compEl: comp });
        vgStartSticky(p, send);
        return true;
      }

      // 3d) mic-button — identical flow, but if mic disappears, fall back to the send button
      if (strat === "mic-button") {
        let target = null;
        try {
          target = p.send_selector ? doc.querySelector(p.send_selector) : null;
        } catch (_) {}
        let comp = null;
        if (!target) {
          comp = findComposerScoped(doc, p.composer_selector, p.slot);
          if (comp) {
            target =
              findMicButtonScoped(doc, comp, p.send_selector) ||
              findSendButtonScoped(doc, comp, p.send_selector);
          }
        }
        if (!target) return false;

        const localFrame =
          target?.ownerDocument?.defaultView?.frameElement || frameEl || null;
        placeSendLeft(doc, localFrame, { sendEl: target, compEl: comp });
        vgStartSticky(p, target);
        return true;
      }

      // 3e) plus-button — identical flow; targets the “+” button
      if (strat === "plus-button") {
        // Direct lookup first (for this strategy we store the plus CSS in p.send_selector)
        let plus = null;
        try {
          plus = p.send_selector ? doc.querySelector(p.send_selector) : null;
        } catch (_) {}

        // Optional composer-scoped fallback (identical to send/mic patterns)
        let comp = null;
        if (!plus) {
          comp = findComposerScoped(doc, p.composer_selector, p.slot);
          if (comp) plus = findPlusButtonScoped(doc, comp, p.send_selector);
        }
        if (!plus) return false;

        const localFrame =
          plus?.ownerDocument?.defaultView?.frameElement || frameEl || null;
        // Use the same geometry (left-of anchor, vertically centered)
        placeSendLeft(doc, localFrame, { sendEl: plus, compEl: comp });
        vgStartSticky(p, plus);
        return true;
      }

      // Unknown/empty strategy → keep hidden
      return false;
    };

    if (tryPlaceOnce()) {
      // We have a valid anchor & geometry. Only now reveal the pill.
      // If a route transition set a "lock", clear it on first success.
      if (frame && frame.__VG_ROUTE_LOCK__) frame.__VG_ROUTE_LOCK__ = false;

      // If currently hidden, flip to visible …
      if (frame && getComputedStyle(frame).display === "none") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            frame.style.display = "block";
          });
        });
      }

      // ensure drag shield exists & is aligned
      __vgEnsureDragShield__();

      // ← success for this pass
      if (opts.singleShot === true) return true;
    } else {
      vgStopSticky();
      if (frame && frame.style.display !== "none") frame.style.display = "none"; // keep hidden until success

      // In resolve mode, do single-shot only (no timers/observers) → avoids flicker
      if (opts.singleShot === true) return false;

      // Recheck quickly for a moment, then back off to light polling.
      let tries = 0;

      const fastLimit = 40; // ~2s @ 50ms
      const maxTries = 240; // ~2 minutes total

      const recheck = () => {
        // iframe might be gone if SPA pruned; re-attach
        if (!frame.isConnected)
          (document.body || document.documentElement).appendChild(frame);

        if (tryPlaceOnce()) return; // success (will reveal via block above)

        tries++;
        if (tries >= maxTries) return; // stop trying; stays hidden

        const delay = tries <= fastLimit ? 50 : 1000;
        setTimeout(recheck, delay);
      };

      // MutationObserver for immediate “composer appeared” events
      try {
        const root = doc.documentElement || doc;
        const mo = new MutationObserver(() => {
          if (tryPlaceOnce()) mo.disconnect();
        });
        mo.observe(root, { childList: true, subtree: true });
        // also run the timed recheck plan
        setTimeout(recheck, 0);
        // safety: disconnect observer after 60s
        setTimeout(() => mo.disconnect(), 60000);
      } catch {
        // fallback to timers only
        setTimeout(recheck, 0);
      }
      return false; // this pass didn’t find an anchor yet
    }
  };

  // ==== Public wrapper: resolve silently → commit once → lock for route ====
  window.__VG_PLACE_HUD__ = async function placeHudOnce(placement, opts = {}) {
    // NEW: expose the DB placement immediately so Quick Menu can read composer_selector
    try {
      window.__VG_DB_PLACEMENT = placement;
      window.__VG_LAST_PLACEMENT = placement;
    } catch {}

    __vgUnlockIfRouteChanged__();
    if (__vg_locked__ && !opts.force) return true;

    // ⛔️ Path-level suppression: honor DB rows that say "off"/"disabled"
    const mode = String(
      placement?.pick_strategy || placement?.strategy || ""
    ).toLowerCase();
    if (mode === "off" || mode === "disabled") {
      return false; // no anchor, no fallback, no pill
    }

    const frame = document.getElementById(IFRAME_ID);
    if (!frame) return false;

    if (!frame.isConnected)
      (document.body || document.documentElement).appendChild(frame);

    // keep hidden during resolve (prevents flicker)
    if (frame.style.display !== "none") frame.style.display = "none";

    const deadline = Date.now() + __VG_RESOLVE_MAX_MS__;
    let stable = 0;

    // silent resolve loop: singleShot probes, require consecutive stability
    while (Date.now() < deadline) {
      const ok =
        window.__VG_PLACE_HUD__IMPL__?.(placement, { singleShot: true }) ===
        true;
      stable = ok ? stable + 1 : 0;
      if (stable >= __VG_STABLE_TICKS__) break;
      await new Promise((r) => setTimeout(r, __VG_RESOLVE_TICK_MS__));
    }

    let placed = false;
    if (stable >= __VG_STABLE_TICKS__) {
      console.debug("[VG/HUD] commit anchor placement");
      placed = window.__VG_PLACE_HUD__IMPL__?.(placement) === true;
    } else {
      console.debug("[VG/HUD] anchor not found → fixed bottom-right fallback");
      placed = __VG_PLACE_WINDOW_FIXED__(placement);
      if (placed) __vgEnsureDragShield__();
    }

    // 🔒 lock for this route (prevents mid-session jumps)
    __vg_locked__ = !!placed;
    __vg_locked_route__ = __vgRouteKey__();
    return placed;
  };

  // ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  // CLOSES window.__VG_PLACE_HUD__

  // === Live repaint on auth changes (purple/gray without refresh)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "VG_AUTH_CHANGED") return;

    const signed = !!msg.signedIn;

    // Skip redundant paints if state hasn’t actually changed
    if (window.__VG_LAST_AUTH__ === signed) return;
    window.__VG_LAST_AUTH__ = signed;

    // keep a global for any other code that checks it
    window.__VG_SIGNED_IN_GLOBAL = signed;

    // Find the HUD iframe and repaint its icon (include size!)
    const frame = document.getElementById(IFRAME_ID);
    if (!frame || !frame.contentWindow) return;

    const icons = frame.__VG_ICONS__ || {};
    const iconIdle =
      icons.iconIdle || chrome.runtime.getURL("assets/inactive-pill.svg");
    const iconActive =
      icons.iconActive || chrome.runtime.getURL("assets/active-pill.svg");

    // Derive current pixel size from frame width or DB row
    const currentSz =
      Math.round(frame.getBoundingClientRect().width) ||
      Math.round(
        Number(
          (window.__VG_DB_PLACEMENT && window.__VG_DB_PLACEMENT.pill_size) || 36
        )
      );

    try {
      frame.contentWindow.postMessage(
        {
          source: "VG",
          type: "PAINT_AUTH",
          signedIn: signed,
          size: currentSz, // <<<<<<<<<<
          pillSize: currentSz, // <<<<<<<<<<
          iconIdle,
          iconActive,
        },
        "*"
      );
    } catch {}
  });
})();
