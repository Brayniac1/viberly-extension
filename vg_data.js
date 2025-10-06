/***** VibeGuardian – Data Layer (Content script) *****/
const SUPABASE_URL = "https://auudkltdkakpnmpmddaj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dWRrbHRka2FrcG5tcG1kZGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDA3NTYsImV4cCI6MjA3MTI3Njc1Nn0.ukDpH6EXksctzWHMSdakhNaWbgFZ61UqrpvzwTy03ho";

/* ---------- robust storage (tolerates extension reloads; falls back to localStorage) ---------- */
const chromeOk = !!(typeof browser !== "undefined" && browser?.storage?.local);

const storage = chromeOk
  ? {
      getItem: (k) =>
        new Promise((res) => {
          try {
            browser.storage.local.get([k]).then((out) => res(out?.[k] ?? null));
          } catch (_) {
            res(null);
          }
        }),
      setItem: (k, v) =>
        new Promise((res) => {
          try {
            browser.storage.local.set({ [k]: v }).then(() => res());
          } catch (_) {
            res();
          }
        }),
      removeItem: (k) =>
        new Promise((res) => {
          try {
            browser.storage.local.remove([k]).then(() => res());
          } catch (_) {
            res();
          }
        }),
    }
  : {
      getItem: (k) => Promise.resolve(localStorage.getItem(k)),
      setItem: (k, v) => Promise.resolve(localStorage.setItem(k, v)),
      removeItem: (k) => Promise.resolve(localStorage.removeItem(k)),
    };

/* ---------- Supabase client (deferred until UMD is ready) ---------- */
let db;

/** Wait for window.supabase (UMD) to exist */
function waitForSupabase(maxMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (typeof window.supabase?.createClient === "function")
        return resolve(window.supabase);
      if (Date.now() - start > maxMs)
        return reject(new Error("supabase UMD not loaded"));
      setTimeout(tick, 25);
    };
    tick();
  });
}

/** One-time init that runs after UMD is present */
(async () => {
  try {
    const sb = await waitForSupabase();

    db = sb.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // Always include apikey on every REST/RPC call
      global: { headers: { apikey: SUPABASE_ANON_KEY } },
      auth: {
        storage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });

    // Force apikey + bearer token on every REST call (PostgREST, RPC, etc.)
    const origFetch = db.rest.fetch;
    db.rest.fetch = async (url, options = {}) => {
      const {
        data: { session },
      } = await db.auth.getSession();
      const headers = new Headers(options.headers || {});
      headers.set("apikey", SUPABASE_ANON_KEY);
      headers.set(
        "Authorization",
        `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`
      );
      return origFetch(url, { ...options, headers });
    };

    // 🔧 Enhanced session restoration with validation
    try {
      let { data } = await db.auth.getSession();

      // 🔧 Validate existing session
      if (data?.session?.access_token && data?.session?.expires_at) {
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = data.session.expires_at;

        // If token expires within 2 minutes, try to refresh
        if (expiresAt && expiresAt - now < 120) {
          console.log("[VG:data] Token expiring soon, attempting refresh...");
          try {
            const { data: refreshData, error } = await db.auth.refreshSession();
            if (!error && refreshData?.session) {
              data = refreshData;
              console.log("[VG:data] Token refreshed successfully");
            }
          } catch (e) {
            console.warn("[VG:data] Token refresh failed:", e);
          }
        }
      }

      if (!data.session) {
        const keyPrefix = "sb-";
        await new Promise((r) => setTimeout(r, 0));
        if (typeof browser !== "undefined" && browser?.storage?.local) {
          await new Promise((resolve) => {
            browser.storage.local.get().then(async (all) => {
              try {
                const sbKey = Object.keys(all).find(
                  (k) => k.startsWith(keyPrefix) && typeof all[k] === "string"
                );
                if (sbKey) {
                  const parsed = JSON.parse(all[sbKey]);
                  const cs = parsed?.currentSession;
                  if (cs?.access_token && cs?.refresh_token) {
                    try {
                      await db.auth.setSession({
                        access_token: cs.access_token,
                        refresh_token: cs.refresh_token,
                      });

                      // 🔧 Validate restored session
                      const { data: restoredData } = await db.auth.getSession();
                      if (restoredData?.session?.expires_at) {
                        const now = Math.floor(Date.now() / 1000);
                        const expiresAt = restoredData.session.expires_at;
                        if (expiresAt && expiresAt - now < 120) {
                          console.log(
                            "[VG:data] Restored token expiring soon, refreshing..."
                          );
                          try {
                            await db.auth.refreshSession();
                          } catch (e) {
                            console.warn(
                              "[VG:data] Restored token refresh failed:",
                              e
                            );
                          }
                        }
                      }
                    } catch (_) {}
                  }
                }
              } catch (e) {
                console.warn("[VG:data] manual restore failed", e);
              }
              resolve();
            });
          });
        }
        ({ data } = await db.auth.getSession());
      }
      console.log("[VG:data] session ready =", !!data.session);
    } catch (e) {
      console.warn("[VG:data] hydrate/restore failed", e);
    }

    // 🧹 prevent “Extension context invalidated” warning on extension reload while tab is open
    window.addEventListener("unload", () => {
      try {
        db.auth.stopAutoRefresh?.();
      } catch (_) {}
    });

    // (optional) Visibility into auth changes
    db.auth.onAuthStateChange((evt, session) => {
      console.log("[VG:data] auth event:", evt, "hasSession=", !!session);
    });

    // After db is ready, expose VG (moved from bottom)
    exposeVG();
  } catch (e) {
    console.warn("[VG:data] supabase UMD not ready:", e?.message || e);
  }
})();

