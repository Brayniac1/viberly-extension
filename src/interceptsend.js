// src/interceptsend.js

(() => {

  // HARD KILL: if the flag is set, do nothing (no listeners, no overlay)
  if (typeof window !== 'undefined' && window.__VG_DISABLE_SEND_INTERCEPT) {
    try { document.getElementById('vg-send-countdown')?.remove(); } catch {}
    console.log('[VG] interceptsend disabled (hard kill)');
    return;
  }

  const VG = (window.__VG = window.__VG || {});

 
  // ==== NEW: key-state + caret helpers (placed near the top) ====
  // Track whether Space is currently held so Space+Enter doesn't trigger send.
  let __VG_SPACE_HELD = false;
  function __vgBindSpaceStateListeners(target = window) {
    try {
      target.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.key === ' ') __VG_SPACE_HELD = true;
	if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') __VG_SPACE_HELD = true;
      }, true);
      target.addEventListener('keyup', (e) => {
        if (e.code === 'Space' || e.key === ' ') __VG_SPACE_HELD = false;
	if (e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar') __VG_SPACE_HELD = false;
      }, true);
      // Defensive: clear on blur so the flag can’t "stick"
      target.addEventListener('blur', () => { __VG_SPACE_HELD = false; }, true);
    } catch {}
  }
  __vgBindSpaceStateListeners(window);

  // Insert a paragraph break at the caret for textarea/contenteditable.
  // Returns true on success.
  function __vgInsertParagraphBreak(el) {
    if (!el) return false;
    const nl = '\n\n';
    try {
      // contenteditable path first
      if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
        // Prefer beforeinput → lets host handle IME/undo/stack
        try {
          const ok = el.dispatchEvent(new InputEvent('beforeinput', {
            inputType: 'insertText', data: nl, bubbles: true, cancelable: true, composed: true
          }));
          if (ok !== false) return true;
        } catch {}
        // execCommand fallback
        try { if (document.execCommand && document.execCommand('insertText', false, nl)) return true; } catch {}
        // Range fallback
        try {
          const doc = el.ownerDocument || document;
          const sel = doc.getSelection && doc.getSelection();
          if (sel && sel.rangeCount) {
            const r = sel.getRangeAt(0);
            r.deleteContents();
            r.insertNode(doc.createTextNode(nl));
            r.collapse(false);
            sel.removeAllRanges(); sel.addRange(r);
          } else {
            el.appendChild(doc.createTextNode(nl));
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        } catch {}
        return false;
      }
      // <textarea>/<input> path
      if ('value' in el) {
        const start = el.selectionStart ?? el.value.length;
        const end   = el.selectionEnd   ?? el.value.length;
        const before = el.value.slice(0, start);
        const after  = el.value.slice(end);
        const next   = before + nl + after;
        const proto  = Object.getPrototypeOf(el);
        const desc   = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : null;
        if (desc && typeof desc.set === 'function') desc.set.call(el, next); else el.value = next;
        const caret = before.length + nl.length;
        try { el.setSelectionRange(caret, caret); } catch {}
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    } catch {}
    return false;
  }




  // --- Visibility helper
  function vgIsVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.bottom <= 0 || r.top >= innerHeight) return false;
    return true;
  }

    // ---- Bolt-only deep shadow helpers (won't run elsewhere)
	  const __VG_BOLT = /(^|\.)bolt\.new$/.test(location.hostname);
	
	  // Deep query across shadow roots (only used when __VG_BOLT)
	  function vgDeepQueryAll(root, selector, out = []) {
	    try { (root.querySelectorAll?.(selector) || []).forEach(el => out.push(el)); } catch {}
	    const kids = [];
	    try { if (root.shadowRoot) kids.push(root.shadowRoot); } catch {}
	    try { kids.push(...(root.children || [])); } catch {}
	    for (const k of kids) vgDeepQueryAll(k, selector, out);
	    return out;
	  }

	
	// Bolt-only: robust, shadow-aware composer inserter exposed for other modules
