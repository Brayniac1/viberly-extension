// background.js (MV3 service worker)

importScripts("./vendor/browser-polyfill.js");
importScripts("./vendor/supabase.umd.js");

// ---- Debug flag ----
const DEBUG = false;
function dbg(...args) {
  if (DEBUG) console.log(...args);
}
function dbgWarn(...args) {
  if (DEBUG) console.warn(...args);
}
function dbgDebug(...args) {
  if (DEBUG) console.debug(...args);
}

// ---- Viberly logger (quiet by default; runtime toggle via browser.storage.local.VG_LOG_LEVEL) ----
let VG_LOG_LEVEL = "info"; // 'silent' | 'error' | 'warn' | 'info' | 'debug'
try {
  browser.storage.local.get("VG_LOG_LEVEL", (o) => {
    if (typeof o?.VG_LOG_LEVEL === "string") VG_LOG_LEVEL = o.VG_LOG_LEVEL;
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.VG_LOG_LEVEL) {
      VG_LOG_LEVEL = changes.VG_LOG_LEVEL.newValue || "error";
    }
  });
} catch {}
const __LV = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const __ok = (lvl) => (__LV[lvl] ?? 0) <= (__LV[VG_LOG_LEVEL] ?? 1);
const vgErr = (...a) => {
  if (__ok("error")) console.error("[VG]", ...a);
};
const vgWarn = (...a) => {
  if (__ok("warn")) console.warn("[VG]", ...a);
};
const vgInfo = (...a) => {
  if (__ok("info")) console.info("[VG]", ...a);
};
const vgDebug = (...a) => {
  if (__ok("debug")) console.debug("[VG]", ...a);
};

// Initial load message (debug-only)
dbg("Viberly background loaded");

// Load Supabase UMD bundle (exposes global `supabase`)

// ---- Config ----
const VG_SUPABASE_URL = "https://auudkltdkakpnmpmddaj.supabase.co";

const VG_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dWRrbHRka2FrcG5tcG1kZGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDA3NTYsImV4cCI6MjA3MTI3Njc1Nn0.ukDpH6EXksctzWHMSdakhNaWbgFZ61UqrpvzwTy03ho";
// -----------------

function estimateTokenCount(text) {
  const clean = String(text || "").trim();
  if (!clean) return 0;
  const words = clean.split(/\s+/).filter(Boolean).length;
  const chars = clean.length;
  const approx = Math.max(words, Math.round(chars / 4));
  return approx > 0 ? approx : 0;
}

function normalizeSourceHost(input) {
  if (!input) return null;
  try {
    const lower = String(input).trim().toLowerCase();
    if (!lower) return null;
    if (/^https?:\/\//.test(lower)) {
      return new URL(lower).hostname.replace(/^www\./, "");
    }
    return lower.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const RESPONSE_EXCERPT_MAX = 1500;

function sanitizeResponseExcerpt(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function truncateResponseExcerpt(text) {
  if (text.length <= RESPONSE_EXCERPT_MAX) return text;
  return `${text.slice(0, RESPONSE_EXCERPT_MAX - 1).trimEnd()}…`;
}

function hashString(str) {
  const value = String(str || "");
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return hash.toString(16);
}

function normalizeTaskLabel(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSimilarity(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AI_ENHANCE_PLAN_LIMITS = {
  free: { total: 5, month: null },
  basic: { total: null, month: 5 },
  pro: { total: null, month: null },
  default: { total: 5, month: null },
};

function __triggerAiEnhancePaywall(tabId, meta) {
  try {
    const payload = {
      reason: "ai_enhance_limit",
      tier: meta?.tier || null,
      total_used: meta?.total_used ?? null,
      month_used: meta?.month_used ?? null,
      month_reset: meta?.month_reset ?? null,
    };
    if (tabId) {
      browser.tabs
        .sendMessage(tabId, {
          type: "VG_PAYWALL_SHOW",
          payload,
        })
        .catch(() => void browser.runtime.lastError);
    } else {
      browser.tabs
        .query({ active: true, currentWindow: true })
        .then(([tab]) => {
          if (!tab?.id) return;
          browser.tabs
            .sendMessage(tab.id, {
              type: "VG_PAYWALL_SHOW",
              payload,
            })
            .catch(() => void browser.runtime.lastError);
        })
        .catch(() => void browser.runtime.lastError);
    }
  } catch {}
}

function tokenize(text) {
  return normalizeForSimilarity(text)
    .split(" ")
    .filter(Boolean);
}

function jaccardSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

function promptSimilarity(aTitle, aBody, bTitle, bBody) {
  const aTokens = tokenize(`${aTitle || ""} ${aBody || ""}`);
  const bTokens = tokenize(`${bTitle || ""} ${bBody || ""}`);
  return jaccardSimilarity(aTokens, bTokens);
}

// ===== Only talk to tabs where Viberly actually runs (mirror content_scripts.matches) =====
const VG_ALLOWED_URLS = [
  "*://lovable.dev/*",
  "*://*.lovable.dev/*",
  "*://*.replit.com/*",
  "*://bolt.new/*",
  "*://*.cursor.so/*",
  "https://cursor.com/*",
  "*://*.codeium.com/*",
  "*://*.sourcegraph.com/*",
  "*://*.windsurf.ai/*",
  "*://*.mutable.ai/*",
  "*://aider.chat/*",
  "*://*.tabnine.com/*",
  "*://*.base44.com/*",
  "*://*.airtable.com/*",
  "https://airtable.com/*",
  "*://v0.dev/*",
  "*://v0.app/*",
  "https://vercel.com/v0/*",
  "https://github.com/copilot-workspace/*",
  "https://githubnext.com/*",
  "https://chatgpt.com/*",
  "https://*.chatgpt.com/*",
  "https://chat.openai.com/*",
  "*://gemini.google.com/*",
  "*://runwayml.com/*",
  "*://*.runwayml.com/*",
  "*://sora.chatgpt.com/*",
  "*://*.sora.chatgpt.com/*",
  "*://*.perplexity.ai/*",
  "https://perplexity.ai/*",
  "https://claude.ai/*", // Claude-only content_script block also runs here
  "https://www.canva.com/ai",
  "https://www.canva.com/ai/*",
  "https://grok.com/*",
  "https://canva.com/ai",
  "https://canva.com/ai/*",
  "*://bubble.io/*",
  "*://*.bubble.io/*",
  "https://midjourney.com/*",
  "https://chat.deepseek.com/*",
  "https://x.ai/*",
  "https://chat.deepseek.com/*",
  "https://aistudio.google.com/*",
  "https://lindy.ai/*",
  "https://www.lindy.ai/*",
  "https://chat.lindy.ai/*",
  "https://figma.com/*",
  "https://www.figma.com/*",
  "https://chat.mistral.ai/*",
  "https://app.heygen.com/*",
  "https://dream-machine.lumalabs.ai/*",
  "https://www.notion.so/*",
  "https://higgsfield.ai/*",
  "https://www.framer.com/*",
  "https://gamma.app/*",
  "https://pika.art/*",
  "https://app.clickup.com/*",
  "https://zapier.com/*",
];

// Persist Supabase session in browser storage (MV3-safe)
const sbStorage = {
  getItem: (k) => browser.storage.local.get([k]).then((o) => o?.[k] ?? null),

  setItem: (k, v) => browser.storage.local.set({ [k]: v }),

  removeItem: (k) => browser.storage.local.remove([k]),
};

// Create Supabase client (uses browser storage so session survives service-worker sleep)
const client = supabase.createClient(VG_SUPABASE_URL, VG_SUPABASE_ANON_KEY, {
  auth: {
    storage: sbStorage, // ← IMPORTANT: persist in browser.storage.local
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch },
});

// ---- Admin controls (remote-config style knobs) ----
const ADMIN_CONTROL_DEFAULTS = {
  intent_window_batch_threshold: 3,
  auto_generated_guard_activation_version: 3,
};

const ADMIN_CONTROLS_REFRESH_MS = 5 * 60 * 1000;

const adminControlsState = {
  values: { ...ADMIN_CONTROL_DEFAULTS },
  loadedAt: 0,
  pending: null,
};

function normalizeAdminControlNumber(key, value) {
  const fallback = ADMIN_CONTROL_DEFAULTS[key];
  const parsed =
    typeof value === "number"
      ? value
      : value != null
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const min = key === "intent_window_batch_threshold" ? 1 : 0;
  const coerced = Math.max(min, Math.round(parsed));
  return Number.isFinite(coerced) ? coerced : fallback;
}

async function refreshAdminControls(force = false) {
  const now = Date.now();
  if (!force && adminControlsState.pending) {
    try {
      await adminControlsState.pending;
    } catch {
      return adminControlsState.values;
    }
    return adminControlsState.values;
  }
  if (!force && now - adminControlsState.loadedAt < ADMIN_CONTROLS_REFRESH_MS) {
    return adminControlsState.values;
  }
  const task = (async () => {
    try {
      const { data, error } = await client
        .from("admin-controls")
        .select("key,value");
      if (error) {
        vgWarn?.("[VG][admin-controls] fetch failed", error);
        return adminControlsState.values;
      }
      if (Array.isArray(data)) {
        for (const row of data) {
          const key = row?.key;
          if (!(key in ADMIN_CONTROL_DEFAULTS)) continue;
          adminControlsState.values[key] = normalizeAdminControlNumber(
            key,
            row?.value
          );
        }
        adminControlsState.loadedAt = Date.now();
      }
    } catch (err) {
      vgWarn?.("[VG][admin-controls] fetch exception", err);
    } finally {
      adminControlsState.pending = null;
    }
    return adminControlsState.values;
  })();
  adminControlsState.pending = task;
  return task
    .catch(() => adminControlsState.values)
    .then(() => adminControlsState.values);
}

function getAdminControlValue(key) {
  if (!(key in ADMIN_CONTROL_DEFAULTS)) {
    return undefined;
  }
  const now = Date.now();
  if (now - adminControlsState.loadedAt > ADMIN_CONTROLS_REFRESH_MS) {
    refreshAdminControls().catch(() => {});
  }
  const value = adminControlsState.values[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return ADMIN_CONTROL_DEFAULTS[key];
}

refreshAdminControls(true).catch(() => {});

// ---------- Access Gate v1 (Teams) ----------
// Source of truth: vg_profiles.team_id → teams.subscription_status
// Allow: 'active', 'trialing'  |  Block: 'trial_expired','past_due','canceled','expired'
const VG_ACCESS_STORAGE_KEY = "vg__access_status_v1";
const __VG_ALLOW_TEAM_STATES = new Set(["active", "trialing"]);

async function __vgSetAccessSnapshot(snap) {
  try {
    await browser.storage.local.set({ [VG_ACCESS_STORAGE_KEY]: snap });
  } catch {}
  return snap;
}

async function __vgGetAccessSnapshotCached() {
  try {
    const obj = await browser.storage.local.get(VG_ACCESS_STORAGE_KEY);
    return obj?.[VG_ACCESS_STORAGE_KEY] || { blocked: false, team: null };
  } catch {
    return { blocked: false, team: null };
  }
}

const __VG_ALLOWED_WHEN_BLOCKED = new Set([
  "ACCESS_STATUS",
  "ACCESS_RECHECK",
  "AUTH_STATUS",
  "GET_STATUS",
  "AUTH_REDIRECT",
  "SET_SESSION",
  "SIGN_OUT",
  "OPEN_POPUP",
  "VG_DEBUG:SESSION_SNAPSHOT",
  "VG_DEBUG:LOAD_SETTINGS",
  "VG_DEBUG:PROFILE",
  "VG_DEBUG:GUARDS_COUNT",
  "VG_DEBUG:FAVS_COUNT",
  "VG_DEBUG:DUMP_USER_DATA",
  "VG_DEBUG:CONFIG",
  "TEAM_CHECKOUT_START", // conditionally allowed (trial_expired + admin)
  "VG_CAPTURE_VISIBLE_TAB", // screenshot allowed
  "COUNTER_HANDSHAKE", // allow handshake while gated
  "USAGE_TEST_INGEST", // one-shot ingest probe while gated
  "VG_USAGE_BATCH", // ✅ allow batched usage events from page
  "VG_INTENT_CAPTURE",
  "VG_INTENT_RESPONSE_CAPTURE",
]);

async function __vgGateIfBlocked(type, sender) {
  try {
    // Quick read of the last snapshot
    let snap = await __vgGetAccessSnapshotCached();

    // For checkout, ALWAYS use a fresh snapshot and only allow when team trial_expired + admin
    if (type === "TEAM_CHECKOUT_START") {
      snap = await __vgComputeAccessSnapshot();
      const isTeam = snap?.team === true;
      const status = String(snap?.team_status || "");
      const isAdmin = snap?.admin_is_me === true;

      if (isTeam && status === "trial_expired" && isAdmin) return null; // allow switch-case
      try {
        await browser.browserAction.openPopup();
      } catch (_) {}
      return { ok: false, reason: isTeam ? "TEAM_BLOCKED" : "INDIV_BLOCKED" };
    }

    const isBlocked = snap?.blocked === true; // ← block regardless of team/individual
    const isTeam = snap?.team === true;

    if (!isBlocked) return null;

    // Always allow these while blocked (status, auth, debug, etc.)
    if (
      __VG_ALLOWED_WHEN_BLOCKED.has(type) ||
      String(type || "").startsWith("VG_DEBUG:")
    ) {
      return null;
    }

    // Block: open popup and stop the message
    try {
      browser.browserAction.openPopup();
    } catch (_) {}
    return { ok: false, reason: isTeam ? "TEAM_BLOCKED" : "INDIV_BLOCKED" };
  } catch (e) {
    console.warn("[BG] __vgGateIfBlocked error:", e);
    return null;
  }
}

// Compute and cache access snapshot for the current session user
async function __vgComputeAccessSnapshot() {
  const nowIso = new Date().toISOString();
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user?.id) {
      console.debug("[VG][access] no session → allow");
      return __vgSetAccessSnapshot({
        blocked: false,
        team: null,
        reason: null,
        last_checked: nowIso,
      });
    }
    const uid = session.user.id;

    // 1) Profile → team_id (+ user_type, subscription_status)
    let teamId = null;
    let prof = null;
    const profRes = await client
      .from("vg_profiles")
      .select("user_id, team_id, user_type, subscription_status")
      .eq("user_id", uid)
      .single();
    if (profRes?.error) {
      console.warn("[VG][access] vg_profiles select error:", profRes.error);
    } else {
      prof = profRes.data || null;
      teamId = prof?.team_id || null;
    }

    // Fallback: if profile.team_id missing, treat as admin-owned team (common during setup)
    if (!teamId) {
      const adminTeam = await client
        .from("teams")
        .select("id")
        .eq("admin_user_id", uid)
        .limit(1)
        .maybeSingle();
      if (adminTeam?.data?.id) {
        teamId = adminTeam.data.id;
        console.debug("[VG][access] fallback admin-owned team found:", teamId);
      }
    }

    // Individual (no team) → compute by individual subscription_status
    if (!teamId) {
      const utype = String(prof?.user_type || "").toLowerCase();
      const ustat = String(prof?.subscription_status || "").toLowerCase();

      if (
        utype === "individual" &&
        (ustat === "past_due" || ustat === "canceled")
      ) {
        const redirect = `https://viberly.ai/individual/subscription-expired?status=${ustat}`;
        console.debug("[VG][access] individual blocked →", {
          status: ustat,
          redirect,
        });

        return __vgSetAccessSnapshot({
          blocked: true,
          team: false, // NOT a team block
          indiv: true, // helper flag for popup
          indiv_status: ustat, // 'past_due' | 'canceled'
          indiv_redirect: redirect,
          reason: "individual_subscription_block",
          last_checked: nowIso,
        });
      }

      // Allow free/active (or unknown) individuals
      console.debug("[VG][access] individual allowed →", {
        status: ustat || "unknown",
      });
      return __vgSetAccessSnapshot({
        blocked: false,
        team: false,
        reason: null,
        last_checked: nowIso,
      });
    }

    // 2) Team → status/name/admin
    const teamRes = await client
      .from("teams")
      .select("id, name, admin_user_id, subscription_status, seats_purchased")
      .eq("id", teamId)
      .single();

    if (teamRes?.error) {
      console.warn("[VG][access] teams select error:", teamRes.error);
      // Conservative default for team users when we cannot verify: show blocked notice
      return __vgSetAccessSnapshot({
        blocked: true,
        team: true,
        team_id: teamId,
        team_name: null,
        team_status: "unknown",
        admin: { user_id: null, name: null },
        reason: "fetch_error",
        last_checked: nowIso,
      });
    }

    const team = teamRes.data;
    const status = String(team?.subscription_status || "").toLowerCase();
    const blocked = !__VG_ALLOW_TEAM_STATES.has(status);

    // 3) Admin name (optional nicety, stays inside vg_profiles)
    let adminName = null;
    try {
      const ap = await client
        .from("vg_profiles")
        .select("display_name")
        .eq("user_id", team.admin_user_id)
        .single();
      adminName = ap?.data?.display_name || null;
    } catch {}

    const snap = {
      blocked,
      team: true,
      team_id: team.id,
      team_name: team.name || null,
      team_status: status, // 'trialing' | 'active' | 'trial_expired' | 'past_due' | 'canceled' | 'expired'
      admin: { user_id: team.admin_user_id, name: adminName },
      admin_is_me: team.admin_user_id === uid,
      team_seats_purchased:
        Number.isFinite(+team.seats_purchased) && +team.seats_purchased >= 5
          ? +team.seats_purchased
          : 5,
      reason: blocked ? "team_subscription_block" : null,
      last_checked: nowIso,
    };

    dbgDebug("[VG][access] snapshot:", snap);
    return __vgSetAccessSnapshot(snap);
  } catch (e) {
    console.warn("[VG][access] compute error:", e);
    return __vgSetAccessSnapshot({
      blocked: false,
      team: null,
      reason: "compute_exception",
      error: String(e?.message || e),
      last_checked: nowIso,
    });
  }
}

// ---------- Minimal Session Hub (single source of truth) ----------
const VG_STORAGE_KEY = "VG_SESSION";
let VG_SESSION = null; // { access_token, refresh_token, expires_at, userId?, email? }

async function __bgLoadSession() {
  try {
    const obj = await browser.storage.local.get(VG_STORAGE_KEY);
    VG_SESSION = obj[VG_STORAGE_KEY] || null;
  } catch {}
}
async function __bgSaveSession(sess) {
  VG_SESSION = sess || null;
  try {
    await browser.storage.local.set({ [VG_STORAGE_KEY]: VG_SESSION });
  } catch {}
}
function __bgSnapshot() {
  const s = VG_SESSION;
  const signedIn = !!(
    s?.access_token &&
    s?.refresh_token &&
    Number.isFinite(s?.expires_at)
  );
  return {
    signedIn,
    access_token: s?.access_token || null,
    refresh_token: s?.refresh_token || null,
    userId: s?.userId || null,
    email: s?.email || null,
    expires_at: s?.expires_at || null,
  };
}

// ===== Reconcile SoT (VG_SESSION) into Supabase client =====
function __vgValidSess(s) {
  return !!(
    s &&
    s.access_token &&
    s.refresh_token &&
    Number.isFinite(s.expires_at)
  );
}
async function __bgAdoptSoTIntoClient() {
  try {
    if (__vgValidSess(VG_SESSION)) {
      const { access_token, refresh_token } = VG_SESSION;
      await client.auth.setSession({ access_token, refresh_token });
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        if (session?.user?.id) {
          const next = {
            access_token,
            refresh_token,
            expires_at: VG_SESSION.expires_at,
            userId: session.user.id || VG_SESSION.userId || null,
            email: session.user.email || VG_SESSION.email || null,
          };
          const fingerprint =
            VG_SESSION?.access_token?.slice(0, 12) +
            "." +
            VG_SESSION?.refresh_token?.slice(0, 12) +
            "." +
            VG_SESSION?.expires_at;
          const nextFingerprint =
            next.access_token.slice(0, 12) +
            "." +
            next.refresh_token.slice(0, 12) +
            "." +
            next.expires_at;
          if (nextFingerprint !== fingerprint) {
            await __bgSaveSession(next);
          } else if (!VG_SESSION.userId || !VG_SESSION.email) {
            await __bgSaveSession(next);
          }
        }
      } catch {}
      __VG_SIGNED_IN = true;
    } else {
      try {
        await client.auth.signOut();
      } catch {}
      __VG_SIGNED_IN = false;
    }
  } catch {
    __VG_SIGNED_IN = false;
  }
}

// 🔧 Enhanced session validation and refresh
async function __bgValidateAndRefreshSession() {
  try {
    if (!__vgValidSess(VG_SESSION)) return;

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = VG_SESSION.expires_at;

    // If token expires within 5 minutes, try to refresh
    if (expiresAt && expiresAt - now < 300) {
      console.log("[BG] Token expiring soon, attempting refresh...");

      try {
        const { data, error } = await client.auth.refreshSession();
        if (error) {
          console.warn("[BG] Token refresh failed:", error);
          // Clear invalid session
          await __bgSaveSession(null);
          await __bgAdoptSoTIntoClient();
          await __vgBroadcastAuth(false);
          return;
        }

        if (data?.session) {
          console.log("[BG] Token refreshed successfully");
          await __bgSaveSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
            userId: data.session.user?.id || VG_SESSION.userId,
            email: data.session.user?.email || VG_SESSION.email,
          });
          await __bgAdoptSoTIntoClient();
          await __vgBroadcastAuth(true);
        }
      } catch (e) {
        console.warn("[BG] Token refresh error:", e);
        // Clear invalid session
        await __bgSaveSession(null);
        await __bgAdoptSoTIntoClient();
        await __vgBroadcastAuth(false);
      }
    }
  } catch (e) {
    console.warn("[BG] Session validation error:", e);
  }
}

// --- auth cache for fast replies to content/popup ---
let __VG_SIGNED_IN = false;

// --- Team Prompts (cache) ---
let __vgTeamPromptsCache = { ts: 0, rows: [], uid: null };
const __VG_TEAM_TTL_MS = 5 * 60 * 1000; // 5 minutes

// initialize once on worker start — SoT first, then adopt into client
(async () => {
  await __bgLoadSession();
  await __bgAdoptSoTIntoClient();
  await __vgComputeAccessSnapshot(); // ← compute team access snapshot on worker start
  try {
    await __vgBroadcastAuth(__VG_SIGNED_IN);
  } catch (error) {
    console.warn("[BG] __vgBroadcastAuth error:", error);
  } // ← rebroadcast on boot

  // 🔧 Enhanced session restoration: validate and refresh tokens if needed
  await __bgValidateAndRefreshSession();
})();

// Keep access snapshot fresh on SW lifecycle events
try {
  browser.runtime.onStartup?.addListener(() => {
    __vgComputeAccessSnapshot();
    __bgValidateAndRefreshSession(); // Also validate session on startup
  });
  browser.runtime.onInstalled?.addListener(() => {
    __vgComputeAccessSnapshot();
    __bgValidateAndRefreshSession(); // Also validate session on install
  });
} catch {}

// 🔧 Periodic session validation (every 10 minutes)
setInterval(async () => {
  try {
    await __bgValidateAndRefreshSession();
  } catch (e) {
    console.warn("[BG] Periodic session validation error:", e);
  }
}, 10 * 60 * 1000); // 10 minutes

// === AUTH redirect helpers ===
// Parse either fragment tokens (#access_token=…) or PKCE code (?code=…)
function __vgParseAuthReturn(urlStr) {
  const u = new URL(urlStr);
  const h = new URLSearchParams(u.hash.replace(/^#/, ""));
  const q = u.searchParams;

  if (h.get("access_token")) {
    return {
      flow: "implicit",
      state: h.get("state") || "",
      access_token: h.get("access_token"),
      refresh_token: h.get("refresh_token") || "",
      expires_at: Number(h.get("expires_at") || 0),
    };
  }
  if (q.get("code")) {
    return {
      flow: "code",
      state: q.get("state") || "",
      code: q.get("code"),
    };
  }
  return null;
}

// Set BG Supabase session + persist SoT + broadcast
async function __vgAdoptTokensInBG({
  access_token,
  refresh_token,
  expires_at,
}) {
  await client.auth.setSession({ access_token, refresh_token });
  const {
    data: { session },
  } = await client.auth.getSession();

  const snap = {
    access_token: session?.access_token || access_token || null,
    refresh_token: session?.refresh_token || refresh_token || null,
    expires_at: session?.expires_at || expires_at || null,
    userId: session?.user?.id || null,
    email: session?.user?.email || null,
  };

  await __bgSaveSession(snap);
  await __bgAdoptSoTIntoClient();
  __VG_SIGNED_IN = !!session?.user;
  await __vgBroadcastAuth(__VG_SIGNED_IN);
  return snap;
}

// ===== Filtered broadcast helper =====
async function __vgBroadcastAuth(signed) {
  try {
    const allowed = await browser.tabs.query({ url: VG_ALLOWED_URLS });
    const active = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    // de-dupe by id
    const byId = new Map();
    [...allowed, ...active].forEach((t) => {
      if (t?.id) byId.set(t.id, t);
    });
    const tabs = [...byId.values()];

    dbg("[BG] __vgBroadcastAuth → signedIn =", !!signed, "tabs =", tabs.length);

    for (const t of tabs) {
      browser.tabs
        .sendMessage(t.id, { type: "VG_AUTH_CHANGED", signedIn: !!signed })
        .catch(() => {}); // Simply ignore the error // browser.runtime.lastError

      browser.tabs
        .sendMessage(t.id, { type: "AUTH_STATUS_PUSH", signedIn: !!signed })
        .catch(() => {}); // Simply ignore the error // browser.runtime.lastError
    }
  } catch (e) {
    console.warn("[BG] __vgBroadcastAuth failed:", e);
  }
}

// === Host-gated session helpers (only wait on Cursor/Base44) ===
async function __vgEnsureBGSession(retries = 6, delayMs = 200) {
  for (let i = 0; i < retries; i++) {
    try {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (session?.user?.id) return session;
    } catch {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
function __vgShouldWaitForSession(host = "") {
  try {
    host = String(host).toLowerCase();
  } catch {}
  return (
    /(^|\.)cursor\.com$|(^|\.)cursor\.so$/.test(host) || // Cursor
    /(^|\.)base44\.com$|(^|\.)app\.base44\.com$/.test(host) ||
    /(^|\.)replit\.com$/.test(host) || // Replit
    /(^|\.)lovable\.dev$/.test(host) || // Lovable
    /(^|\.)bolt\.new$/.test(host) || // Bolt
    /(^|\.)v0\.app$|(^|\.)v0\.dev$/.test(host) || // V0
    /(^|\.)chatgpt\.com$|(^|\.)openai\.com$/.test(host) // ChatGPT
  );
}

async function __vgGetSessionMaybeWait(host) {
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (session?.user?.id) return session;
  } catch {}
  return __vgShouldWaitForSession(host) ? await __vgEnsureBGSession() : null;
}

// ---------- SoT-based account summary (BG reads with its token) ----------
async function __bgAccountSummary() {
  const out = {
    tier: "free",
    used: 0,
    quick: 0,
    limit: 1,
    status: "inactive",
    aiEnhanceTotal: 0,
    aiEnhanceMonth: 0,
    aiEnhanceMonthReset: null,
  };
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user?.id) return out;
    const uid = session.user.id;

    // Read ONLY from vg_profiles — DB is the source of truth
    const prof = await client
      .from("vg_profiles")
      .select(
        "tier, custom_guards_count, quick_adds_count, subscription_status, ai_enhance_total_used, ai_enhance_month_used, ai_enhance_month_reset"
      )
      .eq("user_id", uid)
      .single();

    const tier = prof?.data?.tier || "free";
    const used = Number.isFinite(prof?.data?.custom_guards_count)
      ? prof.data.custom_guards_count
      : 0;
    const quick = Number.isFinite(prof?.data?.quick_adds_count)
      ? prof.data.quick_adds_count
      : 0;
    const status = prof?.data?.subscription_status || "inactive";
    const aiEnhanceTotal = Number.isFinite(prof?.data?.ai_enhance_total_used)
      ? prof.data.ai_enhance_total_used
      : 0;
    const aiEnhanceMonth = Number.isFinite(prof?.data?.ai_enhance_month_used)
      ? prof.data.ai_enhance_month_used
      : 0;
    const aiEnhanceMonthReset =
      prof?.data?.ai_enhance_month_reset || null;

    const PLAN_LIMITS = { free: 1, basic: 3, pro: Infinity };
    const limit = PLAN_LIMITS[tier] ?? 1;

    return {
      tier,
      used,
      quick,
      limit,
      status,
      aiEnhanceTotal,
      aiEnhanceMonth,
      aiEnhanceMonthReset,
    };
  } catch (e) {
    return { ...out, error: String(e?.message || e) };
  }
}

// === Team Prompts: fresh fetch + cache accessor ===
async function __vgFetchTeamPromptsFresh() {
  // 1) session
  const {
    data: { session },
  } = await client.auth.getSession();
  const uid = session?.user?.id || null;
  if (!uid) return [];

  // 2) profile → team/individual
  const prof = await client
    .from("vg_profiles")
    .select("user_type")
    .eq("user_id", uid)
    .single();

  const t = String(prof?.data?.user_type || "").toLowerCase();
  const isTeam = t === "admin" || t === "member";
  if (!isTeam) return [];

  // 3) memberships → active team_ids
  const mem = await client
    .from("team_memberships")
    .select("team_id, status")
    .eq("user_id", uid);

  const teamIds = (mem?.data || [])
    .filter((r) => String(r.status || "").toLowerCase() === "active")
    .map((r) => r.team_id)
    .filter(Boolean);

  if (!teamIds.length) return [];

  // 4) team prompts (vg_guards)
  const sel =
    "id, title, preview, body, tags, status, updated_at, created_at, team_id, ownership_type";
  const { data, error } = await client
    .from("vg_guards")
    .select(sel)
    .in("team_id", teamIds)
    .eq("ownership_type", "team")
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error) {
    console.warn("[BG] team prompts error", error);
    return [];
  }

  return (data || []).map((r) => ({
    id: r.id,
    name: r.title || "Team Prompt",
    preview: typeof r.preview === "string" ? r.preview : null,
    body: r.body || "",
    tags: Array.isArray(r.tags) ? r.tags : [],
    status: r.status || "active",
    updatedAt: r.updated_at
      ? Date.parse(r.updated_at)
      : r.created_at
      ? Date.parse(r.created_at)
      : Date.now(),
    team_id: r.team_id,
  }));
}

async function __vgGetTeamPromptsCached(force = false) {
  // who is logged in now?
  let uid = null;
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    uid = session?.user?.id || null;
  } catch {}

  const now = Date.now();
  const sameUser = uid && __vgTeamPromptsCache.uid === uid;
  const fresh =
    !force &&
    sameUser &&
    __vgTeamPromptsCache.ts &&
    now - __vgTeamPromptsCache.ts < __VG_TEAM_TTL_MS;

  if (fresh) return __vgTeamPromptsCache.rows;

  const rows = await __vgFetchTeamPromptsFresh().catch(() => []);
  __vgTeamPromptsCache = { ts: Date.now(), rows, uid };
  return rows;
}

/**
 * Fetch Library prompts via Supabase REST (PostgREST)
 * - RLS ensures we only see status='published'
 * - We order by rank asc and cap to a generous limit
 */

async function fetchPromptsREST(filter = {}) {
  const params = new URLSearchParams();

  // ✅ Only columns that actually exist on public.prompts
  //    (NO creator_avatar here; the avatar lives in creator_profiles.avatar_url)
  // Also embed the creator's avatar_url via FK prompts.creator_id → creator_profiles.id
  params.set(
    "select",
    [
      "id",
      "name",
      "type",
      "subcategory",
      "labels",
      "prompt_text",
      "tag_line",
      "is_paid",
      "price_cents",
      "creator_id",
      "source",
      "rank",
      "updated_at",
      // PostgREST embed (inner join keeps only rows with a creator; drop !inner if you want outer)
      "creator_profiles!inner(avatar_url,display_name)",
    ].join(",")
  );

  // If your anon RLS already restricts to published, keep as-is.
  // Otherwise, force it here:
  if (!filter.status) params.set("status", "eq.published");

  params.set("order", "rank.asc");
  params.set("limit", "1000");

  // Optional filters (RLS will still enforce published if you pass it)
  if (filter.status) params.set("status", `eq.${filter.status}`);
  if (filter.type) params.set("type", `eq.${filter.type}`);
  if (filter.subcategory) params.set("subcategory", `eq.${filter.subcategory}`);
  if (filter.name) params.set("name", `eq.${filter.name}`);

  const url = `${VG_SUPABASE_URL}/rest/v1/prompts?${params.toString()}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      apikey: VG_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${VG_SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${t}`);
  }

  const rows = await resp.json();

  // Normalize shape used by settings.js
  return (rows || []).map((p) => {
    // creator_profiles can come back as an object (1–1) or array depending on PostgREST config
    const cp = p.creator_profiles;
    const avatar = Array.isArray(cp)
      ? cp[0]?.avatar_url || ""
      : cp?.avatar_url || "";

    return {
      id: p.id,
      name: p.name,
      type: p.type,
      subcategory: p.subcategory,
      labels: Array.isArray(p.labels) ? p.labels : [],
      prompt_text: p.prompt_text,
      tag_line: p.tag_line || "",
      is_paid: p.is_paid === true,
      price_cents: typeof p.price_cents === "number" ? p.price_cents : null,
      creator_id: p.creator_id || null,
      source: p.source || "",
      rank: typeof p.rank === "number" ? p.rank : 100,
      updated_at: p.updated_at,
      // 👇 this is what settings.js expects
      creator_avatar: avatar,
    };
  });
}

