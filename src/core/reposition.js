// ==== reposition.js — direct Supabase auth (no background messaging) ====

// 0) Supabase client (popup context)
const SUPABASE_URL = "https://auudkltdkakpnmpmddaj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dWRrbHRka2FrcG5tcG1kZGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDA3NTYsImV4cCI6MjA3MTI3Njc1Nn0.ukDpH6EXksctzWHMSdakhNaWbgFZ61UqrpvzwTy03ho";

// Stripe Checkout Edge Function
const CHECKOUT_ENDPOINT =
  "https://auudkltdkakpnmpmddaj.supabase.co/functions/v1/create-checkout-session";

// Manage Billing Edge Function
const FUNCTION_URL_PORTAL =
  "https://auudkltdkakpnmpmddaj.supabase.co/functions/v1/create-portal-session";

// Share session via chrome.storage so content scripts see the same login
const storage = {
  getItem: (k) =>
    new Promise((res) =>
      browser.storage.local.get([k]).then((out) => res(out[k] ?? null))
    ),
  setItem: (k, v) =>
    new Promise((res) => browser.storage.local.set({ [k]: v }).then(res)),
  removeItem: (k) =>
    new Promise((res) => browser.storage.local.remove([k]).then(res)),
};

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// --- Tell background about our current session (sets bg client + broadcasts)
async function syncSessionToBackground() {
  try {
    const {
      data: { session },
    } = await db.auth.getSession();
    if (!session?.access_token || !session?.refresh_token) return;

    const response = await browser.runtime.sendMessage({
      type: "SET_SESSION",
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
      userId: session.user?.id || null,
      email: session.user?.email || null,
    });
    console.log("[popup→bg] SET_SESSION →", response);
  } catch (e) {
    console.warn("[popup→bg] SET_SESSION failed", e);
  }
}

// ---- render on INITIAL_SESSION and later auth changes ----
let _initialPainted = false;
db.auth.onAuthStateChange(async (event, session) => {
  // For any event that includes a valid session, sync to background
  if (session?.access_token && session?.refresh_token) {
    await syncSessionToBackground();
  }

  if (event === "INITIAL_SESSION" && !_initialPainted) {
    _initialPainted = true;
    await renderAuthState();
    await syncSessionToBackground();
    return;
  }

  if (
    event === "SIGNED_IN" ||
    event === "SIGNED_OUT" ||
    event === "TOKEN_REFRESHED" ||
    event === "USER_UPDATED"
  ) {
    await renderAuthState();
    await syncSessionToBackground();
  }
});

/* 👇 ADD: stop auth auto-refresh when popup closes (prevents “context invalidated”) */
window.addEventListener("unload", () => {
  try {
    db.auth.stopAutoRefresh?.();
  } catch (_) {}
});

// 1) Small dom helper
const $ = (id) => document.getElementById(id);

function authMsg(text, type = "err") {
  const m = $("authMsg");
  if (!m) return;
  m.textContent = text || "";
  m.classList.remove("ok", "err");
  m.classList.add(type === "ok" ? "ok" : "err");
  m.hidden = !text;
}
function authMsgClear() {
  const m = $("authMsg");
  if (m) m.hidden = true;
}
$("email")?.addEventListener("input", authMsgClear);
$("password")?.addEventListener("input", authMsgClear);

// ---- Billing / Checkout config ----
// Plan limits (used for display; DB enforcement is via triggers)
const PLAN_LIMITS = { free: 1, basic: 5, pro: Infinity };

// --- fetch current billing summary for the signed‑in user ---
async function getBillingSummary() {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session?.user)
    return {
      tier: "free",
      used: 0,
      limit: PLAN_LIMITS.free,
      status: "inactive",
    };

  const { data, error } = await db
    .from("vg_profiles")
    .select(
      "tier, custom_guards_count, custom_guards_created, vg_guards_automated, subscription_status"
    )
    .eq("user_id", session.user.id)
    .single();

  const tier = data?.tier || "free";
  const used = data?.custom_guards_count ?? 0;
  const limit = PLAN_LIMITS[tier] ?? PLAN_LIMITS.free;
  const status = data?.subscription_status || "inactive";
  return { tier, used, limit, status };
}

// --- start Stripe Checkout for a plan ---
async function startCheckout(tier /* 'basic' | 'pro' */) {
  const price_id =
    tier === "basic"
      ? "price_1RyYJuCKsHaxtGkUiLlRAAd3"
      : tier === "pro"
      ? "price_1RyYMaCKsHaxtGkUMaScJLZS"
      : null;

  if (!price_id) {
    console.warn("[checkout] unknown tier", tier);
    return;
  }

  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session?.access_token) {
    console.warn("[checkout] no session");
    return;
  }

  const r = await fetch(CHECKOUT_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ price_id }), // server will create the session
  });

  if (!r.ok) {
    console.error("[checkout] failed", await r.text());
    return;
  }
  const { url } = await r.json();
  // open Stripe Checkout in a new tab
  try {
    browser.tabs.create({ url });
  } catch {
    window.open(url, "_blank");
  }
}

