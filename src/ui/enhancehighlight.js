// src/ui/enhancehighlight.js
(() => {
  // Prevent double-injection on SPA navigations
  if (window.__VIB_AI_ENH_ACTIVE__) return;
  window.__VIB_AI_ENH_ACTIVE__ = true;

  const ID_HOST = "__vib_enhancepill_host__";
  const ID_TOAST = "__vib_enhancepill_toast__";
  const Z = 2147483600;
  const PILL_TEXT = "AI Enhance";

  const MIN_LEN = 16;
  const MAX_LEN = 8000;

  // Keep pill visible while the API runs (selection may collapse)
  let __enhancing = false;

  // --- enhancing dots loop (pill state)
  let __enhDotsTimer = null;

  function pillStartEnhancing() {
    __enhancing = true;
    try {
      pill.disabled = true;
      pill.style.opacity = "0.90";
    } catch {}
    // ensure visible even if selection collapsed
    try {
      if (pill.style.display === "none") pill.style.display = "inline-block";
    } catch {}
    let step = 0;
    const label = "Enhancing";
    pill.textContent = label + ".";
    __enhDotsTimer = setInterval(() => {
      step = (step + 1) % 3; // 0,1,2
      pill.textContent = label + ".".repeat(step + 1);
    }, 350);
  }
  function pillStopEnhancing() {
    __enhancing = false;
    try {
      pill.disabled = false;
      pill.style.opacity = "1";
    } catch {}
    if (__enhDotsTimer) {
      clearInterval(__enhDotsTimer);
      __enhDotsTimer = null;
    }
    pill.textContent = PILL_TEXT;
  }

  // Only show AI Enhance in composers (textbox editors). Hide elsewhere.
  const REQUIRE_IN_COMPOSER = true;

  // Heuristics to identify composer nodes across sites
  const COMPOSER_SELECTORS = [
    "textarea",
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input[type="url"]',
    '[contenteditable="true"]',
    '[role="textbox"]',
    ".ProseMirror", // common rich editors
    ".ql-editor", // Quill
    ".monaco-editor", // VS Code-style
    '[data-slate-editor="true"]',
  ];

  function isComposerElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "email", "url", "tel", "password"].includes(t);
    }
    const ce = el.getAttribute && el.getAttribute("contenteditable");
    if (ce && ce.toLowerCase() === "true") return true;
    if (el.getAttribute && el.getAttribute("role") === "textbox") return true;
    try {
      if (el.matches && COMPOSER_SELECTORS.some((sel) => el.matches(sel)))
        return true;
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
      pointerEvents: "none",
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
    transform: "translate(-50%, -100%)",
    padding: "8px 12px",
    borderRadius: "999px",
    font: "500 12px/1.2 Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    background: "#1f2937", // dark gray
    color: "#fff",
    border: "1px solid #374151",
    boxShadow: "0 6px 18px rgba(0,0,0,.3)",
    cursor: "pointer",
    display: "none",
    pointerEvents: "auto",
    userSelect: "none",
    transition:
      "background-color .12s ease, color .12s ease, border-color .12s ease",
  });
  root.appendChild(pill);

  pill.addEventListener("mouseenter", () => {
    pill.style.background = "#7c3aed"; // purple
    pill.style.border = "1px solid #6b21a8";
  });
  pill.addEventListener("mouseleave", () => {
    pill.style.background = "#1f2937"; // back to dark gray
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

  // ---------- Formatting helpers (composer readability) ----------

  // Remove "Custom Prompt Name:" and keep only the actual prompt body.
  function stripPromptNameBlock(s) {
    if (!s) return s;
    let txt = s;

    // If it has an explicit "Custom Prompt:" label, keep everything after it
    const idx = txt.toLowerCase().indexOf("custom prompt:");
    if (idx >= 0) {
      txt = txt.slice(idx + "custom prompt:".length);
    }

    // Remove any remaining "Custom Prompt Name: ..." lines
    txt = txt.replace(/^\s*custom\s+prompt\s+name:\s*.*$/gim, "").trim();

    return txt;
  }

  // Turn a dense block into multi-paragraph text:
  // - Normalize line breaks
  // - Add blank lines before major headings and numbered sections
  // - Normalize bullets
  // - Collapse extra blank lines
  function prettifyParagraphs(s) {
    if (!s) return s;

    let t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Ensure bullets are on their own lines (keeps "- " intact at start of a line)
    t = t.replace(/\s*-\s+/g, (match) => match.replace(/^\s*/, " - "));

    // Add blank line before numbered sections like "1) ", "2) ", etc.
    t = t.replace(/(^|\n)\s*(\d+\)\s+)/g, (_m, p1, p2) => `${p1}\n${p2}`);

    // Add blank line before key headings
    const headings = [
      "Objective —",
      "Scope & Constraints —",
      "Safety & Conflicts —",
      "Verification —",
      "Output Format —",
    ];
    for (const h of headings) {
      const re = new RegExp(`(^|\\n)\\s*(${escapeRegExp(h)})`, "g");
      t = t.replace(re, (_m, p1, p2) => `${p1}\n${p2}`);
    }

    // SANITIZE dash artifacts inside lines (but never at bullet starts).
    // Examples fixed: "Objective: - - - Provide …" → "Objective — Provide …"
    //                 "… — - - - Present …" → "… Present …"
    t = t
      .split("\n")
      .map((line) => {
        // Keep real bullets untouched
        if (/^\s*-\s+/.test(line)) return line;

        // If a section label uses colon followed by dash artifacts, convert to an em dash
        line = line.replace(/:\s*(?:[-–—]\s*){1,}/g, " — ");

        // Collapse any remaining repeated dash groups inside the line to a single space
        // (handles "- - -", "— —", "--", etc.)
        line = line.replace(/(?:\s*[-–—]\s*){2,}/g, " ");

        // Remove stray trailing " - " or dash artifacts at end of line
        line = line.replace(/\s*[-–—]\s*$/g, "");

        // Collapse multiple spaces left by the sanitization
        line = line.replace(/\s{2,}/g, " ");

        return line;
      })
      .join("\n");

    // Normalize " - " bullets: ensure each "- " starts a line
    t = t.replace(/(?:^|\n)\s*-\s+/g, (m) => m.replace(/\s*-\s+/, "- "));

    // Collapse 3+ blank lines → 2
    t = t.replace(/\n{3,}/g, "\n\n");

    // Trim leading/trailing whitespace
    t = t.trim();

    return t;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function formatEnhancedForComposer(enhanced) {
    let out = stripPromptNameBlock(enhanced);
    out = prettifyParagraphs(out);
    return out;
  }

  // Convert the polished text into lightweight HTML suitable for rich editors.
  // - Blank lines → separate blocks
  // - Lines that start with "- " → <ul><li>…</li></ul>
  // - Section headers ending with "—" → <p><strong>…</strong></p>
  // - Single newlines inside a block → <br>
  function formatEnhancedToHTML(enhanced) {
    const txt = formatEnhancedForComposer(enhanced);
    const blocks = txt.split(/\n{2,}/); // paragraph-ish blocks
    const out = [];

    for (const rawBlock of blocks) {
      const block = rawBlock.trimEnd();
      if (!block) continue;

      const lines = block.split(/\n/);

      // Detect simple bullet list (all lines start with "- ")
      const isList = lines.length > 1 && lines.every((l) => /^\s*-\s+/.test(l));
      if (isList) {
        const items = lines.map((l) => l.replace(/^\s*-\s+/, "").trim());
        out.push(
          "<ul>" +
            items.map((li) => `<li>${escapeHTML(li)}</li>`).join("") +
            "</ul>"
        );
        continue;
      }

      // Detect "Heading —" (trailing em-dash) and bold it
      const looksHeading = /—\s*$/.test(lines[0].trim());
      if (looksHeading && lines.length === 1) {
        const h = lines[0].trim();
        out.push(`<p><strong>${escapeHTML(h)}</strong></p>`);
        continue;
      }

      // Normal paragraph: keep internal line breaks as <br>
      const inner = lines.map(escapeHTML).join("<br>");
      out.push(`<p>${inner}</p>`);
    }

    // Insert a blank paragraph between blocks to guarantee visible spacing
    return out.join("\n<p><br></p>\n");
  }

  // Escape HTML for safe insertion
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ===== AI Enhance snapshot + anchoring helpers (INSERTED) =====
  function makeSelectionSnapshot(originalText, selRange) {
    const ae = document.activeElement;
    if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")) {
      return {
        kind: "input",
        el: ae,
        start: ae.selectionStart ?? 0,
        end: ae.selectionEnd ?? 0,
        original: originalText,
      };
    }
    return {
      kind: "ce",
      range: selRange?.cloneRange?.() || null, // clone for stability
      original: originalText,
    };
  }

  function getPillRect() {
    const r = pill.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /* ===== find the active composer for anchoring (INSERTED) ===== */
  function getActiveComposer(selRange) {
    // 1) DB selector if present (same one HUD uses)
    const dbSel =
      (window.__VG_DB_PLACEMENT &&
        window.__VG_DB_PLACEMENT.composer_selector) ||
      "";
    if (dbSel) {
      try {
        const el = document.querySelector(dbSel);
        if (el) return el;
      } catch {}
    }
    // 2) Walk up from the selection range anchor to find any composer node
    let n =
      (selRange && selRange.commonAncestorContainer) ||
      (window.getSelection && window.getSelection().anchorNode) ||
      document.activeElement;
    while (n) {
      if (n.nodeType === 1 && isComposerElement(n)) return n;
      n = n.parentNode;
    }
    // 3) Fallback: activeElement if it is a composer
    const ae = document.activeElement;
    if (isComposerElement(ae)) return ae;
    return null;
  }
  /* ===== end inserted ===== */

  // ===== apply helper (INSERTED) =====
  function applyEnhanced(enhanced, snap) {
    try {
      if (!enhanced || !snap) return;

      // Textarea/Input splice
      if (snap.kind === "input" && snap.el) {
        const ae = snap.el;
        const value = ae.value || "";
        const start = Number.isFinite(snap.start) ? snap.start : 0;
        const end = Number.isFinite(snap.end) ? snap.end : start;
        ae.focus?.();
        ae.value = value.slice(0, start) + enhanced + value.slice(end);
        const pos = start + enhanced.length;
        try {
          ae.setSelectionRange(pos, pos);
        } catch {}
        ae.dispatchEvent(new Event("input", { bubbles: true }));
        ae.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }

      // contentEditable / ProseMirror range replacement (DOM fragment insert)
      if (
        snap.kind === "ce" &&
        snap.range &&
        typeof snap.range.deleteContents === "function"
      ) {
        const r = snap.range;

        try {
          // Remove current selection
          r.deleteContents();

          // Build a fragment from our lightweight HTML (paragraphs/lists preserved visually)
          const html = formatEnhancedToHTML(enhanced);
          const container = document.createElement("div");
          container.innerHTML = html;

          const frag = document.createDocumentFragment();
          while (container.firstChild) {
            frag.appendChild(container.firstChild);
          }

          // Keep a handle to the last inserted node to place the caret after it
          const lastNode = frag.lastChild;
          r.insertNode(frag);

          // Move caret to just after the inserted content
          const after = document.createRange();
          if (lastNode && lastNode.parentNode) {
            after.setStartAfter(lastNode);
          } else {
            after.setStart(r.endContainer, r.endOffset);
          }
          after.collapse(true);

          const sel = window.getSelection?.();
          if (sel) {
            sel.removeAllRanges();
            sel.addRange(after);
          }
        } catch (e) {
          console.warn("[VG/enhance] contenteditable replacement failed:", e);
        }
        return;
      }

      // Fallback: clipboard
      navigator.clipboard?.writeText?.(enhanced);
    } catch (e) {
      console.warn("[VG/enhance] applyEnhanced failed:", e);
    }
  }
  // ===== end inserted =====

  // --- selection helpers
  function getSelectionInfo() {
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

    const text = String(sel).trim();
    if (text.length < MIN_LEN || text.length > MAX_LEN) return null;

    // If selection is NOT inside a composer, do NOT show the Enhance pill
    if (REQUIRE_IN_COMPOSER) {
      const anchor = sel.anchorNode || sel.focusNode || null;
      const inComposer = anchor && nodeIsInsideComposer(anchor);
      if (!inComposer) return null;
    }

    const rng = sel.getRangeAt(0).cloneRange();
    let rect = null;

    const rects =
      typeof rng.getClientRects === "function" ? rng.getClientRects() : null;
    if (rects && rects.length) {
      rect = rects[rects.length - 1];
    } else {
      const marker = document.createElement("span");
      marker.style.cssText = "display:inline-block;width:0;height:1px;";
      rng.collapse(false);
      rng.insertNode(marker);
      rect = marker.getBoundingClientRect();
      marker.remove();
    }
    if (!rect) return null;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const isVisible =
      rect.bottom >= 0 && rect.right >= 0 && rect.top <= vh && rect.left <= vw;
    if (!isVisible) return null;

    const x = Math.min(Math.max(rect.right, 12), vw - 12);
    const y = Math.min(Math.max(rect.top, 24), vh - 12);

    return { text, x, y, range: rng };
  }

  function showPillAt(x, y) {
    pill.style.left = `${x}px`;
    pill.style.top = `${y - 8}px`;
    pill.style.display = "inline-block";
  }
  function hidePill() {
    pill.style.display = "none";
  }

  // --- click handler → call Edge Function → replace selection
  let lastText = "";
  let lastRange = null;

  // --- refresh pill on selection changes
  let rafId = 0;
  function scheduleUpdate() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      // While the API is running, keep the pill visible even if selection collapses
      if (__enhancing) {
        if (pill.style.display === "none") pill.style.display = "inline-block";
        return; // do not recompute/hide during the thinking phase
      }

      // Only show in composers
      if (!isComposerElement(document.activeElement)) {
        return hidePill();
      }
      const info = getSelectionInfo();
      if (!info) return hidePill();
      lastText = info.text;
      lastRange = info.range || null;
      showPillAt(info.x, info.y);
    });
  }

  document.addEventListener("selectionchange", scheduleUpdate, {
    passive: true,
  });
  document.addEventListener("mouseup", scheduleUpdate, { passive: true });
  document.addEventListener(
    "keyup",
    (e) => {
      if (
        e.key === "Shift" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowRight" ||
        e.key === "ArrowUp" ||
        e.key === "ArrowDown"
      ) {
        scheduleUpdate();
      }
    },
    { passive: true }
  );

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });

  document.addEventListener(
    "mousedown",
    (e) => {
      try {
        const path = (e.composedPath && e.composedPath()) || [];
        const inside = path.includes(pill) || path.includes(host);
        if (inside) return;
      } catch {}
      hidePill();
    },
    { passive: true }
  );

  pill.addEventListener("click", async () => {
    // Re-grab selection at click; fall back to last known text/range
    const infoAtClick = getSelectionInfo();
    const selText = ((infoAtClick?.text ?? lastText) || "").trim();
    const selRange = infoAtClick?.range || lastRange || null;

    if (!selText || selText.length < MIN_LEN) {
      toast("Select at least 16 characters.");
      return;
    }

    // Snapshot the selection now so we can apply later (after user confirms)
    const snap = makeSelectionSnapshot(selText, selRange);

    // Pill → Enhancing… (looping dots)
    pillStartEnhancing();

    // Call Edge via BG
    const resp = await new Promise((resolve) => {
      try {
        browser.runtime
          .sendMessage({
            type: "VG_AI_ENHANCE",
            payload: { text: selText, surface: "composer" },
          })
          .then((r) => {
            const err = browser.runtime.lastError;
            if (err) {
              console.warn("[VG/enhance] lastError:", err.message);
              resolve({ ok: false, error: "BACKGROUND_UNAVAILABLE" });
            } else {
              resolve(r || null);
            }
          });
      } catch (e) {
        console.warn("[VG/enhance] sendMessage throw:", e);
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });

    // Stop dots, restore pill
    pillStopEnhancing();

    if (!resp || !resp.ok || !resp.text) {
      if (resp?.error === "AI_ENHANCE_LIMIT") {
        try {
          if (window.__VG_OPEN_PAYWALL__) {
            window.__VG_OPEN_PAYWALL__("ai_enhance_limit", "markers_pill");
          } else {
            const mod = await import(browser.runtime.getURL("src/ui/paywall.js"));
            mod?.default?.show?.({ reason: "ai_enhance_limit", source: "markers_pill" });
          }
        } catch {}
        hidePill();
        return;
      }
      const message = resp?.error || "Enhance failed.";
      toast(message, 1600);
      hidePill();
      return;
    }

    // Tidy for readability in editors
    const enhancedRaw = String(resp.text || "");
    const enhanced = formatEnhancedForComposer(enhancedRaw);
    if (enhanced.length > 12000) {
      // Very long — hand off to clipboard and bail
      try {
        await navigator.clipboard.writeText(enhanced);
      } catch {}
      toast("Enhanced text copied (too long to preview).", 1600);
      hidePill();
      return;
    }

    // Open the anchored compare panel above the composer (like Quick Menu)
    const compEl = getActiveComposer(selRange);
    const anchorRect = compEl ? compEl.getBoundingClientRect() : getPillRect();

    openEnhanceComparePanel({
      original: selText,
      enhanced,
      anchorRect, // ← use composer rect when available
      onReplace: () => {
        applyEnhanced(enhanced, snap);
        toast("Enhanced ✓", 1200);
      },
    });

    // Hide the floating pill once the panel is up (optional)
    hidePill();
  });

  // ===== ensure dark scrollbars for Enhance panel (INSERTED) =====
  (function ensureEnhanceScrollbars() {
    if (document.getElementById("vg-en-scrollbars")) return;
    const st = document.createElement("style");
    st.id = "vg-en-scrollbars";
    st.textContent = `
        .vg-en-scroll{ scrollbar-width:thin; scrollbar-color:#2a2a33 #0c0e13; }
        .vg-en-scroll::-webkit-scrollbar{ width:10px; height:10px; }
        .vg-en-scroll::-webkit-scrollbar-track{ background:#0c0e13; border-radius:8px; }
        .vg-en-scroll::-webkit-scrollbar-thumb{ background:#2a2a33; border-radius:8px; border:2px solid #0c0e13; }
        .vg-en-scroll::-webkit-scrollbar-thumb:hover{ background:#3a3a45; }
      `;
    document.head.appendChild(st);
  })();

  // ===== anchored compare panel (ELEGANT VERSION) =====
  function openEnhanceComparePanel({
    original,
    enhanced,
    anchorRect,
    onReplace,
  }) {
    // container — smaller, calmer
    const wrap = document.createElement("div");
    wrap.id = "__vg_enh_compare__";
    Object.assign(wrap.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      width: "400px", // smaller than Quick Menu
      background: "#0f1116",
      color: "#e5e7eb",
      border: "1px solid #2a2a33",
      borderRadius: "12px",
      boxShadow: "0 18px 54px rgba(0,0,0,.48)",
      zIndex: String(Z + 2),
      overflow: "hidden",
      font: "13px/1.5 system-ui, -apple-system, Segoe UI, Inter, Roboto, Arial, sans-serif",
    });

    // content — calm typography + dark scrollbars
    const body = document.createElement("div");
    body.className = "vg-en-scroll";
    Object.assign(body.style, {
      padding: "12px",
      maxHeight: "56vh",
      overflow: "auto",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      color: "#cfd3dc",
      // Firefox fallback (also handled by the class, but keep inline for robustness)
      scrollbarWidth: "thin",
      scrollbarColor: "#2a2a33 #0c0e13",
    });

    // headers + blocks (Option B: stronger "before vs after")
    function makeHdr(text, variant /* 'orig' | 'enh' */) {
      const h = document.createElement("div");
      h.textContent = text;
      if (variant === "orig") {
        // Original header: gray + italic
        h.style.cssText =
          "font-weight:600;font-style:italic;font-size:12px;color:#aeb6c2;letter-spacing:.2px;";
      } else {
        // Enhanced header: white, upright
        h.style.cssText =
          "font-weight:600;font-size:12px;color:#ffffff;letter-spacing:.2px;";
      }
      return h;
    }

    const makeSep = () => {
      const s = document.createElement("div");
      // Hairline, 90% width, centered
      s.style.cssText =
        "height:0;border-top:1px solid rgba(255,255,255,.10);width:90%;margin:8px auto;";
      return s;
    };

    function makeBlockOriginal(txt) {
      const b = document.createElement("div");
      // Dimmer, italic, and slightly smaller than Enhanced
      b.style.cssText =
        "white-space:pre-wrap;word-break:break-word;color:#bfc3cd;font-style:italic;font-size:12px;";
      b.textContent = txt || "";
      return b;
    }

    function makeBlockEnhanced(txt) {
      const b = document.createElement("div");
      // Brighter, upright text = final draft
      b.style.cssText =
        "white-space:pre-wrap;word-break:break-word;color:#d7dbe5;";
      b.textContent = txt || "";
      return b;
    }

    // Original section (italic header + dim/italic body)
    body.appendChild(makeHdr("Original prompt", "orig"));
    body.appendChild(makeBlockOriginal(original || ""));
    body.appendChild(makeSep());

    // Enhanced section (normal header + normal/brighter body)
    body.appendChild(makeHdr("Enhanced prompt", "enh"));
    body.appendChild(makeBlockEnhanced(enhanced || ""));

    // footer — Cancel link (left) • Replace button (right)
    const foot = document.createElement("div");
    Object.assign(foot.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 12px",
      borderTop: "1px solid #2a2a33",
      background: "#0f1116",
    });

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "Cancel";
    btnCancel.style.cssText =
      "background:transparent;border:0;color:#aeb6c2;font:600 12px system-ui,-apple-system,Segoe UI,Inter,Roboto,Arial,sans-serif;cursor:pointer;padding:4px 2px;";
    btnCancel.onmouseenter = () => {
      btnCancel.style.color = "#cfd3dc";
    };
    btnCancel.onmouseleave = () => {
      btnCancel.style.color = "#aeb6c2";
    };

    const btnReplace = document.createElement("button");
    btnReplace.textContent = "Replace";
    btnReplace.style.cssText = [
      "padding:8px 12px",
      "border-radius:10px",
      "border:1px solid #2a2a33",
      "background:#1f1f26", // gray by default
      "color:#e5e7eb",
      "font-weight:600",
      "cursor:pointer",
      "transition:background .14s ease, border-color .14s ease, color .14s ease",
    ].join(";");
    btnReplace.onmouseenter = () => {
      btnReplace.style.background = "#7c3aed";
      btnReplace.style.borderColor = "#7c3aed";
      btnReplace.style.color = "#fff";
    };
    btnReplace.onmouseleave = () => {
      btnReplace.style.background = "#1f1f26";
      btnReplace.style.borderColor = "#2a2a33";
      btnReplace.style.color = "#e5e7eb";
    };

    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    foot.appendChild(btnCancel);
    foot.appendChild(spacer);
    foot.appendChild(btnReplace);

    wrap.appendChild(body);
    wrap.appendChild(foot);
    document.body.appendChild(wrap);

    // keyboard: Esc = cancel, Enter = replace
    function onKey(e) {
      if (e.key === "Escape") {
        close();
      }
      if (e.key === "Enter") {
        try {
          onReplace?.();
        } catch {}
        close();
      }
    }
    window.addEventListener("keydown", onKey, true);

    // outside click = close
    function onDocDown(ev) {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (!path.includes(wrap)) close();
    }
    setTimeout(
      () => document.addEventListener("mousedown", onDocDown, true),
      0
    );

    btnCancel.onclick = () => close();
    btnReplace.onclick = () => {
      try {
        onReplace?.();
      } catch {}
      close();
    };

    // anchor above the **composer rect** (falls back to pill rect if none)
    let raf = 0;
    function place() {
      raf = 0;
      const ar = anchorRect || getPillRect();
      const HALF = 200; // 400 / 2
      const MARGIN = 6;
      const left = Math.max(
        MARGIN,
        Math.min(
          Math.round(ar.left + ar.width / 2) - HALF,
          innerWidth - 400 - MARGIN
        )
      );
      const top = Math.max(
        12,
        Math.round(ar.top - (wrap.offsetHeight || 0) - 8)
      );
      wrap.style.left = left + "px";
      wrap.style.top = top + "px";
      raf = requestAnimationFrame(place);
    }
    raf = requestAnimationFrame(place);

    function close() {
      try {
        cancelAnimationFrame(raf);
      } catch {}
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDocDown, true);
      try {
        wrap.remove();
      } catch {}
    }
  }

  // ===== enhancing overlay (anchored to composer) =====
  function __showComposerEnhancing(anchorElOrRect) {
    const id = "__vg_enh_progress__";
    try {
      document.getElementById(id)?.remove();
    } catch {}
    const host = document.createElement("div");
    host.id = id;
    Object.assign(host.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      width: "280px",
      background: "#0f1116",
      color: "#e5e7eb",
      border: "1px solid #2a2a33",
      borderRadius: "12px",
      boxShadow: "0 14px 42px rgba(0,0,0,.45)",
      zIndex: String(Z + 3),
      padding: "12px",
    });

    const label = document.createElement("div");
    label.textContent = "Enhancing…";
    label.style.cssText =
      "font:600 13px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin-bottom:8px;";
    host.appendChild(label);

    // indeterminate bar
    const barWrap = document.createElement("div");
    Object.assign(barWrap.style, {
      height: "6px",
      background: "#141823",
      border: "1px solid #252833",
      borderRadius: "999px",
      overflow: "hidden",
    });
    const bar = document.createElement("div");
    Object.assign(bar.style, {
      width: "40%",
      height: "100%",
      background: "#7c3aed",
      borderRadius: "999px",
      transform: "translateX(-100%)",
    });
    barWrap.appendChild(bar);
    host.appendChild(barWrap);

    // simple animation (no keyframes needed)
    let dir = 1;
    let pos = -100;
    const tick = () => {
      pos += dir * 3;
      if (pos >= 160) {
        dir = -1;
      }
      if (pos <= -100) {
        dir = 1;
      }
      bar.style.transform = "translateX(" + pos + "%)";
      host.__raf = requestAnimationFrame(tick);
    };
    host.__raf = requestAnimationFrame(tick);

    document.body.appendChild(host);

    function rectOf(a) {
      if (!a) return null;
      if (typeof a.left === "number") return a;
      if (a.getBoundingClientRect) return a.getBoundingClientRect();
      return null;
    }
    function place() {
      const r = rectOf(anchorElOrRect) || {
        left: innerWidth / 2 - 140,
        top: innerHeight / 2 - 24,
        width: 280,
        height: 48,
      };
      const w = host.offsetWidth || 280;
      const h = host.offsetHeight || 40;
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const left = Math.max(
        6,
        Math.min(cx - Math.round(w / 2), innerWidth - w - 6)
      );
      const top = Math.max(
        12,
        Math.min(cy - Math.round(h / 2), innerHeight - h - 12)
      );
      host.style.left = left + "px";
      host.style.top = top + "px";
    }
    place();

    const onVV = () => place();
    try {
      window.addEventListener("resize", onVV, { passive: true });
    } catch {}
    try {
      window.addEventListener("scroll", onVV, { passive: true });
    } catch {}

    return {
      close() {
        try {
          cancelAnimationFrame(host.__raf);
        } catch {}
        try {
          window.removeEventListener("resize", onVV, { passive: true });
        } catch {}
        try {
          window.removeEventListener("scroll", onVV, { passive: true });
        } catch {}
        try {
          host.remove();
        } catch {}
      },
    };
  }

  // ===== Public triggers (selection & full-composer) + in-flight guard =====
  let __VG_ENH_INFLIGHT = false;

  async function __vgCallEnhance(text, surface) {
    return new Promise((resolve) => {
      try {
        browser.runtime
          .sendMessage({
            type: "VG_AI_ENHANCE",
            payload: {
              text: String(text || ""),
              surface: String(surface || "composer"),
            },
          })
          .then((r) => {
            const err = browser.runtime.lastError;
            if (err) {
              console.warn("[VG/enhance] lastError:", err.message);
              resolve({ ok: false, error: "BACKGROUND_UNAVAILABLE" });
            } else {
              resolve(r || null);
            }
          });
      } catch (e) {
        console.warn("[VG/enhance] sendMessage throw:", e);
        resolve({ ok: false, error: String(e?.message || e) });
      }
    });
  }

  function __makeFullComposerSnapshot(el, originalText) {
    // Textarea/Input full-range snapshot
    if (el && "value" in el) {
      const len = (el.value || "").length;
      try {
        el.focus?.();
      } catch {}
      return { kind: "input", el, start: 0, end: len, original: originalText };
    }
    // contentEditable/PM full-range snapshot
    const doc = (el && el.ownerDocument) || document;
    const r = doc.createRange();
    r.selectNodeContents(el || doc.body);
    return { kind: "ce", range: r, original: originalText };
  }

  function __readComposerText() {
    // Prefer DB selector if available
    const dbSel =
      (window.__VG_DB_PLACEMENT &&
        window.__VG_DB_PLACEMENT.composer_selector) ||
      "";
    let el = null;
    if (dbSel) {
      try {
        el = document.querySelector(dbSel) || null;
      } catch {}
    }
    if (!el) {
      // Fallbacks: CE/PM → textarea/input
      el =
        document.activeElement && isComposerElement(document.activeElement)
          ? document.activeElement
          : document.querySelector(
              '[contenteditable="true"], [role="textbox"][contenteditable="true"]'
            ) || document.querySelector('textarea, input[type="text"]');
    }
    if (!el) return { el: null, text: "" };

    // Extract text based on type
    if ("value" in el) return { el, text: String(el.value || "") };
    try {
      const pm = el.classList?.contains("ProseMirror")
        ? el
        : el.closest?.(".ProseMirror");
      const node = pm || el;
      const txt = String(node.innerText || node.textContent || "");
      return { el: node, text: txt };
    } catch {
      return { el, text: String(el.textContent || "") };
    }
  }

  // Expose: Enhance the current SELECTION (mirrors pill click path)
  window.vgEnhanceSelection =
    window.vgEnhanceSelection ||
    (async () => {
      if (__VG_ENH_INFLIGHT) return false;
      const info = getSelectionInfo();
      if (!info || !info.text || info.text.length < MIN_LEN) {
        toast("Select at least 16 characters.");
        return false;
      }
      __VG_ENH_INFLIGHT = true;
      try {
        const snap = makeSelectionSnapshot(info.text, info.range);
        const resp = await __vgCallEnhance(info.text, "selection");
        if (!resp || !resp.ok || !resp.text) {
          toast(resp?.error || "Enhance failed.", 1600);
          return false;
        }
        const enhanced = formatEnhancedForComposer(String(resp.text || ""));
        const compEl = getActiveComposer(info.range);
        const anchorRect = compEl
          ? compEl.getBoundingClientRect()
          : getPillRect();
        openEnhanceComparePanel({
          original: info.text,
          enhanced,
          anchorRect,
          onReplace: () => {
            applyEnhanced(enhanced, snap);
            toast("Enhanced ✓", 1200);
          },
        });
        return true;
      } finally {
        __VG_ENH_INFLIGHT = false;
      }
    });

  // Expose: Enhance the ENTIRE COMPOSER (used by Quick Menu)
  window.vgEnhanceComposerAll =
    window.vgEnhanceComposerAll ||
    (async () => {
      if (__VG_ENH_INFLIGHT) return false;

      const { el, text } = __readComposerText();
      const src = String(text || "").trim();
      if (!el || !src) {
        toast("Nothing to enhance.");
        return false;
      }
      if (src.length > MAX_LEN) {
        toast("Text too long to enhance (>8000).");
        return false;
      }

      // show centered progress over the composer
      const anchorRect =
        (el.getBoundingClientRect && el.getBoundingClientRect()) || null;
      const overlay = __showComposerEnhancing(anchorRect || el);

      __VG_ENH_INFLIGHT = true;
      try {
        const snap = __makeFullComposerSnapshot(el, src);
        const resp = await __vgCallEnhance(src, "composer-all");
        if (!resp || !resp.ok || !resp.text) {
          overlay.close();
          toast(resp?.error || "Enhance failed.", 1600);
          return false;
        }
        const enhanced = formatEnhancedForComposer(String(resp.text || ""));

        overlay.close();
        openEnhanceComparePanel({
          original: src,
          enhanced,
          anchorRect: anchorRect || getPillRect(),
          onReplace: () => {
            applyEnhanced(enhanced, snap);
            toast("Enhanced ✓", 1200);
          },
        });
        return true;
      } finally {
        try {
          overlay?.close();
        } catch {}
        __VG_ENH_INFLIGHT = false;
      }
    });
  // ===== end inserted =====
})();
