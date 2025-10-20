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

  const SUPABASE_URL = "https://auudkltdkakpnmpmddaj.supabase.co";
  const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dWRrbHRka2FrcG5tcG1kZGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDA3NTYsImV4cCI6MjA3MTI3Njc1Nn0.ukDpH6EXksctzWHMSdakhNaWbgFZ61UqrpvzwTy03ho";
  const MAX_LEGACY_INTENT_TEXT = 5000;

  function estimateTokensApprox(text) {
    const clean = String(text || "").trim();
    if (!clean) return 0;
    const words = clean.split(/\s+/).filter(Boolean).length;
    const chars = clean.length;
    const approx = Math.max(words, Math.round(chars / 4));
    return approx || 0;
  }

  function sendRuntimeMessage(message) {
    if (typeof browser !== "undefined" && browser?.runtime?.sendMessage) {
      return browser.runtime.sendMessage(message);
    }
    if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage) {
      return new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(message, (resp) => {
            const err = chrome.runtime.lastError;
            if (err) {
              reject(new Error(err.message || String(err)));
              return;
            }
            resolve(resp);
          });
        } catch (err) {
          reject(err);
        }
      });
    }
    return Promise.reject(new Error("NO_RUNTIME"));
  }

  async function sendRuntimeMessageSafe(message) {
    try {
      return await sendRuntimeMessage(message);
    } catch (err) {
      if (INTERCEPT_DEBUG) {
        console.warn("[VG] runtime message failed", err);
      }
      return null;
    }
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
  if (INTERCEPT_DEBUG) {
    console.debug("[VG][intent] response capture ready", {
      intentMessageId: entry.intentMessageId,
      host: entry.host,
      length: excerpt.length,
    });
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
  if (INTERCEPT_DEBUG) {
    console.debug("[VG][intent] schedule response capture", {
      intentMessageId,
      sourceHost,
    });
  }
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
      if (INTERCEPT_DEBUG) {
        console.debug("[VG][intent] poll assistant", {
          intentMessageId: entry.intentMessageId,
          hash: latest.hash,
          length: latest.text?.length || 0,
          stableCount: entry.stableCount,
        });
      }
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

  function finalizeIntentCaptureResult(
    record,
    tracker,
    snapshot,
    payload,
    meta
  ) {
    if (!meta || !meta.id) return;
    if (record) {
      record.intentMessageId = meta.id;
      record.intentCapturedAt = meta.capturedAt || payload.capturedAt;
      record.sourceHost = meta.sourceUrl || payload.sourceUrl || null;
      if (tracker.cache && record.composer) {
        tracker.cache.set(record.composer, record);
      }
    }
    scheduleResponseCapture({
      composerId: snapshot.composerId || null,
      intentMessageId: meta.id,
      sourceHost: meta.sourceUrl || payload.sourceUrl || null,
    });
  }

  function trimIntentPayloadForLegacy(payload) {
    if (!payload) return payload;
    const trimmed = { ...payload };
    if (
      typeof trimmed.rawText === "string" &&
      trimmed.rawText.length > MAX_LEGACY_INTENT_TEXT
    ) {
      trimmed.rawText = trimmed.rawText.slice(0, MAX_LEGACY_INTENT_TEXT);
    }
    if (
      typeof trimmed.trimmedText === "string" &&
      trimmed.trimmedText.length > MAX_LEGACY_INTENT_TEXT
    ) {
      trimmed.trimmedText = trimmed.trimmedText.slice(
        0,
        MAX_LEGACY_INTENT_TEXT
      );
    }
    if (Array.isArray(trimmed.intentSegments)) {
      trimmed.intentSegments = trimmed.intentSegments
        .slice(0, 25)
        .map((seg) => {
          if (!seg || typeof seg !== "object") return null;
          const next = { ...seg };
          if (typeof next.text === "string") {
            next.text = next.text.slice(0, MAX_LEGACY_INTENT_TEXT);
          }
          return next;
        })
        .filter(Boolean);
    }
    return trimmed;
  }

  async function legacyIntentCapture(payload, record, tracker, snapshot) {
    const safePayload = trimIntentPayloadForLegacy(payload);
    const resp = await sendRuntimeMessageSafe({
      type: "VG_INTENT_CAPTURE",
      payload: safePayload,
    });
    if (
      resp &&
      resp.ok &&
      resp.id &&
      typeof resp.id === "string"
    ) {
      finalizeIntentCaptureResult(record, tracker, snapshot, safePayload, {
        id: resp.id,
        capturedAt: resp.capturedAt || safePayload.capturedAt,
        sourceUrl: safePayload.sourceUrl || null,
      });
    }
  }

  async function uploadIntentViaRest(payload) {
    try {
      const sessionResp = await sendRuntimeMessageSafe({
        type: "GET_SESSION",
      });
      const session = sessionResp?.status || {};
      const isSignedIn = session?.signedIn === true;
      const token =
        isSignedIn && typeof session?.access_token === "string"
          ? session.access_token
          : null;
      const userId =
        isSignedIn && typeof session?.userId === "string"
          ? session.userId
          : null;
      if (!token || !userId) {
        if (INTERCEPT_DEBUG) {
          console.warn("[VG] intent REST skipped (no user session)", {
            signedIn: session?.signedIn ?? null,
            hasToken: Boolean(session?.access_token),
            hasUserId: Boolean(session?.userId),
          });
        }
        return null;
      }

      const insertRow = {
        user_id: userId,
        conversation_id: payload.conversationId || null,
        source_url: payload.sourceUrl || null,
        captured_at: payload.capturedAt,
        raw_text: payload.rawText,
        intent_segments: payload.intentSegments || [],
        token_count: payload.tokenCount ?? null,
        is_rich_text: !!payload.isRichText,
        params:
          typeof payload.params === "object" && payload.params
            ? payload.params
            : null,
      };

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/intent_messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${token}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify(insertRow),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`REST insert failed (${resp.status}): ${text}`);
      }

      const rows = await resp.json().catch(() => null);
      if (Array.isArray(rows) && rows[0]?.intent_message_id) {
        return rows[0];
      }
      return null;
    } catch (err) {
      if (INTERCEPT_DEBUG) {
        console.warn("[VG] intent REST insert failed", err);
      }
      return null;
    }
  }

  async function sendIntentCapture(payload, record, tracker, snapshot) {
    const restRow = await uploadIntentViaRest(payload);
    if (restRow && restRow.intent_message_id) {
      const meta = {
        id: restRow.intent_message_id,
        capturedAt: restRow.captured_at || payload.capturedAt,
        sourceUrl: restRow.source_url || payload.sourceUrl || null,
      };
      finalizeIntentCaptureResult(record, tracker, snapshot, payload, meta);
      await sendRuntimeMessageSafe({
        type: "VG_INTENT_CAPTURE_META",
        payload: {
          intentMessageId: meta.id,
          capturedAt: meta.capturedAt,
          sourceUrl: meta.sourceUrl,
          tokenCount: payload.tokenCount ?? null,
        },
      });
      return;
    }

    await legacyIntentCapture(payload, record, tracker, snapshot);
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

    sendIntentCapture(payload, record, tracker, snapshot);
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