/* ---------- domain -> category mapper ---------- */
function getCategoryForHost(host) {
  const PROGRAMMING = [
    "lovable.dev",
    "bolt.new",
    "replit.com",
    "stackblitz.com",
    "codesandbox.io",
  ];
  const CREATIVE = [
    // add when you care about these
  ];
  const h = (host || location.hostname || "").toLowerCase();
  if (PROGRAMMING.some((d) => h.endsWith(d))) return "programming";
  if (CREATIVE.some((d) => h.endsWith(d))) return "creative";
  return "general";
}

/* ---------- helpers ---------- */
// --- helpers ---
async function getUser() {
  const {
    data: { session },
    error,
  } = await db.auth.getSession();
  if (error || !session?.user) throw new Error("Not signed in");
  return session.user; // <-- no network call, uses hydrated session
}

function getActiveDomain() {
  try {
    return location.hostname;
  } catch {
    return null;
  }
}

/* ---------- Custom Guards core (vg_guards) ---------- */
async function createGuard({
  title,
  body,
  variables = [],
  tags = [],
  site_category = "programming",
  config = {},
}) {
  const user = await getUser();
  const { error, data } = await db
    .from("vg_guards")
    .insert({
      user_id: user.id,
      title,
      body,
      variables,
      tags,
      site_category,
      config,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
async function updateGuard(guardId, patch) {
  const user = await getUser();
  const { error, data } = await db
    .from("vg_guards")
    .update({ ...patch })
    .eq("id", guardId)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// Flip a guard's ON/OFF state (ON = 'active', OFF = 'inactive')
async function setGuardStatus(guardId, on) {
  const user = await getUser();
  const { error } = await db
    .from("vg_guards")
    .update({ status: on ? "active" : "inactive" })
    .eq("id", guardId)
    .eq("user_id", user.id);
  if (error) throw error;
}
async function deleteGuard(guardId) {
  const user = await getUser();
  const { error } = await db
    .from("vg_guards")
    .delete()
    .eq("id", guardId)
    .eq("user_id", user.id);
  if (error) throw error;
  return true;
}

// ---------- site settings + events (RPCs) above this ----------
// Replace your current listGuards with this:

async function listGuards({
  site_category = "programming",
  includeInactive = true,
} = {}) {
  const user = await getUser();

  // base select (explicit columns to keep payload small)
  let q = db
    .from("vg_guards")
    .select("id,title,body,tags,status,site_category,created_at,updated_at")
    .eq("user_id", user.id)
    .eq("site_category", site_category);

  if (!includeInactive) q = q.eq("status", "active");

  // sort: active first, then newest
  const { data, error } = await q
    .order("status", { ascending: false }) // 'active' > 'inactive'
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

/* ---------- site settings + events (RPCs) ---------- */
async function upsertSiteSettings(domain, partialSettingsJson) {
  const { data, error } = await db.rpc("vg_upsert_site_settings", {
    p_domain: domain,
    p_settings: partialSettingsJson,
  });
  if (error) throw error;
  return data;
}
async function logEvent(name, payload = {}) {
  const domain = getActiveDomain();
  const { error } = await db.rpc("vg_log_event", {
    p_name: name,
    p_site_domain: domain,
    p_payload: payload,
  });
  if (error) throw error;
}

/* ---------- expose API object (runs after db is initialized) ---------- */
function exposeVG() {
  if (!db) {
    console.warn("[VG:data] exposeVG(): db not ready yet");
    return;
  }

  const VG_API = {
    auth: db.auth,
    guards: {
      create: createGuard,
      update: updateGuard,
      delete: deleteGuard,
      list: listGuards,
      setStatus: setGuardStatus,
    },
    sites: { upsertSettings: upsertSiteSettings },
    events: { log: logEvent },
    utils: { getActiveDomain, getCategoryForHost },
  };

  try {
    window.VG = VG_API;
  } catch {}
  try {
    self.VG = VG_API;
  } catch {}
  try {
    globalThis.VG = VG_API;
  } catch {}

  console.log("[VG:data] exposed VG:", typeof VG, "URL=", SUPABASE_URL);
}

/***** end data layer *****/