if (__VG_BOLT) {
  window.__VG_COMPOSER_INSERT = function (text) {
    try {
      const sel = 'textarea,[contenteditable="true"],[role="textbox"][contenteditable="true"]';
      const list = vgDeepQueryAll(document, sel).filter(vgIsVisible);
      if (!list.length) return false;

      // Prefer focused, else lower on screen (matches your existing heuristics)
      list.sort((a,b) => {
        const af = (document.activeElement === a) ? 1 : 0;
        const bf = (document.activeElement === b) ? 1 : 0;
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return (bf - af) || ((br.top + br.height/2) - (ar.top + ar.height/2));
      });
      const el  = list[0];
      const txt = String(text || "");

      // Focus first (some shadow editors ignore inserts without focus)
      try { el.focus(); } catch {}

      // <textarea>/<input> path
      if ('value' in el) {
        const cur  = String(el.value || "");
        const next = cur ? (cur + '\n\n' + txt) : txt;
        const proto = Object.getPrototypeOf(el);
        const desc  = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
        if (desc && typeof desc.set === "function") desc.set.call(el, next); else el.value = next;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        try { el.setSelectionRange(next.length, next.length); } catch {}
        return true;
      }

      // contenteditable path
      try {
        // prefer beforeinput → lets host handle IME/undo
        const ev = new InputEvent('beforeinput', {
          inputType:'insertText', data: txt, bubbles:true, cancelable:true, composed:true
        });
        const accepted = el.dispatchEvent(ev);
        if (accepted !== false) return true;
      } catch {}
      // execCommand fallback
      try { if (document.execCommand && document.execCommand('insertText', false, txt)) return true; } catch {}
      // Range insertion fallback
      try {
        const doc = el.ownerDocument || document;
        const selObj = doc.getSelection && doc.getSelection();
        if (selObj && selObj.rangeCount) {
          const r = selObj.getRangeAt(0);
          r.deleteContents();
          r.insertNode(doc.createTextNode(txt));
          r.collapse(false);
          selObj.removeAllRanges(); selObj.addRange(r);
        } else {
          el.appendChild(doc.createTextNode(txt));
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      } catch {}
    } catch {}
    return false;
  };
}

	
	  /* ===== BOLT FIX: make "Insert once" work by overriding the global
	     composer finder that settings.js calls (vgFindComposer). This is
	     bolt.new ONLY and won’t affect other hosts. */
	  if (__VG_BOLT) {
	    try {		
	      window.vgFindComposer = function () {
	        const sel = 'textarea,[role="textbox"],[contenteditable="true"],[contenteditable]';
	        const list = vgDeepQueryAll(document, sel).filter(vgIsVisible);
	        if (!list.length) return null;
	
	        // prefer focused or lower on screen (matches your existing behavior)
	        list.sort((a,b) => {
	          const af = (document.activeElement === a) ? 1 : 0;
	          const bf = (document.activeElement === b) ? 1 : 0;
	          const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
	          return (bf - af) || ((br.top + br.height/2) - (ar.top + ar.height/2));
	        });
	        return list[0] || null;
	      };
	    } catch {}
	  }



  // === NEW: small utilities used by the interceptors ===
  function __vgLabelOf(el) {
    if (!el) return "";
    return (el.innerText || el.textContent || el.value || el.getAttribute?.("aria-label") || "").trim();
  }
  function __vgLooksLikeSend(text) {
    // cover Send / Ask / Submit / Run
    return /\b(send|ask|submit|run)\b/i.test(text || "");
  }
  function __vgIsChatControl(el) {
    return /^\s*chat\s*$/i.test(__vgLabelOf(el));
  }
  function __vgModalOpen() {
  // Settings host id is APP + "-modal-host" (vibeguardian-modal-host). Also ignore AI Chat or Bug Buster if present.
  // Also honor the global flag some UIs set during open/close transitions.
  if (window.__VG_MODAL_ACTIVE === true) return true;
  return !!document.querySelector('[id$="-modal-host"], #vg-aichat-host, #vg-bugbuster-host');
}

  function __vgButtonFromEvent(ev) {
    const path = (ev.composedPath && ev.composedPath()) || [];
    for (const n of path) {
      if (!(n instanceof Element)) continue;
      if (!vgIsVisible(n) || !n.matches) continue;
      if (n.matches('button,[role="button"],input[type="submit"],[aria-label]')) {
        if (__vgLooksLikeSend(__vgLabelOf(n))) return n;
      }
    }
    return null;
  }

  // --- Settings helper: wait up to 2s for settings to be published
  function waitForSettings(timeoutMs = 2000) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (window.__VG_SETTINGS) return resolve(window.__VG_SETTINGS);
        if (Date.now() - start > timeoutMs) return resolve(window.__VG_SETTINGS || {});
        setTimeout(tick, 50);
      };
      tick();
    });
  }