// === Marketplace checkout (Edge) ===
const PROMPT_CHECKOUT_URL = `${VG_SUPABASE_URL}/functions/v1/create-prompt-checkout`;

// Default redirect for password reset (your hosted page handles new password)
const RESET_PASSWORD_REDIRECT = "https://viberly.ai/reset-password";

// === AI Chat · Supabase Edge calls ===
const AI_SEND_URL = `${VG_SUPABASE_URL}/functions/v1/ai-chat-send`;
const AI_SUMMARIZE_URL = `${VG_SUPABASE_URL}/functions/v1/ai-chat-summarize`;
const AI_CREATE_URL = `${VG_SUPABASE_URL}/functions/v1/ai-chat-create-session`;

// === AI Enhance (composer) · Supabase Edge call ===
const AI_ENHANCE_FN = "ai-enhance"; // invoked via client.functions.invoke

async function __aiChatCall(url, payload) {
  // include Supabase access token so RLS auth.uid() works
  let access_token = null;
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    access_token = session?.access_token || null;
  } catch {}

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(access_token ? { authorization: `Bearer ${access_token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out?.error || `HTTP ${r.status}`);
  return out;
}

// Call the 'ai-enhance' Edge Function using supabase-js (handles auth header)
async function __aiEnhanceInvoke(payload) {
  // payload: { text, surface?, tone?, length?, site? }
  const { data, error } = await client.functions.invoke(AI_ENHANCE_FN, {
    body: payload,
  });
  if (error) {
    // Try to surface response details if present
    let status,
      text = "";
    try {
      status = error?.context?.response?.status;
    } catch {}
    try {
      text = await error?.context?.response?.text();
    } catch {}
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    const msg =
      (parsed && typeof parsed.error === "string" && parsed.error) ||
      (text && !parsed ? text : null) ||
      error?.message ||
      `EF_STATUS_${status || "UNKNOWN"}`;
    const errObj = new Error(msg || "AI_ENHANCE_ERROR");
    if (parsed) errObj.details = parsed;
    if (status) errObj.status = status;
    throw errObj;
  }
  return data || {};
}

// Optional: read transcript to resume a session
async function __aiGetMessages(session_id, limit = 50) {
  const { data, error } = await client
    .from("ai_chat_messages")
    .select("role, content, created_at")
    .eq("session_id", session_id)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message || String(error));
  return data || [];
}

// === Bug Buster · Supabase Edge call (uses server-side OPENAI_API_KEY) ===
const BB_SUMMARIZE_URL = `${VG_SUPABASE_URL}/functions/v1/bugbuster-summarize`;

async function __bbSummarizeViaSupabase(site, messages) {
  let access_token = null;
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    access_token = session?.access_token || null;
  } catch {}

  const r = await fetch(BB_SUMMARIZE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(access_token ? { authorization: `Bearer ${access_token}` } : {}),
    },
    body: JSON.stringify({ site, messages }),
  });

  let out = {};
  try {
    out = await r.json();
  } catch {}
  if (!r.ok) throw new Error(out?.error || `HTTP ${r.status}`);
  if (!out?.summary) throw new Error("Empty summary from edge function");
  return out.summary;
}

// === Bug Buster · OpenAI helper (must throw on errors) ===
async function __vgCallOpenAI(messages, system) {
  const { openai_key } = await browser.storage.local.get(["openai_key"]);
  if (!openai_key)
    throw new Error("Missing OpenAI key in browser.storage.local.openai_key");

  const body = {
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(messages) },
    ],
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openai_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let j = {};
  try {
    j = await r.json();
  } catch {}

  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }

  const text = j?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty response from OpenAI");
  return text;
}

// System prompt used by Bug Buster summarizer
function BB_SYSTEM_PROMPT(site) {
  return `You are VibeGuardian Bug Buster, a senior engineering triage agent.

Summarize the last 10 messages between a developer and their code assistant on ${site}.
OUTPUT STRICTLY IN THIS FORMAT:

Issue: <one concise sentence>
Evidence:
- <2–4 short bullets with key clues or quotes>
Suspects: <files/functions/modules if mentioned; otherwise "None mentioned">
Next step: <the single most useful question to ask or action to take first>`;
}

// ---- Page placements (host + path_prefix rules) ----
async function fetchPagePlacementsForHost(host) {
  const h = (host || "").toLowerCase();
  if (!h) return [];

  const parts = h.split(".").filter(Boolean);
  const apex = parts.slice(-2).join("."); // sub.replit.com -> replit.com

  const { data, error } = await client
    .from("vg_page_placements")
    .select("*")
    .eq("enabled", true)
    // match exact host or apex
    .or(`host.eq.${apex},host.eq.${h}`)
    // prefer longest path_prefix, then lowest rank
    .order("path_prefix", { ascending: false })
    .order("rank", { ascending: true });

  if (error) throw new Error(error.message || String(error));
  return data || [];
}

// ===== Live placement streaming to tabs (opt-in per tab/site) =====
const VB_PLACEMENT_SUBS = new Map(); // tabId -> { chan, host, path }

async function vbFetchPlacement(host, path) {
  try {
    const { data, error } = await client
      .from("vg_page_placements")
      .select("*")
      .eq("enabled", true)
      .or(`host.eq.${host},host.eq.${host.replace(/^www\./, "")}`)
      .order("path_prefix", { ascending: false }) // DB order is fine; local sort will dominate
      .order("rank", { ascending: true });

    if (error) throw error;

    const rows = data || [];
    const pathStr = String(path || "/");

    // 1) Keep existing behavior first: strict "startsWith"
    const startMatches = rows.filter((r) => {
      const pref = String(r.path_prefix || "/");
      return pref ? pathStr.startsWith(pref) : false;
    });

    // 2) If no startsWith match, allow nested segments via "includes"
    //    (e.g., "/<workspace>/lindy/.../tasks" should match "/lindy/")
    const pool = startMatches.length
      ? startMatches
      : rows.filter((r) => {
          const pref = String(r.path_prefix || "/");
          if (!pref || pref === "/") return false; // defer "/" to last resort
          return pathStr.includes(pref);
        });

    // 3) Most-specific wins: longest path_prefix, then lowest rank; fallback to rows if pool empty
    const pick =
      (pool.length ? pool : rows).sort((a, b) => {
        const la = String(a.path_prefix || "").length;
        const lb = String(b.path_prefix || "").length;
        if (la !== lb) return lb - la; // longer first
        const ra = Number(a.rank) || 0,
          rb = Number(b.rank) || 0;
        return ra - rb; // then lower rank
      })[0] || null;

    return pick;
  } catch (e) {
    console.warn("[BG] vbFetchPlacement error", e);
    return null;
  }
}

// >>> ADD: path helpers + null-safe merge (do NOT override pill_size)
function __vgPrefixCandidates(path = "/") {
  const clean = String(path || "/")
    .split("#")[0]
    .split("?")[0];
  const parts = clean.split("/").filter(Boolean);
  const prefs = ["/"];
  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    prefs.push(cur);
  }
  return prefs.sort((a, b) => b.length - a.length); // longest-first
}

function __vgMergePlacement(base, ov) {
  if (!ov) return base;
  const m = { ...base };
  const has = (v) => v !== undefined && v !== null && v !== "";
  if (has(ov.dx)) m.dx = ov.dx;
  if (has(ov.dy)) m.dy = ov.dy;
  if (has(ov.anchor_corner)) m.anchor_corner = ov.anchor_corner;
  // NOTE: never override size from user overrides
  // m.pill_size stays as base.pill_size
  return m;
}

async function vbStartPlacementSub(tabId, host, path) {
  const prev = VB_PLACEMENT_SUBS.get(tabId);
  if (prev?.chan) {
    try {
      prev.chan.unsubscribe();
    } catch {}
  }
  VB_PLACEMENT_SUBS.delete(tabId);

  const chan = client
    .channel(`vb_pp_${tabId}_${host}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "vg_page_placements",
        filter: `host=eq.${host}`,
      },
      async () => {
        let pick = await vbFetchPlacement(host, path);
        if (pick && tabId) {
          try {
            const ov = await __vussoReadOverride(host, path); // path-aware
            if (ov) pick = __vgMergePlacement(pick, ov);

            vgDebug("[VB_PUSH]", {
              tabId,
              host,
              path,
              dx: pick?.dx,
              dy: pick?.dy,
              corner: pick?.anchor_corner,
              strat: pick?.pick_strategy || pick?.strategy,
            });
            browser.tabs
              .sendMessage(tabId, {
                type: "VB_PLACEMENT_UPDATE",
                host,
                placement: pick,
              })
              .catch(() => {}); // Simply ignore the error // browser.runtime.lastError
          } catch {}
        }
      }
    )
    .subscribe();

  VB_PLACEMENT_SUBS.set(tabId, { chan, host, path });

  // Initial merged placement for the requester (/projects works immediately)
  let initPick = await vbFetchPlacement(host, path);
  const ov = await __vussoReadOverride(host, path);
  if (initPick && ov) initPick = __vgMergePlacement(initPick, ov);
  return initPick || null;
}