// --- open Stripe Customer Portal (optional; needs a portal function) ---
async function openPortal() {
  const {
    data: { session },
  } = await db.auth.getSession();
  if (!session?.access_token) return;

  const r = await fetch(FUNCTION_URL_PORTAL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ return_url: "https://vibeguardian.app/account" }),
  });
  if (!r.ok) {
    console.error("[portal] failed");
    return;
  }
  const { url } = await r.json();
  try {
    browser.tabs.create({ url });
  } catch {
    window.open(url, "_blank");
  }
}

// ---- Hydrate session from chrome.storage on popup open, then render ----
(async () => {
  try {
    // If Supabase already has the session in memory, great
    let {
      data: { session },
    } = await db.auth.getSession();

    if (!session && browser?.storage?.local) {
      // Manually pull the persisted session written by Supabase into chrome.storage
      browser.storage.local.get(null).then(async (all) => {
        try {
          const sbKey = Object.keys(all).find(
            (k) => k.startsWith("sb-") && typeof all[k] === "string"
          );
          if (sbKey) {
            const parsed = JSON.parse(all[sbKey]); // { currentSession, ... }
            const cs = parsed?.currentSession;
            if (cs?.access_token && cs?.refresh_token) {
              await db.auth.setSession({
                access_token: cs.access_token,
                refresh_token: cs.refresh_token,
              });
            }
          }
        } catch (e) {
          console.warn("[popup] manual hydrate failed", e);
        } finally {
          // paint and push session to background either way
          await renderAuthState();
          await syncSessionToBackground();
        }
      });
    } else {
      // already had a session, or not using chrome.storage
      await renderAuthState();
      await syncSessionToBackground();
    }
  } catch {
    await renderAuthState();
  }
})();

// First render: trust background first, then let Supabase hydrate
document.addEventListener("DOMContentLoaded", () => {
  // Hide both views initially (CSS already hides), then decide quickly:
  browser.runtime.sendMessage({ type: "AUTH_STATUS" }).then(async (r) => {
    const signed = !!r?.signedIn;

    // Set HTML class so CSS shows the right view immediately
    document.documentElement.classList.remove("signed-in", "signed-out");
    document.documentElement.classList.add(signed ? "signed-in" : "signed-out");

    // Now let Supabase hydrate and finalize (won't flip back on null)
    try {
      await renderAuthState();
      await syncSessionToBackground();
    } catch (_) {}
  });
});

// Button on the signed-in view
const btnLogout = $("logout");

// Open Settings modal on the Billing tab
$("manageBilling")?.addEventListener("click", () => {
  // ask the active tab to open Settings -> Billing
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const id = tabs?.[0]?.id;
    if (!id) return;
    browser.tabs.sendMessage(id, { type: "VG_OPEN_BILLING" });
  });
});

// 👇 Add this render function
async function renderAuthState() {
  try {
    const { data } = await db.auth.getSession();
    const session = data?.session;

    // If Supabase hasn't hydrated yet, don't change the CSS class or view.
    if (session == null) return;

    if (session.user) {
      document.documentElement.classList.remove("signed-out");
      document.documentElement.classList.add("signed-in");

      const email = session.user.email || "";
      const label = $("acctEmail");
      if (label) label.textContent = email;

      const { tier, used, limit } = await getBillingSummary();
      const planEl = $("acctPlan");
      if (planEl)
        planEl.textContent =
          tier === "pro" ? "Pro" : tier === "basic" ? "Basic" : "Free";
      const usageEl = $("acctUsage");
      if (usageEl)
        usageEl.textContent =
          limit === Infinity ? `${used} / ∞` : `${used} / ${limit}`;
    } else {
      document.documentElement.classList.remove("signed-in");
      document.documentElement.classList.add("signed-out");
    }
  } catch (e) {
    console.error("[renderAuthState]", e);
  }
}

// 2) Wire buttons — AUTH (new)

const fieldEmail = $("email");
const fieldPassword = $("password");
const btnLogin = $("signin"); // "Log in"

// ✅ Allow Enter key to submit login
[fieldEmail, fieldPassword].forEach((el) => {
  el?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      btnLogin?.click(); // trigger the same login flow
    }
  });
});

const linkSignup = $("signup"); // "Create account" (link at bottom)
const linkForgot = $("forgot"); // "Forgot your password?"
const btnGoogle = $("google"); // "Sign in with Google"

function lock(el, on = true) {
  if (!el) return;
  el.disabled = !!on;
  el.style.opacity = on ? "0.7" : "1";
}