// --- Countdown overlay (anchored above the composer; single instance)
function showCountdownOverlay(seconds) {
  // Ensure single instance — remove any existing countdown before creating a new one
  try { document.getElementById('vg-send-countdown')?.remove(); } catch {}

  return new Promise((resolve) => {
    let remaining = Math.max(0, seconds | 0);
    let cancelled = false;
    let fastForward = false;

    // Anchor: prefer composer, then VG pill, else center
    const composer = findComposer();
    const pillHost = document.querySelector('[id$="-pill-host"]'); // e.g., vibeguardian-pill-host
    const cr = composer?.getBoundingClientRect?.();
    const pr = pillHost?.getBoundingClientRect?.();

    const overlay = document.createElement("div");
    overlay.id = "vg-send-countdown";
    overlay.setAttribute("data-vg-countdown", "1");

    // default: screen-dim (only if no anchor)
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,.45)",
      zIndex: "2147483646",
      fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      backdropFilter: "blur(2px)"
    });

    // anchored popover position
    let anchored = false, left = 0, top = 0;
    if (cr && cr.width > 0 && cr.height > 0) {
      const centerX = pr ? (pr.left + pr.width / 2) : (cr.left + cr.width / 2);
      left = Math.round(centerX);
      top  = Math.round(cr.top) - 10; // 10px above the composer
      anchored = true;
    } else if (pr && pr.width > 0 && pr.height > 0) {
      left = Math.round(pr.left + pr.width / 2);
      top  = Math.round(pr.top) - 12; // just above the pill
      anchored = true;
    }

    if (anchored) {
      Object.assign(overlay.style, {
        inset: "auto",
        left: left + "px",
        top:  top  + "px",
        transform: "translate(-50%, -100%)",
        background: "transparent",
        backdropFilter: "none",
        pointerEvents: "none" // host doesn’t block page; card will accept clicks
      });
    }

    const card = document.createElement("div");
    Object.assign(card.style, {
      minWidth: "260px",
      padding: "12px 14px",
      borderRadius: "12px",
      border: "1px solid rgba(255,255,255,.08)",
      background: "linear-gradient(180deg,#0f1116 0%,#0b0d13 100%)",
      boxShadow: "0 18px 50px rgba(0,0,0,.55)",
      textAlign: "center",
      color: "#e5e7eb",
      fontSize: "14px",
      pointerEvents: "auto"
    });

    const h = document.createElement("div");
    h.textContent = "Sending…";
    h.style.cssText = "font-size:15px;font-weight:600;margin-bottom:4px";

    const p = document.createElement("div");
    p.style.cssText = "opacity:.9;margin-bottom:8px";

    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:center";

    const btnSend = document.createElement("button");
    btnSend.id = "vg-sendnow";
    btnSend.textContent = "Send now";
    btnSend.style.cssText = "background:#7c3aed;color:#fff;border:0;border-radius:10px;padding:6px 10px;cursor:pointer";

    const btnCancel = document.createElement("button");
    btnCancel.id = "vg-cancel";
    btnCancel.textContent = "Cancel";
    btnCancel.style.cssText = "background:#1f1f26;color:#e5e7eb;border:1px solid #2a2a33;border-radius:10px;padding:6px 10px;cursor:pointer";

    row.appendChild(btnSend);
    row.appendChild(btnCancel);

    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function update() { p.textContent = `Sending in ${remaining}s…`; }
    function cleanup() {
      try { window.removeEventListener("keydown", onKey, true); } catch {}
      try { overlay.remove(); } catch {}
    }
    function resolveOnce(payload) {
      cleanup();
      resolve(payload);
    }
    function onKey(e) {
      if (e.key === "Escape") { cancelled = true; resolveOnce({ cancelled:true, fast:false }); }
      else if (e.key === "Enter") { fastForward = true; resolveOnce({ cancelled:false, fast:true }); }
    }

    window.addEventListener("keydown", onKey, true);
    btnSend.addEventListener("click",  () => resolveOnce({ cancelled:false, fast:true }));
    btnCancel.addEventListener("click", () => resolveOnce({ cancelled:true,  fast:false }));

    update();
    if (remaining <= 0) { resolveOnce({ cancelled:false, fast:false }); return; }

    const timer = setInterval(() => {
      if (cancelled || fastForward) { clearInterval(timer); return; }
      remaining -= 1;
      if (remaining <= 0) { clearInterval(timer); resolveOnce({ cancelled:false, fast:false }); return; }
      update();
    }, 1000);
  });
}


    // --- Generic composer finder (bolt.new gets deep-shadow fallback)
	  function findComposer() {
	    const sel = 'textarea,[role="textbox"],[contenteditable="true"],[contenteditable]';
	
	    // 1) Original shallow search (keeps behavior for all sites)
	    let list = Array.from(document.querySelectorAll(sel)).filter(vgIsVisible);
	
	    // 2) Bolt-only: if nothing, search through shadow roots
	    if (!list.length && __VG_BOLT) {
	      list = vgDeepQueryAll(document, sel).filter(vgIsVisible);
	    }
	    if (!list.length) return null;
	
	    // prefer focused or lower on screen
	    list.sort((a,b) => {
	      const af = (document.activeElement === a) ? 1 : 0;
	      const bf = (document.activeElement === b) ? 1 : 0;
	      const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
	      return (bf - af) || ((br.top + br.height/2) - (ar.top + ar.height/2));
	    });
	    return list[0] || null;
	  }


    // --- Send button finder (bolt.new gets deep-shadow fallbacks)
	  function findSendButtonNear(composer) {
	    if (!composer) return null;
	    const Q = [
	      'button[type="submit"]',
	      'input[type="submit"]',
	      'button[aria-label*="send" i]',
	      'button[title*="send" i]',
	      '[data-testid*="send" i]',
	      '[role="button"]'
	    ].join(',');
	
	    // Original behavior: inside the same DOM subtree
	    let cands = Array.from(composer.querySelectorAll(Q)).filter(vgIsVisible);
	    if (!cands.length) {
	      const row = composer.closest('[class*="row"],[class*="bar"],[class*="container"],[class*="footer"]')
	               || composer.parentElement || document.body;
	      cands = Array.from(row.querySelectorAll(Q)).filter(vgIsVisible);
	    }

	    // Bolt-only deep searches if still nothing
	    if (!cands.length && __VG_BOLT) {
	      // search within the composer's root (shadow root aware)
	      const root = (composer.getRootNode && composer.getRootNode()) || document;
	      cands = vgDeepQueryAll(root, Q).filter(vgIsVisible);
	      if (!cands.length) {
	        // as a last resort, deep search whole document (covers portal’d buttons)
	        cands = vgDeepQueryAll(document, Q).filter(vgIsVisible);
	      }
	    }
	
	    if (!cands.length) return null;
	    cands.sort((a,b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
	    return cands[0] || null;
	  }


	  // --- Generic performSend()
	  async function performSend() {
	  const c = findComposer();
	  const btn = findSendButtonNear(c);
	  if (btn) { btn.click(); return true; }
	
	  if (c) {
	    // Prefer form submit → avoids synthetic keydown that could re-trigger our key handler
	    const form = c.closest?.("form");
	    if (form) {
	      if (typeof form.requestSubmit === "function") form.requestSubmit();
	      else form.submit();
	      return true;
	    }
	
	    // Last-resort: synthesize Enter for UIs that only listen to keydown
	    c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
	    c.dispatchEvent(new KeyboardEvent("keyup",   { key: "Enter", bubbles: true }));
	    return true;
	  }
	  return false;
	}


// ---- Helpers used by ensureChatOn ----
function __vgIsPressedOrSelected(el) {
  return !!el.closest('[aria-pressed="true"],[aria-selected="true"],.active,[data-active="true"]');
}
function __vgWaitUntil(pred, timeout = 800, step = 50) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function tick() {
      try { if (pred()) return resolve(true); } catch {}
      if (performance.now() - t0 >= timeout) return resolve(false);
      setTimeout(tick, step);
    })();
  });
}

      // --- Ensure Chat is ON (idempotent; never toggles it OFF) with revert protection