// --- Ensure Quick Menu is loaded in a tab; inject if missing ---
async function __vgEnsureQuickMenuLoaded(tabId) {
  try {
    // 1) Check if quickmenu is already loaded
    const resp = await browser.tabs.sendMessage(tabId, { type: "VG_PING_QM" });
    if (resp?.qm === true) return true;
  } catch (error) {
    // Not loaded, continue to inject
  }

  try {
    // 2) Inject script with feature detection
    const hasScriptingAPI =
      typeof chrome !== "undefined" &&
      chrome.scripting &&
      chrome.scripting.executeScript;

    if (hasScriptingAPI) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["src/ui/quickmenu.js"],
      });
    } else {
      await browser.tabs.executeScript(tabId, {
        file: "src/ui/quickmenu.js",
      });
    }

    // 3) Verify injection
    await new Promise((resolve) => setTimeout(resolve, 100));
    const r2 = await browser.tabs.sendMessage(tabId, { type: "VG_PING_QM" });
    return !!r2?.qm;
  } catch (error) {
    console.warn("[BG] __vgEnsureQuickMenuLoaded error:", error);
    return false;
  }
}

// --- Magic Link Bridge: adopt tokens from viberly.ai/extension-bridge
let __VG_BRIDGE_ADOPT_FP = null; // de-dupe fingerprint

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    const url = changeInfo?.url;
    if (!url) return;

    // watch only our bridge URL
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "viberly.ai") return;
    if (u.pathname !== "/extension-bridge") return;

    // tokens come in the URL fragment (#access_token=…)
    const h = new URLSearchParams((u.hash || "").replace(/^#/, ""));
    const at = h.get("access_token");
    if (!at) return; // not the final hop yet

    const rt = h.get("refresh_token") || "";
    const ei = parseInt(h.get("expires_in") || "0", 10);
    const exp = ei
      ? Math.floor(Date.now() / 1000) + ei
      : parseInt(h.get("expires_at") || "0", 10) || null;

    // dedupe so we don't re-adopt on every minor tab update
    const fp = at.slice(0, 12) + "." + rt.slice(0, 12) + "." + (exp || 0);
    if (__VG_BRIDGE_ADOPT_FP === fp) return;
    __VG_BRIDGE_ADOPT_FP = fp;

    // adopt into BG (saves SoT + broadcasts AUTH_STATUS_PUSH)
    await __vgAdoptTokensInBG({
      access_token: at,
      refresh_token: rt,
      expires_at: exp,
    });
    vgDebug("[BG][bridge] adopted session from bridge URL");

    // 🚀 Post-bridge redirect (one-shot): popup sets __vg_post_bridge_redirect_url before opening the bridge
    try {
      const { __vg_post_bridge_redirect_url } = await browser.storage.local.get(
        "__vg_post_bridge_redirect_url"
      );
      const target = __vg_post_bridge_redirect_url;
      if (typeof target === "string" && target) {
        await browser.tabs.create({ url: target, active: true });
        await browser.storage.local.remove("__vg_post_bridge_redirect_url");
      }
    } catch (e) {
      console.warn("[BG][bridge] post-bridge redirect read failed:", e);
    }

    // 🔽 Auto-close THIS tab after a short delay (only if still on bridge)
    const CLOSE_DELAY_MS = 2500;
    setTimeout(async () => {
      try {
        const cur = await browser.tabs.get(tabId);
        const nowUrl = cur?.url || "";
        if (/^https:\/\/(www\.)?viberly\.ai\/extension-bridge/i.test(nowUrl)) {
          await browser.tabs.remove(tabId);
        }
      } catch (_) {
        /* tab already gone or navigated */
      }
    }, CLOSE_DELAY_MS);
  } catch (e) {
    console.warn("[BG][bridge] adopt failed:", e);
  }
});

// === Phase 3: active tab → host helper (popup calls BG, not content) ===
async function __vgActiveTabHost() {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) return null;
    try {
      return new URL(tab.url).hostname.toLowerCase();
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

/* Phase 4: active tab → path (defaults to "/") */
async function __vgActiveTabPath() {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.url) return "/";
    try {
      return new URL(tab.url).pathname || "/";
    } catch {
      return "/";
    }
  } catch {
    return "/";
  }
}

/* Phase 10: broadcast site-access change to all tabs on host */
async function __vgBroadcastSiteAccess(host, state /* 'on' | 'off' */) {
  try {
    const h = (host || "").toLowerCase().replace(/^www\./, "");
    const tabs = await browser.tabs.query({});
    for (const t of tabs) {
      try {
        const th = new URL(t.url || "").hostname
          .toLowerCase()
          .replace(/^www\./, "");
        if (th === h) {
          browser.tabs
            .sendMessage(t.id, { type: "SITE_ACCESS_CHANGED", host: h, state })
            .catch(() => {}); // Simply ignore the error // browser.runtime.lastError
        }
      } catch {}
    }
  } catch {}
}

// helper: normalize path to an exact, stable key (strip ?/#, unify trailing slash)
function __vgNormalizePath(path = "/") {
  try {
    let p = String(path || "/");
    p = p.split("#")[0].split("?")[0] || "/";
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p || "/";
  } catch {
    return "/";
  }
}

async function __vussoReadOverride(host, path = "/") {
  try {
    const {
      data: { session },
    } = await client.auth.getSession();
    const uid = session?.user?.id || null;
    const h = (host || "").toLowerCase().replace(/^www\./, "");
    const exact = __vgNormalizePath(path);
    if (!uid || !h) return null;

    const { data, error } = await client
      .from("vg_user_site_overrides")
      .select(
        "state, snooze_until, dx, dy, pill_size, anchor_corner, placement_updated_at, path_prefix"
      )
      .eq("user_id", uid)
      .eq("host", h)
      .eq("path_prefix", exact)
      .limit(1);

    if (error) return null;
    return Array.isArray(data) && data[0] ? data[0] : null;
  } catch {
    return null;
  }
}

