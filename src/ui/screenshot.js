// src/ui/screenshot.js
(() => {
  // ChatGPT domain flag (chatgpt.com or chat.openai.com)
  const IS_CHATGPT = /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/.test(
    location.host
  );

  // Claude AI domain flag (claude.ai)
  const IS_CLAUDE = /(^|\.)claude\.ai$/.test(location.host);

  // Expose a single launcher function (same pattern as ai-chat / bug-buster)
  function openScreenshotOverlay() {
    // If already open, do nothing
    if (document.getElementById("vg-shot-backdrop")) return;

    const Z = window.__VG_CONSTS?.Z || 2147483600;

    // Backdrop
    const back = document.createElement("div");
    back.id = "vg-shot-backdrop";
    back.style.position = "fixed";
    back.style.inset = "0";
    back.style.background = "transparent";
    back.style.zIndex = String(Z + 50);
    back.style.display = "block";
    back.style.cursor = "default";

    // Four shroud panes that dim everything OUTSIDE the crop box
    const shroudTop = document.createElement("div");
    const shroudLeft = document.createElement("div");
    const shroudRight = document.createElement("div");
    const shroudBottom = document.createElement("div");
    [shroudTop, shroudLeft, shroudRight, shroudBottom].forEach((el) => {
      el.className = "vg-shot-dim";
      el.style.position = "fixed";
      el.style.background = "rgba(0,0,0,0.45)"; // outside dim
      el.style.pointerEvents = "none"; // clicks pass through to backdrop (so click-to-close works)
      el.style.zIndex = String(Z + 51); // below crop box (Z+52), above backdrop (Z+50)
    });
    // append to backdrop so removing backdrop removes shrouds too
    back.append(shroudTop, shroudLeft, shroudRight, shroudBottom);

    // Helper to position shrouds so the inside of the crop stays bright
    function layoutShroud(rect) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Top band
      Object.assign(shroudTop.style, {
        left: "0px",
        top: "0px",
        width: vw + "px",
        height: Math.max(0, rect.y) + "px",
      });

      // Left band
      Object.assign(shroudLeft.style, {
        left: "0px",
        top: rect.y + "px",
        width: Math.max(0, rect.x) + "px",
        height: Math.max(0, rect.h) + "px",
      });

      // Right band
      const rightW = Math.max(0, vw - (rect.x + rect.w));
      Object.assign(shroudRight.style, {
        left: rect.x + rect.w + "px",
        top: rect.y + "px",
        width: rightW + "px",
        height: Math.max(0, rect.h) + "px",
      });

      // Bottom band
      const bottomH = Math.max(0, vh - (rect.y + rect.h));
      Object.assign(shroudBottom.style, {
        left: "0px",
        top: rect.y + rect.h + "px",
        width: vw + "px",
        height: bottomH + "px",
      });
    }

    // Lock page scroll while overlay is open
    const prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";

    // Toolbar (top-right)
    const bar = document.createElement("div");
    bar.id = "vg-shot-toolbar";
    bar.style.position = "fixed";
    bar.style.top = "16px";
    bar.style.right = "16px";
    bar.style.display = "inline-flex";
    bar.style.alignItems = "center";
    bar.style.gap = "8px";
    bar.style.padding = "8px 10px";
    bar.style.border = "1px solid #2a2a33";
    bar.style.borderRadius = "10px";
    bar.style.background = "#0f1116";
    bar.style.color = "#e5e7eb";
    bar.style.font =
      '13px/1.2 Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    bar.style.boxShadow = "0 20px 60px rgba(0,0,0,.4)";
    bar.style.zIndex = String(Z + 51);

    const sizeLabel = document.createElement("div");
    sizeLabel.id = "vg-shot-size";
    sizeLabel.textContent = "— × —";
    sizeLabel.style.opacity = "0.85";

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Cancel";
    btnCancel.style.cssText = [
      "padding:6px 10px",
      "border-radius:8px",
      "border:1px solid #2a2a33",
      "background:#1f1f26",
      "color:#e5e7eb",
      "cursor:pointer",
    ].join(";");

    const btnCapture = document.createElement("button");
    btnCapture.type = "button";
    btnCapture.textContent = "Capture";
    btnCapture.style.cssText = [
      "padding:6px 10px",
      "border-radius:8px",
      "border:1px solid #8B5CF6",
      "background:#8B5CF6",
      "color:#0B0C10",
      "font-weight:700",
      "cursor:pointer",
    ].join(";");

    bar.appendChild(sizeLabel);
    bar.appendChild(btnCancel);
    bar.appendChild(btnCapture);

    // Crop box
    const box = document.createElement("div");
    box.id = "vg-shot-frame";
    Object.assign(box.style, {
      position: "fixed",
      left: "15vw",
      top: "12vh",
      width: "70vw",
      height: "60vh",
      border: "2px dashed #7c3aed",
      borderRadius: "12px",
      background: "rgba(10,12,16,.25)",
      boxShadow:
        "0 0 0 1px rgba(124,58,237,.35) inset, 0 20px 60px rgba(0,0,0,.35)",
      outline: "2px solid rgba(139,92,246,.75)", // ← stronger edge
      outlineOffset: "-2px", // ← hugs the border
      cursor: "move",
      zIndex: String(Z + 52),
      userSelect: "none",
    });

    // 8 resize handles
    const handlesSpec = [
      ["n", "50%", "0%", "ns-resize"],
      ["s", "50%", "100%", "ns-resize"],
      ["e", "100%", "50%", "ew-resize"],
      ["w", "0%", "50%", "ew-resize"],
      ["ne", "100%", "0%", "nesw-resize"],
      ["nw", "0%", "0%", "nwse-resize"],
      ["se", "100%", "100%", "nwse-resize"],
      ["sw", "0%", "100%", "nesw-resize"],
    ];
    const handleSize = 10;

    function makeHandle(dir, xPct, yPct, cursor) {
      const h = document.createElement("div");
      h.className = "vg-shot-handle";
      h.dataset.dir = dir;
      Object.assign(h.style, {
        position: "absolute",
        width: handleSize + "px",
        height: handleSize + "px",
        background: "#7c3aed",
        border: "1px solid rgba(255,255,255,.6)",
        borderRadius: "50%",
        transform: "translate(-50%, -50%)",
        left: xPct,
        top: yPct,
        cursor,
      });
      return h;
    }
    handlesSpec.forEach(([dir, x, y, cur]) =>
      box.appendChild(makeHandle(dir, x, y, cur))
    );

    // Utilities
    const vp = () => ({
      w: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
      h: Math.max(
        document.documentElement.clientHeight,
        window.innerHeight || 0
      ),
    });

    function clampRect(r) {
      const { w: vw, h: vh } = vp();
      const minSize = 40; // px
      // Width/Height minimums
      r.w = Math.max(minSize, r.w);
      r.h = Math.max(minSize, r.h);
      // Clamp position so the box stays fully visible
      r.x = Math.min(Math.max(0, r.x), vw - r.w);
      r.y = Math.min(Math.max(0, r.y), vh - r.h);
      return r;
    }

    function readBoxRect() {
      const b = box.getBoundingClientRect();
      return {
        x: Math.round(b.left),
        y: Math.round(b.top),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    }

    function writeBoxRect(r) {
      box.style.left = r.x + "px";
      box.style.top = r.y + "px";
      box.style.width = r.w + "px";
      box.style.height = r.h + "px";
      sizeLabel.textContent = `${r.w} × ${r.h}`;
      layoutShroud(r); // keep outside dim in sync with the crop
    }

    // ---- Phase 3.3 helpers (image cropping) ----
    function dataURLToImage(dataURL) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = dataURL;
      });
    }

    function canvasToBlob(canvas, type = "image/png", quality) {
      return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    }

    // ---- Phase 4 (fallback) helpers: local insertion if vgInsertImage isn't available ----
    async function __vgDataURLtoFile(dataUrl, filename = "screenshot.png") {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      return new File([blob], filename, { type: blob.type || "image/png" });
    }
    function __vgFindComposer() {
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
    function __vgPasteFileInto(el, file) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        const ev = new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dt,
        });
        el.dispatchEvent(ev);
        // Consider it a success regardless of return value (some editors cancel the event but still handle it)
        return true;
      } catch {
        return false;
      }
    }

    function __vgDropFileOnto(el, file) {
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
        return el.dispatchEvent(ev);
      } catch {
        return false;
      }
    }
    function __vgInsertLinkFallback(el, url) {
      if (IS_CHATGPT || IS_CLAUDE) return; // <- hard block: no text fallback on ChatGPT/Claude
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

    // Drag/Resize state
    let dragging = false;
    let resizing = false;
    let activeDir = "";
    let start = { x: 0, y: 0 };
    let rect0 = readBoxRect();
    let pointerId = 0;

    // Prevent double-capture (mouse double-click / Enter spam)
    let __vgShotCapturing = false; //  <-- ADD THIS

    function onPointerDownBox(e) {
      // Only start dragging if the pointerdown isn’t on a handle
      if (e.target.classList.contains("vg-shot-handle")) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      resizing = false;
      activeDir = "";
      pointerId = e.pointerId || 1;
      start = { x: e.clientX, y: e.clientY };
      rect0 = readBoxRect();
      try {
        box.setPointerCapture(pointerId);
      } catch {}
      box.style.cursor = "grabbing";
    }

    function onPointerDownHandle(e) {
      const h = e.currentTarget;
      e.preventDefault();
      e.stopPropagation();
      dragging = false;
      resizing = true;
      activeDir = String(h.dataset.dir || "");
      pointerId = e.pointerId || 1;
      start = { x: e.clientX, y: e.clientY };
      rect0 = readBoxRect();
      try {
        h.setPointerCapture(pointerId);
      } catch {}
    }

    function onPointerMove(e) {
      if (!dragging && !resizing) return;

      const dx = Math.round(e.clientX - start.x);
      const dy = Math.round(e.clientY - start.y);
      let next = { ...rect0 };

      if (dragging) {
        next.x = rect0.x + dx;
        next.y = rect0.y + dy;
      } else if (resizing) {
        // Work outwards from rect0
        const dir = activeDir;
        if (dir.includes("e")) next.w = rect0.w + dx;
        if (dir.includes("s")) next.h = rect0.h + dy;
        if (dir.includes("w")) {
          next.x = rect0.x + dx;
          next.w = rect0.w - dx;
        }
        if (dir.includes("n")) {
          next.y = rect0.y + dy;
          next.h = rect0.h - dy;
        }
      }

      next = clampRect(next);
      writeBoxRect(next);
    }

    function endAll(e) {
      if (dragging) {
        dragging = false;
        box.style.cursor = "move";
        try {
          box.releasePointerCapture(pointerId);
        } catch {}
      }
      if (resizing) {
        resizing = false;
        activeDir = "";
        try {
          /* handle may hold capture; safe to ignore */
        } catch {}
      }
    }

    // Keyboard handlers
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeOverlay();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (__vgShotCapturing) return;
        __vgShotCapturing = true;
        btnCapture.disabled = true;
        Promise.resolve()
          .then(handleCapture)
          .finally(() => {
            __vgShotCapturing = false;
            btnCapture.disabled = false;
          });
        return;
      }

      // Optional: nudge with arrows (1px, Shift=10px)
      const step = e.shiftKey ? 10 : 1;
      const r = readBoxRect();
      let changed = false;
      if (e.key === "ArrowLeft") {
        r.x = r.x - step;
        changed = true;
      }
      if (e.key === "ArrowRight") {
        r.x = r.x + step;
        changed = true;
      }
      if (e.key === "ArrowUp") {
        r.y = r.y - step;
        changed = true;
      }
      if (e.key === "ArrowDown") {
        r.y = r.y + step;
        changed = true;
      }
      if (changed) {
        writeBoxRect(clampRect(r));
        e.preventDefault();
      }
    }

    // Phase 3.3: real pixel capture using chrome.tabs.captureVisibleTab via BG
    async function handleCapture() {
      const r = readBoxRect();
      const dpr = window.devicePixelRatio || 1;

      // Hide overlay chrome so it doesn't end up in the screenshot
      const prevBackVis = back.style.visibility;
      const prevBarVis = bar.style.visibility;
      const prevBoxVis = box.style.visibility; // <-- add
      back.style.visibility = "hidden";
      bar.style.visibility = "hidden";
      box.style.visibility = "hidden"; // <-- add

      let reply;
      try {
        reply = await chrome.runtime.sendMessage({
          type: "VG_CAPTURE_VISIBLE_TAB",
        });
      } catch (err) {
        console.error("[VG][screenshot] capture error:", err);
      } finally {
        // Restore overlay chrome
        back.style.visibility = prevBackVis || "";
        bar.style.visibility = prevBarVis || "";
        box.style.visibility = prevBoxVis || ""; // <-- add
      }

      if (!reply || !reply.ok || !reply.dataUrl) {
        console.error(
          "[VG][screenshot] capture failed:",
          reply?.error || "no data"
        );
        return;
      }

      // Crop the captured PNG to the selected rect (DPR-aware)
      try {
        const img = await dataURLToImage(reply.dataUrl);
        const sx = Math.round(r.x * dpr);
        const sy = Math.round(r.y * dpr);
        const sw = Math.round(r.w * dpr);
        const sh = Math.round(r.h * dpr);

        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

        const blob = await canvasToBlob(canvas, "image/png");
        const dataUrl = canvas.toDataURL("image/png");

        // For now: log & emit a custom event (Phase 4 will pipe into insertion flow)
        console.log("[VG][screenshot] cropped PNG", {
          rect: r,
          blob,
          dataUrlLen: dataUrl.length,
        });

        // Emit event only when not ChatGPT/Claude (prevents "insert twice" via other listeners)
        try {
          if (!IS_CHATGPT && !IS_CLAUDE) {
            window.dispatchEvent(
              new CustomEvent("VG_SCREENSHOT_RESULT", {
                detail: { rect: r, blob, dataUrl },
              })
            );
          }
        } catch {}

        // Phase 4: delegate to shared content-side helper (mirrors AI-Chat pattern)
        try {
          if (typeof window.vgInsertImage === "function") {
            await window.vgInsertImage(dataUrl, `screenshot-${Date.now()}.png`);
          } else {
            // ultra-safe fallback (in case content script not ready for some reason)
            const file = await __vgDataURLtoFile(
              dataUrl,
              `screenshot-${Date.now()}.png`
            );
            const target = __vgFindComposer();
            target?.focus?.();

            // ChatGPT/Claude note: paste/drop events often return `false` (preventDefault),
            // but the editor *still* consumes the file and creates an upload.
            // Treat any paste/drop attempt as success to avoid inserting text/second image.
            if (target) {
              // For ChatGPT and Claude, only try paste to avoid dual insertion
              if (IS_CHATGPT || IS_CLAUDE) {
                __vgPasteFileInto(target, file); // fire-and-forget
              } else {
                // For other sites, try paste first, then drop if paste fails
                const pasteSuccess = __vgPasteFileInto(target, file);
                if (!pasteSuccess) {
                  const el = target.isContentEditable
                    ? target
                    : document.querySelector('[contenteditable="true"]') ||
                      target;
                  __vgDropFileOnto(el, file);
                }
              }
            }

            // No text/markdown fallback on ChatGPT (or at all). We’re done here.
          }
        } catch (e) {
          console.warn("[VG][screenshot] insert failed:", e);
        }

        // Close the overlay after capture
        closeOverlay();
      } catch (e) {
        console.error("[VG][screenshot] crop failed:", e);
      }
    }

    function closeOverlay() {
      try {
        document.removeEventListener("keydown", onKey, true);
      } catch {}
      try {
        window.removeEventListener("resize", onResize, true);
      } catch {}
      try {
        window.removeEventListener("pointermove", onPointerMove, true);
      } catch {}
      try {
        window.removeEventListener("pointerup", endAll, true);
      } catch {}
      try {
        window.removeEventListener("pointercancel", endAll, true);
      } catch {}
      try {
        back.remove();
      } catch {}
      try {
        bar.remove();
      } catch {}
      document.documentElement.style.overflow = prevOverflow;
    }

    // Keep inside viewport on resize/orientation changes
    function onResize() {
      writeBoxRect(clampRect(readBoxRect()));
    }

    // Wire events
    box.addEventListener("pointerdown", onPointerDownBox);
    box.querySelectorAll(".vg-shot-handle").forEach((h) => {
      h.addEventListener("pointerdown", onPointerDownHandle);
    });

    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", endAll, true);
    window.addEventListener("pointercancel", endAll, true);

    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize, true);

    // Backdrop click closes; clicks inside the box do NOT close
    back.addEventListener("click", (e) => {
      e.preventDefault();
      closeOverlay();
    });
    box.addEventListener("click", (e) => e.stopPropagation());

    // Toolbar buttons
    btnCancel.addEventListener("click", (e) => {
      e.preventDefault();
      closeOverlay();
    });
    btnCapture.addEventListener("click", (e) => {
      e.preventDefault();
      if (__vgShotCapturing) return;
      __vgShotCapturing = true;
      btnCapture.disabled = true; // UX: grey-out while working
      Promise.resolve()
        .then(handleCapture)
        .finally(() => {
          __vgShotCapturing = false;
          btnCapture.disabled = false;
        });
    });

    // Mount (attach box inside backdrop so clicks outside the box close)
    document.body.appendChild(back);
    back.appendChild(box);
    document.body.appendChild(bar);

    // Set initial label now that the box is in the DOM
    sizeLabel.textContent = `${readBoxRect().w} × ${readBoxRect().h}`;

    // Initial clamp (in case initial % sizes exceed viewport after immediate paint)
    requestAnimationFrame(() => writeBoxRect(clampRect(readBoxRect())));
  }

  // Attach to window so callers can lazy-load this file and invoke it
  try {
    window.openScreenshotOverlay = openScreenshotOverlay;
  } catch {}

  // Allow BG hotkey → message to open overlay
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "VG_SCREENSHOT_OPEN") {
      try {
        window.openScreenshotOverlay?.();
      } catch (e) {
        console.warn("[VG][screenshot] failed to open via hotkey:", e);
      }
    }
  });
})();