async function ensureChatOn() {
  // If clearly ON, do nothing.
  if (isChatActive()) return;

  // Build candidates that would ACTIVATE Chat (not pressed/selected now)
  const tabCandidates = Array.from(document.querySelectorAll(
    '[role="tab"][aria-label*="chat" i]'
  ));
  const btnCandidates = Array.from(document.querySelectorAll(
    'button[aria-label*="chat" i], [role="button"][aria-label*="chat" i]'
  ));
  const genericCandidates = Array.from(document.querySelectorAll(
    '[aria-label*="chat" i], [data-testid*="chat" i], [aria-controls*="chat" i], button, [role="button"], [role="tab"]'
  ));

  // Merge, filter visible and NOT pressed/selected, and NOT inside a pressed/selected ancestor
  const pool = [...tabCandidates, ...btnCandidates, ...genericCandidates]
    .filter(vgIsVisible)
    .filter(el => {
      const label = (__vgLabelOf(el) || '').toLowerCase();
      if (!/\bchat\b/.test(label)) return false;
      const pressed  = (el.getAttribute('aria-pressed')  || '').toLowerCase() === 'true';
      const selected = (el.getAttribute('aria-selected') || '').toLowerCase() === 'true';

      if (pressed || selected) return false;
	if (__vgIsPressedOrSelected(el)) return false; // ancestor pressed/selected
	
	// If a visible chat transcript/panel exists, assume Chat is already ON → don’t click.
	const panelVisible =
	  document.querySelector('.chat-panel, .chat.active, .messages, .message-list, [data-testid*="chat-panel" i], [data-testid*="messages" i]') ||
	  document.querySelector('[role="tabpanel"] [data-testid*="message" i], [role="tabpanel"] [class*="message"]');
	if (panelVisible) return false;
	
	return true;
	
    });

  if (!pool.length) return; // nothing safe to click

  const cand = pool[0];

  // Revert-protected activation:
  // If we mis-detected and it's actually ON, clicking might toggle OFF.
  // Snapshot state, click, then verify and revert if needed.
  
  const wasActive = isChatActive();
	cand.click();
	
	// Wait for state to settle
	let becameOn = await __vgWaitUntil(() => isChatActive(), 800, 50);
	
	// If it did not end up ON (either we toggled OFF or nothing changed), click once more.
	if (!becameOn) {
	  cand.click();
	  becameOn = await __vgWaitUntil(() => isChatActive(), 800, 50);
	}

}   // ← END OF ensureChatOn()

  // --- Back-compat alias so defaults and old code keep working
  function switchToChat() { return ensureChatOn(); }

  // --- Is Chat currently active?