// Message router
async function handleMessage(msg, _host = "", sender = null) {
  const gate = await __vgGateIfBlocked(msg?.type, sender);
  if (gate) return gate;

  switch (msg?.type) {
    case "VG_INTENT_CAPTURE": {
      try {
        const payload = msg?.payload || {};
        const rawText = String(payload?.rawText || payload?.trimmedText || "").trim();
        const segments = Array.isArray(payload?.intentSegments)
          ? payload.intentSegments.filter(
              (seg) =>
                seg &&
                typeof seg.text === "string" &&
                seg.text.trim().length > 0
            )
          : [];
        if (!rawText) {
          return { ok: true, skipped: "NO_TEXT" };
        }
        if (!segments.length) {
          return { ok: true, skipped: "NO_SEGMENTS" };
        }

        const {
          data: { session },
        } = await client.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          vgInfo?.("[VG][intent] capture skipped (no session)");
          return { ok: false, error: "NO_SESSION" };
        }

        const sourceUrl =
          normalizeSourceHost(payload?.sourceUrl) ||
          normalizeSourceHost(_host) ||
          null;
        const tokenCount =
          typeof payload?.tokenCount === "number" && payload.tokenCount >= 0
            ? Math.round(payload.tokenCount)
            : estimateTokenCount(rawText);

        const insertRow = {
          user_id: userId,
          conversation_id:
            typeof payload?.conversationId === "string"
              ? payload.conversationId
              : null,
          source_url: sourceUrl,
          captured_at: payload?.capturedAt
            ? new Date(payload.capturedAt).toISOString()
            : new Date().toISOString(),
          raw_text: rawText,
          intent_segments: segments,
          token_count: tokenCount,
          is_rich_text: !!payload?.isRichText,
          params:
            typeof payload?.params === "object" && payload.params
              ? payload.params
              : null,
        };

        const { data, error } = await client
          .from("intent_messages")
          .insert(insertRow)
          .select("intent_message_id,captured_at")
          .single();

        if (error) {
          vgWarn("[VG][intent] capture insert failed:", error);
          return { ok: false, error: error.message || String(error) };
        }

        const insertedId = data?.intent_message_id || null;
        const capturedIso =
          data?.captured_at ||
          insertRow.captured_at ||
          new Date().toISOString();

        const batchMeta = await handleIntentCaptureBatch({
          userId,
          message: {
            intent_message_id: insertedId,
            captured_at: capturedIso,
            source_url: sourceUrl,
          },
          tokenCount,
        });

        return {
          ok: true,
          id: insertedId,
          tokens: tokenCount,
          ...batchMeta,
        };
      } catch (e) {
        vgWarn("[VG][intent] capture exception:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case "VG_INTENT_CAPTURE_META": {
      try {
        const payload = msg?.payload || {};
        const intentMessageId = String(
          payload?.intentMessageId || payload?.id || ""
        ).trim();
        if (!intentMessageId) {
          return { ok: false, error: "MISSING_INTENT_MESSAGE_ID" };
        }

        if (!__VG_SIGNED_IN) {
          try {
            await __bgLoadSession();
            await __bgAdoptSoTIntoClient();
          } catch (rehydrateErr) {
            vgWarn(
              "[VG][intent] capture meta rehydrate failed",
              rehydrateErr
            );
          }
        }

        const {
          data: { session },
        } = await client.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          vgInfo?.("[VG][intent] capture meta skipped (no session)");
          return { ok: false, error: "NO_SESSION" };
        }

        const sourceUrl =
          normalizeSourceHost(payload?.sourceUrl) ||
          normalizeSourceHost(_host) ||
          null;
        const capturedIso = payload?.capturedAt
          ? new Date(payload.capturedAt).toISOString()
          : new Date().toISOString();

        let tokenCount =
          typeof payload?.tokenCount === "number" && payload.tokenCount >= 0
            ? Math.round(payload.tokenCount)
            : null;

        if (!Number.isFinite(tokenCount) || tokenCount === null) {
          try {
            const { data: tokenRow, error: tokenErr } = await client
              .from("intent_messages")
              .select("token_count")
              .eq("intent_message_id", intentMessageId)
              .maybeSingle();
            if (!tokenErr && tokenRow) {
              const tc = Number(tokenRow.token_count);
              if (Number.isFinite(tc) && tc >= 0) {
                tokenCount = Math.round(tc);
              }
            }
          } catch (tokenLookupError) {
            vgWarn("[VG][intent] token lookup failed", tokenLookupError);
          }
        }

        const batchMeta = await handleIntentCaptureBatch({
          userId,
          message: {
            intent_message_id: intentMessageId,
            captured_at: capturedIso,
            source_url: sourceUrl,
          },
          tokenCount:
            typeof tokenCount === "number" && Number.isFinite(tokenCount)
              ? tokenCount
              : null,
        });

        return {
          ok: true,
          id: intentMessageId,
          tokens:
            typeof tokenCount === "number" && Number.isFinite(tokenCount)
              ? tokenCount
              : null,
          ...batchMeta,
        };
      } catch (err) {
        vgWarn("[VG][intent] capture meta exception:", err);
        return { ok: false, error: String(err?.message || err) };
      }
    }
    case "VG_INTENT_RESPONSE_CAPTURE": {
      try {
        const payload = msg?.payload || {};
        const intentMessageId = String(payload?.intentMessageId || "").trim();
        if (!intentMessageId) {
          return { ok: false, error: "MISSING_INTENT_MESSAGE_ID" };
        }

        // Ensure Supabase client is hydrated with our stored tokens before checking session.
        if (!__VG_SIGNED_IN) {
          try {
            await __bgLoadSession();
            await __bgAdoptSoTIntoClient();
          } catch (rehydrateErr) {
            vgWarn(
              "[VG][intent] response capture rehydrate failed",
              rehydrateErr
            );
          }
        }

        const {
          data: { session },
        } = await client.auth.getSession();
        const userId = session?.user?.id || null;
        if (!userId) {
          vgWarn("[VG][intent] response capture skipped (no session)");
          return { ok: false, error: "NO_SESSION" };
        }

        const sanitized = sanitizeResponseExcerpt(payload?.excerpt || "");
        if (!sanitized) {
          return { ok: false, error: "EMPTY_EXCERPT" };
        }
        const excerpt = truncateResponseExcerpt(sanitized);
        const hash = hashString(excerpt);
        const capturedAtIso = payload?.capturedAt
          ? new Date(payload.capturedAt).toISOString()
          : new Date().toISOString();
        const responseSource =
          typeof payload?.source === "string" && payload.source
            ? payload.source.toLowerCase()
            : null;

        const {
          data: existing,
          error: existingErr,
        } = await client
          .from("intent_messages")
          .select("response_excerpt_hash")
          .eq("intent_message_id", intentMessageId)
          .eq("user_id", userId)
          .maybeSingle();

        if (existingErr) {
          vgWarn("[VG][intent] response capture lookup failed", existingErr);
          return {
            ok: false,
            error: existingErr.message || String(existingErr),
          };
        }

        if (
          existing?.response_excerpt_hash &&
          existing.response_excerpt_hash === hash
        ) {
          return { ok: true, skipped: "DUPLICATE" };
        }

        const { error: updateErr } = await client
          .from("intent_messages")
          .update({
            response_excerpt: excerpt,
            response_excerpt_hash: hash,
            response_captured_at: capturedAtIso,
            response_source: responseSource,
          })
          .eq("intent_message_id", intentMessageId);

        if (updateErr) {
          vgWarn("[VG][intent] response capture update failed", updateErr);
          return { ok: false, error: updateErr.message || String(updateErr) };
        }

        return { ok: true };
      } catch (err) {
        vgWarn("[VG][intent] response capture exception", err);
        return { ok: false, error: String(err?.message || err) };
      }
    }

// ===== COUNTER · Phase 1 Handshake (whitelist check only) =====
    case "COUNTER_HANDSHAKE": {
      try {
        const host = (msg?.payload?.host || "")
          .toLowerCase()
          .replace(/^www\./, "");
        const path =
          typeof msg?.payload?.path === "string" && msg.payload.path
            ? msg.payload.path
            : "/";
        if (!host) return { ok: false, enabled: false, error: "missing host" };

        const pick = await vbFetchPlacement(host, path);
        if (!pick || pick.enabled === false) {
          return { ok: false, enabled: false, reason: "not_enabled" };
        }

        // Minimal normalized shape, no selectors needed in Phase 1
        return {
          ok: true,
          enabled: true,
          placement: { id: pick.id || null, host, path },
        };
      } catch (e) {
        return { ok: false, enabled: false, error: String(e?.message || e) };
      }
    }

    // ===== USAGE · Test write via Edge Function (one-shot probe) =====
    case "USAGE_TEST_INGEST": {
      try {
        // Require a session for RLS
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.access_token) return { ok: false, error: "NO_SESSION" };

        const host = (msg?.payload?.host || "")
          .toLowerCase()
          .replace(/^www\./, "");
        const path =
          typeof msg?.payload?.path === "string" && msg.payload.path
            ? msg.payload.path
            : "/";
        const note = String(msg?.payload?.note || "").slice(0, 200);

        // Build a minimal valid event that the EF will accept
        const nowIso = new Date().toISOString();
        const ext_version = browser?.runtime?.getManifest?.().version || null;

        const body = {
          // device_id: 'dev-probe-1', // optional
          events: [
            {
              host, // REQUIRED per event by EF
              direction: "in", // MUST be 'in' or 'out'
              ts: nowIso, // within ±24h
              char_len: Math.max(1, note.length || 1),
              est_tokens: 1,
              session_id: crypto?.randomUUID?.() || null,
              confidence: "estimated_profile",
              ext_version,
              // fingerprint_hash: null // optional
            },
          ],
        };

        // Use supabase-js to invoke the Edge Function by name (handles auth header)
        const { data, error } = await client.functions.invoke("usage-ingest", {
          body,
        });

        if (error) {
          let status,
            text = "";
          try {
            status = error?.context?.response?.status;
          } catch {}
          try {
            text = await error?.context?.response?.text();
          } catch {}
          return {
            ok: false,
            status: status ?? 500,
            error: "INGEST_FAILED",
            resp: text || error?.message || String(error),
          };
        }

        // EF returns { received, inserted, upserts }
        return { ok: true, resp: data };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // ===== USAGE · Batched page → background events (Phase 6) =====
    case "VG_USAGE_BATCH": {
      try {
        if (!msg || !Array.isArray(msg.events))
          return { ok: false, error: "INVALID_BATCH" };

        const host = String(msg.host || "")
          .toLowerCase()
          .replace(/^www\./, "");
        const path = typeof msg.path === "string" ? msg.path : "/"; // not persisted yet
        const sessionKey = String(msg.sessionId || ""); // non-uuid session id
        const extVersion = browser?.runtime?.getManifest?.().version || null;

        // Require session for RLS
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.access_token) {
          vgInfo?.("[VG][usage][bg] skip persist (no session)");
          return {
            ok: true,
            received: msg.events.length,
            persisted: 0,
            reason: "NO_SESSION",
          };
        }

        // Ensure each event carries host to satisfy EF validation
        const eventsWithHost = msg.events.map((ev) => ({
          ...ev,
          host, // EF checks e.host; we attach batch host here
        }));

        // Forward to Edge Function
        const body = {
          host,
          path,
          sessionKey, // EF maps to fingerprint_hash
          ext_version: extVersion,
          events: eventsWithHost, // now each event has e.host
        };

        const { data, error } = await client.functions.invoke("usage-ingest", {
          body,
        });
        if (error) {
          vgWarn("[VG][usage][bg] ingest error:", error?.message || error);
          return { ok: false, error: String(error?.message || error) };
        }

        vgInfo?.("[VG][usage][bg] persisted:", data);
        return {
          ok: true,
          received: msg.events.length,
          persisted: data?.inserted ?? 0,
        };
      } catch (e) {
        vgWarn("[VG][usage][bg] exception:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // ===== AUTH / STORAGE (existing) =====
    case "SIGN_UP": {
      const { email, password } = msg;
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      return { ok: true, data };
    }

    case "SIGN_IN": {
      const { email, password } = msg;
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return { ok: true, data };
    }

    case "SIGN_OUT": {
      vgDebug("[BG] SIGN_OUT requested by popup/content");
      const { error } = await client.auth.signOut();
      if (error) throw error;

      __VG_SIGNED_IN = false;
      await __bgSaveSession(null); // clear SoT snapshot
      await __bgAdoptSoTIntoClient(); // ← keep client in sync with SoT clear
      await __vgBroadcastAuth(false); // emit BOTH VG_AUTH_CHANGED and AUTH_STATUS_PUSH
      return { ok: true, status: __bgSnapshot() };
    }
    // Final step of web-app → extension auth callback
    case "AUTH_REDIRECT": {
      // Expect: { redirectUrl } from auth.html
      const redirectUrl = msg?.redirectUrl || "";
      if (!redirectUrl) return { ok: false, error: "missing redirectUrl" };

      // 1) Parse returned URL (supports #fragment tokens or ?code)
      const parsed = __vgParseAuthReturn(redirectUrl);
      if (!parsed) return { ok: false, error: "no_tokens_or_code" };

      // No custom state validation — Supabase/Provider handled state internally
      // (Keep parsing tokens or exchanging ?code below as you already do)

      // 3) Complete session
      if (parsed.flow === "implicit") {
        if (!parsed.access_token || !parsed.refresh_token) {
          return { ok: false, error: "incomplete_tokens" };
        }
        const snap = await __vgAdoptTokensInBG({
          access_token: parsed.access_token,
          refresh_token: parsed.refresh_token,
          expires_at: parsed.expires_at || null,
        });
        return { ok: true, flow: "implicit", userId: snap.userId };
      }

      if (parsed.flow === "code") {
        // Exchange code → session via supabase-js in the BG
        let ex;
        try {
          ex = await client.auth.exchangeCodeForSession(parsed.code);
        } catch (e) {
          return { ok: false, error: String(e?.message || e) };
        }
        const s = ex?.data?.session;
        if (!s?.access_token || !s?.refresh_token) {
          return { ok: false, error: "exchange_no_session" };
        }
        const snap = await __vgAdoptTokensInBG({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          expires_at: s.expires_at || null,
        });
        return { ok: true, flow: "code", userId: snap.userId };
      }

      return { ok: false, error: "unrecognized_flow" };
    }

    case "SAVE_ITEM": {
      const { data: auth } = await client.auth.getUser();
      if (!auth?.user) throw new Error("Not signed in");
      const payload = msg.payload ?? {};
      const { error } = await client
        .from("vg_items")
        .insert({ user_id: auth.user.id, data: payload });
      if (error) throw error;
      return { ok: true };
    }
    case "LOAD_ITEMS": {
      const { data, error } = await client
        .from("vg_items")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return { ok: true, data };
    }

    // NEW: highlight → name/tags via EF → insert into public.vg_guards (with logging)
    case "VG_SAVE_HIGHLIGHT": {
      try {
        console.debug("[BG/VG_SAVE_HIGHLIGHT] in:", {
          hasMsg: !!msg,
          hasPayload: !!msg?.payload,
          len: (msg?.payload?.text || "").length,
          host: msg?.payload?.source_host,
        });

        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.user?.id) {
          console.warn("[BG/VG_SAVE_HIGHLIGHT] NOT_SIGNED_IN");
          return { ok: false, error: "NOT_SIGNED_IN" };
        }

        const { text, source_host, source_url } = msg?.payload || {};
        const body = (text || "").trim();
        if (!body) {
          console.warn("[BG/VG_SAVE_HIGHLIGHT] EMPTY_SELECTION");
          return { ok: false, error: "EMPTY_SELECTION" };
        }

        // 🔒 Gate strictly by vg_profiles counters: block when used >= limit
        // No gating on creation. Monetization happens on insertion only.

        // Safer base URL in case client.rest.url isn’t present
        const restUrl =
          client && client.rest && client.rest.url
            ? client.rest.url
            : VG_SUPABASE_URL + "/rest/v1";
        const baseUrl = restUrl.replace("/rest/v1", "");
        const efUrl = `${baseUrl}/functions/v1/save-prompt-meta`;
        console.debug("[BG/VG_SAVE_HIGHLIGHT] calling EF:", efUrl);

        const ef = await fetch(efUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: body, source_host, source_url }),
        });

        let meta = {};
        try {
          meta = await ef.json();
        } catch {}
        console.debug(
          "[BG/VG_SAVE_HIGHLIGHT] EF status:",
          ef.status,
          "meta:",
          meta
        );

        if (!ef.ok) {
          const errMsg = String(
            meta?.error || `EDGE_FUNCTION_FAILED_${ef.status}`
          );
          console.warn("[BG/VG_SAVE_HIGHLIGHT] EF error:", errMsg);
          return { ok: false, error: errMsg };
        }

        const fallbackPreview = body.replace(/\s+/g, " ").slice(0, 100).trim();
        const row = {
          user_id: session.user.id,
          title: meta?.title || "Saved Highlight",
          body,
          preview:
            typeof meta?.preview === "string"
              ? meta.preview.trim().slice(0, 100)
              : fallbackPreview,
          variables: meta?.variables || {},
          tags: Array.isArray(meta?.tags) ? meta.tags : [],
          site_category: meta?.site_category || "general",
          config: meta?.config || {},
          visibility: "private",
          status: "active",
        };

        const { data: ins, error } = await client
          .from("vg_guards")
          .insert(row)
          .select("id")
          .limit(1);
        if (error) {
          console.warn("[BG/VG_SAVE_HIGHLIGHT] insert error:", error);
          return { ok: false, error: String(error.message || error) };
        }

        console.debug("[BG/VG_SAVE_HIGHLIGHT] inserted:", ins && ins[0]?.id);
        return { ok: true };
      } catch (e) {
        console.warn("[BG/VG_SAVE_HIGHLIGHT] throw:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // === AI Enhance: composer selection → Edge → enhanced text
    case "VG_AI_ENHANCE": {
      try {
        const raw = (msg?.payload?.text || "").toString();
        const surface = msg?.payload?.surface || "composer";

        // Require login (RLS)
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };

        const summary = await __bgAccountSummary();
        const tier = String(summary?.tier || "free").toLowerCase();
        const limits =
          AI_ENHANCE_PLAN_LIMITS[tier] || AI_ENHANCE_PLAN_LIMITS.default;

        const totalUsed = Number(summary?.aiEnhanceTotal || 0);
        let monthUsed = Number(summary?.aiEnhanceMonth || 0);
        let resetTime = 0;
        if (summary?.aiEnhanceMonthReset) {
          const ts = Date.parse(summary.aiEnhanceMonthReset);
          if (Number.isFinite(ts)) resetTime = ts;
        }
        const nowTs = Date.now();
        if (!resetTime || resetTime <= nowTs) {
          monthUsed = 0;
          resetTime = 0;
        }

        const limitMeta = {
          tier,
          total_used: totalUsed,
          month_used: monthUsed,
          month_reset: resetTime ? new Date(resetTime).toISOString() : null,
        };

        if (limits.total !== null && totalUsed >= limits.total) {
          __triggerAiEnhancePaywall(sender?.tab?.id, limitMeta);
          return { ok: false, error: "AI_ENHANCE_LIMIT", meta: limitMeta };
        }

        if (
          limits.month !== null &&
          resetTime > nowTs &&
          monthUsed >= limits.month
        ) {
          __triggerAiEnhancePaywall(sender?.tab?.id, limitMeta);
          return { ok: false, error: "AI_ENHANCE_LIMIT", meta: limitMeta };
        }

        // Basic guards (mirror content script limits)
        const text = raw.trim();
        if (text.length < 16) return { ok: false, error: "TEXT_TOO_SHORT" };
        if (text.length > 8000) return { ok: false, error: "TEXT_TOO_LONG" };

        // Optional site hint for EF heuristics
        let site = "";
        try {
          site = new URL(sender?.url || "").hostname || "";
        } catch {}
        // EF expects `prompt` (not `text`). Keep `surface` for future analytics.
        const payload = { prompt: text, site, surface };

        const out = await __aiEnhanceInvoke(payload); // returns { enhanced, ... }
        const enhanced =
          out && typeof out.enhanced === "string" ? out.enhanced : "";

        if (!enhanced) return { ok: false, error: "EMPTY_ENHANCED_TEXT" };

        return { ok: true, text: enhanced, meta: out.meta || null };
      } catch (e) {
        const limitHit =
          e?.details?.error === "AI_ENHANCE_LIMIT" ||
          String(e?.message || "").toUpperCase() === "AI_ENHANCE_LIMIT";
        if (limitHit) {
          __triggerAiEnhancePaywall(sender?.tab?.id, {
            tier: e?.details?.tier || null,
            total_used: e?.details?.total_used ?? null,
            month_used: e?.details?.month_used ?? null,
            month_reset: e?.details?.month_reset ?? null,
          });
          return {
            ok: false,
            error: "AI_ENHANCE_LIMIT",
            meta: e?.details || null,
          };
        }
        console.warn("[BG] VG_AI_ENHANCE error:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    case "SET_SESSION": {
      const {
        access_token,
        refresh_token,
        expires_at: expIn,
        userId,
        email,
      } = msg || {};
      if (!access_token || !refresh_token) {
        return { ok: false, error: "missing tokens" };
      }

      // Derive expires_at from JWT 'exp' if not provided
      let exp = expIn;
      if (!Number.isFinite(exp)) {
        try {
          const mid = String(access_token).split(".")[1] || "";
          const base64 = mid.replace(/-/g, "+").replace(/_/g, "/");
          const padded = base64 + "===".slice((base64.length + 3) % 4);
          const payload = JSON.parse(atob(padded));
          if (Number.isFinite(payload?.exp)) exp = payload.exp; // epoch seconds
        } catch {}
      }
      if (!Number.isFinite(exp)) {
        return { ok: false, error: "missing expires_at" };
      }

      try {
        // Set Supabase client session (RLS)
        const { data, error } = await client.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) return { ok: false, error: String(error.message || error) };

        __VG_SIGNED_IN = !!data?.session?.user;

        // de-dupe by fingerprint (tokens + expiry)
        const fpNew =
          access_token.slice(0, 12) +
          "." +
          refresh_token.slice(0, 12) +
          "." +
          exp;
        const fpOld = VG_SESSION
          ? VG_SESSION.access_token?.slice(0, 12) +
            "." +
            VG_SESSION.refresh_token?.slice(0, 12) +
            "." +
            VG_SESSION.expires_at
          : "";

        // Persist SoT + adopt into client only if changed
        if (fpNew !== fpOld) {
          await __bgSaveSession({
            access_token,
            refresh_token,
            expires_at: exp,
            userId: userId || null,
            email: email || null,
          });
          await __bgAdoptSoTIntoClient();
        }

        // 🔄 session changed → drop team prompts cache (prevents cross-user bleed)
        __vgTeamPromptsCache = { ts: 0, rows: [], uid: null };

        // Broadcast + recompute access snapshot immediately (no stale cache)
        await __vgBroadcastAuth(__VG_SIGNED_IN);
        await __vgComputeAccessSnapshot();

        return { ok: true, status: __bgSnapshot() };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case "GET_SESSION": {
      return { ok: true, status: __bgSnapshot() };
    }

    case "GET_STATUS": {
      return { ok: true, status: __bgSnapshot() };
    }

    case "AUTH_STATUS": {
      // legacy boolean for older callers
      return { ok: true, signedIn: __VG_SIGNED_IN };
    }

    /* === Phase 8: Site access = override ⟂ global (READ-ONLY) === */
    case "GET_SITE_ACCESS": {
      const hostMsg = (msg?.host || "").toLowerCase().replace(/^www\./, "");
      const pathMsg = typeof msg?.path === "string" ? msg.path : null;

      const activeHost = await __vgActiveTabHost();
      const activePath = await __vgActiveTabPath();

      const host = hostMsg || activeHost || "";
      const path = pathMsg || activePath || "/";

      // 0) Is this host supported at all (ignore enabled flag)? → tri-state "na" if none.
      let supported = false;
      try {
        const apex = (host || "")
          .replace(/^www\./, "")
          .split(".")
          .slice(-2)
          .join(".");
        const { count } = await client
          .from("vg_page_placements")
          .select("id", { head: true, count: "exact" })
          .or(`host.eq.${host},host.eq.${apex}`)
          .limit(1);
        supported = typeof count === "number" && count > 0;
      } catch {
        supported = false;
      }

      // 1) Global default from placements (enabled-only, as before)
      let global_enabled = false;
      try {
        const pick = host ? await vbFetchPlacement(host, path) : null;
        global_enabled = !!pick;
      } catch {
        global_enabled = false;
      }

      // 2) Per-user override (if any)
      const ov = await __vussoReadOverride(host, path); // path-aware override
      const now = Date.now();
      const snoozed = !!(
        ov?.snooze_until && new Date(ov.snooze_until).getTime() > now
      );

      let enabled = global_enabled; // default
      let override_state = ov?.state || "inherit";
      if (ov?.state === "on") enabled = true;
      if (ov?.state === "off" && !snoozed) enabled = false;

      // 3) Compute tri-state for popup
      //    - If host not in vg_page_placements at all → "na"
      //    - Else reflect effective ON/OFF
      const state = supported ? (enabled ? "on" : "off") : "na";

      return {
        ok: true,
        host,
        path,
        enabled,
        global_enabled,
        override: override_state,
        state,
      };
    }

    /* === Phase 9: SET_SITE_ACCESS persists per-user override === */
    case "SET_SITE_ACCESS": {
      const hostMsg = (msg?.host || "").toLowerCase().replace(/^www\./, "");
      const pathMsg = typeof msg?.path === "string" ? msg.path : null;
      const reqState = String(msg?.state || "inherit"); // 'off' | 'inherit' | 'on' (we mainly use 'off'/'inherit')

      const activeHost = await __vgActiveTabHost();
      const activePath = await __vgActiveTabPath();

      const host = hostMsg || activeHost || "";
      const path = pathMsg || activePath || "/";

      // Must be signed in to write override
      const {
        data: { session },
      } = await client.auth.getSession();
      const uid = session?.user?.id || null;
      if (!uid || !host) return { ok: false, error: "NOT_SIGNED_IN_OR_HOST" };

      // Write path: 'off' → upsert; 'inherit' → delete (cleaner than storing 'inherit')
      try {
        if (reqState === "off") {
          await client
            .from("vg_user_site_overrides")
            .upsert(
              { user_id: uid, host, path_prefix: "/", state: "off" },
              { onConflict: "user_id,host,path_prefix" }
            );
        } else if (reqState === "on") {
          // optional support for 'on' to force-enable even when global is OFF
          await client
            .from("vg_user_site_overrides")
            .upsert(
              { user_id: uid, host, path_prefix: "/", state: "on" },
              { onConflict: "user_id,host,path_prefix" }
            );
        } else {
          // inherit → delete the row
          await client
            .from("vg_user_site_overrides")
            .delete()
            .match({ user_id: uid, host, path_prefix: "/" });
        }
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }

      // Compute effective after write (same logic as GET_SITE_ACCESS)
      let global_enabled = false;
      try {
        const pick = host ? await vbFetchPlacement(host, path) : null;
        global_enabled = !!pick;
      } catch {
        global_enabled = false;
      }

      const ov = await __vussoReadOverride(host, path);
      const now = Date.now();
      const snoozed = !!(
        ov?.snooze_until && new Date(ov.snooze_until).getTime() > now
      );
      let enabled = global_enabled;
      let override_state = ov?.state || "inherit";
      if (ov?.state === "on") enabled = true;
      if (ov?.state === "off" && !snoozed) enabled = false;

      // Phase 10: broadcast the effective state to all tabs on this host
      try {
        await __vgBroadcastSiteAccess(host, enabled ? "on" : "off");
      } catch {}

      // Also compute tri-state so popup can immediately reflect "na" if ever applicable.
      // (Supported check is host-level; path is only used for vbFetchPlacement above.)
      let supported = false;
      try {
        const apex = (host || "")
          .replace(/^www\./, "")
          .split(".")
          .slice(-2)
          .join(".");
        const { count } = await client
          .from("vg_page_placements")
          .select("id", { head: true, count: "exact" })
          .or(`host.eq.${host},host.eq.${apex}`)
          .limit(1);
        supported = typeof count === "number" && count > 0;
      } catch {
        supported = false;
      }
      const state = supported ? (enabled ? "on" : "off") : "na";

      return {
        ok: true,
        host,
        path,
        wrote: reqState,
        enabled,
        global_enabled,
        override: override_state,
        state,
      };
    }

    // === Access gate status (teams)
    case "ACCESS_STATUS": {
      const snap = await __vgGetAccessSnapshotCached();
      return { ok: true, access: snap };
    }

    case "ACCESS_RECHECK": {
      const snap = await __vgComputeAccessSnapshot();
      return { ok: true, access: snap };
    }

    case "VG_ACCOUNT_SUMMARY": {
      const snap = await __bgAccountSummary();
      return { ok: true, summary: snap };
    }

    // Pre-flight: can this tab insert a Custom Prompt (two-step rule)?
    // 1) If used < limit → allow
    // 2) If used >= limit → allow only if (user_id, guard_id) exists in vg_guard_inserts; else block + paywall
    case "VG_CAN_INSERT_CUSTOM": {
      try {
        const guard_id = String(msg?.guard_id || "").trim();
        if (!guard_id) return { ok: false, error: "MISSING_GUARD_ID" };

        // Get session user
        const {
          data: { session },
        } = await client.auth.getSession();
        const uid = session?.user?.id || null;
        if (!uid) return { ok: false, error: "NOT_SIGNED_IN" };

        // Step 1: plan snapshot
        const snap = await __bgAccountSummary(); // { tier, used, quick, limit, status }
        if (snap.used < snap.limit) {
          // below cap → allow
          return { ok: true, summary: snap };
        }

        // Step 2: at/over cap → check ownership (vg_guard_inserts)
        // If the user has ever inserted this guard → allow; else block.
        const own = await client
          .from("vg_guard_inserts")
          .select("guard_id", { head: false, count: "exact" })
          .eq("user_id", uid)
          .eq("guard_id", guard_id)
          .limit(1);

        const alreadyOwned = Array.isArray(own?.data) && own.data.length > 0;

        if (alreadyOwned) {
          return { ok: true, summary: snap };
        }

        // Block + paywall to the asking tab
        try {
          const tabId = sender?.tab?.id;
          if (tabId)
            browser.tabs.sendMessage(tabId, {
              type: "VG_PAYWALL_SHOW",
              payload: { reason: "custom_guard_limit" },
            });
        } catch {}
        return { ok: false, reason: "CUSTOM_GUARD_LIMIT", summary: snap };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // Pre-flight: can this tab insert a Quick Add (two-step rule)?
    // 1) If quick < limit → allow
    // 2) If quick >= limit → allow only if (user_id, prompt_id) exists in vg_quick_favs; else block + paywall
    case "VG_CAN_INSERT_QUICK": {
      try {
        const prompt_id = String(msg?.prompt_id || "").trim();
        if (!prompt_id) return { ok: false, error: "MISSING_PROMPT_ID" };

        // Get session user
        const {
          data: { session },
        } = await client.auth.getSession();
        const uid = session?.user?.id || null;
        if (!uid) return { ok: false, error: "NOT_SIGNED_IN" };

        // Step 1: plan snapshot (quick is the counter for quick adds)
        const snap = await __bgAccountSummary(); // { tier, used, quick, limit, status }
        if (snap.quick < snap.limit) {
          // below cap → allow
          return { ok: true, summary: snap };
        }

        // Step 2: at/over cap → ownership by prior INSERT (not favorites)
        // Use your log table/view for quick usage. If you expose a view, swap its name here.
        const own = await client
          .from("vg_quick_inserts") // or 'vg_user_quick_inserts'
          .select("prompt_id", { head: false, count: "exact" })
          .eq("user_id", uid)
          .eq("prompt_id", prompt_id)
          .limit(1);

        const alreadyOwned = Array.isArray(own?.data) && own.data.length > 0;

        if (alreadyOwned) {
          return { ok: true, summary: snap }; // allow over cap if user has used it before
        }

        // …send VG_PAYWALL_SHOW and return QUICK_ADD_LIMIT

        // Block + paywall to the asking tab
        try {
          const tabId = sender?.tab?.id;
          if (tabId)
            browser.tabs.sendMessage(tabId, {
              type: "VG_PAYWALL_SHOW",
              payload: { reason: "quick_add_limit" },
            });
        } catch {}
        return { ok: false, reason: "QUICK_ADD_LIMIT", summary: snap };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    case "VG_LOAD_SETTINGS": {
      let session = await __vgGetSessionMaybeWait(_host);
      if (!session?.user?.id) {
        session = await __vgEnsureBGSession(6, 200);
        if (!session?.user?.id) return { ok: true, data: null };
      }

      const res = await client
        .from("vg_profiles")
        .select("settings")
        .eq("user_id", session.user.id)
        .single();

      if (res.error) {
        return { ok: false, error: String(res.error.message || res.error) };
      }

      const s = res?.data?.settings || {};
      return {
        ok: true,
        data: {
          auto_chat: !!s.auto_chat,
          send_delay_sec: Number.isFinite(+s.send_delay_sec)
            ? +s.send_delay_sec
            : 0,
          preset_id:
            typeof s.preset_id === "string" && s.preset_id ? s.preset_id : null,
          protections_on: Array.isArray(s.protections_on)
            ? s.protections_on.filter(Boolean)
            : null,
        },
      };
    }

    case "VG_SAVE_SETTINGS": {
      const patch = msg?.patch || {};
      const {
        data: { session },
      } = await client.auth.getSession();
      if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };

      // read current -> merge -> update (or upsert if missing)
      let cur = {};
      try {
        const { data } = await client
          .from("vg_profiles")
          .select("settings")
          .eq("user_id", session.user.id)
          .single();
        cur = data?.settings || {};
      } catch (_) {}

      const next = {
        ...cur,
        ...("auto_chat" in patch ? { auto_chat: !!patch.auto_chat } : {}),
        ...("send_delay_sec" in patch
          ? { send_delay_sec: parseInt(patch.send_delay_sec || 0, 10) || 0 }
          : {}),
        ...("preset_id" in patch ? { preset_id: patch.preset_id || null } : {}),
        ...("protections_on" in patch
          ? {
              protections_on: Array.isArray(patch.protections_on)
                ? patch.protections_on
                : null,
            }
          : {}),
      };

      // try UPDATE first
      let { data: upd, error: updErr } = await client
        .from("vg_profiles")
        .update({ settings: next, updated_at: new Date().toISOString() })
        .eq("user_id", session.user.id)
        .select("user_id");

      if (updErr || !Array.isArray(upd) || upd.length === 0) {
        // row missing → UPSERT
        const { error: insErr } = await client
          .from("vg_profiles")
          .upsert(
            { user_id: session.user.id, settings: next },
            { onConflict: "user_id" }
          );
        if (insErr)
          return { ok: false, error: String(insErr.message || insErr) };
      }
      return { ok: true };
    }

    case "OPEN_POPUP": {
      try {
        await browser.browserAction.openPopup();
        vgDebug("OPEN_POPUP → action");
        return { ok: true, mode: "action" };
      } catch (e1) {
        try {
          const url = browser.runtime.getURL("popup.html");
          const w = await browser.windows.create({
            url,
            type: "popup",
            width: 420,
            height: 470,
            focused: true,
          });
          vgDebug("OPEN_POPUP → window", w?.id);
          return { ok: true, mode: "window", windowId: w?.id ?? null };
        } catch (e2) {
          try {
            const url = browser.runtime.getURL("popup.html");
            await browser.tabs.create({ url });
            vgDebug("OPEN_POPUP → tab");
            return { ok: true, mode: "tab" };
          } catch (e3) {
            // keep real problems visible
            vgWarn("OPEN_POPUP failed", e1, e2, e3);
            return { ok: false, error: String(e3?.message || e3) };
          }
        }
      }
    }

    // Phase 3.3 — capture the visible tab (returns PNG data URL)
    case "VG_CAPTURE_VISIBLE_TAB": {
      try {
        const winId = sender?.tab?.windowId ?? undefined; // current window by default
        const dataUrl = await new Promise((resolve, reject) => {
          browser.tabs
            .captureVisibleTab(winId, { format: "png" })
            .then((url) => {
              const err = browser.runtime.lastError;
              if (err || !url)
                return reject(new Error(err?.message || "capture failed"));
              resolve(url);
            });
        });
        return { ok: true, dataUrl };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // >>> INSERTED CASE START <<<
    case "VG_OPEN_SIGNIN_POPUP": {
      try {
        // Prefer a real popup window, independent of action button
        const url = browser.runtime.getURL("popup.html?auto=1"); // ← flag this flow for auto-close
        const w = await browser.windows.create({
          url,
          type: "popup",
          width: 384,
          height: 470,
          focused: true,
        });
        return { ok: true, mode: "window", windowId: w?.id ?? null };
      } catch (e1) {
        try {
          await browser.browserAction.openPopup();
          return { ok: true, mode: "action" };
        } catch (e2) {
          try {
            const url = browser.runtime.getURL("popup.html");
            await browser.tabs.create({ url });
            return { ok: true, mode: "tab" };
          } catch (e3) {
            return { ok: false, error: String(e3?.message || e3) };
          }
        }
      }
    }

    // ===== NEW: Prompt Library fetch proxy =====
    case "FETCH_PROMPTS": {
      try {
        const items = await fetchPromptsREST(
          msg?.filter || { status: "published" }
        );
        return { ok: true, items };
      } catch (e) {
        console.warn("[VG][bg] FETCH_PROMPTS failed:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // ===== Team Prompts (cached) =====
    case "GET_TEAM_PROMPTS": {
      try {
        const rows = await __vgGetTeamPromptsCached(false);
        return {
          ok: true,
          prompts: rows,
          hasAny: rows.length > 0,
          cachedAt: __vgTeamPromptsCache.ts,
        };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    case "REFRESH_TEAM_PROMPTS": {
      try {
        const rows = await __vgGetTeamPromptsCached(true);
        return {
          ok: true,
          prompts: rows,
          hasAny: rows.length > 0,
          cachedAt: __vgTeamPromptsCache.ts,
        };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    /* ===== Auth: send password reset email (BG fallback for popup) ===== */
    case "AUTH_RESET_PASSWORD": {
      try {
        const email = String(msg?.email || "").trim();
        if (!email) return { ok: false, error: "missing email" };

        const redirectTo = msg?.redirectTo || RESET_PASSWORD_REDIRECT;
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (error) return { ok: false, error: error.message || String(error) };

        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // === Team subscription checkout (Stripe) ===
    case "TEAM_CHECKOUT_START": {
      try {
        // 0) Ensure fresh session (mirrors web app)
        let {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };
        const now = Math.floor(Date.now() / 1000);
        if (
          Number.isFinite(session.expires_at) &&
          session.expires_at - now < 30
        ) {
          const ref = await client.auth.refreshSession();
          session = ref?.data?.session || session;
        }

        // 1) Gate: admin + trial_expired
        const snap = await __vgComputeAccessSnapshot();
        const status = String(snap?.team_status || "").toLowerCase();
        const isAdmin = snap?.admin_is_me === true;
        vgDebug("TEAM_CHECKOUT_START in →", { status, isAdmin });

        if (!(status === "trial_expired" && isAdmin)) {
          return { ok: false, error: "NOT_ALLOWED" };
        }

        // 2) Inputs (minimal, to match web app contract)
        const seatsMsg = Number.isFinite(+msg?.seats) ? +msg.seats : NaN;
        const seats =
          seatsMsg >= 5
            ? seatsMsg
            : Number.isFinite(+snap?.team_seats_purchased)
            ? +snap.team_seats_purchased
            : 5;
        const isAnnual =
          typeof msg?.isAnnual === "boolean" ? !!msg.isAnnual : true;
        const getUnitPrice = (n) => (n >= 26 ? 7.99 : n >= 11 ? 8.99 : 9.99);
        const unitPrice = getUnitPrice(seats);
        vgDebug("Invoking EF create-team-checkout:", {
          seats,
          isAnnual,
          unitPrice,
        });

        // 3) Call EF EXACTLY like web app (no manual headers; no extra body fields)
        let r;
        try {
          r = await client.functions.invoke("create-team-checkout", {
            body: { seats, isAnnual, unitPrice }, // <- match web app payload
          });
        } catch (thrown) {
          console.warn("[BG] EF thrown:", thrown);
          return {
            ok: false,
            error: `EF_THROWN: ${String(thrown?.message || thrown)}`,
          };
        }

        if (r?.error) {
          // Try to pull status/body from supabase-js; if not available, fallback to raw fetch.
          let status = undefined,
            bodyText = "";
          try {
            status = r.error?.context?.response?.status;
          } catch {}
          try {
            bodyText = await r.error?.context?.response?.text();
          } catch {}

          if (!bodyText) {
            // 🔎 Raw fallback: hit the function endpoint directly to capture exact status+text
            try {
              const fnBase = VG_SUPABASE_URL.replace(
                ".supabase.co",
                ".functions.supabase.co"
              );
              const diagRes = await fetch(`${fnBase}/create-team-checkout`, {
                method: "POST",
                headers: {
                  authorization: `Bearer ${session.access_token}`,
                  apikey: VG_SUPABASE_ANON_KEY,
                  "content-type": "application/json",
                },
                body: JSON.stringify({ seats, isAnnual, unitPrice }),
              });
              const diagText = await diagRes.text();
              console.warn("[BG] EF RAW FETCH →", diagRes.status, diagText);
              return { ok: false, error: `RAW_${diagRes.status}: ${diagText}` };
            } catch (rawErr) {
              console.warn("[BG] EF raw fetch failed:", rawErr);
            }
          }

          console.warn("[BG] EF error detail:", {
            status,
            bodyText,
            err: r.error,
          });
          return {
            ok: false,
            error:
              bodyText ||
              r.error?.message ||
              `EF_STATUS_${status || "UNKNOWN"}`,
          };
        }

        const url = r?.data?.url || r?.data?.checkout_url;
        if (!url) return { ok: false, error: "NO_CHECKOUT_URL" };

        try {
          await browser.tabs.create({ url });
        } catch (e) {
          console.warn("[BG] tabs.create failed:", e);
        }
        return { ok: true, url, sessionId: r?.data?.sessionId || null };
      } catch (e) {
        console.warn("[BG] TEAM_CHECKOUT_START throw:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    /* ===== Start Stripe Checkout for a paid prompt ===== */
    case "VG_START_PROMPT_CHECKOUT": {
      try {
        // Require login
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.access_token) return { ok: false, reason: "NO_SESSION" };

        const prompt_id = String(msg?.prompt_id || "").trim();
        if (!prompt_id) return { ok: false, error: "missing prompt_id" };

        // Call your Edge function: create-prompt-checkout
        const r = await fetch(PROMPT_CHECKOUT_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ prompt_id }),
        });

        let out = {};
        try {
          out = await r.json();
        } catch {}

        if (!r.ok || out?.success !== true || !out?.checkout_url) {
          const err = out?.error || `HTTP ${r.status}`;
          return { ok: false, error: err };
        }

        return {
          ok: true,
          checkout_url: out.checkout_url,
          session_id: out.session_id || null,
        };
      } catch (e) {
        console.warn("[VG] VG_START_PROMPT_CHECKOUT error:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // ===== Quick Add usage log (RPC → vg_log_quick_use) =====
    case "VG_LOG_QUICK_USE": {
      const { prompt_id } = msg || {};
      if (!prompt_id) return { ok: false, error: "missing prompt_id" };

      const session = await __vgGetSessionMaybeWait(_host);
      vgDebug("[bg] VG_LOG_QUICK_USE in →", {
        prompt_id,
        hasSession: !!session?.user?.id,
      });
      if (!session?.user?.id) return { ok: false, error: "NO_SESSION" };

      try {
        const out = await client.rpc("vg_log_quick_use", {
          _prompt_id: prompt_id,
        });
        vgDebug("[bg] RPC out →", out);
        if (out?.error) {
          const msg = String(out.error.message || "").toLowerCase();
          const isLimit = msg.includes("quick add limit");
          const isDup =
            msg.includes("duplicate") ||
            msg.includes("already") ||
            msg.includes("exists");
          if (isDup) return { ok: true, reason: "DUP" }; // ← repeat insert is allowed
          return {
            ok: false,
            error: out.error.message,
            reason: isLimit ? "LIMIT" : "ERROR",
          };
        }
        return { ok: true, data: out.data ?? null };
      } catch (e) {
        console.warn("[VG][bg] RPC throw →", e);
        // network hiccup → do not hard block insert
        return { ok: true, reason: "NET_FLAKY" };
      }
    }

    case "VB_PLACEMENT_SUB": {
      const tabId = sender?.tab?.id;
      const host = (msg?.host || "").toLowerCase();
      const path = msg?.path || "/";
      if (!tabId || !host) return { ok: false, error: "missing tab/host" };
      const init = await vbStartPlacementSub(tabId, host, path);
      return { ok: true, placement: init || null };
    }

    // ===== Custom Guard usage log (RPC → vg_log_guard_use) =====
    case "VG_LOG_GUARD_USE": {
      const { guard_id } = msg || {};
      if (!guard_id) return { ok: false, error: "missing guard_id" };

      const session = await __vgGetSessionMaybeWait(_host);
      vgDebug("[bg] VG_LOG_GUARD_USE in →", {
        guard_id,
        hasSession: !!session?.user?.id,
      });
      if (!session?.user?.id) return { ok: false, error: "NO_SESSION" };

      try {
        const out = await client.rpc("vg_log_guard_use", {
          _guard_id: guard_id,
        });
        vgDebug("[bg] VG_LOG_GUARD_USE RPC →", out);
        if (out?.error) {
          const msg = String(out.error.message || "").toLowerCase();
          const isLimit =
            msg.includes("custom guard limit") || msg.includes("guard limit");
          const isDup =
            msg.includes("duplicate") ||
            msg.includes("already") ||
            msg.includes("exists");
          if (isDup) return { ok: true, reason: "DUP" }; // ← repeat insert is allowed
          return {
            ok: false,
            error: out.error.message,
            reason: isLimit ? "LIMIT" : "ERROR",
          };
        }
        return { ok: true, data: out.data ?? null };
      } catch (e) {
        console.warn("[VG][bg] VG_LOG_GUARD_USE RPC throw →", e);
        // network hiccup → do not hard block insert
        return { ok: true, reason: "NET_FLAKY" };
      }
    }

    // ===== Forward "open billing" from content/popup to the active tab (with fresh auth broadcast) =====
    case "VG_OPEN_BILLING": {
      try {
        // 1) Refresh our idea of session and broadcast it so content gets VG_AUTH_CHANGED immediately
        let signed = false;
        try {
          const {
            data: { session },
          } = await client.auth.getSession();
          __VG_SIGNED_IN = !!session?.user;
          signed = __VG_SIGNED_IN;
        } catch (_) {
          __VG_SIGNED_IN = false;
          signed = false;
        }
        await __vgBroadcastAuth(signed);

        // 2) Now forward the open-billing event to the active tab
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id) {
          browser.tabs
            .sendMessage(tab.id, { type: "VG_OPEN_BILLING" })
            .catch(() => void browser.runtime.lastError); // Simply ignore the error // browser.runtime.lastError
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // ===== Reset pill position (delete per-user overrides) =====
    case "VG_RESET_PILL_POS": {
      try {
        const hostMsg = String(msg?.host || "")
          .toLowerCase()
          .replace(/^www\./, "");
        const scope = msg?.scope === "site" ? "site" : "page";
        const pathMsg = typeof msg?.path === "string" ? msg.path : "/";

        if (!hostMsg) return { ok: false, error: "MISSING_HOST" };

        const {
          data: { session },
        } = await client.auth.getSession();
        const uid = session?.user?.id || null;
        if (!uid) return { ok: false, error: "NOT_SIGNED_IN" };

        if (scope === "site") {
          // Delete ALL overrides for this user+host (any path_prefix)
          const { count, error } = await client
            .from("vg_user_site_overrides")
            .delete()
            .eq("user_id", uid)
            .eq("host", hostMsg)
            .select("path_prefix", { count: "exact", head: true });

          if (error)
            return { ok: false, error: String(error.message || error) };
          return { ok: true, deleted: typeof count === "number" ? count : 0 };
        } else {
          // Delete ONLY the override for this exact normalized path
          const exact = __vgNormalizePath(pathMsg);
          const { count, error } = await client
            .from("vg_user_site_overrides")
            .delete()
            .match({ user_id: uid, host: hostMsg, path_prefix: exact })
            .select("path_prefix", { count: "exact", head: true });

          if (error)
            return { ok: false, error: String(error.message || error) };
          return { ok: true, deleted: typeof count === "number" ? count : 0 };
        }
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // ===== Save pill position (drag-and-drop) =====
    case "VG_SAVE_PILL_POS": {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const uid = session?.user?.id || null;
        if (!uid) return { ok: false, error: "NOT_SIGNED_IN" };

        const host = String(msg?.host || "")
          .toLowerCase()
          .replace(/^www\./, "");
        const pathRaw = typeof msg?.path === "string" ? msg.path : "/";
        const path = __vgNormalizePath(pathRaw);
        const dx = Number.isFinite(+msg?.dx) ? +msg.dx : 0;
        const dy = Number.isFinite(+msg?.dy) ? +msg.dy : 0;
        const corner = (msg?.anchor_corner || "").toLowerCase(); // 'tl'|'tr'|'bl'|'br'|''

        // never write pill_size here (size stays controlled by base row)
        const row = {
          user_id: uid,
          host,
          path_prefix: path || "/",
          dx,
          dy,
          ...(corner ? { anchor_corner: corner } : {}),
          placement_updated_at: new Date().toISOString(),
          state: "inherit", // don’t force on/off here; keep visibility behavior untouched
        };

        const { error } = await client
          .from("vg_user_site_overrides")
          .upsert(row, { onConflict: "user_id,host,path_prefix" });

        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // Relay Quick Menu toggle to the SAME tab that clicked the pill (inject on demand)
    case "VG_QM_TOGGLE": {
      try {
        // Prefer the sender tab; fallback to active tab in the last focused window
        const getTabId = async () =>
          sender?.tab?.id ??
          (
            await browser.tabs.query({ active: true, lastFocusedWindow: true })
          )[0]?.id;

        const id = await getTabId();
        if (!id) return { ok: false, error: "NO_TARGET_TAB" };

        // Ensure quickmenu.js is present and listening in that tab
        const ensured = await __vgEnsureQuickMenuLoaded(id);
        vgDebug("VG_QM_TOGGLE: ensured quickmenu", { tabId: id, ensured });

        // Now send the canonical toggle message
        browser.tabs
          .sendMessage(id, { type: "VG_QM_TOGGLE" })
          .catch(() => void browser.runtime.lastError); // Simply ignore the error // browser.runtime.lastError

        return { ok: true, tabId: id, ensured };
      } catch (e) {
        console.warn("[BG] VG_QM_TOGGLE error:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // ===== Bug Buster intake summarizer (via Supabase Edge) =====
    case "BUG_BUSTER:SUMMARIZE": {
      const { site, messages } = msg || {};
      try {
        const text = await __bbSummarizeViaSupabase(
          site || "this site",
          messages || []
        );
        return { ok: true, summary: text };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // === AI Chat routes ===
    case "AI_CHAT:CREATE_WITH_SUMMARY": {
      const { site, summary_text, title } = msg || {};
      const j = await __aiChatCall(AI_CREATE_URL, {
        site,
        summary_text,
        title,
      });
      return { ok: true, session_id: j.session_id };
    }

    case "AI_CHAT:NEW_SESSION": {
      return { ok: true, can_create_on_first_send: true };
    }

    case "AI_CHAT:SEND": {
      const { session_id, site, user_text } = msg || {};
      const j = await __aiChatCall(AI_SEND_URL, {
        session_id,
        site,
        user_text,
      });
      return { ok: true, session_id: j.session_id, assistant: j.assistant };
    }

    case "AI_CHAT:SUMMARIZE": {
      try {
        const { session_id, site, messages } = msg || {};
        // If we have a session, let the Edge fn use it; otherwise send page transcript.
        const payload = session_id ? { session_id } : { site, messages };

        // (optional debug; super handy in the SW console)
        vgDebug("AI_CHAT:SUMMARIZE →", { payload });

        const j = await __aiChatCall(AI_SUMMARIZE_URL, payload);

        // Normalize and bubble errors back to UI if any
        if (!j || typeof j.summary !== "string" || !j.summary.trim()) {
          return { ok: false, error: "Empty summary", data: j };
        }
        return { ok: true, summary: j.summary };
      } catch (e) {
        console.warn("[BG] AI_CHAT:SUMMARIZE failed:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    case "AI_CHAT:GET_MESSAGES": {
      const { session_id, limit } = msg || {};
      const rows = await __aiGetMessages(session_id, limit || 50);
      return { ok: true, messages: rows };
    }

    case "AI_CHAT:LIST_SESSIONS": {
      const session = await __vgGetSessionMaybeWait(_host);
      if (!session?.user?.id) return { ok: true, sessions: [] };

      const { data, error } = await client
        .from("ai_chat_sessions")
        .select("id, title, site, is_archived, updated_at, last_summary")
        .eq("user_id", session.user.id)
        .order("updated_at", { ascending: false })
        .limit(50);

      if (error) return { ok: false, error: String(error.message || error) };
      return { ok: true, sessions: data || [] };
    }

    // 🔧 Session validation endpoint for content scripts
    case "VG_VALIDATE_SESSION": {
      try {
        await __bgValidateAndRefreshSession();
        const {
          data: { session },
        } = await client.auth.getSession();
        return {
          ok: true,
          hasSession: !!session?.user?.id,
          userId: session?.user?.id || null,
          email: session?.user?.email || null,
        };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // ===== NEW: placements for auto-anchoring the pill =====
    case "VG_GET_PAGE_PLACEMENTS": {
      const host = (msg?.host || "").toLowerCase();
      // prefer explicit msg.path; otherwise fall back to active tab path
      const path =
        typeof msg?.path === "string" && msg.path
          ? msg.path
          : await __vgActiveTabPath();
      if (!host) return { ok: false, error: "missing host" };

      try {
        const rows = await fetchPagePlacementsForHost(host);

        // Path-aware user override for the FIRST paint
        let ov = null;
        try {
          ov = await __vussoReadOverride(host, path);
        } catch {}

        if (!ov) {
          return { ok: true, placements: rows || [] };
        }

        // Null-safe merge that NEVER changes size
        const has = (v) => v !== undefined && v !== null && v !== "";
        const merged = (rows || []).map((r) => {
          const out = { ...r };
          if (has(ov.dx)) out.dx = ov.dx;
          if (has(ov.dy)) out.dy = ov.dy;
          if (has(ov.anchor_corner)) out.anchor_corner = ov.anchor_corner;
          if (ov.placement_updated_at) out.updated_at = ov.placement_updated_at;
          return out;
        });

        vgDebug("[GET_PAGE_PLACEMENTS]", {
          host,
          path,
          ov_dx: ov?.dx,
          ov_dy: ov?.dy,
          ov_corner: ov?.anchor_corner,
          rows: rows?.length ?? 0,
        });

        return { ok: true, placements: merged };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    case "VG_INTENT_FETCH_GUARDS": {
      try {
        vgDebug("[VG_INTENT_FETCH_GUARDS] in");
        let session = await __vgGetSessionMaybeWait(_host);
        if (!session?.user?.id) {
          session = await __vgEnsureBGSession(10, 300);
          if (!session?.user?.id) {
            await __bgValidateAndRefreshSession();
            session = await __vgGetSessionMaybeWait(_host);
          }
          if (!session?.user?.id) {
            return { ok: true, guards: [] };
          }
        }

        const columns =
          "id,title,preview,body,tags,site_category,status,visibility,config,auto_generated,auto_generated_source,auto_generated_version,ownership_type,user_modified_at,updated_at,created_at";
        const { data, error } = await client
          .from("vg_guards")
          .select(columns)
          .eq("ownership_type", "personal")
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(500);

        if (error) {
          console.warn("[BG/VG_INTENT_FETCH_GUARDS] query error:", error);
          return { ok: false, error: String(error.message || error) };
        }

        const guards = (Array.isArray(data) ? data : []).map((row) => ({
          id: row.id,
          title: row.title || "Custom Prompt",
          preview: typeof row.preview === "string" ? row.preview : null,
          body: row.body || "",
          tags: Array.isArray(row.tags) ? row.tags : [],
          siteCategory: row.site_category || null,
          status: row.status || "inactive",
          visibility: row.visibility || "private",
          config:
            row.config && typeof row.config === "object" ? row.config : null,
          autoGenerated: Boolean(row.auto_generated),
          autoSource: row.auto_generated_source || null,
          autoVersion: row.auto_generated_version || 0,
          ownershipType: row.ownership_type || "personal",
          userModifiedAt: row.user_modified_at || null,
          updatedAt: row.updated_at || null,
          createdAt: row.created_at || null,
        }));

        return { ok: true, guards };
      } catch (e) {
        console.warn("[BG/VG_INTENT_FETCH_GUARDS] throw:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    case "VG_LIST_CUSTOM_PROMPTS": {
      try {
        vgDebug("[VG_LIST_CUSTOM_PROMPTS] in");
        let session = await __vgGetSessionMaybeWait(_host);
        vgDebug(
          "[VG_LIST_CUSTOM_PROMPTS] session?",
          !!session?.user?.id,
          "host=",
          _host
        );

        // 🔧 Enhanced session restoration for custom prompts access
        if (!session?.user?.id) {
          console.log(
            "[BG] No session found for custom prompts, attempting restoration..."
          );

          // Try aggressive session restoration
          session = await __vgEnsureBGSession(10, 300); // 10 retries, 300ms delay

          if (!session?.user?.id) {
            // Final attempt: validate and refresh existing session
            await __bgValidateAndRefreshSession();
            session = await __vgGetSessionMaybeWait(_host);
          }

          if (!session?.user?.id) {
            console.log(
              "[BG] Custom prompts: no session after restoration attempts"
            );
            return { ok: true, items: [] };
          }
        }

        // ⚠️ Only select columns that actually exist on vg_guards
        const sel =
          "id, title, preview, body, tags, site_category, status, visibility, auto_generated, auto_generated_source, auto_generated_version, user_modified_at, updated_at, created_at";

        // Let RLS restrict rows; avoid hard-coding the user column name here
        const { data, error } = await client
          .from("vg_guards")
          .select(sel + ", ownership_type") // include the field (optional but useful)
          .eq("ownership_type", "personal") // <- only personal guards in My Prompts
          .order("updated_at", { ascending: false })
          .limit(500);

        if (error) {
          console.warn("[BG/VG_LIST_CUSTOM_PROMPTS] query error:", error);
          return { ok: false, error: String(error.message || error) };
        }

        const rows = Array.isArray(data) ? data : [];
        vgDebug("[VG_LIST_CUSTOM_PROMPTS] rows:", rows.length);

        const items = rows.map((r) => ({
          id: r.id,
          name: r.title || "Custom Prompt",
          preview: typeof r.preview === "string" ? r.preview : null,
          body: r.body || "",
          tags: Array.isArray(r.tags) ? r.tags : [],
          updatedAt:
            (r.updated_at && Date.parse(r.updated_at)) ||
            (r.created_at && Date.parse(r.created_at)) ||
            Date.now(),
          siteCategory: r.site_category || null,
          status: r.status || "active",
          visibility: r.visibility || "private",
          ownership_type: r.ownership_type || "personal",
          autoGenerated: Boolean(r.auto_generated),
          autoGeneratedSource: r.auto_generated_source || null,
          autoGeneratedVersion: Number(r.auto_generated_version || 0),
          userModifiedAt: r.user_modified_at || null,
        }));

        return { ok: true, items };
      } catch (e) {
        console.warn("[BG/VG_LIST_CUSTOM_PROMPTS] throw:", e);
        return { ok: false, error: String(e?.message || e) };
      }
    }

    /* ======== INSERTED CRUD CASES FOR vg_guards ======== */

    // CREATE
    case "VG_GUARD_CREATE": {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };

        // No gating here; creating a guard from a highlight is always allowed.
        // We still gate at insertion time via VG_CAN_INSERT_CUSTOM.

        let preview =
          typeof msg?.preview === "string"
            ? msg.preview.trim().slice(0, 100)
            : null;
        let tags = Array.isArray(msg?.tags) ? msg.tags : [];
        let config =
          msg?.config && typeof msg.config === "object" ? msg.config : {};
        let packageNotes = null;

        try {
          const packagePayload = {
            title: (msg?.title || "Custom Guard").toString(),
            body: (msg?.body || "").toString(),
            site_category: (msg?.site_category || "general").toString(),
            tags,
            variables: Array.isArray(msg?.variables) ? msg.variables : [],
            task_label:
              typeof config?.intent_task_label === "string"
                ? config.intent_task_label
                : null,
          };

          const startedAt = Date.now();
          const { data: pkgData, error: pkgError } = await client.functions.invoke(
            "custom-prompt-package",
            { body: packagePayload }
          );

          if (pkgError) {
            vgWarn("[VG][prompt-package] invoke failed", {
              error: pkgError,
              durationMs: Date.now() - startedAt,
            });
          } else if (!pkgData?.ok) {
            vgWarn("[VG][prompt-package] response missing ok", {
              pkgData,
              durationMs: Date.now() - startedAt,
            });
          } else {
            vgInfo?.("[VG][prompt-package] enriched prompt", {
              durationMs: Date.now() - startedAt,
              tagCount: Array.isArray(pkgData?.tags) ? pkgData.tags.length : 0,
            });
            if (typeof pkgData?.preview === "string" && pkgData.preview.trim()) {
              preview = pkgData.preview.trim().slice(0, 100);
            }
            if (Array.isArray(pkgData?.tags) && pkgData.tags.length) {
              tags = pkgData.tags.map((tag) => String(tag ?? "").trim()).filter(Boolean);
            }
            if (pkgData?.config && typeof pkgData.config === "object") {
              config = {
                ...config,
                ...pkgData.config,
              };
            }
            packageNotes = typeof pkgData?.notes === "string" ? pkgData.notes : null;
          }
        } catch (pkgException) {
          vgWarn("[VG][prompt-package] exception during invoke", pkgException);
        }

        const payload = {
          user_id: session.user.id,
          title: (msg?.title || "Custom Guard").toString(),
          body: (msg?.body || "").toString(),
          preview,
          variables: Array.isArray(msg?.variables) ? msg.variables : {},
          tags,
          site_category: (msg?.site_category || "general").toString(),
          config,
          visibility: "private",
          status: "active",
          auto_generated: false,
          auto_generated_source: null,
          auto_generated_version: 0,
          user_modified_at: new Date().toISOString(),
        };

        if (packageNotes) {
          vgInfo?.("[VG][prompt-package] notes", packageNotes);
        }

        const { data, error } = await client
          .from("vg_guards")
          .insert(payload)
          .select(
            "id, title, preview, body, tags, site_category, status, visibility, updated_at, created_at"
          )
          .single();

        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true, row: data };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // UPDATE
    case "VG_GUARD_UPDATE": {
      try {
        const id = String(msg?.id || "");
        if (!id) return { ok: false, error: "MISSING_ID" };
        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };

        const patch = {};
        if (typeof msg?.patch?.title === "string")
          patch.title = msg.patch.title;
        if (typeof msg?.patch?.body === "string") patch.body = msg.patch.body;
        if (Array.isArray(msg?.patch?.tags)) patch.tags = msg.patch.tags;
        if (typeof msg?.patch?.preview === "string")
          patch.preview = msg.patch.preview.trim().slice(0, 100);
        else if (msg?.patch && "preview" in msg.patch && msg.patch.preview === null)
          patch.preview = null;

        if (!Object.keys(patch).length)
          return { ok: false, error: "EMPTY_PATCH" };

        patch.auto_generated = false;
        patch.auto_generated_source = null;
        patch.user_modified_at = new Date().toISOString();

        const { data, error } = await client
          .from("vg_guards")
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select(
            "id, title, preview, body, tags, site_category, status, visibility, updated_at, created_at"
          )
          .single();

        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true, row: data };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // DELETE
    case "VG_DELETE_GUARD": {
      try {
        const id = String(msg?.id || "");
        if (!id) return { ok: false, error: "MISSING_ID" };

        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };

        const { error } = await client
          .from("vg_guards")
          .delete()
          .eq("id", id)
          .select("id")
          .single();

        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // SET STATUS (active/inactive)
    case "VG_GUARD_SET_STATUS": {
      try {
        const id = String(msg?.id || "");
        const on = !!msg?.on;
        if (!id) return { ok: false, error: "MISSING_ID" };

        const {
          data: { session },
        } = await client.auth.getSession();
        if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };

        const { error } = await client
          .from("vg_guards")
          .update({
            status: on ? "active" : "inactive",
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .select("id")
          .single();

        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    /* ======== END INSERTED CRUD CASES ======== */

    // ===== Quick-Add Favorites (server-roaming) =====
    case "VG_LIST_QA_FAVORITES": {
      try {
        const session = await __vgGetSessionMaybeWait(_host);
        if (!session?.user?.id) return { ok: true, data: [] };
        const { data, error } = await client
          .from("vg_quick_favs")
          .select("prompt_id")
          .eq("user_id", session.user.id);

        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true, data: Array.isArray(data) ? data : [] };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    case "VG_UPSERT_QA_FAVORITE": {
      try {
        const { prompt_id } = msg || {};
        if (!prompt_id) return { ok: false, error: "missing prompt_id" };
        const session = await __vgGetSessionMaybeWait(_host);
        if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };

        // No gating: users may favorite unlimited items
        const row = { user_id: session.user.id, prompt_id };
        const { error } = await client
          .from("vg_quick_favs")
          .upsert(row, { onConflict: "user_id,prompt_id" });
        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    case "VG_DELETE_QA_FAVORITE": {
      try {
        const { prompt_id } = msg || {};
        if (!prompt_id) return { ok: false, error: "missing prompt_id" };
        const session = await __vgGetSessionMaybeWait(_host);
        if (!session?.user?.id) return { ok: false, error: "NOT_SIGNED_IN" };
        const { error } = await client
          .from("vg_quick_favs")
          .delete()
          .match({ user_id: session.user.id, prompt_id });
        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // List purchased prompt_ids for current user (Marketplace ownership)
    case "VG_LIST_PURCHASES": {
      try {
        const session = await __vgGetSessionMaybeWait(_host);
        if (!session?.user?.id) return { ok: true, rows: [] };

        const { data, error } = await client
          .from("user_purchases")
          .select("prompt_id")
          .eq("user_id", session.user.id);

        if (error) return { ok: false, error: String(error.message || error) };
        return { ok: true, rows: Array.isArray(data) ? data : [] };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    /* ===== Creators & Prompts (Marketplace) ===== */
    // List creators for marketplace
    case "VG_CREATORS_LIST": {
      try {
        const { data, error } = await client
          .from("creator_profiles")
          .select("id, user_id, display_name, avatar_url, bio, updated_at")
          .order("updated_at", { ascending: false })
          .limit(200);
        if (error) return { ok: false, error: String(error.message || error) };
        const creators = (data || []).map((r) => ({
          id: r.id, // PRIMARY KEY (use for creator_id match)
          user_id: r.user_id, // secondary key (fallback match)
          name: r.display_name || "Creator",
          avatar_url: r.avatar_url || "",
          desc: r.bio || "",
        }));
        return { ok: true, creators };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // List published prompts for a given creator (matches your schema)
    case "VG_CREATOR_PROMPTS": {
      try {
        const creatorId = msg?.creator_id || null; // creator_profiles.id
        const creatorUid = msg?.creator_user_id || null; // creator_profiles.user_id (optional fallback)
        if (!creatorId && !creatorUid)
          return { ok: false, error: "missing creator_id" };

        // Only select columns that actually exist
        const sel =
          "id,name,type,subcategory,labels,prompt_text,status,creator_id,updated_at,is_paid,price_cents";

        async function fetchBy(val) {
          const { data, error } = await client
            .from("prompts")
            .select(sel)
            .eq("status", "published")
            .eq("creator_id", val) // your table uses 'creator_id' (uuid)
            .order("updated_at", { ascending: false })
            .limit(500);
          if (error) {
            console.warn("[VG] prompts fetch error:", error);
            return [];
          }
          return Array.isArray(data) ? data : [];
        }

        // Try id first; if empty and a user_id was provided, try that too
        let rows = [];
        if (creatorId) rows = await fetchBy(creatorId);
        if ((!rows || rows.length === 0) && creatorUid)
          rows = await fetchBy(creatorUid);

        const prompts = (rows || []).map((row) => {
          const cents =
            typeof row.price_cents === "number" ? row.price_cents : null;
          const paid = row.is_paid === true || (cents != null && cents > 0);
          return {
            id: row.id,
            name: row.name,
            type: row.type || "Prompt",
            subcategory: row.subcategory || "Library",
            labels: Array.isArray(row.labels) ? row.labels : [],
            text: row.prompt_text || "",
            paid,
            price: cents && cents > 0 ? `$${(cents / 100).toFixed(2)}` : "",
          };
        });

        return { ok: true, prompts };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    // === DEBUG: snapshot SW auth state (no side effects)
    case "VG_DEBUG:SESSION_SNAPSHOT": {
      let userId = null,
        hasSession = false,
        email = null;
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        userId = session?.user?.id || null;
        email = session?.user?.email || null;
        hasSession = !!userId;
      } catch {}
      return {
        ok: true,
        host: _host,
        signedFlag: !!__VG_SIGNED_IN, // what the purple pill uses
        sw_user_id: userId,
        email,
        hasSession,
      };
    }

    // === DEBUG: run settings read and surface RLS error details
    case "VG_DEBUG:LOAD_SETTINGS": {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const userId = session?.user?.id || null;

        const res = await client
          .from("vg_profiles")
          .select("settings")
          .eq("user_id", userId)
          .single();

        return {
          ok: !res.error,
          host: _host,
          userId,
          data: res.data || null,
          error: res.error ? String(res.error.message || res.error) : null,
        };
      } catch (e) {
        return { ok: false, host: _host, error: String(e?.message || e) };
      }
    }

    // === DEBUG: profile row for current session user (with error detail)
    case "VG_DEBUG:PROFILE": {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const userId = session?.user?.id || null;
        if (!userId) return { ok: false, host: _host, error: "NO_SESSION" };

        const res = await client
          .from("vg_profiles")
          .select(
            "user_id, display_name, tier, subscription_status, custom_guards_count, updated_at, settings"
          )
          .eq("user_id", userId)
          .single();

        return {
          ok: !res.error,
          host: _host,
          userId,
          data: res.data || null,
          error: res.error ? String(res.error.message || res.error) : null,
        };
      } catch (e) {
        return { ok: false, host: _host, error: String(e?.message || e) };
      }
    }

    // === DEBUG: guards count for current session user
    case "VG_DEBUG:GUARDS_COUNT": {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const userId = session?.user?.id || null;
        if (!userId) return { ok: false, host: _host, error: "NO_SESSION" };

        const res = await client
          .from("vg_guards")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);

        // when head:true, res.data is null; count is in res.count
        return {
          ok: !res.error,
          host: _host,
          userId,
          count: typeof res.count === "number" ? res.count : null,
          error: res.error ? String(res.error.message || res.error) : null,
        };
      } catch (e) {
        return { ok: false, host: _host, error: String(e?.message || e) };
      }
    }

    // === DEBUG: quick favorites count for current session user
    case "VG_DEBUG:FAVS_COUNT": {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const userId = session?.user?.id || null;
        if (!userId) return { ok: false, host: _host, error: "NO_SESSION" };

        const res = await client
          .from("vg_quick_favs")
          .select("prompt_id", { count: "exact", head: true })
          .eq("user_id", userId);

        return {
          ok: !res.error,
          host: _host,
          userId,
          count: typeof res.count === "number" ? res.count : null,
          error: res.error ? String(res.error.message || res.error) : null,
        };
      } catch (e) {
        return { ok: false, host: _host, error: String(e?.message || e) };
      }
    }

    case "VG_DEBUG:DUMP_USER_DATA": {
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        const userId = session?.user?.id || null;
        if (!userId) return { ok: false, error: "NO_SESSION" };

        const [guards, favs] = await Promise.all([
          client
            .from("vg_guards")
            .select("id,name,labels,rank,created_at")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(10),
          client
            .from("vg_quick_favs")
            .select("prompt_id")
            .eq("user_id", userId)
            .limit(10),
        ]);

        return {
          ok: true,
          userId,
          guards: guards?.data || [],
          favs: favs?.data || [],
          guards_error: guards?.error
            ? String(guards.error.message || guards.error)
            : null,
          favs_error: favs?.error
            ? String(favs.error.message || favs.error)
            : null,
        };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    case "VG_DEBUG:CONFIG": {
      return {
        ok: true,
        url: VG_SUPABASE_URL,
        key_hint: (VG_SUPABASE_ANON_KEY || "").slice(0, 6) + "…",
      };
    }

    // === RELAY: paywall trigger from any script → content script in this tab
    case "VG_PAYWALL_SHOW": {
      try {
        const pay = msg?.payload || {};
        const tabId = sender?.tab?.id;
        if (tabId) {
          // forward to the content script in *this* tab
          browser.tabs
            .sendMessage(tabId, { type: "VG_PAYWALL_SHOW", payload: pay })
            .catch(() => void browser.runtime.lastError); // Simply ignore the error // browser.runtime.lastError

          return { ok: true };
        }
        // fallback: active tab in current window
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id) {
          browser.tabs
            .sendMessage(tab.id, { type: "VG_PAYWALL_SHOW", payload: pay })
            .catch(() => void browser.runtime.lastError); // Simply ignore the error // browser.runtime.lastError
          return { ok: true };
        }
        return { ok: false, error: "NO_TARGET_TAB" };
      } catch (e) {
        return { ok: false, error: String(e?.message || e) };
      }
    }

    default:
      return { ok: false, error: "Unknown message" };
  }
}

// Listener (pass sender host to the router)
browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      const _host = (() => {
        try {
          return new URL(_sender?.url || "").hostname.toLowerCase();
        } catch {
          return "";
        }
      })();

      const res = await handleMessage(msg, _host, _sender); // ← pass host + sender
      sendResponse(res);
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // keep channel open for async response
});

// Cleanup: if a tab that subscribed is closed, drop its realtime channel
try {
  browser.tabs.onRemoved.addListener((tabId) => {
    const sub = VB_PLACEMENT_SUBS?.get?.(tabId);
    if (sub?.chan) {
      try {
        sub.chan.unsubscribe();
      } catch {}
    }
    VB_PLACEMENT_SUBS?.delete?.(tabId);
  });
} catch {}

// Hotkeys
browser.commands?.onCommand.addListener(async (command) => {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return;

    if (command === "open-marketplace") {
      browser.tabs.sendMessage(
        tab.id,
        { type: "VG_OPEN_MARKETPLACE" }, // have your UI route this to the Marketplace tab
        () => void browser.runtime.lastError
      );
      return;
    }

    if (command === "capture-screenshot") {
      // Ensure screenshot module is present, then open overlay

      if (
        typeof chrome !== "undefined" &&
        chrome.scripting &&
        chrome.scripting.executeScript
      ) {
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: ["src/ui/screenshot.js"] },
          () =>
            browser.tabs
              .sendMessage(tab.id, { type: "VG_SCREENSHOT_OPEN" })
              .catch(() => void browser.runtime.lastError)
        );
      } else {
        browser.tabs
          .executeScript(tab.id, { file: "src/ui/screenshot.js" })
          .then(() => {
            browser.tabs
              .sendMessage(tab.id, { type: "VG_SCREENSHOT_OPEN" })
              .catch(() => void browser.runtime.lastError); // Simply ignore the error // browser.runtime.lastError
          });
      }
      return;
    }
  } catch (e) {
    console.warn("[VG] command handler failed", e);
  }
});

// Keep cache fresh + broadcast to allowed tabs when auth changes
client.auth.onAuthStateChange((_event, session) => {
  try {
    __VG_SIGNED_IN = !!session?.user;
    dbg("[BG] onAuthStateChange → signedIn =", __VG_SIGNED_IN);

    // user changed → clear team cache
    __vgTeamPromptsCache = { ts: 0, rows: [], uid: null };

    __vgBroadcastAuth(__VG_SIGNED_IN);
    __vgComputeAccessSnapshot(); // ← refresh team access snapshot on auth change
    refreshAdminControls(true).catch(() => {});
  } catch (e) {
    console.warn("[BG] auth broadcast failed", e);
  }
});
const intentBatchCounters = new Map();

function updateIntentBatchCounter(key, message, maxMessages) {
  if (!key) {
    return { count: 0, firstCapturedAt: null, messages: [] };
  }
  const entry =
    intentBatchCounters.get(key) || {
      count: 0,
      firstCapturedAt: null,
      messages: [],
    };
  entry.count += 1;
  if (!entry.firstCapturedAt) {
    entry.firstCapturedAt = Date.now();
  }
  if (message) {
    entry.messages.push(message);
    const limit = Math.max(
      1,
      Number.isFinite(maxMessages) && maxMessages > 0
        ? Math.round(maxMessages)
        : ADMIN_CONTROL_DEFAULTS.intent_window_batch_threshold
    );
    entry.messages = entry.messages
      .slice(-limit)
      .filter((m) => m && m.intent_message_id);
  }
  intentBatchCounters.set(key, entry);
  return entry;
}

function resetIntentBatchCounter(key) {
  if (!key) return;
  intentBatchCounters.delete(key);
}

async function handleIntentCaptureBatch({ userId, message, tokenCount }) {
  const normalizedTokenCount =
    typeof tokenCount === "number" && Number.isFinite(tokenCount)
      ? Math.max(0, Math.round(tokenCount))
      : null;

  try {
    const rawThreshold = getAdminControlValue("intent_window_batch_threshold");
    const batchThreshold = Math.max(
      1,
      Number.isFinite(rawThreshold)
        ? Math.round(rawThreshold)
        : ADMIN_CONTROL_DEFAULTS.intent_window_batch_threshold
    );

    const counterKey = `${userId}`;
    const counter = updateIntentBatchCounter(
      counterKey,
      message,
      batchThreshold
    );
    const { count, messages } = counter;

    const logPayload = {
      id: message?.intent_message_id || null,
      host: message?.source_url || null,
      tokens: normalizedTokenCount,
      count,
      threshold: batchThreshold,
    };

    let batchReady = false;

    if (
      count >= batchThreshold &&
      message?.intent_message_id
    ) {
      batchReady = true;
      vgInfo?.("[VG][intent] batch ready", logPayload);

      const windowMessages = Array.isArray(messages)
        ? messages.slice(-batchThreshold)
        : [];
      const messageIds = windowMessages
        .map((m) => m?.intent_message_id)
        .filter(Boolean);
      const sourceHosts = Array.from(
        new Set(
          windowMessages
            .map((m) => m?.source_url)
            .filter((host) => typeof host === "string" && host.length)
        )
      );
      const windowStartIso =
        windowMessages[0]?.captured_at || message?.captured_at;
      const windowEndIso =
        windowMessages[windowMessages.length - 1]?.captured_at ||
        message?.captured_at;

      await maybeHandleIntentWindow({
        userId,
        sourceUrl: message?.source_url || null,
        sourceHosts,
        windowStartIso,
        windowEndIso,
        messageIds,
      });

      resetIntentBatchCounter(counterKey);
    } else {
      vgInfo?.("[VG][intent] captured", logPayload);
    }

    return {
      batchReady,
      count,
      threshold: batchThreshold,
    };
  } catch (err) {
    vgWarn("[VG][intent] batch pipeline exception", err);
    return {
      batchReady: false,
      count: 0,
      threshold: 1,
    };
  }
}

async function maybeHandleIntentWindow({
  userId,
  sourceUrl,
  sourceHosts,
  windowStartIso,
  windowEndIso,
  messageIds,
}) {
  try {
    if (!Array.isArray(messageIds) || !messageIds.length) return;

    const { data: windowInsert, error: windowInsertError } = await client
      .from("intent_windows")
      .insert({
        user_id: userId,
        source_url: sourceUrl,
        source_hosts: sourceHosts.length ? sourceHosts : null,
        message_ids: messageIds,
        started_at: windowStartIso,
        ended_at: windowEndIso,
        message_count: messageIds.length,
        custom_prompt_created: false,
        custom_prompt_error: null,
      })
      .select("window_id")
      .single();

    if (windowInsertError) {
      throw windowInsertError;
    }

    await handleIntentWindowInsights({
      userId,
      windowId: windowInsert?.window_id || null,
      sourceHosts,
      windowStartIso,
      windowEndIso,
      messageIds,
    });
  } catch (err) {
    vgWarn("[VG][intent] window insert failed:", err);
  }
}

async function handleIntentWindowInsights({
  userId,
  windowId,
  sourceHosts,
  windowStartIso,
  windowEndIso,
  messageIds,
}) {
  try {
    const { data: messageRows, error: messageErr } = await client
      .from("intent_messages")
      .select(
        "intent_message_id,captured_at,source_url,raw_text,intent_segments,token_count,is_rich_text,response_excerpt,response_excerpt_hash,response_captured_at,response_source"
      )
      .in("intent_message_id", messageIds)
      .order("captured_at", { ascending: true });

    if (messageErr) {
      vgWarn("[VG][intent] fetch messages failed", messageErr);
      return;
    }

    const { data: profileRow } = await client
      .from("intent_profiles")
      .select("profile_version,profile,persona,confidence")
      .eq("user_id", userId)
      .maybeSingle();

    const recentOutputs = Array.isArray(messageRows)
      ? (() => {
          const sorted = [...messageRows].sort((a, b) => {
            const left = Date.parse(
              a?.response_captured_at || a?.captured_at || 0
            );
            const right = Date.parse(
              b?.response_captured_at || b?.captured_at || 0
            );
            return right - left;
          });
          const seen = new Set();
          const out = [];
          for (const row of sorted) {
            const rawExcerpt = sanitizeResponseExcerpt(
              row?.response_excerpt || ""
            );
            if (!rawExcerpt) continue;
            const excerpt = truncateResponseExcerpt(rawExcerpt);
            const hash = row?.response_excerpt_hash || hashString(excerpt);
            if (hash && seen.has(hash)) continue;
            if (hash) seen.add(hash);
            const host =
              typeof row?.response_source === "string" && row.response_source
                ? row.response_source.toLowerCase()
                : typeof row?.source_url === "string" && row.source_url
                ? row.source_url.toLowerCase()
                : null;
            out.push({
              host,
              excerpt,
              captured_at:
                row?.response_captured_at || row?.captured_at || null,
            });
            if (out.length >= 3) break;
          }
          return out;
        })()
      : [];

    const invokePayload = {
      window: {
        window_id: windowId || null,
        user_id: userId,
        source_hosts: sourceHosts.length ? sourceHosts : null,
        started_at: windowStartIso,
        ended_at: windowEndIso,
        message_ids: messageIds,
      },
      messages: messageRows ?? [],
      profile_snapshot: profileRow?.profile ?? null,
    };

    try {
      const { data: insightsData, error: insightsErr } =
        await client.functions.invoke("intent-insights", {
          body: invokePayload,
        });
      if (insightsErr) {
        vgWarn("[VG][intent] insights invoke failed", insightsErr);
        return;
      }

      vgInfo?.("[VG][intent] insights", insightsData);

      try {
        await client
          .from("intent_windows")
          .update({
            repetition_snapshot: insightsData?.intent_repetition ?? [],
          })
          .eq("window_id", windowId || null);
      } catch (snapshotErr) {
        vgWarn(
          "[VG][intent] repetition snapshot update failed",
          snapshotErr
        );
      }

      const repetitions = Array.isArray(insightsData?.intent_repetition)
        ? insightsData.intent_repetition.filter(
            (entry) => entry?.threshold_met === true
          )
        : [];

      if (repetitions.length) {
        for (const entry of repetitions) {
          await maybeInsertAutoGeneratedGuard({
            userId,
            windowId,
            entry,
            insightsData,
            messageRows,
            recentOutputs,
          });
        }
      }
    } catch (fnErr) {
      vgWarn("[VG][intent] insights exception", fnErr);
    }
  } catch (err) {
    vgWarn("[VG][intent] window pipeline exception", err);
  }
}

async function maybeInsertAutoGeneratedGuard({
  userId,
  windowId,
  entry,
  insightsData,
  messageRows,
  recentOutputs,
}) {
  try {
    if (!entry?.task_label) return false;

    const normalizedTaskKey = normalizeTaskLabel(entry.task_label);
    const promptPayload = {
      user_id: userId,
      window_id: windowId || null,
      task_label: entry.task_label,
      total_recent_count: entry?.total_recent_count ?? null,
      count_in_window: entry?.count_in_window ?? null,
      persona:
        insightsData?.profile?.persona &&
        typeof insightsData.profile.persona === "string"
          ? insightsData.profile.persona
          : null,
      examples:
        Array.isArray(entry?.examples) && entry.examples.length
          ? entry.examples
          : [],
      messages: Array.isArray(messageRows) ? messageRows : [],
      recent_outputs: recentOutputs,
    };

    vgInfo?.("[VG][intent] invoking prompt builder", {
      windowId: windowId || null,
      taskLabel: entry.task_label,
      totalRecentCount: entry?.total_recent_count ?? null,
      countInWindow: entry?.count_in_window ?? null,
      exampleCount: Array.isArray(promptPayload.examples)
        ? promptPayload.examples.length
        : 0,
      messageCount: Array.isArray(promptPayload.messages)
        ? promptPayload.messages.length
        : 0,
      recentOutputCount: Array.isArray(promptPayload.recent_outputs)
        ? promptPayload.recent_outputs.length
        : 0,
    });

    const builderStartedAt = Date.now();
    const {
      data: promptResult,
      error: promptError,
    } = await client.functions.invoke("intent-prompt-builder", {
      body: promptPayload,
    });

    vgInfo?.("[VG][intent] prompt builder response", {
      windowId: windowId || null,
      taskLabel: entry.task_label,
      durationMs: Date.now() - builderStartedAt,
      hasError: Boolean(promptError),
      hasPayload:
        Boolean(promptResult?.title) &&
        Boolean(promptResult?.body) &&
        Boolean(promptResult?.preview),
    });

    if (promptError) {
      vgWarn("[VG][intent] prompt builder failed", promptError);
      await client
        .from("intent_windows")
        .update({
          custom_prompt_error:
            promptError?.message || String(promptError),
        })
        .eq("window_id", windowId || null);
      return false;
    }

    if (!promptResult?.title || !promptResult?.body) {
      vgWarn(
        "[VG][intent] prompt builder returned empty title/body",
        promptResult
      );
      await client
        .from("intent_windows")
        .update({
          custom_prompt_error:
            "prompt builder returned empty title or body",
        })
        .eq("window_id", windowId || null);
      return false;
    }

    const newTitle = String(promptResult.title).trim();
    const newBody = String(promptResult.body).trim();
    let newPreviewRaw =
      typeof promptResult.preview === "string"
        ? promptResult.preview.trim()
        : "";
    if (!newPreviewRaw) {
      const fallbackFromTitle = (() => {
        const trimmedTitle = newTitle.trim();
        if (!trimmedTitle) return "";
        const capped = trimmedTitle.slice(0, 100).trim();
        return capped || "";
      })();
      const fallbackFromBody = (() => {
        const sentences = newBody.split(/[.!?]/).map((part) => part.trim()).filter(Boolean);
        const firstSentence = sentences.length ? sentences[0] : "";
        return firstSentence ? firstSentence.slice(0, 100).trim() : "";
      })();
      newPreviewRaw = fallbackFromTitle || fallbackFromBody;
      if (newPreviewRaw) {
        vgWarn("[VG][intent] prompt builder missing preview; using fallback", {
          windowId: windowId || null,
          taskLabel: entry.task_label,
          usedTitleFallback: Boolean(fallbackFromTitle),
          usedBodyFallback: Boolean(fallbackFromBody) && !fallbackFromTitle,
        });
      }
    }
    if (!newPreviewRaw) {
      vgWarn("[VG][intent] prompt builder still missing preview after fallback", {
        windowId: windowId || null,
        taskLabel: entry.task_label,
      });
      await client
        .from("intent_windows")
        .update({
          custom_prompt_error: "prompt builder preview empty",
        })
        .eq("window_id", windowId || null);
      return false;
    }
    const newPreview = (() => {
      if (newPreviewRaw.length <= 100) return newPreviewRaw;
      const truncated = newPreviewRaw.slice(0, 100);
      const lastSpace = truncated.lastIndexOf(" ");
      const candidate =
        lastSpace > 60 ? truncated.slice(0, lastSpace) : truncated;
      return `${candidate.replace(/\s+$/, "")}...`;
    })();
    const newTags = Array.isArray(promptResult.tags)
      ? promptResult.tags
          .map((tag) => String(tag ?? "").trim())
          .filter(Boolean)
      : [];
    const newVariables = Array.isArray(promptResult.variables)
      ? promptResult.variables
      : [];
    const newSiteCategory =
      String(promptResult.site_category ?? "general").trim() || "general";
    const baseConfig =
      typeof promptResult.config === "object" && promptResult.config
        ? promptResult.config
        : {};
    const mergedConfigBase = {
      ...baseConfig,
      origin_window_id: windowId || null,
      intent_task_label: entry.task_label,
      intent_task_key: normalizedTaskKey,
    };

    let reusedGuardId = null;

    try {
      const selectCols =
        "id,title,preview,body,tags,config,status,auto_generated,auto_generated_source,auto_generated_version,user_modified_at";
      const applyBaseFilters = (q) =>
        q
          .eq("user_id", userId)
          .eq("ownership_type", "personal")
          .eq("visibility", "private");

      let existingGuards = [];
      let existingErr = null;

      const primary = await applyBaseFilters(
        client
          .from("vg_guards")
          .select(selectCols)
          .contains("config", {
            intent_task_key: normalizedTaskKey,
          })
      );

      if (primary?.error) {
        existingErr = primary.error;
      } else if (Array.isArray(primary?.data) && primary.data.length) {
        existingGuards = primary.data;
      } else {
        const secondary = await applyBaseFilters(
          client
            .from("vg_guards")
            .select(selectCols)
            .contains("config", {
              intent_task_label: entry.task_label,
            })
        );
        if (secondary?.error) {
          existingErr = secondary.error;
        } else if (Array.isArray(secondary?.data) && secondary.data.length) {
          existingGuards = secondary.data;
        } else {
          const fallback = await applyBaseFilters(
            client
              .from("vg_guards")
              .select(selectCols)
              .order("updated_at", {
                ascending: false,
              })
              .limit(25)
          );
          if (fallback?.error) {
            existingErr = fallback.error;
          } else if (Array.isArray(fallback?.data)) {
            existingGuards = fallback.data;
            existingErr = null;
          }
        }
      }

      if (existingErr) {
        vgWarn("[VG][intent] guard lookup failed", existingErr);
      } else if (Array.isArray(existingGuards)) {
        let bestMatch = null;
        let bestScore = 0;
        let titleMatch = false;
        const normalizedNewTitle = newTitle
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();
        for (const guard of existingGuards) {
          const guardTitle = String(guard?.title || "");
          const normalizedGuardTitle = guardTitle
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
          if (normalizedGuardTitle === normalizedNewTitle) {
            bestMatch = guard;
            bestScore = 1;
            titleMatch = true;
            break;
          }
          const score = promptSimilarity(
            guardTitle,
            guard?.body || "",
            newTitle,
            newBody
          );
          if (score > bestScore) {
            bestScore = score;
            bestMatch = guard;
          }
        }
        const MATCH_THRESHOLD = 0.72;
        if (bestMatch && (titleMatch || bestScore >= MATCH_THRESHOLD)) {
          const isAutoGenerated = bestMatch.auto_generated === true;
          const hasUserEdits = Boolean(
            bestMatch.user_modified_at && String(bestMatch.user_modified_at).trim()
          );

          if (!isAutoGenerated) {
            vgInfo?.("[VG][intent] skip merge (user-created guard)", {
              guardId: bestMatch.id,
              score: Number(bestScore.toFixed(3)),
            });
            reusedGuardId = bestMatch.id;
          } else if (hasUserEdits) {
            vgInfo?.("[VG][intent] skip merge (user-edited guard)", {
              guardId: bestMatch.id,
              score: Number(bestScore.toFixed(3)),
            });
            reusedGuardId = bestMatch.id;
          } else {
            vgInfo?.("[VG][intent] invoking prompt merge", {
              guardId: bestMatch.id,
              taskLabel: entry.task_label,
              score: Number(bestScore.toFixed(3)),
              autoVersion: bestMatch.auto_generated_version || 0,
              tagsExisting: Array.isArray(bestMatch.tags)
                ? bestMatch.tags.length
                : 0,
              tagsNew: newTags.length,
            });

            const mergeStartedAt = Date.now();
            const mergePayload = {
              task_label: entry.task_label,
              existing_prompt: String(bestMatch.body || ""),
              new_prompt: newBody,
              existing_tags: Array.isArray(bestMatch.tags)
                ? bestMatch.tags.map((tag) => String(tag ?? "").trim()).filter(Boolean)
                : [],
              new_tags: newTags,
              existing_config:
                bestMatch.config && typeof bestMatch.config === "object"
                  ? bestMatch.config
                  : {},
              new_config: mergedConfigBase,
            };

            let mergeResultData = null;
            let mergeError = null;
            try {
              const { data, error } = await client.functions.invoke(
                "intent-prompt-merge",
                { body: mergePayload }
              );
              mergeResultData = data ?? null;
              mergeError = error ?? null;
            } catch (mergeException) {
              mergeError = mergeException;
            }

            if (mergeError) {
              vgWarn("[VG][intent] prompt merge failed", {
                guardId: bestMatch.id,
                taskLabel: entry.task_label,
                durationMs: Date.now() - mergeStartedAt,
                error: mergeError,
              });
              reusedGuardId = bestMatch.id;
            } else if (
              !mergeResultData?.merged_prompt ||
              !mergeResultData?.preview
            ) {
              vgWarn("[VG][intent] prompt merge returned empty result", {
                guardId: bestMatch.id,
                taskLabel: entry.task_label,
                durationMs: Date.now() - mergeStartedAt,
                mergeResultData,
              });
              reusedGuardId = bestMatch.id;
            } else {
              vgInfo?.("[VG][intent] prompt merge succeeded", {
                guardId: bestMatch.id,
                taskLabel: entry.task_label,
                durationMs: Date.now() - mergeStartedAt,
                mergedTagCount: Array.isArray(mergeResultData.merged_tags)
                  ? mergeResultData.merged_tags.length
                  : 0,
              });
              const mergedBody = String(mergeResultData.merged_prompt).trim();
              const mergedPreview = String(mergeResultData.preview).trim();
              const mergedTags = Array.isArray(mergeResultData.merged_tags)
                ? mergeResultData.merged_tags
                    .map((tag) => String(tag ?? "").trim())
                    .filter(Boolean)
                : newTags;

              const existingConfig =
                bestMatch.config && typeof bestMatch.config === "object"
                  ? bestMatch.config
                  : {};
              const mergedConfigPayload =
                mergeResultData.config && typeof mergeResultData.config === "object"
                  ? mergeResultData.config
                  : {};
              const mergedConfig = {
                ...existingConfig,
                ...mergedConfigPayload,
                origin_window_id: mergedConfigBase.origin_window_id,
                intent_task_label: mergedConfigBase.intent_task_label,
                intent_task_key: mergedConfigBase.intent_task_key,
              };

              const nextVersion = (bestMatch.auto_generated_version || 0) + 1;
              const rawActivationThreshold = getAdminControlValue(
                "auto_generated_guard_activation_version"
              );
              const guardActivationThreshold = Math.max(
                1,
                Number.isFinite(rawActivationThreshold)
                  ? Math.round(rawActivationThreshold)
                  : ADMIN_CONTROL_DEFAULTS.auto_generated_guard_activation_version
              );

              const updatePayload = {
                title: newTitle,
                preview: mergedPreview,
                body: mergedBody,
                tags: mergedTags,
                variables: newVariables,
                site_category: newSiteCategory,
                config: mergedConfig,
                auto_generated: true,
                auto_generated_source: "intent-prompt-merge",
                auto_generated_version: nextVersion,
                user_modified_at: null,
                updated_at: new Date().toISOString(),
              };
              if (
                nextVersion >= guardActivationThreshold &&
                bestMatch.status !== "active"
              ) {
                updatePayload.status = "active";
              }

              const updateStartedAt = Date.now();
              const { error: updateErr } = await client
                .from("vg_guards")
                .update(updatePayload)
                .eq("id", bestMatch.id);

              if (updateErr) {
                vgWarn("[VG][intent] guard update failed", {
                  guardId: bestMatch.id,
                  taskLabel: entry.task_label,
                  durationMs: Date.now() - updateStartedAt,
                  error: updateErr,
                });
                reusedGuardId = bestMatch.id;
              } else {
                reusedGuardId = bestMatch.id;
                vgInfo?.("[VG][intent] prompt merged into existing guard", {
                  guardId: bestMatch.id,
                  score: Number(bestScore.toFixed(3)),
                  nextVersion,
                  activationThreshold: guardActivationThreshold,
                  durationMs: Date.now() - updateStartedAt,
                });
              }
            }
          }
        }
      }
    } catch (reuseErr) {
      vgWarn("[VG][intent] guard reuse lookup exception", reuseErr);
    }

    if (!reusedGuardId) {
      vgInfo?.("[VG][intent] inserting new prompt guard", {
        windowId: windowId || null,
        taskLabel: entry.task_label,
        tagCount: newTags.length,
      });
      const insertPayload = {
        user_id: userId,
        title: newTitle,
        preview: newPreview,
        body: newBody,
        tags: newTags,
        variables: newVariables,
        site_category: newSiteCategory,
        config: mergedConfigBase,
        visibility: "private",
        status: "inactive",
        ownership_type: "personal",
        auto_generated: true,
        auto_generated_source: "intent-prompt-builder",
        auto_generated_version: 1,
        user_modified_at: null,
      };

      const insertStartedAt = Date.now();
      const { error: guardError } = await client
        .from("vg_guards")
        .insert(insertPayload);

      if (guardError) {
        vgWarn("[VG][intent] guard insert failed", {
          windowId: windowId || null,
          taskLabel: entry.task_label,
          durationMs: Date.now() - insertStartedAt,
          error: guardError,
        });
        await client
          .from("intent_windows")
          .update({
            custom_prompt_error:
              guardError?.message || String(guardError),
          })
          .eq("window_id", windowId || null);
        return false;
      }

      vgInfo?.("[VG][intent] prompt created", {
        windowId: windowId || null,
        taskLabel: entry.task_label,
        title: insertPayload.title,
        durationMs: Date.now() - insertStartedAt,
        tagCount: Array.isArray(insertPayload.tags)
          ? insertPayload.tags.length
          : 0,
      });
    }

    await client
      .from("intent_windows")
      .update({
        custom_prompt_created: true,
        custom_prompt_error: null,
      })
      .eq("window_id", windowId || null);

    return true;
  } catch (promptException) {
    vgWarn("[VG][intent] prompt builder exception", promptException);
    await client
      .from("intent_windows")
      .update({
        custom_prompt_error:
          promptException?.message || String(promptException),
      })
      .eq("window_id", windowId || null);
    return false;
  }
}