// Email + Password: Log in
btnLogin?.addEventListener("click", async () => {
  authMsgClear();
  try {
    const email = (fieldEmail?.value || "").trim();
    const password = fieldPassword?.value || "";
    if (!email || !password) {
      authMsg("Enter email and password");
      return;
    }

    lock(btnLogin, true);
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      authMsg(error.message || "Sign in failed");
      return;
    }

    // ensure profile row exists
    const {
      data: { user },
    } = await db.auth.getUser();
    await db
      .from("vg_profiles")
      .upsert(
        { user_id: user.id, display_name: (user.email || "").split("@")[0] },
        { onConflict: "user_id" }
      );

    authMsg("Signed in", "ok");
    await renderAuthState();
    await syncSessionToBackground(); // ← ADD THIS LINE
  } catch (e) {
    authMsg(e?.message || "Unexpected error");
  } finally {
    lock(btnLogin, false);
  }
});

// Create account (uses current email+password fields)
linkSignup?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  authMsgClear();
  try {
    const email = (fieldEmail?.value || "").trim();
    const password = fieldPassword?.value || "";
    if (!email || !password) {
      authMsg("Enter email and password");
      return;
    }

    lock(linkSignup, true);
    const { error } = await db.auth.signUp({ email, password });
    if (error) {
      authMsg(error.message || "Sign up failed");
      return;
    }

    // Many projects require email confirmation → session may not exist yet.
    authMsg("Account created. Check your email to confirm.", "ok");
    await renderAuthState();
  } catch (e) {
    authMsg(e?.message || "Unexpected error");
  } finally {
    lock(linkSignup, false);
  }
});

// Forgot password (sends reset email)
linkForgot?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  authMsgClear();
  try {
    const email = (fieldEmail?.value || "").trim();
    if (!email) {
      authMsg("Enter your email first");
      return;
    }

    const redirectTo = browser.runtime.id
      ? `https://${browser.runtime.id}.chromiumapp.org/reset-finish`
      : undefined;

    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo,
    });
    if (error) {
      authMsg(error.message || "Reset failed");
      return;
    }

    authMsg("Password reset email sent.", "ok");
  } catch (e) {
    authMsg(e?.message || "Unexpected error");
  }
});

// Google OAuth
btnGoogle?.addEventListener("click", async () => {
  authMsgClear();
  try {
    lock(btnGoogle, true);

    const redirectTo = browser.runtime.id
      ? `https://${browser.runtime.id}.chromiumapp.org/oauth/callback`
      : undefined;

    const { error } = await db.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      authMsg(error.message || "Google sign-in failed");
      return;
    }

    // Navigation happens; session will be persisted on return.
  } catch (e) {
    authMsg(e?.message || "Unexpected error");
  } finally {
    lock(btnGoogle, false);
  }
});

// Log out (account view)
btnLogout?.addEventListener("click", async () => {
  try {
    lock(btnLogout, true);
    const { error } = await db.auth.signOut();
    if (error) throw error;

    // Tell background to clear its session and broadcast to all tabs
    try {
      browser.runtime
        .sendMessage({ type: "SIGN_OUT" })
        .then((r) => console.log("[popup→bg] SIGN_OUT →", r));
    } catch (_) {}

    await renderAuthState(); // swap back to auth view
  } catch (e) {
    console.error("[logout]", e?.message || e);
  } finally {
    lock(btnLogout, false);
  }
});

// --- Upgrade buttons (only do something if they exist in HTML) ---
$("upgradeBasic")?.addEventListener("click", () => startCheckout("basic"));
$("upgradePro")?.addEventListener("click", () => startCheckout("pro"));

// ---------- Stripe Checkout (Basic / Pro) ----------

// Re‑usable helper to call the Edge Function and open Stripe Checkout
async function openCheckout({ priceId, tier, mode = "subscription" } = {}) {
  try {
    const {
      data: { session },
    } = await db.auth.getSession();
    if (!session) {
      console.warn("[checkout] no session — user must be signed in");
      return;
    }

    const res = await fetch(CHECKOUT_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        // Either pass priceId or a simple tier label your function understands.
        price_id: priceId || undefined,
        tier: tier || undefined,
        mode,
        success_url: "https://vibeguardian.app/checkout/success",
        cancel_url: "https://vibeguardian.app/checkout/cancel",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[checkout] edge function error:", res.status, text);
      return;
    }

    const { url } = await res.json();
    if (url) {
      // Open Stripe Checkout
      browser.tabs.create({ url });
    } else {
      console.error("[checkout] no URL returned from function");
    }
  } catch (e) {
    console.error("[checkout] unexpected error", e);
  }
}

// Buttons on the signed‑in view (add these IDs in popup.html)
const btnBuyBasic = $("buyBasic"); // <button id="buyBasic">Upgrade – Basic</button>
const btnBuyPro = $("buyPro"); // <button id="buyPro">Upgrade – Pro</button>

// Wire them (defensive if the elements don’t exist yet)
btnBuyBasic?.addEventListener(
  "click",
  () => openCheckout({ priceId: "price_1RyYJuCKsHaxtGkUiLlRAAd3" }) // your BASIC price
);
btnBuyPro?.addEventListener(
  "click",
  () => openCheckout({ priceId: "price_1RyYMaCKsHaxtGkUMaScJLZS" }) // your PRO price
);

// Also render when the popup becomes visible again (defensive)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") renderAuthState();
});