function isChatActive() {
  // 0) Helper: visible?
  const __vis = (el) => {
    if (!el || !(el instanceof Element)) return false;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  };

  // 1) Strong, explicit signals (keep existing)
  if (document.querySelector(
    '[role="tab"][aria-selected="true"][aria-label*="chat" i], ' +
    '[aria-current="page"][aria-label*="chat" i], ' +
    'button[aria-pressed="true"][aria-label*="chat" i], ' +
    '[role="button"][aria-pressed="true"][aria-label*="chat" i], ' +
    '[data-active-tab*="chat" i], [data-mode*="chat" i], [data-state*="chat" i], ' +
    '.chat-panel, .chat.active, [data-testid*="chat-panel" i], [role="tabpanel"][aria-label*="chat" i]'
  )) return true;

  // 2) Panel heuristics for UIs that don't update ARIA on the toggle (e.g., Lovable)
  //    Look for a visible transcript/message scroller next to a composer.
  const panelCandidates = document.querySelectorAll([
    // common generic panes
    '.chat, .chat__panel, .chat-panel, .messages, .message-list, [data-testid*="chat" i], [data-testid*="messages" i]',
    // common left-column transcripts
    '[role="log"]',
    // any role="tabpanel" that *contains* messages
    '[role="tabpanel"]'
  ].join(','));
  for (const el of panelCandidates) {
    if (!__vis(el)) continue;
    // If the container contains multiple chat message rows/bubbles, treat as active.
    const bubbles = el.querySelectorAll('[role="article"], [data-testid*="message" i], [class*="message"]');
    if (bubbles.length >= 1) return true;
  }

  // 3) Generic “currently selected element” heuristic
  const selectedNow = document.querySelector(
    '[role="tab"][aria-selected="true"], button[aria-pressed="true"], [role="button"][aria-pressed="true"], [aria-current="page"]'
  );
  const labelOf = (el) => (el?.innerText || el?.textContent || el?.getAttribute?.('aria-label') || '').trim().toLowerCase();
  if (selectedNow && /\bchat\b/.test(labelOf(selectedNow))) return true;

  // 4) If we see any visible “switch to Chat” activator, assume OFF
  const activators = Array.from(document.querySelectorAll(
    '[role="tab"][aria-label*="chat" i]:not([aria-selected="true"]), ' +
    'button[aria-label*="chat" i]:not([aria-pressed="true"]), ' +
    '[role="button"][aria-label*="chat" i]:not([aria-pressed="true"]), ' +
    '[data-testid*="chat" i], [aria-controls*="chat" i]'
  )).filter(__vis);
  if (activators.length > 0) return false;

  // 5) Conservative default
  return false;
}



    // --- Wrap actual send with Auto-Chat + Countdown using global settings
  async function wrapSendWithVG(originalSend) {
  const cfg = (await waitForSettings()) || {};
  const delay = Number(cfg.send_delay_sec || 0);
  const autoChat = !!cfg.auto_chat;

  // Snapshot Chat state BEFORE we send
  const wasActiveBefore = isChatActive();

  if (delay > 0) {
    const result = await showCountdownOverlay(delay);
    if (result.cancelled) return { sent:false, reason:'cancelled' };
  }

  // SEND FIRST (do not touch Chat before sending)
  const out = await Promise.resolve().then(() => originalSend());

  // POST-SEND: if feature is enabled and Chat was OFF, turn it ON for next time
  if (autoChat) {
    setTimeout(() => { try { ensureChatOnPostSend(wasActiveBefore); } catch {} }, 120);
  }

  return { sent:true, result: out };
}


  // --- Public API for optional overrides (kept for future)
