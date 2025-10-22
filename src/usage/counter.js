// src/usage/counter.js
// Phase 1: Handshake only. Confirms page ↔ background whitelist status. No counting.

(() => {
  try {
    window.__vgEnsureKeepAlive?.();
  } catch {}

  if (!browser?.runtime?.id) return;

  const HOST = (location.hostname || "").toLowerCase().replace(/^www\./, "");
  const PATH = location.pathname || "/";

  // Tiny debug surface for DevTools checks
  window.__VG_COUNTER = { armed: false, host: HOST, path: PATH, last: null };

  browser.runtime
    .sendMessage({
      type: "COUNTER_HANDSHAKE",
      payload: { host: HOST, path: PATH },
    })
    .then((resp) => {
      window.__VG_COUNTER.last = resp || null;

      if (resp?.ok && resp.enabled) {
        window.__VG_COUNTER.armed = true;
        document.documentElement.dataset.vgCounter = "armed";
        if (__VG_DEBUG_COUNTER)
          console.log("[VG][counter] COUNTER ARMED for", HOST, PATH, resp);
      } else {
        document.documentElement.dataset.vgCounter = "disabled";
        if (__VG_DEBUG_COUNTER)
          console.log("[VG][counter] COUNTER NOT armed for", HOST, PATH, resp);
      }
    });

  // ---- Phase A: Local usage tracking (log-only) ----
  if (window.__VG_COUNTER_PHASE_A) return;
  window.__VG_COUNTER_PHASE_A = true;

  // Load optional debug flag EARLY so we can safely gate logs
  let __VG_DEBUG_COUNTER = false;
  try {
    browser.storage.local.get("VG_DEBUG_COUNTER").then((o) => {
      __VG_DEBUG_COUNTER = !!(o && o.VG_DEBUG_COUNTER);
    });
  } catch (e) {}

  if (__VG_DEBUG_COUNTER) console.log("[VG][counter] Phase A tracker active");

  // --- Tokenizer loader (uses our vendored wrapper) ---
  let __countTokens = null;
  try {
    const url = browser.runtime.getURL("src/usage/tokenCounter.js");
    import(url)
      .then((m) => {
        __countTokens = m.countTokens;
        try {
          window.__VG_TOK_READY = true;
        } catch {}
      })
      .catch(() => {
        /* fallback stays on heuristic if import fails */
      });
  } catch (e) {
    /* ignore */
  }

  // --- SELECTORS pulled from vg_page_placements via BG (fallback to generic) ---
  let SELECTORS = { composer: null, send: null, messages: null };

  // Ask BG for placements and pick a row that provides selectors (merged w/ overrides)
  async function resolveSelectors(host, path) {
    try {
      const res = await browser.runtime.sendMessage({
        type: "VG_GET_PAGE_PLACEMENTS",
        host,
        path,
      });
      const rows = Array.isArray(res?.placements) ? res.placements : [];

      // prefer rows that give us explicit selectors
      const withSelectors =
        rows.find(
          (r) =>
            r?.composer_selector ||
            r?.send_selector ||
            r?.message_container_selector
        ) ||
        rows[0] ||
        null;

      SELECTORS.composer = withSelectors?.composer_selector || null;
      SELECTORS.send = withSelectors?.send_selector || null;
      SELECTORS.messages = withSelectors?.message_container_selector || null;

      if (__VG_DEBUG_COUNTER)
        console.log("[VG][counter] selectors resolved:", SELECTORS);
    } catch (e) {
      if (__VG_DEBUG_COUNTER)
        console.warn(
          "[VG][counter] selector resolve failed; using generic listeners",
          e
        );
      SELECTORS = { composer: null, send: null, messages: null };
    }
  }

  // ---- Outlier guardrails ----
  const MAX_DELTA_CHARS = 50_000; // ~12.5k tokens worst case
  const MAX_EVENT_TOKENS = 12_500;

  function clampAndFlag(chars, tokens) {
    let flagged = false;
    let c = chars,
      t = tokens;
    if (c > MAX_DELTA_CHARS) {
      c = MAX_DELTA_CHARS;
      flagged = true;
    }
    if (t > MAX_EVENT_TOKENS) {
      t = MAX_EVENT_TOKENS;
      flagged = true;
    }
    return {
      chars: c,
      tokens: t,
      confidence: flagged ? "low" : "estimated_profile",
    };
  }

  // Token estimator (simple rule for now)
  const estTokens = (text) => Math.ceil((text?.length || 0) / 4);

  // ---- Global token factors (no per-host overrides) ----
  const TOKEN_FACTORS = {
    prose: 0.25,
    mixed: 0.28,
    code: 0.31,
  };

  // Lightweight content classifier for reply deltas
  function __classifyReplyText(s) {
    if (!s) return "prose";

    // Fast signals
    const len = s.length;
    const lines = s.split(/\r?\n/);
    const lineCount = lines.length;

    // Heuristics for code
    let codeLikeLines = 0;
    let fencedBlocks = 0;
    let symbolCount = 0;

    for (let i = 0; i < lineCount; i++) {
      const L = lines[i];

      if (L.startsWith("```")) fencedBlocks++;

      // leading indent or typical code tokens
      if (
        /^\s{2,}/.test(L) ||
        /[{;}()\[\]<>]|=>|const |let |var |function |class |def |return |import |export |#include|<\w+>/.test(
          L
        )
      ) {
        codeLikeLines++;
      }

      // non-alpha density
      const nonAlpha = (L.match(/[^A-Za-z0-9\s]/g) || []).length;
      symbolCount += nonAlpha;
    }

    const codeLineRatio = codeLikeLines / Math.max(1, lineCount);
    const symbolRatio = symbolCount / Math.max(1, len);

    // Decision rules (tuned for simplicity; tweak later if needed)
    if (fencedBlocks >= 1) return "code";
    if (codeLineRatio >= 0.35) return "code";
    if (codeLineRatio >= 0.15 || symbolRatio >= 0.12) return "mixed";
    return "prose";
  }

  function __factorForProfile(profile) {
    if (profile === "code") return TOKEN_FACTORS.code;
    if (profile === "mixed") return TOKEN_FACTORS.mixed;
    return TOKEN_FACTORS.prose;
  }

  let __VG_SESSION_ID = null;
  const __VG_BATCH = [];
  let __VG_BATCH_TIMER = null;

  const __VG_BATCH_MAX = 5; // flush when N events queued
  const __VG_BATCH_MAX_AGE_MS = 2000; // or after this many ms

  // Load optional debug flag; default false
  try {
    browser.storage.local.get("VG_DEBUG_COUNTER").then((o) => {
      __VG_DEBUG_COUNTER = !!(o && o.VG_DEBUG_COUNTER);
    });
  } catch (e) {}

  // Simple session id (per page-arm)
  function __vgNewSessionId() {
    const rand = Math.random().toString(36).slice(2);
    const ts = Date.now().toString(36);
    return "sid_" + rand + ts;
  }

  // Queue an event and maybe flush
  function __queueUsage(evt) {
    try {
      if (!__VG_SESSION_ID) __VG_SESSION_ID = __vgNewSessionId();

      __VG_BATCH.push(evt);

      if (__VG_DEBUG_COUNTER) {
        console.log("[VG][usage][queued]", evt);
      }

      // Size-based flush
      if (__VG_BATCH.length >= __VG_BATCH_MAX) {
        __flushUsageBatch();
        return;
      }

      // Age-based flush
      if (__VG_BATCH_TIMER) clearTimeout(__VG_BATCH_TIMER);
      __VG_BATCH_TIMER = setTimeout(() => {
        __VG_BATCH_TIMER = null;
        __flushUsageBatch();
      }, __VG_BATCH_MAX_AGE_MS);
    } catch (e) {}
  }

  function __flushUsageBatch() {
    if (!__VG_BATCH.length) return;

    const batch = __VG_BATCH.splice(0, __VG_BATCH.length);

    const payload = {
      type: "VG_USAGE_BATCH",
      host: (location.hostname || "").toLowerCase().replace(/^www\./, ""),
      path: location.pathname || "/",
      sessionId: __VG_SESSION_ID,
      events: batch,
    };

    try {
      browser.runtime.sendMessage(payload).then((resp) => {
        if (__VG_DEBUG_COUNTER) {
          console.log("[VG][usage][sent]", { count: batch.length, resp });
        }
      });
    } catch (e) {
      if (__VG_DEBUG_COUNTER) {
        console.warn("[VG][usage][send-failed]", e);
      }
    }
  }

  // ---- Prompt de-dupe helpers (one-shot within 800ms window) ----
  let __lastPromptSig = null;
  let __lastPromptAt = 0;
  let __skipNextOutput = false; // declare here so __emitPrompt can safely set it

  function __emitPrompt(val) {
    const now = Date.now();
    const sig = `${val.length}:${val.slice(0, 64)}`; // cheap signature

    // Skip duplicate if same signature within 800ms
    if (__lastPromptSig === sig && now - __lastPromptAt < 800) return;

    __lastPromptSig = sig;
    __lastPromptAt = now;

    // Drop boot suppression once the user actually sends something
    __suppressOutputs = false;

    // Option A: treat the next output delta as the user's echoed message and skip it
    __skipNextOutput = true;

    // Queue (no console unless debug flag is ON)
    {
      const tokens = __countTokens
        ? __countTokens(val)
        : Math.ceil(val.length * 0.25);
      __queueUsage({
        direction: "in",
        ts: new Date().toISOString(),
        chars: val.length,
        profile: "prose",
        // factor_used kept for backwards compatibility; no longer used for math
        factor_used: 0.25,
        tokens_est: tokens,
      });
    }
  }

  // Capture prompts using DB selectors when available; fall back to generic
  const hookPromptSend = () => {
    // 1) If we have an explicit send button selector, listen for real sends
    if (SELECTORS.send) {
      document.addEventListener(
        "click",
        (e) => {
          try {
            if (!(e.target && e.target.closest)) return;
            const btn = e.target.closest(SELECTORS.send);
            if (!btn) return;

            // Read the composer using its selector if provided; else fallback probe
            let val = "";
            if (SELECTORS.composer) {
              const comp = document.querySelector(SELECTORS.composer);
              if (comp) {
                val = (comp.value ?? comp.textContent ?? "").trim();
              }
            }
            if (!val) {
              // last-resort fallback to active element/editor
              const el = document.activeElement;
              if (el) {
                if (el.tagName === "TEXTAREA") val = (el.value || "").trim();
                else if (
                  el.isContentEditable ||
                  el.getAttribute?.("contenteditable") === "true"
                )
                  val = (el.textContent || "").trim();
                else if (el.getAttribute?.("role") === "textbox")
                  val = (el.value || el.textContent || "").trim();
              }
            }
            if (!val) return;

            // de-duped emit
            __emitPrompt(val);
          } catch {}
        },
        true
      ); // capture clicks before frameworks stop propagation
    }

    // 2) Also keep a generic Enter listener (covers Enter-to-send UIs)
    document.addEventListener(
      "keydown",
      (e) => {
        // avoid IME composition or dead-key sequences
        if (e.isComposing) return;

        const isEnter = e.key === "Enter";
        const isSubmit = isEnter && (e.metaKey || e.ctrlKey || !e.shiftKey); // ignore Shift+Enter
        if (!isSubmit) return;

        let el = e.target,
          val = "";
        if (el && el.tagName === "TEXTAREA") val = (el.value || "").trim();
        else if (
          el &&
          (el.isContentEditable ||
            el.getAttribute?.("contenteditable") === "true")
        )
          val = (el.textContent || "").trim();
        else if (el && el.getAttribute?.("role") === "textbox")
          val = (el.value || el.textContent || "").trim();

        if (!val && SELECTORS.composer) {
          const comp = document.querySelector(SELECTORS.composer);
          if (comp) val = (comp.value ?? comp.textContent ?? "").trim();
        }
        if (!val) return;

        // de-duped emit
        __emitPrompt(val);
      },
      true
    );
  };

  // Wait for handshake to set __VG_COUNTER.armed (up to ~1.5s)
  async function __vgWaitArmed(timeoutMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.__VG_COUNTER?.armed) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return !!window.__VG_COUNTER?.armed;
  }

  // ---- Output settle helpers: added-nodes only (skip echo after prompt) ----
  let __outTimer = null;
  let __pendingAddedText = "";
  let __suppressOutputs = true; // ignore initial page boot/hydration

  function textFromNode(n) {
    if (!n) return "";
    // ignore inputs/editors/buttons
    if (n.matches?.("textarea,[contenteditable],input,button")) return "";
    // ignore obvious hidden nodes
    const ariaHidden = n.getAttribute?.("aria-hidden");
    if (ariaHidden === "true") return "";
    // prefer visible text; fall back to textContent
    return (n.innerText ?? n.textContent ?? "") || "";
  }

  function collectAddedText(muts) {
    let acc = "";
    for (const m of muts) {
      if (!m.addedNodes?.length) continue;
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue; // elements only
        acc += textFromNode(node);
      }
    }
    return acc;
  }

  function __flushOutputFromAdded() {
    const deltaText = __pendingAddedText;
    __pendingAddedText = "";
    if (!deltaText) return;

    // Ignore page boot/hydration until first prompt
    if (__suppressOutputs) return;

    // Skip the very next output after a prompt (user echo in transcript)
    if (__skipNextOutput) {
      __skipNextOutput = false;
      return;
    }

    const chars = deltaText.length;
    const profile = __classifyReplyText(deltaText);
    const factor = __factorForProfile(profile); // label only

    // exact tokens (fallback to heuristic if tokenizer not ready)
    const heur = Math.ceil(chars * factor);
    const tokens = __countTokens ? __countTokens(deltaText) : heur;

    // clamp + confidence flag
    const {
      chars: safeChars,
      tokens: safeTokens,
      confidence,
    } = clampAndFlag(chars, tokens);

    if (__VG_DEBUG_COUNTER) {
      console.log("[VG][counter] out delta", {
        chars,
        tokens_raw: tokens,
        safeChars,
        safeTokens,
        confidence,
      });
    }

    __queueUsage({
      direction: "out",
      ts: new Date().toISOString(),
      chars: safeChars,
      profile,
      factor_used: factor,
      tokens_est: safeTokens,
      confidence,
    });
  }

  // Capture assistant outputs (scoped to message container if available)
  const hookOutputs = () => {
    const container =
      (SELECTORS.messages && document.querySelector(SELECTORS.messages)) ||
      document.body ||
      document.documentElement;
    if (!container) return;

    const obs = new MutationObserver((muts) => {
      const added = collectAddedText(muts);
      if (!added) return;

      __pendingAddedText += added;

      if (__outTimer) clearTimeout(__outTimer);
      __outTimer = setTimeout(() => {
        __outTimer = null;
        __flushOutputFromAdded();
      }, 400); // settle window for streaming UIs
    });

    obs.observe(container, { childList: true, subtree: true });
  };

  async function __vgStartPhaseA() {
    const ready = await __vgWaitArmed(1500);
    if (!ready) {
      console.log(
        "[VG][counter] Phase A skipped: not armed (handshake not ready)"
      );
      return;
    }
    await resolveSelectors(HOST, PATH); // pull DB selectors first
    hookPromptSend();
    hookOutputs();
  }

  // Start now if DOM ready; else wait for DOMContentLoaded (document_idle safety)
  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    __vgStartPhaseA();
  } else {
    document.addEventListener("DOMContentLoaded", () => __vgStartPhaseA(), {
      once: true,
    });
  }
})();
