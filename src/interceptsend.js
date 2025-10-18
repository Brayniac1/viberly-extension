// src/interceptsend.js
// Minimal send hooks — only used to capture intent snapshots.

(() => {
  const VG = (window.__VG = window.__VG || {});

  const INTERCEPT_DEBUG =
    typeof window !== "undefined" && Boolean(window.VG_INTENT_DEBUG);

  if (window.__VG_DISABLE_SEND_INTERCEPT) {
    if (INTERCEPT_DEBUG) {
      console.debug("[VG] intent intercept disabled");
    }
    return;
  }

  function estimateTokensApprox(text) {
    const clean = String(text || "").trim();
    if (!clean) return 0;
    const words = clean.split(/\s+/).filter(Boolean).length;
    const chars = clean.length;
  const approx = Math.max(words, Math.round(chars / 4));
  return approx || 0;
}

const RESPONSE_EXCERPT_LIMIT = 1500;
const RESPONSE_MIN_LENGTH = 80;
const RESPONSE_MAX_ATTEMPTS = 45;
const RESPONSE_POLL_INTERVAL_MS = 900;
const RESPONSE_STABLE_COUNT = 2;

const pendingResponseCaptures = new Map();
const lastAssistantHashByHost = new Map();

function hashString(str) {
  const text = String(str || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

function normalizeExcerpt(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function truncateExcerpt(text, limit = RESPONSE_EXCERPT_LIMIT) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}…`;
}

function isChatGptHost(host) {
  if (!host) return false;
  const value = host.toLowerCase();
  return (
    /(.*\.)?chatgpt\.com$/.test(value) ||
    /(.*\.)?chat\.openai\.com$/.test(value)
  );
}

function getChatGptAssistantReply() {
  try {
    const nodes = document.querySelectorAll(
      '[data-message-author-role="assistant"]'
    );
    if (!nodes.length) return null;
    const last = nodes[nodes.length - 1];
    if (!last) return null;
    const text = normalizeExcerpt(last.innerText || "");
    if (!text) return null;
    return { text, hash: hashString(text) };
  } catch {
    return null;
  }
}

function getLatestAssistantReply(host) {
  if (isChatGptHost(host)) return getChatGptAssistantReply();
  return null;
}

function cleanupPendingCapture(id) {
  const entry = pendingResponseCaptures.get(id);
  if (!entry) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.cancelled = true;
  pendingResponseCaptures.delete(id);
}

function submitResponseCapture(entry, latest) {
  const excerpt = truncateExcerpt(latest.text || "");
  if (!excerpt || excerpt.length < RESPONSE_MIN_LENGTH) {
    cleanupPendingCapture(entry.intentMessageId);
    return;
  }
  const payload = {
    intentMessageId: entry.intentMessageId,
    excerpt,
    hash: latest.hash,
    capturedAt: new Date().toISOString(),
    source: entry.host,
  };
  try {
    if (browser?.runtime?.sendMessage) {
      browser.runtime
        .sendMessage({ type: "VG_INTENT_RESPONSE_CAPTURE", payload })
        .catch(() => void 0);
    } else if (
      typeof chrome !== "undefined" &&
      chrome?.runtime?.sendMessage
    ) {
      chrome.runtime.sendMessage(
        { type: "VG_INTENT_RESPONSE_CAPTURE", payload },
        () => void chrome.runtime.lastError
      );
    }
  } catch {}
  if (latest.hash) {
    lastAssistantHashByHost.set(entry.host, latest.hash);
  }
  cleanupPendingCapture(entry.intentMessageId);
}

function scheduleResponseCapture({
  composerId,
  intentMessageId,
  sourceHost,
}) {
  if (!intentMessageId) return;
  const host =
    typeof sourceHost === "string" && sourceHost
      ? sourceHost.toLowerCase()
      : (location?.hostname || "").toLowerCase();
  if (!host) return;
  if (!isChatGptHost(host)) return;

  const baseline = getLatestAssistantReply(host);
  const baselineHash =
    baseline?.hash || lastAssistantHashByHost.get(host) || null;
  if (baseline?.hash) {
    lastAssistantHashByHost.set(host, baseline.hash);
  }

  const entry = {
    host,
    composerId: composerId || null,
    intentMessageId,
    baselineHash,
    lastHash: baseline?.hash || baselineHash || null,
    stableCount: 0,
    attempts: 0,
    timer: null,
    cancelled: false,
  };

  cleanupPendingCapture(intentMessageId);
  pendingResponseCaptures.set(intentMessageId, entry);

  const poll = () => {
    if (entry.cancelled) return;
    const latest = getLatestAssistantReply(entry.host);
    if (latest && latest.hash) {
      if (latest.hash === entry.lastHash) {
        entry.stableCount += 1;
      } else {
        entry.lastHash = latest.hash;
        entry.stableCount = 1;
      }
      if (
        latest.hash !== entry.baselineHash &&
        latest.text &&
        latest.text.length >= RESPONSE_MIN_LENGTH &&
        entry.stableCount >= RESPONSE_STABLE_COUNT
      ) {
        submitResponseCapture(entry, latest);
        return;
      }
    }

    entry.attempts += 1;
    if (entry.attempts >= RESPONSE_MAX_ATTEMPTS) {
      cleanupPendingCapture(entry.intentMessageId);
      return;
    }

    entry.timer = setTimeout(poll, RESPONSE_POLL_INTERVAL_MS);
  };

  entry.timer = setTimeout(poll, RESPONSE_POLL_INTERVAL_MS);
}

function cloneSnapshot(record) {
  if (!record) return null;
  const trimmed = String(record?.trimmedText || record?.text || "").trim();
  if (!trimmed) return null;
  const segments = Array.isArray(record?.segments)
      ? record.segments
          .filter(
            (seg) =>
              seg &&
              typeof seg.text === "string" &&
              seg.text.trim().length > 0
          )
          .map((seg) => ({
            text: seg.text,
            start: typeof seg.start === "number" ? seg.start : 0,
            end: typeof seg.end === "number" ? seg.end : 0,
          }))
      : [];
  if (!segments.length) return null;
  const composerId =
    typeof record?.composerId === "string" ? record.composerId : null;
  const conversationId =
    typeof record?.conversationId === "string" ? record.conversationId : null;
  const intentMessageId =
    typeof record?.intentMessageId === "string" ? record.intentMessageId : null;
  return {
    rawText: record.text || trimmed,
    trimmedText: trimmed,
    segments,
    isRichText: !!record.isRichText,
    composerId,
    conversationId,
    intentMessageId,
  };
}

function captureIntentSnapshot(reason = "send") {
  try {
    const tracker = window.__VG?.intentTracker;
    if (!tracker || !tracker.last) return;
    const record = tracker.last;
    const snapshot = cloneSnapshot(record);
    if (!snapshot) return;

    const key = `${snapshot.trimmedText}::${snapshot.segments.length}`;
    const now = Date.now();
    if (
        tracker.lastSentKey === key &&
        now - (tracker.lastSentAt || 0) < 1500
      ) {
        return;
      }

      tracker.lastSentKey = key;
      tracker.lastSentAt = now;

      const payload = {
        reason,
        rawText: snapshot.rawText,
        trimmedText: snapshot.trimmedText,
      intentSegments: snapshot.segments,
      isRichText: snapshot.isRichText,
      sourceUrl: location?.hostname ? location.hostname : null,
      capturedAt: new Date().toISOString(),
      tokenCount: estimateTokensApprox(snapshot.trimmedText),
      composerId: snapshot.composerId || null,
      conversationId: snapshot.conversationId || null,
    };

    if (browser?.runtime?.sendMessage) {
      browser.runtime
        .sendMessage({ type: "VG_INTENT_CAPTURE", payload })
        .then((resp) => {
          if (
            resp &&
            resp.ok &&
            resp.id &&
            typeof resp.id === "string" &&
            record
          ) {
            record.intentMessageId = resp.id;
            record.intentCapturedAt = resp?.capturedAt || payload.capturedAt;
            record.sourceHost = payload.sourceUrl || null;
            if (tracker.cache && record.composer) {
              tracker.cache.set(record.composer, record);
            }
            scheduleResponseCapture({
              composerId: snapshot.composerId || null,
              intentMessageId: resp.id,
              sourceHost: payload.sourceUrl || null,
            });
          }
        })
        .catch(() => void 0);
    } else if (
      typeof chrome !== "undefined" &&
      chrome?.runtime?.sendMessage
    ) {
      chrome.runtime.sendMessage(
        { type: "VG_INTENT_CAPTURE", payload },
        (resp) => {
          void chrome.runtime.lastError;
          if (
            resp &&
            resp.ok &&
            resp.id &&
            typeof resp.id === "string" &&
            record
          ) {
            record.intentMessageId = resp.id;
            record.intentCapturedAt = resp?.capturedAt || payload.capturedAt;
            record.sourceHost = payload.sourceUrl || null;
            if (tracker.cache && record.composer) {
              tracker.cache.set(record.composer, record);
            }
            scheduleResponseCapture({
              composerId: snapshot.composerId || null,
              intentMessageId: resp.id,
              sourceHost: payload.sourceUrl || null,
            });
          }
        }
      );
    }
  } catch (err) {
    console.debug("[VG] intent capture emit failed", err);
  }
}

  function labelOf(el) {
    if (!el) return "";
    return (
      el.getAttribute?.("aria-label") ||
      el.getAttribute?.("data-tooltip") ||
      el.innerText ||
      el.textContent ||
      ""
    )
      .trim()
      .toLowerCase();
  }

  function looksLikeSend(text) {
    return /\b(send|ask|submit|run|create|generate)\b/i.test(text || "");
  }

  function findSendButtonFromEvent(ev) {
    const path = (ev.composedPath && ev.composedPath()) || [];
    for (const node of path) {
      if (!(node instanceof Element)) continue;
      if (!node.matches) continue;
      if (
        node.matches(
          'button,[role="button"],input[type="submit"],[aria-label],[data-testid]'
        )
      ) {
        const label = labelOf(node);
        if (looksLikeSend(label)) return node;
      }
    }
    return null;
  }

  const keydownHandler = (event) => {
    if (event.defaultPrevented) return;
    if (event.key !== "Enter") return;
    if (event.shiftKey || event.altKey) return;
    const wantsCtrl = event.ctrlKey || event.metaKey;
    // allow ctrl/cmd enter to fall through (common "send" shortcut) → still capture
    captureIntentSnapshot("key");
  };

  const clickHandler = (event) => {
    const button = findSendButtonFromEvent(event);
    if (!button) return;
    captureIntentSnapshot("click");
  };

  const submitHandler = () => {
    captureIntentSnapshot("submit");
  };

  function installListeners() {
    if (window.__VG_INTERCEPT_INSTALLED__) return;
    window.__VG_INTERCEPT_INSTALLED__ = true;
    document.addEventListener("keydown", keydownHandler, true);
    document.addEventListener("click", clickHandler, true);
    document.addEventListener("submit", submitHandler, true);
  }

  function removeListeners() {
    if (!window.__VG_INTERCEPT_INSTALLED__) return;
    window.__VG_INTERCEPT_INSTALLED__ = false;
    document.removeEventListener("keydown", keydownHandler, true);
    document.removeEventListener("click", clickHandler, true);
    document.removeEventListener("submit", submitHandler, true);
  }

  window.__VG_INSTALL_INTERCEPT = () => {
    removeListeners();
    if (!window.__VG_DISABLE_SEND_INTERCEPT) {
      installListeners();
    }
  };

  installListeners();
})();