VG.installInterceptSend = async function(opts = {}) {
  const {
    findComposer: fc = findComposer,
    performSend: ps = performSend,
    // default to the idempotent version; callers can still pass a custom one
    switchToChat: stc = ensureChatOn,
    isChatActive: ica = isChatActive,
    keybindMode = "listener",
    interceptKeys = { enterSends: true, ctrlEnterOnly: false },
  } = opts || {};

    // route all sends through the guarded runner (BYPASS + cooldown)
	VG.invokeInterceptedSend = async () => __vgRunSendWithSettings();


        if (keybindMode === "listener" && typeof fc === "function") {
      const start = Date.now();
      const waitMax = 2500;
      (function bindWhenReady(){
        const el = fc();
        if (el && vgIsVisible(el)) {

              // Ensure our space-state listeners are also bound on the composer root
              try { __vgBindSpaceStateListeners(el.ownerDocument || window); } catch {}

          el.addEventListener("keydown", async (e) => {
  // Do not re-enter while a modal is open, while we are sending, or during cooldown
  if (__vgModalOpen()) return;
  if (__VG_BYPASS_INTERCEPT || __VG_COUNTDOWN_ACTIVE) return;
  if (performance.now() < (__VG_SUPPRESS_UNTIL || 0)) return;

  const enter = (e.key === "Enter");
  const wantsCtrl = interceptKeys?.ctrlEnterOnly;
  const hasCtrl = e.ctrlKey || e.metaKey;
  if (!enter) return;
  // NEW: let Shift+Enter behave as native newline (don’t intercept)
  if (e.shiftKey) return;
  // NEW: let Alt/Option+Enter behave as native newline (don’t intercept)
  if (e.altKey) return;
  if (wantsCtrl && !hasCtrl) return;
  if (!wantsCtrl && hasCtrl) return;

  // NEW: Space+Enter → insert paragraph break, do NOT send
  if (__VG_SPACE_HELD) {
    const composer = fc();
    if (composer) {
      e.preventDefault(); e.stopPropagation();
      const ok = __vgInsertParagraphBreak(composer);
      if (ok) return; // handled as paragraph; do not fall through to send
      // If insertion failed, fall through to old behavior (send)
    }
  }

  e.preventDefault(); e.stopPropagation();


  __VG_COUNTDOWN_ACTIVE = true;
  try {
    await VG.invokeInterceptedSend?.();   // now calls __vgRunSendWithSettings()
  } catch {} 
  finally {
    __VG_COUNTDOWN_ACTIVE = false;
  }
}, true);

          return;
        }
        if (Date.now() - start < waitMax) setTimeout(bindWhenReady, 80);
      })();
    }

    // === NEW: global interceptors to cover Send button clicks + form submits ===
let __VG_COUNTDOWN_ACTIVE = false;
let __VG_BYPASS_INTERCEPT = false;   // true while we programmatically send
let __VG_SUPPRESS_UNTIL   = 0;       // ms clock; ignore trailing events until this time


// Post-send: only ensure ON if it was OFF at the moment of send
let __VG_CHAT_TOGGLE_INFLIGHT = false;


async function ensureChatOnPostSend(preWasActive) {
  // Only act if it was OFF at the time of send
  if (preWasActive) return;

  // 0) If another toggle is running, wait for it (or success) and exit.
  if (__VG_CHAT_TOGGLE_INFLIGHT) {
    await __vgWaitUntil(() => !__VG_CHAT_TOGGLE_INFLIGHT || isChatActive(), 1500, 60);
    return;
  }

  // 1) Let the host UI settle; if it turns ON by itself, do nothing.
  const becameOn = await __vgWaitUntil(() => isChatActive(), 900, 70);
  if (becameOn) return;

  // 2) If still OFF, click exactly once to enable.
  __VG_CHAT_TOGGLE_INFLIGHT = true;
  try {
    const pool = [
      ...document.querySelectorAll('[role="tab"][aria-label*="chat" i]'),
      ...document.querySelectorAll('button[aria-label*="chat" i], [role="button"][aria-label*="chat" i]'),
      ...document.querySelectorAll('[aria-label*="chat" i], [data-testid*="chat" i], [aria-controls*="chat" i], button, [role="button"], [role="tab"]')
    ].filter(vgIsVisible).filter(el => {
      const label = (__vgLabelOf(el) || '').toLowerCase();
      if (!/\bchat\b/.test(label)) return false;
      if ((el.getAttribute('aria-pressed')||'').toLowerCase()==='true') return false;
      if ((el.getAttribute('aria-selected')||'').toLowerCase()==='true') return false;
      if (__vgIsPressedOrSelected(el)) return false;
      // If a visible chat panel exists already, we are done
      const panelVisible =
        document.querySelector('.chat-panel, .chat.active, .messages, .message-list, [data-testid*="chat-panel" i], [data-testid*="messages" i]') ||
        document.querySelector('[role="tabpanel"] [data-testid*="message" i], [role="tabpanel"] [class*="message"]');
      if (panelVisible) return false;
      return true;
    });

    if (!pool.length) return;

    const btn = pool[0];
    // Snapshot just in case the host flipped while we were computing pool
    if (isChatActive()) return;

    btn.click();

    // 3) Wait up to 1.5s; if still not ON, do NOT click again (avoid flip-flop).
    await __vgWaitUntil(() => isChatActive(), 1500, 60);
  } finally {
    __VG_CHAT_TOGGLE_INFLIGHT = false;
  }
}



async function __vgRunSendWithSettings() {
  const cfg   = (await waitForSettings()) || {};
  const delay = Number(cfg.send_delay_sec || 0);
  const autoChat = !!cfg.auto_chat;

  // Snapshot Chat state BEFORE we send
  const wasActiveBefore = isChatActive();

  if (delay > 0) {
    const { cancelled } = await showCountdownOverlay(delay);
    if (cancelled) return false;
  }

  __VG_BYPASS_INTERCEPT = true;
  try {
    const out = await Promise.resolve().then(() => ps());
    __VG_SUPPRESS_UNTIL = performance.now() + 600;

    // POST-SEND: only ensure ON if it was OFF at send time
    if (autoChat) {
      setTimeout(() => { try { ensureChatOnPostSend(wasActiveBefore); } catch {} }, 650);
    }

    return !!out;
  } finally {
    __VG_BYPASS_INTERCEPT = false;
  }
}



    // CLICK: intercept labeled Send/Ask/Submit/Run buttons
   document.addEventListener("click", async (ev) => {
  try {
    if (__vgModalOpen()) return;
	if (__VG_BYPASS_INTERCEPT || __VG_COUNTDOWN_ACTIVE) return;
	if (performance.now() < (__VG_SUPPRESS_UNTIL || 0)) return;


        const btn = __vgButtonFromEvent(ev);
        if (!btn) return;                 // not a send-ish control
        if (__vgIsChatControl(btn)) return;

        const cfg = (await waitForSettings()) || {};
        const needs = (cfg.send_delay_sec > 0) || !!cfg.auto_chat;
        if (!needs) return;

        ev.preventDefault(); ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

        __VG_COUNTDOWN_ACTIVE = true;
        const ok = await __vgRunSendWithSettings();

        // Allow native handlers again
        __VG_BYPASS_INTERCEPT = true;
        try { /* nothing to do if we already sent */ }
        finally { __VG_BYPASS_INTERCEPT = false; __VG_COUNTDOWN_ACTIVE = false; }
      } catch { /* noop */ }
    }, true); // capture

    // SUBMIT: forms that submit via Enter or icon-only submitters
    document.addEventListener("submit", async (ev) => {
  try {
    if (__vgModalOpen()) return;
	if (__VG_BYPASS_INTERCEPT || __VG_COUNTDOWN_ACTIVE) return;
	if (performance.now() < (__VG_SUPPRESS_UNTIL || 0)) return;

        const cfg = (await waitForSettings()) || {};
        const needs = (cfg.send_delay_sec > 0) || !!cfg.auto_chat;
        if (!needs) return;

        // eslint-disable-next-line compat/compat
        const sub = ev.submitter;
        if (sub && __vgIsChatControl(sub)) return;

        ev.preventDefault(); ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();

        __VG_COUNTDOWN_ACTIVE = true;
        const ok = await __vgRunSendWithSettings();

        __VG_BYPASS_INTERCEPT = true;
        try {
          // If you needed to re-fire native submit, you could do it here.
          // Our ps() already sent; nothing else required.
        } finally {
          __VG_BYPASS_INTERCEPT = false;
          __VG_COUNTDOWN_ACTIVE = false;
        }
      } catch { /* noop */ }
    }, true); // capture
  };


  // --- AUTO-INSTALL (universal; no site modules needed)
  try {
    VG.installInterceptSend({
      keybindMode: "listener",
      interceptKeys: { enterSends: true, ctrlEnterOnly: false },
      // keep defaults (generic find/send/chat)
    });
  } catch {}
})();
