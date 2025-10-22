// src/ui/settings.js
// NOTE: The “Settings” modal is now branded as “Dashboard” in the product UI.
(() => {
  // shared app constants (one source of truth)
  const APP = window.__VG_CONSTS?.APP || "vibeguardian";
  const Z = window.__VG_CONSTS?.Z || 2147483600;

  const QUICK_TEXTS = window.__VG_QUICK_TEXTS || {}; // shared from quick menu

  // ---- Seed + keep background Supabase session in sync (isolated world safe) ----
  (async () => {
    async function seedBGFromPageSession() {
      try {
        const resp = await (window.VG?.auth?.getSession?.() ??
          Promise.resolve({ data: { session: null } }));
        const s = resp?.data?.session;
        if (s?.access_token && s?.refresh_token) {
          return await new Promise((res) => {
            browser.runtime
              .sendMessage({
                type: "SET_SESSION",
                access_token: s.access_token,
                refresh_token: s.refresh_token,
                expires_at: s.expires_at ?? null,
                userId: s.user?.id || null,
                email: s.user?.email || null,
              })
              .then((r) => res(!!r?.ok));
          });
        }
      } catch (_) {}
      return false;
    }

    // 1) Seed once at load
    await seedBGFromPageSession();

    // 2) If BG says not signed in, force re-seed (covers SW sleep/reload)
    try {
      browser.runtime.sendMessage({ type: "AUTH_STATUS" }).then(async (r) => {
        if (!r || r.signedIn !== true) {
          await seedBGFromPageSession();
        }
      });
    } catch {}

    // 3) Keep it fresh on auth change (token refresh / sign-in / sign-out→in)
    try {
      window.VG?.auth?.onAuthStateChange?.((_event, _session) => {
        // Fire and forget; BG will pick up fresh tokens
        seedBGFromPageSession();
      });
    } catch {}
  })();

  // --- BG messaging with one retry if SW was asleep (mirrors quickmenu) ---
  async function sendBG(type, payload, timeoutMs = 1500) {
    function ask() {
      return new Promise((res) => {
        let done = false;
        const to = setTimeout(() => {
          if (!done) res("__TIMEOUT__");
        }, timeoutMs);
        try {
          browser.runtime
            .sendMessage({ type, ...(payload || {}) })
            .then((r) => {
              done = true;
              clearTimeout(to);
              if (browser.runtime.lastError) return res("__NO_RECEIVER__");
              res(r);
            });
        } catch {
          res("__NO_RECEIVER__");
        }
      });
    }
    let r = await ask();
    if (r === "__NO_RECEIVER__" || r === "__TIMEOUT__") {
      // try to re-seed tokens from SoT (covers SW restart)
      try {
        const resp = await (window.VG?.auth?.getSession?.() ?? {
          data: { session: null },
        });
        const s = resp?.data?.session;
        if (s?.access_token && s?.refresh_token) {
          await new Promise((res) =>
            browser.runtime
              .sendMessage({
                type: "SET_SESSION",
                access_token: s.access_token,
                refresh_token: s.refresh_token,
                expires_at: s.expires_at ?? null,
                userId: s.user?.id || null,
                email: s.user?.email || null,
              })
              .then(() => res())
          );
        }
      } catch {}
      r = await ask(); // one retry
    }
    return r;
  }

  // Seed BG service worker from SoT tokens before any DB read (mirrors quickmenu)
  async function __vgEnsureBGSessionFromSoT() {
    try {
      const sot = await new Promise((res) =>
        browser.storage.local
          .get("VG_SESSION")
          .then((o) => res(o?.VG_SESSION || null))
      );
      if (
        !sot ||
        !sot.access_token ||
        !sot.refresh_token ||
        !Number.isFinite(sot.expires_at)
      ) {
        return false; // nothing to seed
      }
      const r = await sendBG(
        "SET_SESSION",
        {
          access_token: sot.access_token,
          refresh_token: sot.refresh_token,
          expires_at: sot.expires_at,
          userId: sot.userId || null,
          email: sot.email || null,
        },
        1500
      );
      return !!(r && r.ok);
    } catch {
      return false;
    }
  }

  function buildBasicProtections() {
    return [QUICK_TEXTS.SAFETY, QUICK_TEXTS.CONFLICT, QUICK_TEXTS.OUTPUT].join(
      "\n\n"
    );
  }

  function buildAllProtections() {
    return [
      QUICK_TEXTS.FORBIDDEN,
      QUICK_TEXTS.SAFETY,
      QUICK_TEXTS.CONFLICT,
      QUICK_TEXTS.CONFIG,
      QUICK_TEXTS.DB,
      QUICK_TEXTS.DATA,
      QUICK_TEXTS.OUTPUT,
      QUICK_TEXTS.QA,
    ].join("\n\n");
  }
  function buildInjection(active, selectedCustomGuards = []) {
    const b = [];
    if (active.has("ui")) b.push(QUICK_TEXTS.UI);
    if (active.has("copy")) b.push(QUICK_TEXTS.COPY);
    if (active.has("logic")) b.push(QUICK_TEXTS.LOGIC);
    if (active.has("strict")) b.push(QUICK_TEXTS.STRICT);
    if (active.has("noref")) b.push(QUICK_TEXTS.NOREF);
    if (active.has("basic")) b.push(QUICK_TEXTS.BASIC);
    if (active.has("wire")) b.push(QUICK_TEXTS.WIRE);
    if (active.has("pol")) b.push(QUICK_TEXTS.POL);
    if (active.has("data")) b.push(QUICK_TEXTS.DATA);
    if (active.has("qa")) b.push(QUICK_TEXTS.QA);
    for (const cg of selectedCustomGuards || [])
      if (cg?.body) b.push(cg.body.trim());
    b.push("BELOW IS WHAT I WANT YOU TO FOCUS ON:");
    return b.join("\n\n");
  }

  // ===== VibeGuardian: Prompt Library (content) =====
  const VG_LIB_CACHE_KEY = "vg_prompts_cache"; // { items, cached_at }
  const VG_LIB_TTL_MS = 24 * 60 * 60 * 1000; // 24h cache

  // === Prompt Library: helpers (content → background proxy) ===
  const vgGetCache = () =>
    new Promise((res) =>
      browser.storage.local
        .get([VG_LIB_CACHE_KEY])
        .then((o) => res(o[VG_LIB_CACHE_KEY] || null))
    );
  const vgSetCache = (payload) =>
    new Promise((res) =>
      browser.storage.local
        .set({ [VG_LIB_CACHE_KEY]: payload })
        .then(() => res())
    );

  // Use background REST proxy to avoid page CSP issues
  async function vgFetchPromptsViaBackground() {
    try {
      await __vgEnsureBGSessionFromSoT();
      const resp = await sendBG("FETCH_PROMPTS");
      if (!resp || resp.ok !== true)
        return { ok: false, error: resp?.error || "Fetch failed" };
      return { ok: true, items: resp.items || [] };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  // Optional tiny local seed (if you ship vg_library.js); safe to leave empty
  async function vgLoadLocalSeed() {
    try {
      if (!window.PROMPT_LIBRARY_SEED) {
        const url = browser.runtime.getURL("vg_library.js");
        await import(url); // defines window.PROMPT_LIBRARY_SEED = [...]
      }
      return window.PROMPT_LIBRARY_SEED || [];
    } catch {
      return [];
    }
  }

  // === Standard Guards (Programming → "Standard Guards") ===
  async function vgFetchGuardsViaBackground() {
    try {
      await __vgEnsureBGSessionFromSoT();
      const resp = await sendBG("FETCH_PROMPTS", {
        filter: {
          type: "Programming",
          subcategory: "Standard Guards",
          status: "published",
        },
      });
      if (!resp || resp.ok !== true)
        return { ok: false, error: resp?.error || "Fetch failed" };
      return { ok: true, items: resp.items || [] };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  // Load guard templates from DB and overwrite QUICK_TEXTS used by Preview
  async function vgLoadGuardTemplatesFromDB() {
    try {
      const r = await vgFetchGuardsViaBackground();
      if (!r.ok || !Array.isArray(r.items)) return;

      const mapIdToKey = {
        basic: "BASIC",
        ui: "UI",
        copy: "COPY",
        logic: "LOGIC",
        strict: "STRICT",
        noref: "NOREF",
        wire: "WIRE",
        pol: "POL",
        data: "DATA",
        qa: "QA",
      };

      for (const row of r.items) {
        const id = String(row.name || "").toLowerCase();
        const key = mapIdToKey[id];
        if (key && row.prompt_text) QUICK_TEXTS[key] = row.prompt_text;
      }
    } catch (e) {
      console.warn("[VG] guard templates cloud load failed", e);
    }
  }

  // Merge the "Standard Guards" rows (from Programming / Standard Guards) into Library
  async function vgUnionStandardGuards(items) {
    try {
      const r = await vgFetchGuardsViaBackground();
      if (!r.ok || !Array.isArray(r.items) || !r.items.length) return items;

      const seen = new Set(items.map((p) => String(p.id || p.name)));
      const merged = items.slice();

      for (const g of r.items) {
        const gid = String(g.id || g.name);
        if (seen.has(gid)) continue;
        merged.push({
          id: gid,
          name: g.name,
          type: g.type || "Programming",
          subcategory: g.subcategory || "Standard Guards",
          labels: Array.isArray(g.labels) ? g.labels : [],
          prompt_text: g.prompt_text,
          rank: 50,
          updated_at: g.updated_at,
        });
      }
      return merged;
    } catch {
      return items;
    }
  }

  async function vgLoadPromptLibrary(force = false) {
    const cached = await vgGetCache();
    const fresh =
      cached && !force && Date.now() - (cached.cached_at || 0) < VG_LIB_TTL_MS;
    if (fresh) return cached.items;

    const r = await vgFetchPromptsViaBackground();
    if (r.ok) {
      await vgSetCache({ items: r.items, cached_at: Date.now() });
      return r.items;
    }

    console.warn("VG: background fetch failed", r.error);
    if (cached?.items) return cached.items;

    const seed = await vgLoadLocalSeed();
    await vgSetCache({ items: seed, cached_at: Date.now() });
    return seed;
  }

  // One-liner you can call from anywhere later
  async function vgRefreshLibraryNow() {
    let items = await vgLoadPromptLibrary(true);
    items = await vgUnionStandardGuards(items);
    window.__VG_PROMPT_LIBRARY = items.map((p) => ({
      id: p.id || p.name,
      "Prompt Name": p.name,
      Type: p.type,
      Subcategory: p.subcategory,
      Labels: Array.isArray(p.labels) ? p.labels : [],
      "Prompt Text": p.prompt_text, // kept for Quick Add insert
      Tagline: (p.tag_line ?? p.tagline ?? "").toString(), // ← NEW
      IsPaid: p.is_paid === true, // ← NEW
      Free: !!p.is_free,
      PriceCents: typeof p.price_cents === "number" ? p.price_cents : null,
      CreatorId: p.creator_id || null,
      Source: p.source || "",
      CreatorAvatar: p.creator_avatar || "",
    }));

    document.dispatchEvent(new CustomEvent("vg-lib-updated"));
  }

  // === Quick Add storage (for Library favorites) — DB first, local fallback ===
  const VG_QA_KEY = "vg_quick_add_prompts";

  async function qaGetLocal() {
    return new Promise((res) =>
      browser.storage.local
        .get([VG_QA_KEY])
        .then((o) => res(o[VG_QA_KEY] || []))
    );
  }
  async function qaSetLocal(ids) {
    return new Promise((res) =>
      browser.storage.local.set({ [VG_QA_KEY]: ids }).then(() => res())
    );
  }

  // Per-favorite ON/OFF (local map: { [promptId]: true|false }, default ON)
  const QA_ACTIVE_KEY = "vg_qa_active_map";
  async function qaActiveGetMap() {
    const area = await getArea();
    const got = await area.get("sb_" + QA_ACTIVE_KEY);
    return (got && got["sb_" + QA_ACTIVE_KEY]) || {};
  }
  async function qaActiveSetMap(map) {
    const area = await getArea();
    await area.set({ ["sb_" + QA_ACTIVE_KEY]: map || {} });
    try {
      document.dispatchEvent(new CustomEvent("vg-qa-active-updated"));
    } catch {}
  }
  async function qaActiveSet(id, on) {
    const m = await qaActiveGetMap();
    if (on) m[id] = true;
    else m[id] = false;
    await qaActiveSetMap(m);
  }
  function qaActiveIsOn(map, id) {
    // default ON if missing
    return map[id] !== false;
  }

  // Return array of prompt_ids the user has favorited (server when signed-in, local otherwise)
  async function vgQAGet() {
    try {
      const r = await new Promise((res) =>
        browser.runtime.sendMessage({ type: "VG_LIST_QA_FAVORITES" }).then(res)
      );
      if (r?.ok && Array.isArray(r.data)) {
        const ids = r.data.map((row) => row.prompt_id);
        // mirror to local so Quick Menu (if reading local) stays in sync
        try {
          await qaSetLocal(ids);
        } catch {}
        return ids;
      }
    } catch (_) {}
    // fallback local
    return qaGetLocal();
  }

  // Not used directly by UI now, but we keep local setter for fallback symmetry
  async function vgQASet(ids) {
    return qaSetLocal(ids);
  }

  /* ===== Ownership sets (favorites + purchased) ===== */
  let __VG_FAV_SET = new Set(); // prompt_id strings the user favorited
  let __VG_PURCHASED_SET = new Set(); // prompt_id strings the user purchased

  // BG proxy: get purchased prompt_ids from user_purchases
  async function vgPurchasesGet() {
    try {
      // Prefer background proxy (same pattern as FETCH_PROMPTS etc.)
      const resp = await sendBG("VG_LIST_PURCHASES"); // { ok:true, rows:[{prompt_id}, ...] }
      if (resp?.ok && Array.isArray(resp.rows)) {
        return resp.rows.map((r) => String(r.prompt_id));
      }
    } catch {}
    // Fallback (page-side Supabase, if available)
    try {
      const {
        data: { session },
      } = await (window.VG?.auth?.getSession?.() ?? {
        data: { session: null },
      });
      if (!session?.user || !window.VG?.db) return [];
      const { data, error } = await window.VG.db
        .from("user_purchases")
        .select("prompt_id")
        .eq("user_id", session.user.id);
      if (error || !Array.isArray(data)) return [];
      return data.map((r) => String(r.prompt_id));
    } catch (_) {
      return [];
    }
  }

  // Load both sets (favorites + purchased) and cache them
  async function vgLoadOwnershipSets() {
    try {
      const favIds = await vgQAGet(); // server-first helper you already have
      __VG_FAV_SET = new Set((favIds || []).map(String));
    } catch {
      __VG_FAV_SET = new Set();
    }

    try {
      const purIds = await vgPurchasesGet();
      __VG_PURCHASED_SET = new Set((purIds || []).map(String));
    } catch {
      __VG_PURCHASED_SET = new Set();
    }

    try {
      console.debug("[VG][market] ownership sets", {
        favs: __VG_FAV_SET.size,
        purchased: __VG_PURCHASED_SET.size,
      });
    } catch {}
  }

  // Toggle favorite for current user (BG server → mirror local → notify)
  async function vgQAToggle(id) {
    try {
      const cur = await vgQAGet(); // server-first list (mirrors local)
      const isFav = cur.includes(id);
      const r = await new Promise((res) =>
        browser.runtime
          .sendMessage({
            type: isFav ? "VG_DELETE_QA_FAVORITE" : "VG_UPSERT_QA_FAVORITE",
            prompt_id: id,
          })
          .then(res)
      );
      if (r?.ok) {
        const next = isFav ? cur.filter((x) => x !== id) : [...cur, id];
        try {
          await qaSetLocal(next);
        } catch {}
        try {
          document.dispatchEvent(
            new CustomEvent("vg-qa-updated", { detail: { ids: next } })
          );
        } catch {}
        return !isFav;
      }
    } catch (_) {}
    // Local fallback
    const cur = await qaGetLocal();
    const has = cur.includes(id);
    const next = has ? cur.filter((x) => x !== id) : [...cur, id];
    await qaSetLocal(next);
    try {
      document.dispatchEvent(
        new CustomEvent("vg-qa-updated", { detail: { ids: next } })
      );
    } catch {}
    return !has;
  }

  // === Insert helper ===
  function vgInsertPrompt(text) {
    const ta = findComposerTextarea();
    if (!ta) return alert("Couldn't find the chat input.");
    const cur = "value" in ta ? ta.value || "" : ta.innerText || "";
    const next = (cur ? cur.trimEnd() + "\n\n" : "") + (text || "");
    if ("value" in ta) {
      setReactValue(ta, next);
      ta.focus();
      ta.setSelectionRange(next.length, next.length);
    } else {
      ta.innerText = next;
    }
  }

  // === Render Marketplace (card grid) ===
  function vgRenderMarketplaceGrid(container) {
    const items = Array.isArray(window.__VG_PROMPT_LIBRARY)
      ? window.__VG_PROMPT_LIBRARY
      : [];

    container.innerHTML = `
  <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
    <input id="vg-lib-search" type="text" placeholder="Search by name, text, type, subcategory, labels…"
      style="flex:1;padding:8px;border:1px solid #2a2a33;border-radius:8px;background:#0c0e13;color:#e5e7eb">

    <!-- NEW: Pricing dropdown (UI only in Phase 1) -->
    <div style="flex:0 0 auto;display:flex;align-items:center;gap:8px">
      <label for="vg-price" style="display:none">Pricing</label>
      <select id="vg-price" aria-label="Pricing filter"
        style="min-width:120px;padding:8px;border:1px solid #2a2a33;border-radius:10px;background:#0c0e13;color:#e5e7eb">
        <option value="all">All</option>
        <option value="free">Free</option>
        <option value="paid">Premium</option>
      </select>
    </div>

    <!-- Ownership dropdown -->
    <div style="flex:0 0 auto;margin-left:auto;display:flex;align-items:center;gap:8px">
      <label for="vg-own" style="display:none">Ownership</label>
      <select id="vg-own" aria-label="Ownership filter"
        style="min-width:120px;padding:8px;border:1px solid #2a2a33;border-radius:10px;background:#0c0e13;color:#e5e7eb">
        <option value="all">All</option>
        <option value="mine">Mine</option>
      </select>
    </div>
  </div>


  <div id="vg-pill-filters" style="display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap;padding-bottom:4px;margin-bottom:8px"></div>

  <div id="vg-grid" style="display:grid;grid-template-columns:1fr;gap:10px"></div>
`;

    const searchEl = container.querySelector("#vg-lib-search");
    const pillBar = container.querySelector("#vg-pill-filters");
    const grid = container.querySelector("#vg-grid");
    const priceSel = container.querySelector("#vg-price"); // NEW
    const ownSel = container.querySelector("#vg-own"); // local — not global

    // repaint on dropdown changes
    ownSel?.addEventListener("change", () => doPaint(true));
    priceSel?.addEventListener("change", () => doPaint(true)); // NEW

    // 2-col inside modal; auto 1-col when narrow
    try {
      const mq = matchMedia("(min-width: 860px)");
      const setCols = () =>
        (grid.style.gridTemplateColumns = mq.matches ? "1fr 1fr" : "1fr");
      setCols();
      mq.addEventListener
        ? mq.addEventListener("change", setCols)
        : mq.addListener(setCols);
    } catch {}

    // ── Helpers
    const getPromptUrl = (id) =>
      `https://viberly.ai/prompt/${encodeURIComponent(id)}`; // ← new public route
    const titleOf = (p) => String(p["Prompt Name"] || "").trim();
    const descOf = (p) => {
      const s = String(p["Tagline"] || "").trim();
      if (s) return s;
      const fall = String(p["Prompt Text"] || "")
        .replace(/\s+/g, " ")
        .trim();
      return fall.slice(0, 120) + (fall.length > 120 ? "…" : "");
    };

    const tagsOf = (p) => {
      // Single row: choose at most 3 concise tags (pref: Subcategory + first 2 labels)
      const out = [];
      if (p["Subcategory"]) out.push(String(p["Subcategory"]));
      const labels = Array.isArray(p["Labels"]) ? p["Labels"].map(String) : [];
      labels.slice(0, 2).forEach((t) => out.push(t));
      return out.slice(0, 3);
    };

    // Price formatter for paid prompts
    const formatUSD = (cents) => {
      const n = Number(cents);
      if (!Number.isFinite(n) || n <= 0) return null;
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: "USD",
        }).format(n / 100);
      } catch {
        return "$" + (n / 100).toFixed(2);
      }
    };

    // Stripe checkout (via Background proxy)
    async function handleBuyClick(promptId) {
      try {
        // Ask the BG to create the session with its stored Supabase token
        const resp = await sendBG(
          "VG_START_PROMPT_CHECKOUT",
          { prompt_id: String(promptId) },
          5000
        );

        if (!resp?.ok) {
          if (resp?.reason === "NO_SESSION") {
            // Not signed in inside the extension → open the sign-in popup once
            try {
              await __vgPromptSignInPopup?.();
            } catch {}
            throw new Error("Not signed in");
          }
          throw new Error(resp?.error || "Failed to start checkout");
        }

        const url = resp.checkout_url;
        if (!url) throw new Error("Missing checkout_url");

        // Open Stripe Checkout
        try {
          browser.tabs?.create
            ? browser.tabs.create({ url })
            : window.open(url, "_blank");
        } catch {
          window.open(url, "_blank");
        }

        // When the user returns, refresh purchases so the card flips to "Purchased"
        const onFocus = async () => {
          window.removeEventListener("focus", onFocus);
          try {
            await vgLoadOwnershipSets();
          } catch {}
          try {
            typeof doPaint === "function" && doPaint(true);
          } catch {}
        };
        window.addEventListener("focus", onFocus, { once: true });
      } catch (e) {
        console.error("[VG] Purchase error:", e);
        alert("Failed to start purchase process. Please try again.");
      }
    }

    const allCats = (() => {
      const set = new Set(["All"]);
      items.forEach((p) => {
        if (p["Type"]) set.add(String(p["Type"]));
      });
      return [...set];
    })();

    // Build pill filters
    let currentCat = "All";
    function paintPills() {
      pillBar.innerHTML = "";

      const btns = [];
      function applyPillStyles() {
        btns.forEach(({ btn, cat }) => {
          const isActive = currentCat === cat;
          btn.style.background = isActive ? "#1f1f26" : "#0c0e13";
          btn.style.color = isActive ? "#c9b7ff" : "#cbd5e1";
          btn.style.borderColor = isActive ? "#4c1d95" : "#2a2a33";
          btn.style.boxShadow = isActive
            ? "0 0 0 1px rgba(124,58,237,.25) inset"
            : "none";
        });
      }

      allCats.forEach((cat) => {
        const btn = document.createElement("button");
        btn.textContent = cat;
        btn.style.cssText = `
        padding:6px 12px;border-radius:999px;border:1px solid #2a2a33;
        background:#0c0e13;color:#cbd5e1;
        font:500 12px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        transition:background .12s ease, color .12s ease, border-color .12s ease, box-shadow .12s ease;
      `;
        btn.onclick = () => {
          if (currentCat === cat) return;
          currentCat = cat;
          applyPillStyles(); // visually mark the selection immediately
          doPaint(true); // subtle fade while grid updates
        };
        pillBar.appendChild(btn);
        btns.push({ btn, cat });
      });

      applyPillStyles();
    }

    function filterByQuery(list, q) {
      if (!q) return list;
      const n = String(q).toLowerCase();
      return list.filter(
        (p) =>
          titleOf(p).toLowerCase().includes(n) ||
          String(p["Tagline"] || "")
            .toLowerCase()
            .includes(n) ||
          String(p["Type"] || "")
            .toLowerCase()
            .includes(n) ||
          String(p["Subcategory"] || "")
            .toLowerCase()
            .includes(n) ||
          (Array.isArray(p["Labels"]) ? p["Labels"] : []).some((t) =>
            String(t).toLowerCase().includes(n)
          )
      );
    }

    function filterByCat(list) {
      if (currentCat === "All") return list;
      return list.filter((p) => String(p["Type"] || "") === currentCat);
    }

    function pricePill(isPaid) {
      // Only show chip for Free items; paid items rely on the Buy CTA
      if (isPaid) return null;
      const el = document.createElement("span");
      el.textContent = "Free";
      el.style.cssText = `
      display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
      font:600 11px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      background:#093316;color:#86efac;border:1px solid #14532d
    `;
      return el;
    }

    function cardFor(p) {
      const card = document.createElement("div");
      card.style.cssText = `
      border:1px solid #1e2230;background:#0f1116;border-radius:12px;padding:12px;
      transition:border-color .12s ease, box-shadow .12s ease
    `;
      card.onmouseenter = () => {
        card.style.borderColor = "#4c1d95";
        card.style.boxShadow = "0 12px 40px rgba(0,0,0,.45)";
      };
      card.onmouseleave = () => {
        card.style.borderColor = "#1e2230";
        card.style.boxShadow = "none";
      };

      const top = document.createElement("div");
      top.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:8px";
      const left = document.createElement("div");
      left.style.cssText = "display:flex;align-items:center;gap:8px";

      // Avatar (creator)
      const av = document.createElement("div");
      const avatarUrl = String(p["CreatorAvatar"] || "").trim();
      if (avatarUrl) {
        const img = document.createElement("img");
        img.src = avatarUrl;
        img.alt = p["Prompt Name"] || "Creator";
        img.referrerPolicy = "no-referrer";
        img.style.cssText =
          "width:36px;height:36px;border-radius:10px;display:block;object-fit:cover";
        av.appendChild(img);
        av.style.cssText =
          "width:36px;height:36px;border-radius:10px;display:block";
      } else {
        av.style.cssText =
          "width:36px;height:36px;border-radius:10px;background:#1f1f26;color:#fff;display:grid;place-items:center;font-weight:700";
        av.textContent = "👤";
      }

      const name = document.createElement("div");
      name.textContent = titleOf(p);
      name.title = titleOf(p);
      name.style.cssText =
        "font-weight:600;color:#e5e7eb;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

      left.appendChild(av);
      left.appendChild(name);

      const pop = document.createElement("a");
      pop.href = getPromptUrl(p.id);
      pop.target = "_blank";
      pop.rel = "noreferrer";
      pop.title = "Open prompt page";
      pop.textContent = "↗";
      pop.style.cssText = "color:#cbd5e1;text-decoration:none";

      // Prefer Chrome Tabs API for extensions; fallback to window.open
      pop.addEventListener("click", (e) => {
        try {
          e.preventDefault();
          e.stopPropagation();
          const url = getPromptUrl(p.id);
          if (browser?.tabs?.create) {
            browser.tabs.create({ url });
          } else if (browser?.tabs?.update) {
            browser.tabs.update({ url });
          } else {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        } catch {
          // last resort
          try {
            window.open(getPromptUrl(p.id), "_blank", "noopener,noreferrer");
          } catch {}
        }
      });

      top.appendChild(left);
      top.appendChild(pop);

      // Tagline Body (short)
      const body = document.createElement("div");
      body.style.cssText = "margin-top:6px;color:#cbd5e1cc;font-size:13px";
      body.textContent = descOf(p);

      // Tags (one row, max 3)
      const tags = document.createElement("div");
      tags.style.cssText =
        "display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:6px";
      tagsOf(p).forEach((t) => {
        const chip = document.createElement("span");
        chip.textContent = t;
        chip.style.cssText =
          "display:inline-block;margin-right:6px;font-size:11px;color:#cbd5e1;border:1px solid #2a2a33;border-radius:999px;padding:2px 8px;vertical-align:middle";
        tags.appendChild(chip);
      });

      // Footer
      const foot = document.createElement("div");
      foot.style.cssText =
        "margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px";

      const leftFoot = document.createElement("div");
      leftFoot.style.cssText = "display:flex;align-items:center;gap:8px";

      const pid = String(p.id);
      const paid = !!p["IsPaid"];
      const isPurchased = __VG_PURCHASED_SET.has(pid);
      const priceCents =
        typeof p["PriceCents"] === "number" ? p["PriceCents"] : null;
      const priceText = formatUSD(priceCents);

      if (!paid) {
        // Free → show "Free" chip
        const freeChip = pricePill(false);
        if (freeChip) leftFoot.appendChild(freeChip);
      } else if (isPurchased) {
        // Paid + purchased → show "Purchased" chip
        const pc = document.createElement("span");
        pc.textContent = "Purchased";
        pc.style.cssText = `
        display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
        font:600 11px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        background:#1b1430;color:#c9b7ff;border:1px solid #4c1d95
      `;
        leftFoot.appendChild(pc);
      } else {
        // Paid & not owned → show price chip when available
        if (priceText) {
          const priceChip = document.createElement("span");
          priceChip.textContent = priceText;
          priceChip.style.cssText = `
          display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;
          font:700 11px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
          background:#1a2433;color:#cde1ff;border:1px solid #264766
        `;
          leftFoot.appendChild(priceChip);
        }
      }

      // Right CTA
      // --- CTA (ownership-aware) ---
      const cta = document.createElement("button");
      const isFav = __VG_FAV_SET.has(pid);

      // label + style
      if (paid) {
        // Owned paid prompts align with “Added ✓” language and are inert
        if (isPurchased) {
          cta.textContent = "Added ✓";
          cta.style.cssText =
            "padding:7px 12px;border-radius:10px;cursor:default;background:#1f1f26;color:#cbd5e1;border:1px solid #2a2a33;pointer-events:none;opacity:.9";
        } else {
          cta.textContent = "Buy";
          cta.style.cssText =
            "padding:7px 12px;border-radius:10px;cursor:pointer;background:#7c3aed;color:#fff;border:0;font-weight:700";
        }
      } else {
        cta.textContent = isFav ? "Added ✓" : "Quick Add";
        cta.style.cssText =
          "padding:7px 12px;border-radius:10px;cursor:pointer;background:#111827;color:#e5e7eb;border:1px solid #2a2a33";
      }

      cta.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (paid) {
          if (isPurchased) return; // already owned; CTA disabled anyway
          await handleBuyClick(pid); // opens Stripe
        } else {
          try {
            const nowAdded = await vgQAToggle(pid);
            if (nowAdded) __VG_FAV_SET.add(pid);
            else __VG_FAV_SET.delete(pid);
            cta.textContent = nowAdded ? "Added ✓" : "Quick Add";
          } catch {}
        }
      };

      foot.appendChild(leftFoot);
      foot.appendChild(cta);

      card.appendChild(top);
      card.appendChild(body);
      card.appendChild(tags);
      card.appendChild(foot);
      return card;
    }

    async function doPaint(busy = false) {
      // subtle visual feedback
      try {
        grid.style.transition = grid.style.transition || "opacity .14s ease";
        if (busy) {
          grid.style.opacity = "0.45";
          grid.style.pointerEvents = "none";
        }
      } catch {}

      const query = (searchEl.value || "").trim().toLowerCase();
      let filtered = filterByCat(filterByQuery(items, query));

      // ownership filter (union: favorites ∪ purchased)
      const own = String(ownSel?.value || "all");
      if (own === "mine") {
        filtered = filtered.filter((p) => {
          const id = String(p.id);
          return __VG_FAV_SET.has(id) || __VG_PURCHASED_SET.has(id);
        });
      }

      // NEW: pricing filter
      const price = String(priceSel?.value || "all");
      if (price !== "all") {
        filtered = filtered.filter((p) => {
          const isFree =
            p["Free"] === true ||
            p["PriceCents"] == null ||
            p["PriceCents"] === 0;

          const isPaid =
            p["IsPaid"] === true ||
            (typeof p["PriceCents"] === "number" && p["PriceCents"] > 0);

          return price === "free" ? isFree : isPaid; // 'paid' → Premium
        });
      }

      grid.innerHTML = "";
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No prompts match your filters.";
        grid.appendChild(empty);
      } else {
        filtered.forEach((p) => grid.appendChild(cardFor(p)));
      }

      // fade back in
      try {
        requestAnimationFrame(() => {
          grid.style.opacity = "1";
          grid.style.pointerEvents = "auto";
        });
      } catch {}
    }

    paintPills();
    // Ensure we have ownership sets before first paint
    vgLoadOwnershipSets()
      .then(() => doPaint())
      .catch(() => doPaint());

    let t = null;
    searchEl.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(doPaint, 120);
    });
  }

  // Boot library immediately (runs once on page load in this IIFE)
  (async () => {
    try {
      let items = await vgLoadPromptLibrary();
      items = await vgUnionStandardGuards(items);
      window.__VG_PROMPT_LIBRARY = items.map((p) => ({
        id: p.id || p.name,
        "Prompt Name": p.name,
        Type: p.type,
        Subcategory: p.subcategory,
        Labels: Array.isArray(p.labels) ? p.labels : [],
        "Prompt Text": p.prompt_text, // kept for Quick Add insert
        Tagline: (p.tag_line ?? p.tagline ?? "").toString(), // ← NEW
        IsPaid: p.is_paid === true, // ← NEW
        Free: !!p.is_free,
        PriceCents: typeof p.price_cents === "number" ? p.price_cents : null,
        CreatorId: p.creator_id || null,
        Source: p.source || "",
        CreatorAvatar: p.creator_avatar || "",
      }));

      document.dispatchEvent(new CustomEvent("vg-lib-ready"));
    } catch (e) {
      console.warn("[VG] Library boot failed", e);
      window.__VG_PROMPT_LIBRARY = [];
    }
  })();

  // volatile runtime flags
  let __VG_LAST_MENU_CLOSE = 0;
  let __VG_LAST_MODAL_CLOSE = 0;
  let __VG_COUNTDOWN_ACTIVE = false;
  let __VG_BYPASS_INTERCEPT = false;
  let __VG_ACTIVE_COUNTDOWN_TOKEN = null;

  /// live behavior settings cache (mirrors storage)
  let __VG_SETTINGS = { auto_chat: false, send_delay_sec: 0 };

  // --- Publish behavior settings globally for interceptsend.js (Option A) ---
  function __vgPublishBehaviorSettings() {
    try {
      window.__VG_SETTINGS = {
        auto_chat: !!__VG_SETTINGS.auto_chat,
        send_delay_sec: Number(__VG_SETTINGS.send_delay_sec || 0),
      };
    } catch {}
  }
  // publish initial defaults immediately (safe, will be updated after hydrate)
  __vgPublishBehaviorSettings();
  // version tag (moved out of content.js so define it here)
  const PILL_VERSION = "6.4.0";

  // make version non-writable (best effort)
  try {
    Object.defineProperty(window, "__VG_PILL_VERSION__", {
      value: PILL_VERSION,
      writable: false,
    });
  } catch {}

  // ===== Tiny utils =====
  const text = (el) => ((el && (el.innerText || el.textContent)) || "").trim();
  const qbtn = (root = document) =>
    Array.from(root.querySelectorAll('button,[role="button"]'));

  function vgIsVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const st = getComputedStyle(el);
    if (
      st.visibility === "hidden" ||
      st.display === "none" ||
      Number(st.opacity) === 0
    )
      return false;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) return false;
    if (r.bottom <= 0 || r.top >= innerHeight) return false;
    return true;
  }

  // === Quick test hook for background fetch ===
  window.__VG_TEST_FETCH = async () => {
    const r = await new Promise((resolve) =>
      browser.runtime.sendMessage({ type: "FETCH_PROMPTS" }).then(resolve)
    );
    console.log("FETCH_PROMPTS →", r);
    return r;
  };

  function findRowEditChat() {
    const btns = qbtn(document);
    const edit = btns.find((b) => /^\s*Edit\s*$/i.test(text(b)));
    const chat = btns.find((b) => /^\s*Chat\s*$/i.test(text(b)));
    if (!edit || !chat) return { row: null, edit: null, chat: null };

    const seen = new Set();
    for (let n = edit; n; n = n.parentElement) seen.add(n);

    let row = chat;
    while (row && !seen.has(row)) row = row.parentElement;
    return { row, edit, chat };
  }

  // ===== Composer helpers =====

  // Fallback composer finder (used if content.js didn’t attach one)
  window.vgFindComposer =
    window.vgFindComposer ||
    function () {
      const sel =
        'textarea,[role="textbox"],[contenteditable="true"],[contenteditable]';
      const list = Array.from(document.querySelectorAll(sel)).filter(
        vgIsVisible
      );
      // prefer focused or lower-on-screen
      list.sort((a, b) => {
        const af = document.activeElement === a ? 1 : 0;
        const bf = document.activeElement === b ? 1 : 0;
        const ar = a.getBoundingClientRect(),
          br = b.getBoundingClientRect();
        return bf - af || br.top + br.height / 2 - (ar.top + ar.height / 2);
      });
      return list[0] || null;
    };

  function findComposerTextarea() {
    const el = vgFindComposer();
    return el && vgIsVisible(el) ? el : null; // can be <textarea> or contenteditable
  }

  // === Send button finder (rightmost visible submit-like control) ===
  function vgFindSendButtonIn(composer) {
    if (!composer) return null;

    const Q = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[aria-label*="send" i]',
      'button[title*="send" i]',
      '[role="button"]',
    ].join(",");

    // Try inside the composer first
    const inside = Array.from(composer.querySelectorAll(Q)).filter(vgIsVisible);
    let cands = inside;

    // Fallback: try a nearby row/container if nothing inside
    if (!cands.length) {
      const row =
        composer.closest(
          '[class*="row"],[class*="bar"],[class*="container"],[class*="footer"]'
        ) ||
        composer.parentElement ||
        document.body;
      const more = Array.from(row.querySelectorAll(Q)).filter(vgIsVisible);
      cands = more;
    }
    if (!cands.length) return null;

    // Pick the rightmost visible candidate
    cands.sort(
      (a, b) =>
        b.getBoundingClientRect().right - a.getBoundingClientRect().right
    );
    return cands[0];
  }

  function placeLeftOfSend(pillEl, composerEl, rule = {}) {
    try {
      const send = vgFindSendButtonIn(composerEl);
      if (!send) return; // fallback handled by caller

      const R = send.getBoundingClientRect();
      // defaults if not provided by DB rule
      const gap = Number(rule.send_gap_px ?? 10);
      const size = Number(rule.pill_size ?? CFG?.PILL_HEIGHT ?? 30);
      const dy = Number(rule.dy_px ?? 0); // vertical tweak if needed

      // set pill size if rule specifies
      try {
        pillEl.style.width = `${size}px`;
        pillEl.style.height = `${size}px`;
      } catch {}

      const x = R.left - gap;
      const y = R.top + R.height / 2 + dy;

      pillEl.style.position = "fixed";
      pillEl.style.left = Math.round(x) + "px";
      pillEl.style.top = Math.round(y) + "px";
      pillEl.style.right = "auto";
      pillEl.style.bottom = "auto";
      pillEl.style.transform = "translate(-100%, -50%)"; // left of button, vertically centered
      pillEl.style.opacity = "1";
      pillEl.style.zIndex = String(Z);
    } catch {
      /* let caller fallback */
    }
  }

  function setReactValue(el, value) {
    try {
      const proto = Object.getPrototypeOf(el);
      const desc = proto
        ? Object.getOwnPropertyDescriptor(proto, "value")
        : null;
      if (desc && typeof desc.set === "function") {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_e) {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function setComposerGuardAndCaret(textBlock /*, marker */) {
    const ta = findComposerTextarea();
    if (!ta) return false;

    const cur = "value" in ta ? ta.value || "" : ta.innerText || "";
    const next =
      String(textBlock || "").trimEnd() + (cur ? "\n\n" + cur.trimStart() : "");

    if ("value" in ta) {
      setReactValue(ta, next);
    } else {
      ta.innerText = next;
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }

    try {
      ta.focus();
      if ("value" in ta) {
        ta.setSelectionRange(next.length, next.length);
      } else {
        const sel = window.getSelection();
        sel.removeAllRanges();
        const r = document.createRange();
        r.selectNodeContents(ta);
        r.collapse(false);
        sel.addRange(r);
      }
    } catch (_e) {}
    return true;
  }

  // ===== Storage helpers =====
  async function getArea() {
    try {
      await browser.storage.sync.get(null);
      return browser.storage.sync;
    } catch (_e) {
      return browser.storage.local;
    }
  }

  async function S_get(key, def = null) {
    const area = await getArea();
    const obj = await area.get("sb_" + key);
    return Object.prototype.hasOwnProperty.call(obj, "sb_" + key)
      ? obj["sb_" + key]
      : def;
  }

  async function S_set(key, val) {
    const area = await getArea();
    await area.set({ ["sb_" + key]: val });
  }

  async function S_getMany(keys) {
    const area = await getArea();
    const prefixed = keys.map((k) => "sb_" + k);
    const got = await area.get(prefixed);
    const out = {};
    keys.forEach((k, i) => {
      const pk = prefixed[i];
      if (pk in got) out[k] = got[pk];
    });
    return out;
  }

  // === Roaming settings via background (Supabase lives in the worker) ===
  async function DB_getUserSettings() {
    try {
      await __vgEnsureBGSessionFromSoT();
      const resp = await sendBG("VG_LOAD_SETTINGS");
      if (resp?.ok) return resp.data || null;
    } catch (e) {
      console.warn("[VG] DB_getUserSettings bridge failed", e);
    }
    return null;
  }

  async function DB_saveUserSettings(partial) {
    try {
      await __vgEnsureBGSessionFromSoT();
      const resp = await sendBG("VG_SAVE_SETTINGS", { patch: partial || {} });
      if (resp?.ok) return true;
      if (resp?.reason === "NO_SESSION") return "__NO_SESSION__";
      return false;
    } catch (e) {
      console.warn("[VG] DB_saveUserSettings bridge failed", e);
      return false;
    }
  }

  // Ask background to open the sign-in popup window
  async function __vgPromptSignInPopup() {
    try {
      const r = await browser.runtime.sendMessage({
        type: "VG_OPEN_SIGNIN_POPUP",
      });
      console.debug("[VG] sign-in popup opened:", r);
    } catch (e) {
      console.warn("[VG] could not open sign-in popup:", e);
    }
  }

  // Wrapper: save to profile, or prompt login if the background reports NO_SESSION
  async function saveSettingsRoamingOrPromptLogin(patch) {
    const ok = await DB_saveUserSettings(patch);
    if (ok === "__NO_SESSION__") {
      await __vgPromptSignInPopup();
      return false;
    }
    return !!ok;
  }

  // Soft-gate: compare UNIQUE guard usages against plan limits (open Billing if exceeded)
  async function maybePromptUpgrade() {
    try {
      const {
        data: { session },
      } = await (window.VG?.auth?.getSession?.() ?? {
        data: { session: null },
      });
      if (!session?.user) return;

      const { data, error } = await (window.VG?.db)
        .from("vg_profiles")
        .select("tier, custom_guards_count, quick_adds_count")
        .eq("user_id", session.user.id)
        .single();

      if (error) return;

      const tier = String(data?.tier || "free").toLowerCase();
      const usedGuards = data?.custom_guards_count ?? 0;
      const usedQuick = data?.quick_adds_count ?? 0;

      // current plan limits
      const LIMITS = { free: 1, basic: 3, pro: Infinity };
      const limit = tier in LIMITS ? LIMITS[tier] : LIMITS.free;

      // If either unique count exceeds the plan → open Billing
      if (usedGuards > limit || usedQuick > limit) {
        try {
          openModal?.("billing");
        } catch {}
        setTimeout(() => {
          const host = document.getElementById(APP + "-modal-host");
          const sh = host?.shadowRoot;
          sh?.querySelector("#tab-billing")?.click();
        }, 60);
      }
    } catch (_) {
      /* silent */
    }
  }

  // Make it callable from Quick Menu (which calls window.maybePromptUpgrade())
  try {
    window.maybePromptUpgrade = maybePromptUpgrade;
  } catch {}

  // ===== Custom Guards storage (Supabase-backed via VG) =====
  // NOTE: keeps the SAME function names your UI already calls.

  function __vgCategory() {
    // programmatic site categorization; no per-domain UI
    try {
      return (
        (window.VG && VG.utils.getCategoryForHost(location.hostname)) ||
        "general"
      );
    } catch {
      return "general";
    }
  }

  // Map DB rows <-> your local item shape
  function __toLocalGuard(row) {
    return {
      id: row.id,
      name: row.title || row.name || "Custom Guard",
      body: row.body || "",
      tags: Array.isArray(row.tags)
        ? row.tags
        : Array.isArray(row.labels)
        ? row.labels
        : [],
      status: row.status || "inactive",
      createdAt: row.created_at
        ? Date.parse(row.created_at)
        : typeof row.updatedAt === "number"
        ? row.updatedAt
        : Date.now(),
      updatedAt: row.updated_at
        ? Date.parse(row.updated_at)
        : typeof row.updatedAt === "number"
        ? row.updatedAt
        : Date.now(),
      siteCategory: row.siteCategory || row.site_category || null,
      visibility: row.visibility || "private",
    };
  }

  // List custom guards via Background (SoT) — return ALL for the user (no site filtering)
  async function CG_list(_scope = "site") {
    await __vgEnsureBGSessionFromSoT();

    let items = [];
    try {
      const resp = await sendBG("VG_LIST_CUSTOM_PROMPTS");
      if (resp && resp.ok && Array.isArray(resp.items)) {
        items = resp.items;
      }
    } catch (_) {
      items = [];
    }

    if (!Array.isArray(items)) return [];

    return items
      .filter(
        (row) => String(row?.status || "").toLowerCase() === "active"
      )
      .map(__toLocalGuard);
  }

  // (Deprecated in DB mode—no-op kept for compatibility)
  async function CG_saveAll(items) {
    return items;
  }

  // Create a new guard via Background (BG has the authenticated Supabase client)
  async function CG_create({ name, body, tags = [] }) {
    const cat = __vgCategory();
    await __vgEnsureBGSessionFromSoT();
    const resp = await sendBG("VG_GUARD_CREATE", {
      title: (name || "").trim() || "Custom Guard",
      body: body || "",
      variables: [], // jsonb (kept empty today)
      tags: Array.isArray(tags) ? tags : [],
      site_category: cat,
      config: {}, // jsonb reserved
    });
    if (!resp?.ok || !resp?.row)
      throw new Error(resp?.error || "CREATE_FAILED");
    return __toLocalGuard(resp.row);
  }

  // Update an existing guard via Background
  async function CG_update(id, patch) {
    const payload = {};
    if (typeof patch?.name === "string") payload.title = patch.name;
    if (typeof patch?.body === "string") payload.body = patch.body;
    if (Array.isArray(patch?.tags)) payload.tags = patch.tags;

    await __vgEnsureBGSessionFromSoT();
    const resp = await sendBG("VG_GUARD_UPDATE", { id, patch: payload });
    if (!resp?.ok || !resp?.row)
      throw new Error(resp?.error || "UPDATE_FAILED");
    return __toLocalGuard(resp.row);
  }

  // Delete a guard via Background
  async function CG_delete(id) {
    await __vgEnsureBGSessionFromSoT();
    const resp = await sendBG("VG_DELETE_GUARD", { id });
    if (!resp?.ok) throw new Error(resp?.error || "DELETE_FAILED");
    return true;
  }

  // ===== Guards meta =====
  const PROTECTIONS = [
    { id: "basic", label: "Basic Prompt Guards" },
    { id: "ui", label: "Restrict design changes" },
    { id: "copy", label: "Restrict text changes" },
    { id: "logic", label: "Restrict logic changes" },
    { id: "strict", label: "Only touch listed files" },
    { id: "noref", label: "No refactors" },
    { id: "wire", label: "Wire-Up New Code Paths" },
    { id: "pol", label: "Database/RLS & Service-Role Safety" },
    { id: "data", label: "Data Alignment & Schema Contracts" },
    { id: "qa", label: "Double-Check Work" },
  ];

  const PRESETS = [
    {
      id: "all",
      name: "Beginner Safe Mode (all)",
      on: [
        "basic",
        "ui",
        "copy",
        "logic",
        "strict",
        "noref",
        "wire",
        "pol",
        "data",
      ],
    },
    { id: "design", name: "Design Guard", on: ["ui", "copy"] },
    {
      id: "logic",
      name: "Logic Guard",
      on: ["logic", "noref", "wire", "data"],
    },
    {
      id: "bugfix",
      name: "Bugfix Surgical Mode",
      on: ["copy", "logic", "strict", "noref"],
    },
    {
      id: "ship",
      name: "Ship-Safe Feature Build",
      on: ["logic", "strict", "noref", "wire", "pol", "data"],
    },
  ];

  // --- NEW: helpers to infer preset or "custom" from a list of toggles
  function _norm(arr) {
    return [...new Set(arr || [])].sort();
  }
  function inferPresetIdFromList(list) {
    const key = _norm(list).join(",");
    for (const p of PRESETS) {
      if (_norm(p.on).join(",") === key) return p.id;
    }
    return "custom";
  }

  // ===== Modal (v0.4.9) =====
  async function openModal(defaultTab = "advanced") {
    if (document.getElementById(APP + "-modal-host")) return;

    // Only block if we are SURE the user is signed out.
    try {
      let signedFlag; // undefined = unknown

      // 1) Page-side Supabase
      try {
        const resp = await (window.VG?.auth?.getSession?.() ??
          Promise.resolve({ data: {} }));
        const s = resp?.data?.session;
        if (s && s.user) signedFlag = true;
      } catch {}

      // 2) Background with timeout
      if (typeof signedFlag !== "boolean") {
        const auth = await new Promise((res) => {
          let done = false;
          const to = setTimeout(() => {
            if (!done) res(undefined);
          }, 400);
          try {
            browser.runtime.sendMessage({ type: "AUTH_STATUS" }).then((r) => {
              done = true;
              clearTimeout(to);
              res(r);
            });
          } catch {
            res(undefined);
          }
        });
        if (typeof auth?.signedIn === "boolean") signedFlag = auth.signedIn;
      }

      // 3) Unknown → allow
      if (typeof signedFlag !== "boolean") signedFlag = true;

      if (signedFlag === false) {
        await new Promise((res) =>
          browser.runtime.sendMessage({ type: "OPEN_POPUP" }).then(res)
        );
        return;
      }
    } catch {}

    // === ensure guard templates are hydrated before building the UI ===
    await vgLoadGuardTemplatesFromDB();

    const host = document.createElement("div");
    host.id = APP + "-modal-host";
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: "open" });
    const LOGO_URL = browser.runtime.getURL("assets/Viberly-transparent.svg");
    shadow.innerHTML = `
	  <style>

        *{box-sizing:border-box}
        .overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2147483647;pointer-events:auto}
        /* Fixed shell (width + height) so the outer modal never jumps */
        .modal{
          width:min(980px,94vw);
          height:86vh;                 /* <— fixed height */
          display:flex;                /* stack header/tabs/banner/body/footer */
          flex-direction:column;
          background:#0f1116;
          color:#e5e7eb;
          border:1px solid #2a2a33;
          border-radius:16px;
          box-shadow:0 40px 100px rgba(0,0,0,.6);
          pointer-events:auto;
          overflow:hidden;             /* <— prevent shell from resizing */
        }

	.header{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #2a2a33;background:#14151d;z-index:5}
	.title{display:inline-flex;align-items:flex-end;gap:10px;font-family:system-ui,-apple-system,Segoe UI,Inter,Roboto,Arial,sans-serif;font-weight:600;font-size:16px;line-height:1}
	.title .logo{height:42px;width:auto;display:block}
	.ver{align-self:flex-end;position:relative;top:1px;font-weight:500;font-size:12px;color:#a1a1aa;margin-left:0}

       
.close{cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#1f1f26;color:#cbd5e1}
.close:hover{background:#2a2a33}

.help {
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: #1f1f26;
  color: #cbd5e1;
  font-weight: 600;
  font-size: 15px;
}
.help:hover { background:#2a2a33; }


	.banner{margin:12px 18px 12px;padding:10px 12px;border:1px dashed #4b5563;border-radius:10px;background:#0f1116;color:#cbd5e1;font-size:13px}
        /* Scroll only the inner content area, not the modal shell */
        .body{
          flex:1;                      /* fill the fixed-height shell */
          overflow:auto;               /* internal scroll only */
          padding:12px 18px 80px;
          display:flex;
          flex-direction:column;
          gap:16px;
        }

        .card{border:1px solid #2a2a33;border-radius:12px;background:#0f1116;padding:12px}
        .muted{color:#a1a1aa;font-size:12px}
        .toprow{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:12px;flex-wrap:wrap}
        select{background:#0c0e13;color:#e5e7eb;border:1px solid #2a2a33;border-radius:10px;padding:8px}
        table{width:100%;border-collapse:collapse;font-size:13px}
        th,td{padding:10px 8px;border-bottom:1px solid #22232b;text-align:left}
        th{color:#cbd5e1;font-weight:600}
        
	.tog{
	  display:inline-flex; align-items:center; gap:6px;
	  background:#1b1d27;                       /* darker neutral */
	  border:1px solid #2a2f3a;
	  border-radius:999px; padding:4px 10px;
	  cursor:pointer; user-select:none;
	  color:#cbd5e1;
	  transition:background .12s, border-color .12s, color .12s;
	}
	.tog:hover{ background:#222431; border-color:#343a46; }
	
	.tog.on{
	  background:#2a2f3a;                        /* neutral "on" */
	  border-color:#3a4250;
	  color:#e5e7eb;
	}


        .btn{background:#7c3aed;color:white;border:0;padding:8px 14px;border-radius:10px;cursor:pointer;font-weight:500}
        .ghost{background:#1f1f26;color:#e5e7eb;border:1px solid #2a2a33}
        #preview{border:1px solid #2a2a33;border-radius:10px;padding:12px;min-height:200px;background:#0c0e13;color:#e5e7eb;white-space:pre-wrap}
        .footer{position:sticky;bottom:0;background:#14151d;display:flex;justify-content:flex-end;gap:10px;padding:12px 18px;border-top:1px solid #2a2a33}
        .behave{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
        .group{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
        .info{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#1f1f26;border:1px solid #2a2a33;color:#cbd5e1;font-size:12px;cursor:default}
        
	.tooltip{position:relative;display:inline-flex;align-items:center;gap:8px}
	.tooltip:hover .tip{opacity:1;transform:translateY(-2px);pointer-events:auto}
	.tip{
	  opacity:0; pointer-events:none; position:absolute; left:0; transform:translate(0,0);
	  bottom:150%; min-width:240px; max-width:360px; padding:8px 10px; border-radius:8px;
	  background:#0e0f14; border:1px solid #2a2a33; color:#e5e7eb; font-size:12px;
	  box-shadow:0 12px 40px rgba(0,0,0,.45);
	  z-index:50;                /* keep it above normal content */
	}
	.right .tip{left:auto; right:0;}
	/* Renders the tooltip below the trigger, away from the sticky header */
	.tip-below{ top:calc(100% + 8px); bottom:auto; transform:none; }


        /* --- Sticky tabs just under the header (lower z so it never covers header/footer) --- */
	.tabs{
	  position:sticky;
	  top:46px;                 /* header height */
	  z-index:4;                /* was 7 — lower than header/footer */
	  background:#14151d;
	  margin:0;
	  padding:10px 18px 8px;
	  border-bottom:1px solid #2a2a33;
	}


       .tabs .tab{
         display:inline-block;
         font:600 13px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
         color:#a1a1aa;
         margin-right:16px;
         padding-bottom:6px;
         cursor:pointer;
       }
       /* active tab underline rendered above the row border */
      .tabs .tab{ position:relative; }
      .tabs .tab.active{
        color:#e5e7eb;
      }
      .tabs .tab.active::after{
        content:"";
        position:absolute;
        left:0; right:0;
        height:2px;
        background:#7c3aed;
        bottom:-1px;            /* sits on top of the row border */
        border-radius:1px;
      }

       .tabs{
         background:#14151d;   /* already there */
         border-bottom:1px solid #22232b;
       }

       /* Reset native button look in the tabs row */
      .tabs .tab{
        background: transparent !important;
        border: 0 !important;
        -webkit-appearance: none;
        appearance: none;
        box-shadow: none;
      }
      .tabs .tab:focus{
        outline: none;
        box-shadow: none;
      }

	/* Ensure header/footer always float above scroll content & tabs */
	.header{ z-index:15; position:sticky; top:0; }
	.footer{ z-index:15; }

	/* Let tooltips escape above the header by not creating a stacking context here */
	.body{ position:relative; z-index:auto; }


	/* Hidden overlays must not intercept clicks under any circumstance */
	.cgm-overlay[hidden], .tplm-overlay[hidden]{ display:none !important; }


      /* --- Preview pill (match .tog height) --- */
      .preview-btn{
        padding:4px 10px;
        border-radius:999px;
        font-size:12px;
        line-height:1;
        height:auto;
        background:#1f1f26;
        border:1px solid #2a2a33;
        color:#e5e7eb;
        cursor:pointer;
      }
      .preview-btn:hover{
        background:#24242c;
      }

        /* === New Custom Prompt Modal (cgm-*) === */
        .cgm-overlay{
          position:fixed; inset:0; z-index:9999;
          display:flex; align-items:center; justify-content:center;
          background:rgba(0,0,0,.55);
        }  
        .cgm-overlay[hidden]{ display:none; }

        .cgm-dialog{
          width:min(720px, 92vw);
          max-height:84vh;
          background:#0f1116;
          color:#e5e7eb;
          border:1px solid #2a2a33;
          border-radius:12px;
          box-shadow:0 30px 100px rgba(0,0,0,.6);
          display:flex; flex-direction:column;
        }

        .cgm-header{
         display:flex; align-items:center; justify-content:space-between;
          gap:8px; padding:12px 14px;
          background:#14151d; border-bottom:1px solid #2a2a33;
        }
        .cgm-title{
          font:600 14px Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
          color:#e5e7eb;
        } 
        .cgm-actions{ display:flex; gap:8px; }

        .cgm-body{
          padding:14px; overflow:auto; display:flex; flex-direction:column; gap:12px;
        }
        .cgm-label{
          font:600 12px Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
          color:#cbd5e1;
        }
        .cgm-input,
        .cgm-textarea{
          width:100%;
          border:1px solid #2a2a33;
          border-radius:10px;
          background:#0c0e13;
          color:#e5e7eb;
          padding:10px 12px;
          font:13px Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        }
        .cgm-textarea{
          min-height:220px; resize:vertical; line-height:1.45;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
          font-size:12px;
        }


	/* Import preview table */
	.vgImpTable { width:100%; border-collapse:collapse; font:13px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; }
	.vgImpTable th, .vgImpTable td { border-bottom:1px solid #22232b; padding:8px; text-align:left; color:#cbd5e1; }
	.vgImpTable th { font-weight:600; color:#aeb6c2; position:sticky; top:0; background:#0c0e13; }
	.vgChip { display:inline-flex; gap:6px; flex-wrap:wrap; }
	.vgTag { display:inline-flex; padding:2px 6px; border-radius:999px; border:1px solid #2a2a33; color:#aeb6c2; }



        .cgm-footer{
          display:flex; justify-content:flex-end; gap:8px; padding:12px 14px;
          border-top:1px solid #2a2a33; background:#0f1116;
        }

        
	/* --- Save button feedback --- */
	.btn.loading{position:relative;opacity:.9;pointer-events:none}
	.btn .spin{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;margin-right:8px;vertical-align:-2px;animation:vgspin .8s linear infinite}
	@keyframes vgspin{to{transform:rotate(360deg)}}
	.btn.saved{pointer-events:none}


      /* === Small Preview Modal (read-only) === */
     .tplm-overlay{
        position:fixed; inset:0; z-index:9999;
        display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,.55); 
      }
      .tplm-overlay[hidden]{ display:none; }

      .tplm-dialog{
        width:min(780px, 92vw);
        max-height:84vh;
        background:#0f1116;
        color:#e5e7eb;
        border:1px solid #2a2a33;
        border-radius:12px;
        box-shadow:0 30px 100px rgba(0,0,0,.6);
        display:flex; flex-direction:column;
      }

      .tplm-header{
        display:flex; align-items:center; justify-content:space-between;
        gap:8px; padding:12px 14px;
        background:#14151d; border-bottom:1px solid #2a2a33;
      }
      .tplm-title{
        font:600 14px Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
        color:#e5e7eb;
      }
      .tplm-actions{ display:flex; gap:8px; }

      .tplm-body{
	  padding:12px 14px; overflow:auto;
	  white-space:pre-wrap; background:#0c0e13;
	  border-top:1px solid rgba(255,255,255,.04);
	  font:13px/1.5 Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
	}


	/* ===== Billing tab (Settings → Billing) ===== */
	:host, .modal {
	  --primary: #7c3aed;       /* purple */
	  --btn-bg: #1f1f26;
	  --btn-border: #2a2a33;
	  --text: #e5e7eb;
	  --muted: #a1a1aa;
	  --input: #0c0e13;
	  --input-border: #2a2a33;
	}

	.stack{ display:flex; flex-direction:column; gap:14px; }
	.rowBtns{ display:flex; gap:10px; }
	
	/* Base button styling for Billing buttons */
	button.btn{
	  display:inline-flex; align-items:center; justify-content:center;
	  padding:8px 14px;
	  height:40px;                                  /* match other CTAs */
	  border-radius:10px;
	  font:600 13px Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
	  cursor:pointer; user-select:none;
	  background: var(--btn-bg);
	  color: var(--text);
	  border:1px solid var(--btn-border);
	}


	/* Force purple CTA for the Create button */
	#modal #cgNew.btn{
	  background: var(--primary);  /* brand purple */
	  color:#fff; border:0;
	}
	#modal #cgNew.btn:hover{ filter:brightness(1.07); }



	/* Pro = CTA (purple) */
	button.btn.pro{
	  background: var(--primary);
	  color:#fff;
	  border:0;
	}

	/* Basic = outline only (no fill) */
	button.btn.basic{
	  background: transparent;
	  border:1px solid #2a2a33;
	  color: var(--text);
	}

	/* (Optional extras you might use elsewhere) */
	button.btn.neutral{
	  background: var(--btn-bg);
	  border:1px solid var(--btn-border);
	}
	button.btn.ghost{
	  background: transparent;
	  border:1px solid #2a2a33;
	  color: var(--muted);
	}
	button.btn.ghost:hover{
	  border-color:#3a3a45;
	  color:#c3c7d0;
	}

	/* Give the billing card some breathing room */
	section[data-tab="billing"] .card{ min-height: 440px; }



	/* ▼▼▼ PASTE THIS NEW BLOCK HERE ▼▼▼ */
	
	/* Billing — plan cards (match Paywall) */
	.billing-plans{
	  display:flex;
	  justify-content:center;     /* center the grid block */
	  margin-top:4px;
	}
	.plans{
	  display:grid;
	  grid-template-columns:1fr 1fr;
	  gap:12px;
	  width:min(640px, 100%);     /* nice max-width and fully responsive */
	}
	@media (max-width:560px){ .plans{ grid-template-columns:1fr; } }
	
	.plan{
	  border:1px solid #2a2a33;
	  background:#0c0e13;
	  border-radius:12px;
	  padding:12px;
	  display:flex;
	  flex-direction:column;
	  gap:10px;
	  position:relative;	
	}
	.plan.popular{
	  border-color:#7c3aed;
	  box-shadow:0 0 0 1px rgba(124,58,237,.35) inset;
	  transform:translateY(-1px);
	}
	.plan .hdr{ display:flex; align-items:baseline; gap:8px; }
	.plan .hdr .name{ font-weight:700; font-size:14px; }
	.plan .hdr .price{ color:#cbd5e1; font-weight:600; }
	
	.plan .badge{
	  position:absolute; top:10px; right:10px;
	  font-size:10px; font-weight:700;
	  background:#7c3aed; color:#fff;
	  padding:3px 6px; border-radius:999px;
	}
	.bullets{ display:flex; flex-direction:column; gap:8px; }
	.bullet{ display:flex; gap:8px; align-items:flex-start; color:#e5e7eb; }
	.bullet svg{ color:#7c3aed; flex:0 0 auto; margin-top:2px; }

	.foot{ color:#a1a1aa; font-size:12px; }
	
	.planBtn{
	  margin-top:8px;
	  display:inline-flex; align-items:center; justify-content:center;
	  padding:10px 14px; border-radius:10px; cursor:pointer; font-weight:700;
	  width:100%;
	}
	.plan.basic .planBtn{
	  background:#2a2a33; color:#e5e7eb; border:1px solid #2a2a33;
	}
	.plan.basic .planBtn:hover{
	  background:#7c3aed; border-color:#7c3aed; color:#fff;
	}
	.plan.pro .planBtn{ background:#7c3aed; color:#fff; border:0; }
	.plan.pro .planBtn:hover{ filter:brightness(1.07); }
	
	/* ▲▲▲ END NEW BLOCK ▲▲▲ */



/* Billing: current plan (grayed out + inert) */
  .plan.current{
    opacity:.6;
    filter:grayscale(.15);
    box-shadow:none;
    border-color:#2a2a33;
  }
  .plan.current .planBtn{
    background:#1f1f26 !important;
    color:#9aa0aa !important;
    border:1px solid #2a2a33 !important;
    cursor:default !important;
    pointer-events:none !important;
  }
  .plan .planBtn[disabled]{
    cursor:default;
    opacity:.9;
    pointer-events:none;
  }



	/* Floating layer between header and tabs */
	.top-layer{
	  position:sticky;
	  top:46px;           /* header height */
	  z-index:14;         /* below .header (15), above .banner/tabs/body */
	  pointer-events:none;
	}


	
	.top-layer .tip{
	  position:absolute;
	  z-index:1;
	  pointer-events:auto;
	}
	

	.top-layer .countdown-chip{
	  position:absolute;
	  right:18px;
	  top:8px;
	  display:inline-flex;
	  gap:8px;
	  align-items:center;
	  padding:6px 10px;
	  border-radius:999px;
	  background:#1f1f26;
	  border:1px solid #2a2a33;
	  font:600 12px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
	  color:#e5e7eb;
	}

	/* --- Dark scrollbars (WebKit + Firefox) --- */
	.body,
	#vg-grid,
	.cgm-body,
	.tplm-body {
	  scrollbar-width: thin;               /* Firefox */
	  scrollbar-color: #2a2a33 #0c0e13;    /* thumb / track */
	}
	.body::-webkit-scrollbar,
	#vg-grid::-webkit-scrollbar,
	.cgm-body::-webkit-scrollbar,
	.tplm-body::-webkit-scrollbar {
	  width: 10px;
	  height: 10px;
	}
	.body::-webkit-scrollbar-track,
	#vg-grid::-webkit-scrollbar-track,
	.cgm-body::-webkit-scrollbar-track,
	.tplm-body::-webkit-scrollbar-track {
	  background: #0c0e13;
	  border-radius: 8px;
	}
	.body::-webkit-scrollbar-thumb,
	#vg-grid::-webkit-scrollbar-thumb,
	.cgm-body::-webkit-scrollbar-thumb,
	.tplm-body::-webkit-scrollbar-thumb {
	  background: #2a2a33;
	  border-radius: 8px;
	  border: 2px solid #0c0e13;          /* inset look */
	}

	.body::-webkit-scrollbar-thumb:hover,
	#vg-grid::-webkit-scrollbar-thumb:hover,
	.cgm-body::-webkit-scrollbar-thumb:hover,
	.tplm-body::-webkit-scrollbar-thumb:hover {
	  background: #3a3a45;
	}


/* Settings · Site Access alignment (INSERTED) */
.saRow   { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.saRight { display:flex; align-items:center; gap:10px; }
.saLabel { width:130px; text-align:right; white-space:nowrap; color:var(--muted); }
@media (max-width:560px){ .saLabel { width:110px; } }


	/* --- Site access switch (same look/feel as popup) --- */
	.vg-switch{ position:relative; display:inline-block; width:44px; height:24px; }
	.vg-switch input{ opacity:0; width:0; height:0; }
	.vg-slider{
	  position:absolute; inset:0; border-radius:999px; transition:background .2s ease, box-shadow .2s ease;
	  background:#2b2f3a; box-shadow: 0 1px 0 rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.06);
	}
	.vg-slider:before{
	  content:""; position:absolute; height:18px; width:18px; left:3px; top:3px; border-radius:50%;
	  background:#c2c7d1; box-shadow: 0 1px 0 rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.06);
	  transition: transform .22s ease, background .2s ease, box-shadow .2s ease;
	}
	.vg-switch input:checked + .vg-slider{
	  background: color-mix(in srgb, var(--primary) 62%, #1a1c24);
	}
	.vg-switch input:checked + .vg-slider:before{
	  transform: translateX(20px); background:#aeb5c2;
	}
	.vg-switch input:disabled + .vg-slider{ opacity:.65; }

</style>


<div class="overlay">
  <div class="modal" id="modal" tabindex="-1">

    <div class="header">
      <div class="title">
        <img class="logo" src="${LOGO_URL}" alt="Viberly" />
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="help" id="help">?</div>
        <div class="close" id="close">✕</div>
      </div>
    </div>

    <!-- Floating layer for tooltips + countdown -->
    <div class="top-layer" id="vg-top-layer"></div>


          <div class="tabs" id="vg-tabs">
		  <button class="tab active" id="tab-advanced" data-tab="advanced">My Prompts</button>
		  <button class="tab" id="tab-library" data-tab="library">Marketplace</button>
		  <button class="tab" id="tab-settings" data-tab="settings">Settings</button>
		  <button class="tab" id="tab-billing" data-tab="billing">Billing</button>
		</div>


          <div class="banner" hidden>⚡ Coming soon: <b>Run Code Health Check ($4.99)</b> &nbsp;|&nbsp; <b>Chat with VibeGuardian bot</b></div>

       
          <div class="body">



      <!-- MY PROMPTS TAB CONTENT -->
	<section data-tab="advanced" hidden>
	
	  <!-- NEW: Shared search for My Prompts (filters Custom + Quick Adds) -->
	  <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
	    <input id="mpSearch" type="text"
	      placeholder="Search my prompts (name, text, tags)…"
	      style="flex:1;padding:8px;border:1px solid #2a2a33;border-radius:8px;background:#0c0e13;color:#e5e7eb">
	  </div>
	
	  <div class="card">
 		 <div style="display:flex; gap:8px; flex-wrap:wrap">
 		   <button class="btn ghost" id="cgImport">Import</button>
 		   <button class="btn" id="cgNew">Create</button> <!-- purple CTA -->
 		 </div>
		</div>


	    <!-- (REMOVED the in-card search here) -->
	
<div id="cgList" style="display:flex;flex-direction:column;gap:8px"></div>

<!-- Quick Adds list (now inside the same section) -->

<div class="card" style="margin-top:8px">
  <div class="toprow" style="margin-bottom:6px">
    <div>
      <div style="font-weight:600">Quick Adds</div>
    </div>
  </div>
  <div id="qaList" style="display:flex;flex-direction:column;gap:8px"></div>
</div>

</section>



	<!-- SETTINGS TAB CONTENT -->
	<section data-tab="settings" hidden>
	  <div class="card">
	    <div class="toprow" style="margin-bottom:6px">
  <div>
    <div style="font-weight:600">Site Access</div>
    <div class="muted">
      Manage Viberly access for the current site. If you don't see Viberly when ON, refresh page.
    </div>
  </div>
</div>  <!-- ADDED: closes .toprow -->



<!-- Two-row layout: Access and Placement -->
<!-- AFTER (saCard block with aligned right column) -->
<div id="saCard" style="font-size:12px; color:var(--muted); display:flex; flex-direction:column; gap:8px;">

  <!-- Row 1: Current site (left) · Access (right) -->
  <div class="saRow">
    <div>Current site: <span id="saHost">—</span></div>

    <div class="saRight">
      <div class="saLabel">Viberly access: <span id="saState">—</span></div>
      <label class="vg-switch" title="Toggle Viberly on this site">
        <input id="saToggle" type="checkbox" />
        <span class="vg-slider"></span>
      </label>
    </div>
  </div>

  <!-- Row 2: (empty left) · Placement (right, aligned with the label above) -->
  <div class="saRow">
    <div></div>
    <div class="saRight">
      <div class="saLabel">Placement</div>
      <button class="btn ghost" id="saResetPage" type="button" title="Reset pill position on this page">Reset</button>
    </div>
  </div>
</div>




	    <!-- Helper messages -->
	    <div id="saNA" class="muted" style="font-size:12px; margin-top:6px; display:none;">
	      Viberly isn’t available on this site yet.
	    </div>
	  </div>
	</section>



	<!-- MARKETPLACE (PREVIOUSLY CALLED LIBRARY) TAB CONTENT -->
	<section data-tab="library" hidden>
	  <div class="card">
	   	    <div class="toprow" style="margin-bottom:6px">
 			 <div>
 			   <div style="font-weight:600">Prompt Marketplace</div>
 			 </div>
 			 <div style="display:flex;gap:8px;align-items:center;margin-left:auto">
 			   <button class="btn ghost" id="vg-lib-refresh" type="button">Refresh</button>
 			 </div>
			</div>


	
	    <!-- search + list will render here -->
	    <div id="vg-lib-root"></div>	
	  </div>
	</section>




	<!-- BILLING TAB CONTENT -->
	<section data-tab="billing" hidden>
	  <div class="card">
	    <div class="toprow" style="margin-bottom:6px">
	      <div>
	        <div style="font-weight:600">Billing</div>
	        <div class="muted">Manage your subscription and view usage.</div>
	      </div>
	    </div>

	    <div class="stack">
	      <!-- Account info -->
	      <div>
	        <div class="muted" style="font-size:12px; margin-bottom:6px;">Account</div>
	        <div id="billEmail"
	             style="padding:10px;border:1px solid var(--input-border);border-radius:10px;background:var(--input);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
	          (signed‑in email)
	        </div>
	
	        <div class="muted" style="font-size:12px;margin-top:8px">
	          Plan: <span id="billPlan">–</span> • Usage: <span id="billUsage">–</span>
	        </div>
	      </div>
	
	            <!-- Plans (centered, same look as paywall) -->
  		    <div class="billing-plans">
  		      <div id="billPlans" class="plans"></div>
  		    </div>		
	    </div>
	  </div>
	</section>



    </div> <!-- end .body -->

      <!-- Preview Template Modal -->
      <div id="tplModal" class="tplm-overlay" hidden>
        <div class="tplm-dialog" role="dialog" aria-modal="true" aria-labelledby="tplmName">
          <div class="tplm-header">
            <div class="tplm-title" id="tplmName">Template</div>
            <div class="tplm-actions">
              <button class="btn ghost sm" id="tplmCopy" type="button">Copy</button>
              <button class="btn sm" id="tplmClose" type="button" aria-label="Close">Close</button>
            </div>
          </div>
          <div class="tplm-body" id="tplmBody">(no template selected)</div>
        </div>
      </div>

      <!-- New Custom Prompt Modal -->
      <div id="cgNewModal" class="cgm-overlay" hidden>
        <div class="cgm-dialog" role="dialog" aria-modal="true" aria-labelledby="cgmTitle">
          <div class="cgm-header">
            <div class="cgm-title" id="cgmTitle">New Custom Prompt</div>
            <!-- (no header actions; create/cancel live in footer) -->
          </div>
          <div class="cgm-body">
            <label class="cgm-label" for="cgmName">Name</label>
            <input id="cgmName" class="cgm-input" type="text" placeholder="e.g. Don’t touch home page" />

            <label class="cgm-label" for="cgmBody">Prompt template (guard text)</label>
            <textarea id="cgmBody" class="cgm-textarea" placeholder="Paste or write the guard block here."></textarea>
          </div>
          <div class="cgm-footer">
            <button class="btn ghost" id="cgmCancel2" type="button">Cancel</button>
            <button class="btn" id="cgmCreate2" type="button">Create</button>
          </div>
        </div>
      </div>


      <!-- Import Prompts (CSV) Modal -->
      <div id="vgImpOverlay" class="cgm-overlay" hidden>
        <div class="cgm-dialog" role="dialog" aria-modal="true" aria-labelledby="vgImpTitle">
          <div class="cgm-header">
            <div class="cgm-title" id="vgImpTitle">Import Prompts (CSV)</div>
            <div class="cgm-actions">
              <button class="btn ghost" id="vgImpClose" type="button">Close</button>
            </div>
          </div>

          <div class="cgm-body" id="vgImpBody">
            <!-- Step 0: Upload -->
            <div id="vgImpStep0">
              <div class="cgm-label">
		  Upload CSV
		  <span class="tooltip" style="margin-left:8px">
		    <span class="info">i</span>
		    <span class="tip tip-below">Import a CSV to immediately add your custom guards.</span>
		  </span>
		</div>


              <input id="vgImpFile" class="cgm-input" type="file" accept=".csv" />
              <div style="display:flex;gap:8px;margin-top:8px">
                <a id="vgImpDownloadTpl" class="btn ghost" href="#" download="prompt_import_template.csv">Download CSV template</a>
              </div>
              <div class="muted" style="margin-top:8px">
		  <b>Required Columns:</b> Prompt Name, Prompt Text.
		</div>
		<div class="muted" style="margin-top:4px">
		  <b>Optional Columns:</b> Tags, Category.
		</div>
            </div>

            <!-- Step 1: Map Columns -->
            <div id="vgImpStep1" hidden>
              <div class="cgm-label" style="margin-bottom:6px">Map Columns</div>
              <div id="vgImpMapGrid" style="display:grid;grid-template-columns:1fr 220px;gap:8px"></div>
              <div class="muted" style="margin-top:6px">We auto‑matched headers; adjust if needed. Name + Prompt Text are required.</div>
            </div>

            <!-- Step 2: Preview -->
            <div id="vgImpStep2" hidden>
              <div class="cgm-label" style="margin-bottom:6px">Preview (first 10 rows)</div>
              <div id="vgImpPreview" style="max-height:260px;overflow:auto;border:1px solid #2a2a33;border-radius:10px;background:#0c0e13;"></div>
              <label style="display:flex;gap:8px;align-items:center;margin-top:8px">
                <input id="vgImpDedup" type="checkbox" checked />
                <span class="muted">Skip exact duplicates (Name + Prompt Text)</span>
              </label>
            </div>
          </div>

          <div class="cgm-footer">
            <button class="btn ghost" id="vgImpBack" type="button" hidden>Back</button>
 	    <button class="btn" id="vgImpImport" type="button" disabled>Import</button>
          </div>
        </div>
      </div>


        <div class="footer">
          <button class="btn ghost" id="save">Save</button>
          <button class="btn" id="saveClose">Save & Close</button>
        </div>
      </div> <!-- end .modal -->
    </div> <!-- end .overlay -->
  `;

    const q = (sel) => shadow.querySelector(sel);

    /* === Settings · Site access (ON / OFF / N/A) === */
    async function __vgSettingsRead() {
      try {
        await __vgEnsureBGSessionFromSoT();
        const host = location.hostname.toLowerCase().replace(/^www\./, "");
        const path = location.pathname || "/";
        const res = await sendBG("GET_SITE_ACCESS", { host, path });
        return res && res.ok ? res : null;
      } catch {
        return null;
      }
    }

    function __vgSettingsPaint(data) {
      const elHost = q("#saHost");
      const elState = q("#saState");
      const elNA = q("#saNA");
      const toggle = q("#saToggle");

      if (!elHost || !elState || !toggle) return;

      // Show the real page host if BG didn’t send one
      const hostFromPage = location.hostname
        .toLowerCase()
        .replace(/^www\./, "");
      const host = data?.host || hostFromPage || null;

      const tri =
        typeof data?.state === "string"
          ? data.state
          : data?.enabled
          ? "on"
          : "off";
      const isOn = tri === "on";
      const isNA = tri === "na";

      elHost.textContent = host || "—";
      elState.textContent = isNA ? "N/A" : isOn ? "ON" : "OFF";

      // toggle state
      toggle.checked = isOn;
      toggle.disabled = !!isNA;
      if (isNA) toggle.setAttribute("aria-disabled", "true");
      else toggle.removeAttribute("aria-disabled");

      // helper rows
      if (elNA) elNA.style.display = isNA ? "" : "none";
    }

    // ADD: Settings refresh wrapper (read → paint)
    async function __vgSettingsRefresh() {
      try {
        const res = await __vgSettingsRead();
        if (res && res.ok) {
          __vgSettingsPaint(res);
        } else {
          // Fallback: show the real page host and mark as N/A
          __vgSettingsPaint({
            host: location.hostname.toLowerCase().replace(/^www\./, ""),
            state: "na",
            enabled: false,
          });
        }
      } catch {
        // Defensive fallback if BG read throws
        __vgSettingsPaint({
          host: location.hostname.toLowerCase().replace(/^www\./, ""),
          state: "na",
          enabled: false,
        });
      }
    }

    // Reset pill overrides and repaint HUD (scope: 'page' | 'site')
    async function __vgResetPill(scope /* 'page' | 'site' */) {
      const host = location.hostname.toLowerCase().replace(/^www\./, "");
      const path = location.pathname || "/";

      try {
        // 1) Delete override(s)
        const r = await sendBG("VG_RESET_PILL_POS", {
          host,
          scope: scope === "site" ? "site" : "page",
          path,
        });
        if (!r || r.ok !== true) {
          alert("Reset failed. Please try again.");
          return;
        }

        // 2) Pull fresh merged placement (global + any remaining override)
        const resp = await sendBG("VG_GET_PAGE_PLACEMENTS", { host, path });
        const rules =
          resp && resp.ok && Array.isArray(resp.placements)
            ? resp.placements
            : [];
        const pick = rules[0] || null;

        // 3) Apply immediately (no blink)
        if (pick) {
          const next = {
            strategy: pick.pick_strategy || pick.strategy || "",
            dx: Number.isFinite(+pick.dx) ? +pick.dx : 0,
            dy: Number.isFinite(+pick.dy) ? +pick.dy : 0,
            gutter: Number.isFinite(+pick.gutter) ? +pick.gutter : 12,
            pill_size: Number.isFinite(+pick.pill_size) ? +pick.pill_size : 36,
            composer_selector: pick.composer_selector || "",
            send_selector: pick.send_selector || "",
            slot: String(pick.slot || "primary").toLowerCase(),
            iframe_selector: pick.iframe_selector || "",
          };
          try {
            window.__VG_DB_PLACEMENT = next;
          } catch {}
          if (typeof window.__VG_PLACE_HUD__ === "function") {
            window.__VG_PLACE_HUD__(next, { force: true });
          }
        }

        // 4) Refresh the row
        await __vgSettingsRefresh();
        alert("Pill position reset. Using site default.");
      } catch (e) {
        console.warn("[VG] reset pill error:", e);
        alert("Reset failed. Please try again.");
      }
    }

    // Wire access toggle + single page reset
    function __vgSettingsWire() {
      // Access toggle
      const toggle = q("#saToggle");
      if (toggle && !toggle.__wired) {
        toggle.__wired = true;
        toggle.addEventListener("change", async () => {
          if (toggle.disabled) {
            toggle.checked = false;
            return;
          }
          const wantOn = !!toggle.checked;
          const host =
            (q("#saHost")?.textContent || "")
              .trim()
              .toLowerCase()
              .replace(/^www\./, "") || null;
          try {
            await sendBG("SET_SITE_ACCESS", {
              host,
              state: wantOn ? "inherit" : "off",
            });
          } catch {}
          __vgSettingsRefresh();
        });
      }

      // Reset (this page only)
      const btnResetPage = q("#saResetPage");
      if (btnResetPage && !btnResetPage.__wired) {
        btnResetPage.__wired = true;
        btnResetPage.addEventListener("click", async () => {
          const old = btnResetPage.textContent;
          btnResetPage.disabled = true;
          btnResetPage.textContent = "Resetting…";
          try {
            await __vgResetPill("page");
          } finally {
            btnResetPage.textContent = old;
            btnResetPage.disabled = false;
          }
        });
      }

      // Repaint when BG broadcasts a host-level change
      try {
        browser.runtime.onMessage.addListener((msg) => {
          if (msg?.type !== "SITE_ACCESS_CHANGED") return;
          const shownHost = (q("#saHost")?.textContent || "")
            .trim()
            .toLowerCase()
            .replace(/^www\./, "");
          const msgHost = String(msg?.host || "")
            .toLowerCase()
            .replace(/^www\./, "");
          if (shownHost && msgHost && shownHost === msgHost)
            __vgSettingsRefresh();
        });
      } catch {}
    }

    // First render if Settings tab is already the current tab; wire listeners.
    (function __vgSettingsBoot() {
      const sec = q('section[data-tab="settings"]');
      if (sec) {
        if (!sec.hidden) __vgSettingsRefresh();
        __vgSettingsWire();
      }
    })();

    __vgMaybeAddTeamTabShell();

    // === Team Prompts: conditional tab + empty section (Phase 2 shell) ===
    async function __vgMaybeAddTeamTabShell() {
      try {
        const resp = await new Promise((res) =>
          browser.runtime.sendMessage({ type: "GET_TEAM_PROMPTS" }).then(res)
        );
        const hasAny = !!(resp && resp.ok && resp.hasAny);
        if (!hasAny) return;

        const tabsBar = q("#vg-tabs");
        const bodyEl = q(".body");
        if (!tabsBar || !bodyEl) return;

        // Avoid duplicates
        if (tabsBar.querySelector("#tab-team")) return;

        // Insert the tab between My Prompts and Marketplace
        const teamBtn = document.createElement("button");
        teamBtn.className = "tab";
        teamBtn.id = "tab-team";
        teamBtn.dataset.tab = "team";
        teamBtn.textContent = "Team Prompts";

        const my = tabsBar.querySelector("#tab-advanced");
        const market = tabsBar.querySelector("#tab-library");
        tabsBar.insertBefore(teamBtn, market || my?.nextSibling || null);

        // Add a section (hidden); we’ll populate it in Phase 3
        const sec = document.createElement("section");
        sec.setAttribute("data-tab", "team");
        sec.hidden = true;

        sec.innerHTML = `
      <!-- Team search ABOVE the card (matches My Prompts layout) -->
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input id="tpSearch" type="text"
          placeholder="Search team prompts (name, text, tags)…"
          style="flex:1;padding:8px;border:1px solid #2a2a33;border-radius:8px;background:#0c0e13;color:#e5e7eb">
      </div>

      <div class="card">
        <div class="toprow" style="margin-bottom:6px">
          <div>
            <div style="font-weight:600">Team Prompts</div>
            <div class="muted">Shared by your team.</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <button class="btn ghost" id="tpRefresh">Refresh</button>
          </div>
        </div>

        <div id="tpList" style="display:flex;flex-direction:column;gap:8px"></div>
      </div>
    `;
        bodyEl.appendChild(sec);

        // Rebind clicks at the bar level so underline & section visibility always stay in sync,
        // even if the Team tab was injected after the router ran the first time.
        tabsBar.addEventListener(
          "click",
          (ev) => {
            const btn = ev.target && ev.target.closest(".tab");
            if (!btn) return;

            const which = String(btn.dataset.tab || "");
            const sections = [
              "advanced",
              "team",
              "library",
              "settings",
              "billing",
            ];

            // underline exactly one tab
            tabsBar
              .querySelectorAll(".tab")
              .forEach((t) => t.classList.toggle("active", t === btn));

            // show exactly one section
            sections.forEach((k) => {
              const s = document
                .getElementById(
                  (window.__VG_CONSTS?.APP || "vibeguardian") + "-modal-host"
                )
                ?.shadowRoot?.querySelector(`section[data-tab="${k}"]`);
              if (s) s.hidden = k !== which;
            });

            if (which === "team") {
              try {
                __vgPaintTeamPromptsList?.();
              } catch {}
            }
          },
          { capture: true }
        );

        // Refresh button (Phase 3 will listen for this event to repaint)
        sec.querySelector("#tpRefresh")?.addEventListener("click", async () => {
          await new Promise((res) =>
            browser.runtime
              .sendMessage({ type: "REFRESH_TEAM_PROMPTS" })
              .then(res)
          );
          document.dispatchEvent(new CustomEvent("vg-team-prompts-refresh"));
        });
      } catch (e) {
        console.warn("[VG][settings] team tab shell failed", e);
      }
    }

    async function __vgPaintTeamPromptsList() {
      const host = (
        document.getElementById(
          (window.__VG_CONSTS?.APP || "vibeguardian") + "-modal-host"
        ) || {}
      ).shadowRoot;
      const root = host?.querySelector('section[data-tab="team"] #tpList');
      const search = host?.querySelector('section[data-tab="team"] #tpSearch');
      if (!root) return;

      root.innerHTML = '<div class="muted">Loading…</div>';

      const resp = await new Promise((res) =>
        browser.runtime.sendMessage({ type: "GET_TEAM_PROMPTS" }).then(res)
      );
      const items =
        resp && resp.ok && Array.isArray(resp.prompts) ? resp.prompts : [];

      // Render helper with filter
      function norm(s) {
        return String(s || "").toLowerCase();
      }
      function render() {
        const q = norm(search?.value || "");
        const filtered = !q
          ? items
          : items.filter((it) => {
              const name = norm(it.name);
              const body = norm(it.body);
              const tags = (Array.isArray(it.tags) ? it.tags : [])
                .map(norm)
                .join(" ");
              return name.includes(q) || body.includes(q) || tags.includes(q);
            });

        root.innerHTML = "";

        if (!filtered.length) {
          root.innerHTML =
            '<div class="muted">No team prompts match your search.</div>';
          return;
        }

        filtered.forEach((item) => {
          const row = document.createElement("div");
          row.style.cssText = `
        display:flex;align-items:center;gap:10px;
        padding:8px;border:1px solid #2a2a33;border-radius:10px;
        background:#0f1116;min-width:0;
      `;

          // ON/OFF toggle
          const tog = document.createElement("div");
          const on = String(item.status || "active").toLowerCase() === "active";
          tog.className = "tog" + (on ? " on" : "");
          tog.textContent = on ? "On" : "Off";
          tog.style.marginRight = "6px";
          tog.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const nextOn = !tog.classList.contains("on");

            // optimistic
            tog.classList.toggle("on", nextOn);
            tog.textContent = nextOn ? "On" : "Off";

            const r = await new Promise((res) =>
              browser.runtime
                .sendMessage({
                  type: "VG_GUARD_SET_STATUS",
                  id: item.id,
                  on: nextOn,
                })
                .then(res)
            );
            if (!r?.ok) {
              // rollback on error
              tog.classList.toggle("on", !nextOn);
              tog.textContent = !nextOn ? "On" : "Off";
            }
          };

          // Name + badge
          const name = document.createElement("div");
          name.style.cssText = `
        flex:1;min-width:0;font-size:13px;color:#e5e7eb;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        display:flex;align-items:center;gap:8px;flex-wrap:wrap;
      `;
          name.innerHTML = `
        <span>${item.name || "Team Prompt"}</span>
        <span class="muted" style="font-size:12px;">Team</span>
      `;

          // Minimal preview = copy body
          const btnPrev = document.createElement("button");
          btnPrev.className = "btn ghost";
          btnPrev.textContent = "Preview";
          btnPrev.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              await navigator.clipboard.writeText(item.body || "");
              alert("Copied prompt to clipboard.");
            } catch {}
          };

          const actions = document.createElement("div");
          actions.style.cssText = "display:flex;gap:6px;flex:0 0 auto;";
          actions.appendChild(btnPrev);

          row.appendChild(tog);
          row.appendChild(name);
          row.appendChild(actions);
          root.appendChild(row);
        });
      }

      // Initial paint
      if (!items.length) {
        root.innerHTML = '<div class="muted">No team prompts yet.</div>';
      } else {
        render();
      }

      // Wire search
      if (search && !search.__wired) {
        search.__wired = true;
        let t = null;
        search.addEventListener("input", () => {
          clearTimeout(t);
          t = setTimeout(render, 120);
        });
      }
    }

    // Repaint on Team → Refresh
    document.addEventListener(
      "vg-team-prompts-refresh",
      __vgPaintTeamPromptsList
    );

    // --- Save button UI helpers (spinner → saved → reset) ---
    function btnSetLoading(btn, label = "Saving…") {
      if (!btn) return;
      btn.__busy = true;
      btn.classList.add("loading");
      // remember old label to restore later
      btn.__oldLabel = btn.textContent;
      // show spinner + label
      btn.innerHTML = `<span class="spin"></span>${label}`;
    }

    function btnSetDone(btn, label = "Saved", resetMs = 1500) {
      if (!btn) return;
      btn.classList.remove("loading");
      btn.__busy = false;
      btn.classList.add("saved");
      btn.textContent = label;
      const old = btn.__oldLabel || "Save";
      // reset label/state after a short delay
      setTimeout(() => {
        if (!btn.isConnected) return;
        btn.classList.remove("saved");
        btn.textContent = old;
        btn.__oldLabel = undefined;
      }, resetMs);
    }

    // ===== Tooltip + Countdown floating layer wiring (modal-scope) =====
    const topLayer = shadow.getElementById("vg-top-layer");

    // Hard override for portaled tips so old CSS can't hide them
    (function ensureTipGlobalCSS() {
      if (shadow.getElementById("vg-tip-global-style")) return;
      const st = document.createElement("style");
      st.id = "vg-tip-global-style";
      st.textContent = `
	    .tip-global{ opacity:1 !important; transform:none !important; bottom:auto !important; }
	  `;
      shadow.appendChild(st);
    })();

    function positionFloating(trigger, floating, offsetY = 4) {
      const r = trigger.getBoundingClientRect(); // trigger (viewport)
      const t = topLayer.getBoundingClientRect(); // .top-layer (viewport)

      // Convert viewport → top-layer local coords
      let left = r.left - t.left + (r.width - floating.offsetWidth) / 2; // center under the "i"
      let top = r.bottom - t.top + offsetY; // just below the "i"

      // Clamp inside the modal width
      const maxLeft = topLayer.clientWidth - floating.offsetWidth - 18;
      left = Math.max(18, Math.min(left, maxLeft));

      // If it would go off the bottom of the modal, flip above the "i"
      const maxTop = topLayer.clientHeight - floating.offsetHeight - 18;
      if (top > maxTop) {
        top = r.top - t.top - floating.offsetHeight - offsetY;
      }

      floating.style.left = left + "px";
      floating.style.top = top + "px";
    }

    function attachPortalTooltip(trigger, tipEl) {
      if (!topLayer || !trigger || !tipEl) return;

      // move the tip into the top-layer once and normalize style
      if (!tipEl.classList.contains("tip-global")) {
        tipEl.classList.add("tip-global");
        tipEl.style.position = "absolute";
        tipEl.style.pointerEvents = "auto";
        tipEl.style.display = "none"; // closed by default
        tipEl.style.opacity = "1"; // cancel original 0
        tipEl.style.transform = "none"; // cancel original transform
        tipEl.style.bottom = "auto"; // we use top/left now
        topLayer.appendChild(tipEl);
      }

      let hideTimer = null;

      const open = () => {
        clearTimeout(hideTimer);
        tipEl.style.display = "block";
        // ensure it has a size before positioning (next frame if needed)
        requestAnimationFrame(() => positionFloating(trigger, tipEl, 4));
      };

      const scheduleClose = () => {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          tipEl.style.display = "none";
        }, 100);
      };

      // Keep open while pointer is on trigger OR on the tip
      trigger.addEventListener("mouseenter", open);
      trigger.addEventListener("mouseleave", scheduleClose);
      trigger.addEventListener("focus", open);
      trigger.addEventListener("blur", scheduleClose);

      tipEl.addEventListener("mouseenter", () => {
        clearTimeout(hideTimer);
        tipEl.style.display = "block";
      });
      tipEl.addEventListener("mouseleave", scheduleClose);

      window.addEventListener("resize", () => {
        if (tipEl.style.display !== "none") positionFloating(trigger, tipEl, 4);
      });
    }

    /* Only wire the two "i" tooltips in the Behavior row (avoids hijacking tips
	   inside other overlays like Import CSV). */
    try {
      const behaveInfos =
        shadow.querySelectorAll(".behave .tooltip .info") || [];
      const behaveTips = shadow.querySelectorAll(".behave .tooltip .tip") || [];
      behaveInfos.forEach((btn, i) => {
        const tip = behaveTips[i];
        if (btn && tip) {
          try {
            attachPortalTooltip(btn, tip);
          } catch {}
        }
      });
    } catch {}

    // Optional: countdown chip you can show in this layer if you want a small status
    function ensureCountdownChip() {
      if (!topLayer) return null;
      let chip = shadow.getElementById("vg-countdown-chip");
      if (!chip) {
        chip = document.createElement("div");
        chip.id = "vg-countdown-chip";
        chip.className = "countdown-chip";
        chip.style.display = "none";
        topLayer.appendChild(chip);
      }
      return chip;
    }

    // ===== Import (CSV) modal open/close + step navigation (no parsing yet) =====
    function vgImpShowStep(n) {
      q("#vgImpStep0")?.toggleAttribute("hidden", n !== 0);
      q("#vgImpStep1")?.toggleAttribute("hidden", n !== 1);
      q("#vgImpStep2")?.toggleAttribute("hidden", n !== 2);
      // In one-step mode: Import stays visible, Back stays hidden
      q("#vgImpBack")?.setAttribute("hidden", "true");
      q("#vgImpImport")?.removeAttribute("hidden");
    }

    function vgImpOpen() {
      q("#vgImpOverlay").hidden = false;
      vgImpShowStep(0);
    }
    function vgImpClose() {
      q("#vgImpOverlay").hidden = true;
    }

    q("#cgImport")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      vgImpOpen();
    });
    q("#vgImpClose")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      vgImpClose();
    });

    // Back/Next stepping (placeholder)
    q("#vgImpBack")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!q("#vgImpStep1").hidden) vgImpShowStep(0);
      else if (!q("#vgImpStep2").hidden) vgImpShowStep(1);
    });
    q("#vgImpNext")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!q("#vgImpStep0").hidden) vgImpShowStep(1);
      else if (!q("#vgImpStep1").hidden) vgImpShowStep(2);
    });

    // Final Import action (parse CSV → create guards) — forgiving + clear summary
    q("#vgImpImport")?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const file = q("#vgImpFile")?.files?.[0];
      if (!file) return alert("Please choose a CSV file first.");

      try {
        let text = await file.text();

        // ── Forgiveness pass 0: normalize line endings + smart quotes + BOM + NBSP
        text = text.replace(/^\uFEFF/, ""); // strip BOM
        text = text.replace(/\u00A0/g, " "); // NBSP → space
        text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        text = text.replace(/[\u201C\u201D]/g, '"'); // “ ” → "
        text = text.replace(/[\u2018\u2019]/g, "'"); // ‘ ’ → '

        // ── Forgiveness pass 1: if rows look tab‑separated (Numbers/Excel export), convert to CSV
        const firstLine = text.split("\n")[0] || "";
        const looksTSV =
          firstLine.indexOf("\t") >= 0 && firstLine.indexOf(",") === -1;
        if (looksTSV) {
          text = text
            .split("\n")
            .map((line) => line.replace(/\t/g, ","))
            .join("\n");
        }

        // ── Forgiveness pass 2: de‑glitch odd trailing quotes per line (e.g., ci")
        text = text
          .split("\n")
          .map((line) => {
            const qcount = (line.match(/"/g) || []).length;
            if (qcount % 2 !== 0) return line.replace(/"(\s*)$/, "$1");
            return line;
          })
          .join("\n");

        // Robust CSV parser (quoted fields, commas, escaped quotes)
        function parseCSV(str) {
          const rows = [];
          let row = [],
            cur = "",
            inQ = false;
          for (let i = 0; i < str.length; i++) {
            const c = str[i],
              n = str[i + 1];
            if (inQ) {
              if (c === '"' && n === '"') {
                cur += '"';
                i++;
                continue;
              }
              if (c === '"') {
                inQ = false;
                continue;
              }
              cur += c;
              continue;
            } else {
              if (c === '"') {
                inQ = true;
                continue;
              }
              if (c === ",") {
                row.push(cur);
                cur = "";
                continue;
              }
              if (c === "\n") {
                row.push(cur);
                rows.push(row);
                row = [];
                cur = "";
                continue;
              }
              cur += c;
            }
          }
          row.push(cur);
          rows.push(row);
          // trim all cells
          return rows.map((r) => r.map((x) => String(x ?? "").trim()));
        }

        const all = parseCSV(text).filter((r) => r.some((cell) => cell.length));
        if (!all.length) throw new Error("CSV appears empty.");

        // Headers (forgiving names)
        const headers = all[0].map((h) => String(h || "").toLowerCase());
        const idxName =
          headers.indexOf("prompt name") >= 0
            ? headers.indexOf("prompt name")
            : headers.indexOf("name");
        const idxBody = headers.indexOf("prompt text");
        const idxTags = headers.indexOf("tags");
        const idxCat = headers.indexOf("category");

        if (idxName === -1 || idxBody === -1) {
          alert(
            "CSV must include 'Prompt Name' (or Name) and 'Prompt Text' columns."
          );
          return;
        }

        const rows = all.slice(1);

        // Deduplicate within this file by (name+prompt)
        const keyOf = (n, p) =>
          n.toLowerCase().trim() + "::" + p.toLowerCase().trim();
        const seen = new Set();

        let ok = 0,
          skipped = 0;
        const failures = [];

        // OPTIONAL: dedupe against existing DB (same name+body)
        let existingKeys = new Set();
        try {
          const existing = await CG_list(); // get all guards in current category
          existingKeys = new Set(
            existing.map(
              (g) =>
                (g.name || "").toLowerCase().trim() +
                "::" +
                (g.body || "").toLowerCase().trim()
            )
          );
        } catch (_) {
          console.warn("[VG] could not fetch existing guards for dedupe");
        }

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const name = r[idxName] || "";
          const body = r[idxBody] || "";
          if (!name.trim() || !body.trim()) {
            skipped++;
            continue;
          }

          const k = keyOf(name, body);
          if (seen.has(k) || existingKeys.has(k)) {
            skipped++;
            continue;
          }
          seen.add(k);

          // tags
          let tags = [];
          if (idxTags >= 0 && r[idxTags]) {
            const raw = r[idxTags];
            if (/^\s*\[/.test(raw)) {
              try {
                const a = JSON.parse(raw);
                if (Array.isArray(a))
                  tags = a.map((x) => String(x).trim()).filter(Boolean);
              } catch {
                /* ignore; fallback below */
              }
            }
            if (!tags.length)
              tags = raw
                .split(/[,;]+/)
                .map((s) => s.trim())
                .filter(Boolean);
          }
          // category
          const category =
            idxCat >= 0 && r[idxCat]
              ? r[idxCat].replace(/^"|"$/g, "").trim()
              : null;

          try {
            await CG_create({ name, body, tags, category });
            ok++;
          } catch (err) {
            failures.push({ row: i + 2, err: String(err?.message || err) });
          }
        }

        // Refresh and close
        try {
          await cgLoadAndRender();
        } catch (_) {}
        vgImpClose();

        // Build summary message (with rules if not perfect)
        const total = rows.length;
        let msg = `Imported ${ok} of ${total} prompts successfully.`;
        const skippedCount = skipped + failures.length;
        if (skippedCount) {
          msg += ` ${skippedCount} row${
            skippedCount === 1 ? "" : "s"
          } were skipped.`;
          msg +=
            `\n\nIf some rows didn’t import, make sure your CSV follows these rules:\n` +
            `• Header row includes: “Prompt Name”, “Prompt Text”.\n` +
            `• Optional columns: “Tags” (comma or semicolon separated), “Category”.\n` +
            `• Use straight quotes " not smart quotes “ ” (we try to fix these).\n` +
            `• No stray trailing quotes in cells (e.g., \`ci"\`).\n` +
            `• Each row must have non‑empty Prompt Name and Prompt Text.\n` +
            `• Don’t merge cells; one prompt per row.\n`;
          if (failures.length) {
            console.warn("[VG] Import failures:", failures);
            msg += `\nDetails for failed rows are logged in the console.`;
          }
        }
        alert(msg);
      } catch (err) {
        console.error("[VG] Import error", err);
        alert("Failed to import CSV: " + (err?.message || err));
      }
    });

    // Download sample CSV template
    q("#vgImpDownloadTpl")?.addEventListener("click", (e) => {
      e.preventDefault();
      const tpl = `Prompt Name,Prompt Text,Tags,Category
	"Debug: Explain Stacktrace","Analyze this error and provide a minimal fix. Return root cause and the smallest patch.","debug;stacktrace","Debugging"	
	"Refactor for readability","Refactor without changing behavior. Show before/after diff.","refactor,readability","Refactoring"
	"Create CI workflow","Create a CI workflow with lint, test, build, and artifact caching.","devops,ci","DevOps"`;
      const blob = new Blob([tpl], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "prompt_import_template.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 500);
    });

    // One-step import UX (no Continue). Enable Import only if a CSV is chosen.
    const vgImpFile = q("#vgImpFile");
    const vgImpImportBtn = q("#vgImpImport");
    const vgImpBackBtn = q("#vgImpBack"); // stays hidden; reserved if you add steps later

    function vgImpUpdateImportEnabled() {
      const hasFile = !!vgImpFile?.files?.length;
      vgImpImportBtn?.toggleAttribute("disabled", !hasFile);
    }
    vgImpFile?.addEventListener("change", vgImpUpdateImportEnabled);

    // Focus the file input when Import opens and set initial disabled state
    const _vgImpOpenOrig = typeof vgImpOpen === "function" ? vgImpOpen : null;
    vgImpOpen = function () {
      q("#vgImpOverlay").hidden = false;
      setTimeout(() => vgImpFile?.focus(), 50);
      vgImpUpdateImportEnabled();
    };

    // Remove dead listeners related to "Continue"
    try {
      q("#vgImpNext")?.remove();
    } catch (_) {}
    try {
      // ensure any prior showStep logic won't show hidden controls
      if (typeof vgImpShowStep === "function") {
        vgImpShowStep = function () {
          /* one-step: nothing to show/hide */
        };
      }
    } catch (_) {}

    // Close Import modal when clicking the dimmed backdrop
    q("#vgImpOverlay")?.addEventListener("click", (ev) => {
      if (ev.target === q("#vgImpOverlay")) {
        ev.preventDefault();
        ev.stopPropagation();
        vgImpClose();
      }
    });

    // Modal is now active; suspend global interceptors until we close.
    window.__VG_MODAL_ACTIVE = true;

    // Unified closer so every path clears the flag and removes the host safely.
    function __vgCloseSettingsModal() {
      try {
        window.__VG_MODAL_ACTIVE = false;
      } catch (_) {}
      try {
        host.remove();
      } catch (_) {}
    }

    // focus so Esc works
    q("#modal").focus();

    // Swallow ALL key events inside the settings modal so page hotkeys (e.g., "t") can't steal focus.
    // Let Escape bubble so our Esc-to-close still works.
    shadow.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") e.stopPropagation();
      },
      true // capture phase so we beat page-level handlers
    );

    // backdrop click to close (capture so we don't click-through)
    const overlayEl = q(".overlay");
    overlayEl.addEventListener(
      "click",
      (ev) => {
        if (ev.target === overlayEl) {
          ev.preventDefault();
          ev.stopPropagation();
          if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
          __VG_LAST_MODAL_CLOSE = performance.now();
          __vgCloseSettingsModal();
        }
      },
      true
    );

    // Esc to close
    shadow.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // If Import overlay is open, close it instead of the whole Settings modal
        if (!q("#vgImpOverlay")?.hidden) {
          vgImpClose();
          return;
        }
        __vgCloseSettingsModal();
      }
    });

    // modal-scoped state
    const rows = q("#rows");
    const presetSel = q("#preset");
    const active = new Set();

    // --- Custom Prompts state (required by cgLoadAndRender/renderCustomList) ---
    let __CUSTOMS = [];
    const selectedCustomIds = new Set();
    let __CG_QUERY = "";

    async function cgLoadAndRender() {
      try {
        await __vgEnsureBGSessionFromSoT();
      } catch {}

      try {
        // Return ALL customs for the user (no site filtering)
        __CUSTOMS = await CG_list("all");
        if (!Array.isArray(__CUSTOMS)) __CUSTOMS = [];
      } catch (e) {
        console.warn("[VG] CG_list failed, defaulting to empty", e);
        __CUSTOMS = [];
      }

      // Rebuild selected set from status
      selectedCustomIds.clear();
      for (const g of __CUSTOMS) {
        if ((g.status || "inactive") === "active") selectedCustomIds.add(g.id);
      }
      try {
        await S_set("custom_selected", Array.from(selectedCustomIds));
      } catch (_) {}

      // keep the last query visible in the input
      try {
        const s = q("#mpSearch");
        if (s) s.value = __CG_QUERY || "";
      } catch {}

      renderCustomList();
      render(); // update preview
    }

    function renderCustomList() {
      const holder = q("#cgList");
      holder.innerHTML = "";

      if (!__CUSTOMS.length) {
        return;
      }

      // ← NEW: case-insensitive filter over name, body, tags
      const ql = String(__CG_QUERY || "")
        .toLowerCase()
        .trim();
      const list = !ql
        ? __CUSTOMS
        : __CUSTOMS.filter((item) => {
            const name = String(item.name || "").toLowerCase();
            const body = String(item.body || "").toLowerCase();
            const tags = Array.isArray(item.tags)
              ? item.tags.map((t) => String(t).toLowerCase())
              : [];
            return (
              name.includes(ql) ||
              body.includes(ql) ||
              tags.some((t) => t.includes(ql))
            );
          });

      if (!list.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No custom prompts match your search.";
        holder.appendChild(empty);
        return;
      }

      list.forEach((item) => {
        const row = document.createElement("div");
        row.style.cssText = `
	      display:flex;align-items:center;gap:10px;
	      padding:8px;border:1px solid #2a2a33;border-radius:10px;
	      background:#0f1116;min-width:0;
	    `;

        const tog = document.createElement("div");
        const on = item.status === "active";
        tog.className = "tog" + (on ? " on" : "");
        tog.textContent = on ? "On" : "Off";
        tog.style.marginRight = "6px";
        tog.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const nextOn = !tog.classList.contains("on");

          // optimistic UI
          tog.classList.toggle("on", nextOn);
          tog.textContent = nextOn ? "On" : "Off";

          try {
            await __vgEnsureBGSessionFromSoT();
            const r = await sendBG("VG_GUARD_SET_STATUS", {
              id: item.id,
              on: nextOn,
            });
            if (!r?.ok) throw new Error(r?.error || "STATUS_FAILED");

            if (nextOn) selectedCustomIds.add(item.id);
            else selectedCustomIds.delete(item.id);
            await S_set("custom_selected", Array.from(selectedCustomIds));
          } catch (err) {
            console.error("[VG] toggle error", err);
            // rollback UI on failure
            tog.classList.toggle("on", !nextOn);
            tog.textContent = !nextOn ? "On" : "Off";
            return;
          }

          // refresh list + preview
          await cgLoadAndRender();
        };

        const name = document.createElement("div");
        name.style.cssText = `
	      flex:1;min-width:0;font-size:13px;color:#e5e7eb;
	      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
	    `;
        name.textContent = item.name;

        const actions = document.createElement("div");
        actions.style.cssText = `display:flex;gap:6px;flex:0 0 auto;`;

        const btnEdit = document.createElement("button");
        btnEdit.className = "btn ghost";
        btnEdit.textContent = "Edit";
        btnEdit.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openCgNewModal({ name: item.name || "", body: item.body || "" });
          cgmCreate2.textContent = "Save";
          cgmCreate2.onclick = async () => {
            const newName = (cgmName.value || "").trim();
            const newBody = (cgmBody.value || "").trim();
            if (!newBody) {
              cgmBody.focus();
              return;
            }
            await CG_update(item.id, { name: newName, body: newBody });
            await cgLoadAndRender();
            closeCgNewModal();
          };
        };

        const btnDelete = document.createElement("button");
        btnDelete.className = "btn ghost";
        btnDelete.textContent = "Delete";
        btnDelete.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!confirm('Delete "' + (item.name || "") + '"?')) return;
          await CG_delete(item.id);
          selectedCustomIds.delete(item.id);
          await cgLoadAndRender();
        };

        actions.appendChild(btnEdit);
        actions.appendChild(btnDelete);

        row.appendChild(tog);
        row.appendChild(name);
        row.appendChild(actions);
        holder.appendChild(row);
      });
    }

    // Open the "New Custom Guard" modal
    q("#cgNew").onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCgNewModal();
    };

    // Shared My Prompts search (filters Custom + Quick Adds)
    const mpSearch = q("#mpSearch");
    let __mpSearchTimer = null;
    if (mpSearch) {
      mpSearch.value = __CG_QUERY || "";
      mpSearch.addEventListener("input", () => {
        clearTimeout(__mpSearchTimer);
        __mpSearchTimer = setTimeout(() => {
          __CG_QUERY = mpSearch.value || "";
          renderCustomList();
          renderQuickAddsList();
        }, 120);
      });
    }

    // Seed "Standard Guards" into Quick Adds once (idempotent)
    async function seedStdGuardsIntoQuickAddsOnce() {
      try {
        const seeded = await S_get("seed_std_qa", "0"); // sb_seed_std_qa
        if (seeded === "1") return;

        const lib = Array.isArray(window.__VG_PROMPT_LIBRARY)
          ? window.__VG_PROMPT_LIBRARY
          : [];
        const stdIds = lib
          .filter(
            (p) =>
              String(p["Subcategory"] || "").toLowerCase() === "standard guards"
          )
          .map((p) => p.id);

        if (!stdIds.length) return;

        const cur = await vgQAGet();
        const toAdd = stdIds.filter((id) => !cur.includes(id));
        for (const id of toAdd) {
          try {
            await vgQAToggle(id);
          } catch {}
        }

        await S_set("seed_std_qa", "1");
      } catch {}
    }

    function renderQuickAddsList() {
      const holder = q("#qaList");
      if (!holder) return;
      holder.innerHTML = "";

      (async () => {
        try {
          // 1) Current favorites (server-first → mirrored locally)
          const favIds = await vgQAGet();

          // 2) Library index
          const lib = Array.isArray(window.__VG_PROMPT_LIBRARY)
            ? window.__VG_PROMPT_LIBRARY
            : [];
          const byId = new Map(lib.map((p) => [String(p.id), p]));

          // 3) Active-state map (local)
          const activeMap = await qaActiveGetMap();

          if (!favIds.length) {
            const empty = document.createElement("div");
            empty.className = "muted"; // same class used for "No custom prompts"
            empty.textContent =
              'No quick adds yet. Open the Marketplace and click "Quick Add".';
            holder.appendChild(empty);
            return;
          }

          // Shared query over name, text, type, subcategory, labels
          const ql = String(__CG_QUERY || "")
            .toLowerCase()
            .trim();
          const matches = (p) => {
            if (!ql) return true;
            const labels = Array.isArray(p["Labels"]) ? p["Labels"] : [];
            return (
              (p["Prompt Name"] || "").toLowerCase().includes(ql) ||
              (p["Prompt Text"] || "").toLowerCase().includes(ql) ||
              (p["Type"] || "").toLowerCase().includes(ql) ||
              (p["Subcategory"] || "").toLowerCase().includes(ql) ||
              labels.some((t) => String(t).toLowerCase().includes(ql))
            );
          };

          const idsToShow = favIds.filter((id) => {
            const p = byId.get(String(id));
            return !!p && matches(p);
          });

          if (!idsToShow.length) {
            holder.innerHTML = `<div class="muted">No quick adds match your search.</div>`;
            return;
          }

          idsToShow.forEach((id) => {
            const p = byId.get(String(id));
            if (!p) return;

            const isFree =
              p["Free"] === true ||
              p["PriceCents"] == null ||
              p["PriceCents"] === 0 ||
              (Array.isArray(p["Labels"]) &&
                p["Labels"].some((t) => String(t).toLowerCase() === "free"));
            const chipText = isFree ? "Free" : "Purchased";

            // --- Row (matches Custom Prompts style) ---
            const row = document.createElement("div");
            row.style.cssText = `
	    display:flex;align-items:center;gap:10px;
	    padding:8px;border:1px solid #2a2a33;border-radius:10px;
	    background:#0f1116;min-width:0;
	  `;

            // ON/OFF toggle (local active state)
            const tog = document.createElement("div");
            const on = qaActiveIsOn(activeMap, String(id));
            tog.className = "tog" + (on ? " on" : "");
            tog.textContent = on ? "On" : "Off";
            tog.style.marginRight = "6px";
            tog.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              const nextOn = !tog.classList.contains("on");
              tog.classList.toggle("on", nextOn);
              tog.textContent = nextOn ? "On" : "Off";
              await qaActiveSet(String(id), nextOn);
            };

            // Name + meta
            const name = document.createElement("div");
            name.style.cssText = `
	    flex:1;min-width:0;font-size:13px;color:#e5e7eb;
	    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
	    display:flex;align-items:center;gap:8px;flex-wrap:wrap;
	  `;
            name.innerHTML = `
	    <span>${p["Prompt Name"]}</span>
	    <span class="vgTag" style="font-size:11px;padding:2px 6px;border-radius:999px;border:1px solid #2a2a33;">${chipText}</span>
	    <span class="muted" style="font-size:12px;">${p["Type"] || "Prompt"} • ${
              p["Subcategory"] || "Library"
            }</span>
	  `;

            // Actions
            const actions = document.createElement("div");
            actions.style.cssText = `display:flex;gap:6px;flex:0 0 auto;`;

            const btnPrev = document.createElement("button");
            btnPrev.className = "btn ghost";
            btnPrev.textContent = "Preview";
            btnPrev.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              openPromptPreviewModal(p["Prompt Name"], p["Prompt Text"] || "");
            };

            const btnDel = document.createElement("button");
            btnDel.className = "btn ghost";
            btnDel.textContent = "Delete";
            btnDel.onclick = async (e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                const nowAdded = await vgQAToggle(p.id);
                const m = await qaActiveGetMap();
                delete m[String(p.id)];
                await qaActiveSetMap(m);

                if (!nowAdded) row.remove();
                if (!holder.children.length) {
                  holder.innerHTML = `<div class="muted">No quick adds yet. Open the Library tab and click “Quick Add”.</div>`;
                }
              } catch (err) {
                console.warn("[VG] quick add delete failed", err);
              }
            };

            actions.appendChild(btnPrev);
            actions.appendChild(btnDel);

            row.appendChild(tog);
            row.appendChild(name);
            row.appendChild(actions);
            holder.appendChild(row);
          });
        } catch (e) {
          console.warn("[VG] renderQuickAddsList error", e);
          holder.innerHTML = `<div class="muted">Couldn’t load Quick Adds.</div>`;
        }
      })();
    }

    // Map protection ids -> QUICK_TEXTS keys (used by template preview)
    function guardIdToTemplateKey(id) {
      const map = {
        basic: "BASIC",
        ui: "UI",
        copy: "COPY",
        logic: "LOGIC",
        strict: "STRICT",
        noref: "NOREF",
        wire: "WIRE",
        pol: "POL",
        data: "DATA",
        qa: "QA",
      };
      return map[id] || null;
    }

    // (from OLD content.js) — protection descriptions used in the table UI
    const descs = {
      basic: "Includes Safety Instructions, Conflict Check, and Output Format.",
      ui: "Prevents AI from altering layout, style, or visual design.",
      copy: "Prevents AI from changing wording, labels, or text content.",
      logic: "Prevents AI from modifying how the code executes.",
      strict: "Ensures AI only modifies the specific files you list.",
      noref:
        "Prevents AI from rewriting or reorganizing existing code structure.",
      wire: "Ensures new functions are registered (exports/routes/DI/flags/etc).",
      pol: "Validates RLS/service-role policies for touched tables/views.",
      data: "Prevents data mismatches; validates schema/contracts & migrations.",
      qa: "Forces a structured self-review with completion percent.",
    };

    // (from OLD content.js) — build the protections table rows
    // Basic tab may be removed; only paint if the table body exists.
    if (rows) {
      for (const p of PROTECTIONS) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
	      <td>${p.label}</td>
	      <td class="muted" style="color:#cbd5e1">${descs[p.id] || ""}</td>
	      <td style="text-align:right; display:flex; gap:8px; justify-content:flex-end; align-items:center">
	        <button class="preview-btn" data-guard="${p.id}">Preview</button>
	        <div class="tog" data-id="${p.id}">Off</div>
	      </td>`;
        rows.appendChild(tr);
      }
    }

    // (from OLD content.js) — toggler helpers
    function setToggle(el, on) {
      if (!el) return;
      el.classList.toggle("on", !!on);
      el.textContent = on ? "On" : "Off";
      const id = el.getAttribute("data-id");
      if (on) active.add(id);
      else active.delete(id);
      render();
    }

    // CHANGED: applyPreset used to only drive DOM toggles.
    // Now it ALSO mutates `active` directly so it works even if `rows` is null.
    function applyPreset(id) {
      // normalize preset
      const preset = PRESETS.find((x) => x.id === id);

      // 1) always sync the data model
      active.clear();
      if (preset && Array.isArray(preset.on)) {
        preset.on.forEach((pid) => active.add(pid));
      }

      // 2) paint UI only if the Basic table exists
      if (rows) {
        // clear all toggles then apply preset selection
        rows.querySelectorAll(".tog").forEach((el) => setToggle(el, false));
        if (preset) {
          preset.on.forEach((pid) => {
            const el = rows.querySelector(`.tog[data-id="${pid}"]`);
            setToggle(el, true);
          });
        }
      }

      // 3) keep dropdown in sync (if it exists)
      if (presetSel) presetSel.value = id;

      // 4) persist immediately so other surfaces (Quick Menu/My Prompts) can read it
      try {
        S_set("protections_on", Array.from(active));
      } catch (_) {}
    }

    // (from OLD content.js) — the live preview & enablement
    function render() {
      // collect selected custom guard objects by id
      const selectedCustomGuards = __CUSTOMS.filter((x) =>
        selectedCustomIds.has(x.id)
      );

      // build preview text
      const txt = buildInjection(active, selectedCustomGuards);

      // Write to preview if it exists (safe if not present)
      const prevEl = q("#preview");
      if (prevEl) prevEl.textContent = txt || "(nothing yet)";

      // If you keep Insert/Apply buttons in your UI, gate them. (Safe if absent.)
      const anyOn = active.size > 0 || selectedCustomIds.size > 0;
      const insertOnce = q("#insertOnce");
      const applyAll = q("#applyAll");
      if (insertOnce) {
        insertOnce.disabled = !anyOn;
        insertOnce.style.opacity = anyOn ? "1" : "0.6";
      }
      if (applyAll) {
        applyAll.disabled = !anyOn;
        applyAll.style.opacity = anyOn ? "1" : "0.6";
      }
    }

    // ===== Basic table events (delegated): Preview + Toggle =====
    if (rows) {
      rows.addEventListener("click", async (e) => {
        // 1) Preview buttons
        const pv = e.target && e.target.closest(".preview-btn");
        if (pv && rows.contains(pv)) {
          e.preventDefault();
          e.stopPropagation();
          const id = pv.getAttribute("data-guard");
          openTemplateModal(id);
          return;
        }

        // 2) On/Off toggles
        const tg = e.target && e.target.closest(".tog");
        if (!tg || !rows.contains(tg)) return;

        e.preventDefault();
        e.stopPropagation();

        const nowOn = !tg.classList.contains("on");
        tg.classList.toggle("on", nowOn);
        tg.textContent = nowOn ? "On" : "Off";

        const id = tg.getAttribute("data-id");
        if (nowOn) active.add(id);
        else active.delete(id);

        const list = Array.from(active);
        const inferred = inferPresetIdFromList(list);
        if (presetSel) presetSel.value = inferred;

        try {
          await S_set("protections_on", list);
          await S_set("preset_id", inferred);
        } catch {}
        try {
          await saveSettingsRoamingOrPromptLogin({
            preset_id: inferred,
            protections_on: list,
          });
        } catch {}

        render();
      });
    }

    // (DB-first) behavior toggles + restore (then mirror to Chrome storage)
    (async () => {
      // Ensure SW is awake and adopted before any BG reads
      try {
        await __vgEnsureBGSessionFromSoT();
      } catch {}

      // 1) Hydrate from DB first; fallback to Chrome storage
      let seededFromDB = false;
      try {
        const db = await DB_getUserSettings(); // { auto_chat, send_delay_sec } or null
        if (db) {
          __VG_SETTINGS.auto_chat = !!db.auto_chat;
          __VG_SETTINGS.send_delay_sec =
            parseInt(db.send_delay_sec || 0, 10) || 0;

          // Mirror to Chrome storage so other UIs (Quick Menu) keep working offline
          await S_set("auto_chat", __VG_SETTINGS.auto_chat ? "1" : "0");
          await S_set("send_delay_sec", __VG_SETTINGS.send_delay_sec);

          // ---- NEW: hydrate preset + row toggles from DB if present ----
          if (Array.isArray(db.protections_on) && db.protections_on.length) {
            if (rows) {
              // Clear all and turn ON exactly what DB says
              rows.querySelectorAll(".tog").forEach((el) => {
                const id = el.getAttribute("data-id");
                setToggle(el, db.protections_on.includes(id));
              });
            }
            // Reflect stored preset (if any)
            if (db.preset_id && presetSel) {
              presetSel.value = db.preset_id;
            }
            // Mirror to Chrome storage for Quick Menu
            await S_set("protections_on", Array.from(active));
            await S_set("preset_id", db.preset_id || "all");
          } else if (db.preset_id) {
            // If only preset is stored, apply it now (this fills `active`)
            applyPreset(db.preset_id);
            await S_set("protections_on", Array.from(active));
            await S_set("preset_id", db.preset_id);
          }

          seededFromDB = true;
          __vgPublishBehaviorSettings(); // ← publish globally
        }
      } catch {}

      if (!seededFromDB) {
        const auto_chat = await S_get("auto_chat", "1");
        const send_delay_sec = await S_get("send_delay_sec", "5");
        __VG_SETTINGS.auto_chat =
          auto_chat === "1" || auto_chat === 1 || auto_chat === true;
        __VG_SETTINGS.send_delay_sec = parseInt(send_delay_sec || "0", 10) || 0;
        __vgPublishBehaviorSettings(); // ← publish globally
      }

      // 2) Wire UI
      const autoChatBtn = q("#autoChat");
      const countdownBtn = q("#countdown");
      const secsSel = q("#secs");
      // (do not redeclare presetSel here; we use the shared one defined above)

      /* Settings-lite guard:
   If the controls were removed from the Settings tab, exit cleanly so
   nothing throws or binds listeners. */
      if (!autoChatBtn || !countdownBtn || !secsSel) {
        console.debug(
          "[VG][settings] behavior controls hidden (coming-soon message active)"
        );
      } else {
        function reflectBehavior() {
          autoChatBtn.classList.toggle("on", !!autoChatBtn.__on);
          countdownBtn.classList.toggle("on", !!countdownBtn.__on);
        }

        // Seed UI state from current settings
        autoChatBtn.__on = !!__VG_SETTINGS.auto_chat;
        countdownBtn.__on = (__VG_SETTINGS.send_delay_sec || 0) > 0;
        try {
          secsSel.value = String(__VG_SETTINGS.send_delay_sec || 5);
        } catch {}
        reflectBehavior();

        // 3) Persist on change: DB + Chrome storage
        autoChatBtn.addEventListener("click", async () => {
          autoChatBtn.__on = !autoChatBtn.__on;
          reflectBehavior();
          __VG_SETTINGS.auto_chat = !!autoChatBtn.__on;
          __vgPublishBehaviorSettings(); // ← publish globally
          await S_set("auto_chat", autoChatBtn.__on ? "1" : "0");
          DB_saveUserSettings({ auto_chat: __VG_SETTINGS.auto_chat });
        });

        countdownBtn.addEventListener("click", async () => {
          countdownBtn.__on = !countdownBtn.__on;
          reflectBehavior();
          const v = countdownBtn.__on ? parseInt(secsSel.value, 10) || 5 : 0;
          __VG_SETTINGS.send_delay_sec = v;
          __vgPublishBehaviorSettings(); // ← publish globally
          await S_set("send_delay_sec", v);
          DB_saveUserSettings({ send_delay_sec: v });
        });

        secsSel.addEventListener("change", async () => {
          if (!countdownBtn.__on) return;
          const v = parseInt(secsSel.value, 10) || 5;
          __VG_SETTINGS.send_delay_sec = v;
          __vgPublishBehaviorSettings(); // ← publish globally
          await S_set("send_delay_sec", v);
          DB_saveUserSettings({ send_delay_sec: v });
        });
      } // ← end settings-lite guard

      // When the preset dropdown changes, apply and persist immediately (local + DB)
      presetSel?.addEventListener("change", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        let id = presetSel.value || "all";

        // If user selects "custom", do NOT call applyPreset — keep current toggles.
        if (id !== "custom") {
          applyPreset(id); // updates `active` + calls render()
        } else {
          // Align "custom" with whatever is currently selected
          id = inferPresetIdFromList(Array.from(active)); // will be "custom" unless it matches a preset
          presetSel.value = id;
        }

        const list = Array.from(active);

        // Local
        try {
          await S_set("preset_id", id);
          await S_set("protections_on", list);
        } catch (err) {
          console.warn("[VG] local preset save failed", err);
        }

        // DB
        try {
          const ok = await saveSettingsRoamingOrPromptLogin({
            preset_id: id,
            protections_on: list,
          });
          console.debug("[VG] DB preset save", { id, list, ok });
        } catch (err) {
          console.warn("[VG] DB preset save failed", err);
        }
      });

      // 4) First-run preset restore (guard DOM)
      const { booted, preset_id, protections_on } = await S_getMany([
        "booted",
        "preset_id",
        "protections_on",
      ]);

      if (!booted) {
        await S_set("booted", "1");
        await S_set("preset_id", "all");
        applyPreset("all");
        await S_set("protections_on", Array.from(active));
      } else if (
        protections_on &&
        Array.isArray(protections_on) &&
        protections_on.length
      ) {
        if (rows) {
          rows
            .querySelectorAll(".tog")
            .forEach((el) =>
              setToggle(el, protections_on.includes(el.getAttribute("data-id")))
            );
        }
        if (presetSel) presetSel.value = preset_id || "all";
      } else {
        applyPreset(preset_id || "all");
        await S_set("protections_on", Array.from(active));
      }

      render();
      await cgLoadAndRender();
    })();

    // (removed stray call; Quick Adds render when the My Prompts tab is visible)

    // (from OLD content.js) — Save / Save & Close wiring
    const saveBtn = q("#save");
    const saveCloseBtn = q("#saveClose");
    const closeBtn = q("#close");

    // Close (X) button
    closeBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      __VG_LAST_MODAL_CLOSE = performance.now();
      try {
        host.remove();
      } catch (_e) {}
    });

    // Help button (routes to Help Center)
    const helpBtn = q("#help");
    helpBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const url = "https://viberly.ai/help-center";
      try {
        if (browser?.tabs?.create) browser.tabs.create({ url });
        else window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });

    // Save button
    saveBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (saveBtn.__busy) return;
      btnSetLoading(saveBtn);

      const selectedCustomGuards = __CUSTOMS.filter((x) =>
        selectedCustomIds.has(x.id)
      );
      await S_set("preview", buildInjection(active, selectedCustomGuards));

      const list = Array.from(active);
      const pid = inferPresetIdFromList(list); // infer, not the dropdown
      await S_set("protections_on", list);
      await S_set("preset_id", pid);

      try {
        const ok = await saveSettingsRoamingOrPromptLogin({
          preset_id: pid,
          protections_on: list,
        });
        console.debug("[VG] DB save (Save button)", { pid, list, ok });
      } catch (err) {
        console.warn("[VG] DB save failed (Save button)", err);
      }

      try {
        document.dispatchEvent(
          new CustomEvent("vg-standard-guards-updated", {
            detail: { on: list, preset: pid },
          })
        );
      } catch {}

      btnSetDone(saveBtn); // resets after ~1.5s
    });

    // Save & Close button
    saveCloseBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (saveCloseBtn.__busy) return;
      btnSetLoading(saveCloseBtn);

      const selectedCustomGuards = __CUSTOMS.filter((x) =>
        selectedCustomIds.has(x.id)
      );
      await S_set("preview", buildInjection(active, selectedCustomGuards));

      const list = Array.from(active);
      const pid = inferPresetIdFromList(list); // infer, not the dropdown
      await S_set("protections_on", list);
      await S_set("preset_id", pid);

      try {
        const ok = await saveSettingsRoamingOrPromptLogin({
          preset_id: pid,
          protections_on: list,
        });
        console.debug("[VG] DB save (Save&Close)", { pid, list, ok });
      } catch (err) {
        console.warn("[VG] DB save failed (Save&Close)", err);
      }

      try {
        document.dispatchEvent(
          new CustomEvent("vg-standard-guards-updated", {
            detail: { on: list, preset: pid },
          })
        );
      } catch {}

      btnSetDone(saveCloseBtn, "Saved", 400);
      setTimeout(__vgCloseSettingsModal, 420);
    });

    // (from OLD content.js) — Tab switcher (Basic / Advanced / Library / Billing)
    (function initTabs() {
      const tabsBar = q("#vg-tabs");
      if (!tabsBar) return;

      const advSec = q('section[data-tab="advanced"]');
      const teamSec = q('section[data-tab="team"]'); // ← NEW
      const libSec = q('section[data-tab="library"]');
      const setSec = q('section[data-tab="settings"]');
      const billSec = q('section[data-tab="billing"]');

      const tabs = [
        q("#tab-advanced"),
        q("#tab-team"), // ← NEW
        q("#tab-library"),
        q("#tab-settings"),
        q("#tab-billing"),
      ].filter(Boolean);

      function showTab(which) {
        if (advSec) advSec.hidden = which !== "advanced";
        if (teamSec) teamSec.hidden = which !== "team"; // ← NEW
        if (libSec) libSec.hidden = which !== "library";
        if (setSec) setSec.hidden = which !== "settings";
        if (billSec) billSec.hidden = which !== "billing";

        tabs.forEach((t) =>
          t.classList.toggle("active", t?.dataset.tab === which)
        );

        try {
          if (which === "advanced") {
            seedStdGuardsIntoQuickAddsOnce().then(() => {
              try {
                renderQuickAddsList();
              } catch {}
            });
          }

          if (which === "team") {
            // ← NEW: paint team list on view
            __vgPaintTeamPromptsList?.();
          }

          if (which === "library") {
            const root = shadow.querySelector(
              'section[data-tab="library"] #vg-lib-root'
            );
            if (root) vgRenderMarketplaceGrid(root);
            const btn = shadow.querySelector("#vg-lib-refresh");
            if (btn)
              btn.onclick = async (e) => {
                e.preventDefault();
                try {
                  await vgRefreshLibraryNow();
                } catch {}
                try {
                  await vgLoadOwnershipSets();
                } catch {}
                if (root) vgRenderMarketplaceGrid(root);
              };
          }

          if (which === "settings") {
            try {
              __vgSettingsRefresh?.();
              __vgSettingsWire?.();
            } catch {}
          }

          if (which === "billing") {
            renderPlanCardsOnce(shadow);
            renderBilling?.();
          }
        } catch {}
      }

      // Attach one unified click handler to all tabs (including Team if present)
      tabs.forEach((t) =>
        t.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const w = e.currentTarget?.dataset?.tab || e.target?.dataset?.tab;
          showTab(w);
        })
      );

      // default land on Basic (or forced deep link)
      showTab(defaultTab);
    })();

    // auto re-render library when data is ready/updated (shadow-safe, router-aware)
    document.addEventListener("vg-lib-ready", () => {
      const secLib = q('section[data-tab="library"]');
      const root = secLib?.querySelector?.("#vg-lib-root");
      if (secLib && !secLib.hidden && root) vgRenderMarketplaceGrid(root);

      // If My Prompts is visible, seed Quick Adds now that library is ready
      const secAdv = q('section[data-tab="advanced"]');
      if (secAdv && !secAdv.hidden) {
        seedStdGuardsIntoQuickAddsOnce().then(() => {
          try {
            renderQuickAddsList();
          } catch {}
        });
      }
    });

    document.addEventListener("vg-lib-updated", () => {
      const secLib = q('section[data-tab="library"]');
      const root = secLib?.querySelector?.("#vg-lib-root");
      if (secLib && !secLib.hidden && root) vgRenderMarketplaceGrid(root);
    });

    // Repaint Quick Adds when favorites or library change (only if My Prompts tab is visible)
    function _qaRefreshIfVisible() {
      const sec = q('section[data-tab="advanced"]'); // My Prompts
      if (sec && !sec.hidden) renderQuickAddsList();
    }
    document.addEventListener("vg-qa-updated", _qaRefreshIfVisible);
    document.addEventListener("vg-lib-ready", _qaRefreshIfVisible);
    document.addEventListener("vg-lib-updated", _qaRefreshIfVisible);

    // === Billing plan cards (same look as paywall) ===
    const BILL_FEATURES = {
      basic: {
        title: "Basic",
        price: "$4.99/mo",
        bullets: [
          "Up to 3 Custom Prompts",
          "Up to 3 Quick Adds",
          "5 Enhance Prompts / mo",
        ],
        footnote: "Cancel anytime.",
      },
      pro: {
        title: "Pro",
        price: "$9.99/mo",
        popular: true,
        bullets: [
          "Unlimited Custom Prompts",
          "Unlimited Quick Adds",
          "Unlimited Enhance Prompts",
        ],
        footnote: "Best for active builders.",
      },
    };
    function billCheckSVG() {
      const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      s.setAttribute("viewBox", "0 0 24 24");
      s.setAttribute("width", "16");
      s.setAttribute("height", "16");
      s.innerHTML =
        '<path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
      return s;
    }
    function billPlanCard(kind, shadow) {
      const spec = BILL_FEATURES[kind];
      const card = document.createElement("div");
      card.className = `plan ${kind}` + (spec.popular ? " popular" : "");

      if (spec.popular) {
        const badge = document.createElement("div");
        badge.className = "badge";
        badge.textContent = "Most popular";
        card.appendChild(badge);
      }

      const hdr = document.createElement("div");
      hdr.className = "hdr";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = spec.title;
      const price = document.createElement("div");
      price.className = "price";
      price.textContent = spec.price;
      hdr.append(name, price);
      card.appendChild(hdr);

      const bl = document.createElement("div");
      bl.className = "bullets";
      spec.bullets.forEach((t) => {
        const row = document.createElement("div");
        row.className = "bullet";
        const icon = billCheckSVG();
        const txt = document.createElement("div");
        txt.textContent = t;
        row.append(icon, txt);
        bl.appendChild(row);
      });
      card.appendChild(bl);

      if (spec.footnote) {
        const foot = document.createElement("div");
        foot.className = "foot";
        foot.textContent = spec.footnote;
        card.appendChild(foot);
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "planBtn";
      btn.id = kind === "pro" ? "planBtnPro" : "planBtnBasic";
      btn.textContent = kind === "pro" ? "Get Pro" : "Get Basic";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        try {
          // use the settings’ billing helper if present
          if (kind === "pro") billingStartCheckout(PRICE_PRO);
          else billingStartCheckout(PRICE_BASIC);
        } catch {}
      });
      card.appendChild(btn);

      return card;
    }
    let __plansRenderedOnce = false;
    function renderPlanCardsOnce(shadow) {
      if (__plansRenderedOnce) return;
      const host = shadow.getElementById("billPlans");
      if (!host) return;
      host.innerHTML = "";
      host.appendChild(billPlanCard("basic", shadow));
      host.appendChild(billPlanCard("pro", shadow));
      __plansRenderedOnce = true;
    }

    /* ---------- Billing tab wiring (from OLD content.js) ---------- */
    const FUNCTION_URL_CHECKOUT =
      "https://auudkltdkakpnmpmddaj.supabase.co/functions/v1/create-checkout-session";
    const FUNCTION_URL_PORTAL =
      "https://auudkltdkakpnmpmddaj.supabase.co/functions/v1/create-portal-session";

    const PRICE_BASIC = "price_1RyYJuCKsHaxtGkUiLlRAAd3";
    const PRICE_PRO = "price_1RyYMaCKsHaxtGkUMaScJLZS";
    const PLAN_LIMITS = { free: 1, basic: 3, pro: Infinity };

    const B = (id) => q(`#${id}`);

    async function billingStartCheckout(price_id) {
      const plan =
        price_id === PRICE_PRO
          ? "pro"
          : price_id === PRICE_BASIC
          ? "basic"
          : null;
      const startViaBackground = async () => {
        try {
          const resp = await browser.runtime
            .sendMessage({ type: "PAYWALL:CHECKOUT", plan, price_id })
            .catch(() => null);
          if (resp?.ok && resp.url) {
            window.open(resp.url, "_blank");
            return true;
          }
          if (resp && !resp.ok && resp.error) {
            console.warn("[billing] BG checkout error:", resp.error);
          }
        } catch (err) {
          console.warn("[billing] BG checkout failed:", err);
        }
        return false;
      };

      try {
        const {
          data: { session },
        } = await (window.VG?.auth?.getSession?.() ?? {
          data: { session: null },
        });
        if (!session?.access_token) throw new Error("Not signed in");
        const res = await fetch(FUNCTION_URL_CHECKOUT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ price_id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.url) {
          const err =
            json?.error ||
            (typeof json === "string" ? json : `HTTP_${res.status}`);
          throw new Error(err || "Checkout failed");
        }
        window.open(json.url, "_blank");
        return;
      } catch (err) {
        console.warn("[billing] direct checkout failed:", err);
        const ok = await startViaBackground();
        if (!ok) {
          alert("Could not start checkout. Please try again in a moment.");
        }
      }
    }

    async function billingOpenPortal() {
      const {
        data: { session },
      } = await (window.VG?.auth?.getSession?.() ?? {
        data: { session: null },
      });
      if (!session?.access_token) return;
      const res = await fetch(FUNCTION_URL_PORTAL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ return_url: location.href }),
      });
      if (!res.ok) return console.error("[portal]", await res.text());
      const { url } = await res.json();
      window.open(url, "_blank");
    }

    // === EXPOSE billing helpers for paywall buttons (checked syntax) ===
    try {
      window.__VGBilling = {
        checkout: function (plan) {
          const id =
            plan === "pro"
              ? "price_1RyYMaCKsHaxtGkUMaScJLZS" // PRO
              : "price_1RyYJuCKsHaxtGkUiLlRAAd3"; // BASIC
          return billingStartCheckout(id);
        },
        portal: function () {
          return billingOpenPortal();
        },
      };
    } catch (e) {
      console.warn("[VG] __VGBilling expose failed:", e);
    }

    async function renderBilling() {
      try {
        // Make sure BG SW is awake/adopted
        await __vgEnsureBGSessionFromSoT();

        // 1) Email from SoT snapshot (same as popup)
        let email = "(not signed in)";
        try {
          const sot = await new Promise((res) =>
            browser.storage.local
              .get("VG_SESSION")
              .then((o) => res(o?.VG_SESSION || null))
          );
          if (sot?.email) email = sot.email;
        } catch {}
        const elEmail = B("billEmail");
        if (elEmail) elEmail.textContent = email;

        // 2) Plan + usage — DB-only summary from BG
        //    VG_ACCOUNT_SUMMARY now returns: { tier, used, quick, limit, status }
        const sumResp = await sendBG("VG_ACCOUNT_SUMMARY");
        const summary = sumResp && sumResp.ok ? sumResp.summary || {} : {};

        const tier = String(summary.tier || "free").toLowerCase();
        const limit =
          typeof summary.limit === "number" || summary.limit === Infinity
            ? summary.limit
            : PLAN_LIMITS[tier] ?? PLAN_LIMITS.free;

        const usedGuards = Number.isFinite(summary.used) ? summary.used : 0;
        const usedQuick = Number.isFinite(summary.quick) ? summary.quick : 0;

        // 3) Paint plan/usage
        const planEl = B("billPlan");
        if (planEl)
          planEl.textContent = tier.charAt(0).toUpperCase() + tier.slice(1);

        const usageEl = B("billUsage");
        if (usageEl) {
          const guardsStr =
            limit === Infinity
              ? `${usedGuards} / ∞`
              : `${usedGuards} / ${limit}`;
          const quickStr =
            limit === Infinity ? `${usedQuick} / ∞` : `${usedQuick} / ${limit}`;
          usageEl.textContent = `Guards ${guardsStr} • Quick Adds ${quickStr}`;
        }

        // 4) Card/button states (gray-out current plan and make CTA inert)
        const isPro = tier === "pro";
        const isBasic = tier === "basic";
        const isFree = tier === "free";

        function setPlanUI(kind, isCurrent) {
          const card = shadow.querySelector(`.plan.${kind}`);
          const btn = card?.querySelector(".planBtn");
          if (!card || !btn) return;

          if (isCurrent) {
            card.classList.add("current");
            btn.textContent = "Current Plan";
            btn.setAttribute("disabled", "");
          } else {
            card.classList.remove("current");
            btn.removeAttribute("disabled");
            btn.textContent = kind === "pro" ? "Get Pro" : "Get Basic";
          }
        }

        setPlanUI("basic", isBasic);
        setPlanUI("pro", isPro);

        // (Optional legacy buttons, if present)
        B("billBuyPro")?.toggleAttribute("disabled", isPro);
        B("billBuyBasic")?.toggleAttribute("disabled", isBasic || !isFree);
      } catch (e) {
        console.error("[billing render]", e);
      }
    }

    // Buttons
    B("billBuyBasic")?.addEventListener("click", () =>
      billingStartCheckout(PRICE_BASIC)
    );
    B("billBuyPro")?.addEventListener("click", () =>
      billingStartCheckout(PRICE_PRO)
    );

    // Also render when user clicks the Billing tab (in case they jump straight there)
    q("#vg-tabs")?.addEventListener("click", (ev) => {
      if (ev.target?.dataset?.tab === "billing") renderBilling();
    });
    /* ---------- end Billing tab wiring ---------- */

    // --- Template modal controls ---
    const tplModal = q("#tplModal");
    const tplmName = q("#tplmName");
    const tplmBody = q("#tplmBody");
    const tplmCopy = q("#tplmCopy");
    const tplmClose = q("#tplmClose");

    function openTemplateModal(id) {
      const key = guardIdToTemplateKey(id);
      const text = key ? QUICK_TEXTS[key] || "" : "";

      // Try to pull the pretty label from the first column of the table row
      let name = id || "Template";
      if (rows) {
        try {
          const row = Array.from(rows.querySelectorAll("tr")).find(
            (tr) => tr.querySelector(".preview-btn")?.dataset.guard === id
          );
          if (row) name = row.children[0].textContent.trim();
        } catch {}
      }

      tplmName.textContent = name + " — (read-only)";
      tplmBody.textContent = text || "(prompt not available)";
      tplModal.hidden = false;
      setTimeout(() => tplmClose?.focus(), 0);
    }

    // Preview a library prompt’s raw text using the same modal
    function openPromptPreviewModal(name, text) {
      try {
        tplmName.textContent = (name || "Prompt") + " — (read-only)";
        tplmBody.textContent = text || "(prompt not available)";
        tplModal.hidden = false;
        setTimeout(() => tplmClose?.focus(), 0);
      } catch (_e) {}
    }

    function closeTemplateModal() {
      tplModal.hidden = true;
    }
    tplmCopy?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(tplmBody.textContent || "");
        const old = tplmCopy.textContent;
        tplmCopy.textContent = "Copied";
        setTimeout(() => (tplmCopy.textContent = old), 900);
      } catch (_e) {}
    });

    tplmClose?.addEventListener("click", closeTemplateModal);

    // Click outside dialog closes
    tplModal?.addEventListener("click", (ev) => {
      if (ev.target === tplModal) closeTemplateModal();
    });

    // Esc closes when the modal is open
    shadow.addEventListener("keydown", (e) => {
      if (!tplModal.hidden && e.key === "Escape") {
        e.preventDefault();
        closeTemplateModal();
      }
    });

    // --- "New Custom Guard" modal controls ---
    const cgmModal = q("#cgNewModal");
    const cgmName = q("#cgmName");
    const cgmBody = q("#cgmBody");
    const cgmCreate = q("#cgmCreate");
    const cgmCancel = q("#cgmCancel");
    const cgmCreate2 = q("#cgmCreate2");
    const cgmCancel2 = q("#cgmCancel2");

    // (all the SAME tooltip wiring, Import CSV wiring, unified closer, rows/presets,
    //  Library tab renderer hooks, Billing wiring, Custom Guards list, save handlers, etc.)
    // — just leave your code unchanged, it now lives INSIDE openModal.

    /* === AI Enhance overlay (Thinking…) — lazy build (from OLD content.js) === */
    let aiOverlay = null; // created on demand
    let __aiDotsTimer = null; // shared ticker

    function ensureAiOverlay() {
      if (aiOverlay && aiOverlay.isConnected) return aiOverlay;

      const dlg = q(".cgm-dialog");
      if (!dlg) return null;

      aiOverlay = q("#aiThinkingOverlay");
      if (aiOverlay && aiOverlay.isConnected) return aiOverlay;

      aiOverlay = document.createElement("div");
      aiOverlay.id = "aiThinkingOverlay";
      aiOverlay.setAttribute("hidden", "");
      aiOverlay.style.cssText = `
        position:absolute; inset:0; z-index:50;
        display:flex; align-items:center; justify-content:center;
        background:rgba(0,0,0,.62); border-radius:12px;
      `;

      const box = document.createElement("div");
      box.style.cssText = `
        display:flex; gap:10px; align-items:center;
        background:#0f1116; border:1px solid #2a2a33;
        padding:14px 16px; border-radius:10px;		
        box-shadow:0 20px 60px rgba(0,0,0,.55);
        font:600 15px Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
        color:#e5e7eb;
      `;

      const spinner = document.createElement("div");
      spinner.style.cssText = `
        width:16px; height:16px; border-radius:50%;
        border:2px solid #7c3aed; border-top-color:transparent;
        animation:vgspin .8s linear infinite;
      `;
      if (!q("#vgspin-style")) {
        const st = document.createElement("style");
        st.id = "vgspin-style";
        st.textContent = `@keyframes vgspin{to{transform:rotate(360deg)}}`;
        dlg.appendChild(st);
      }

      const label = document.createElement("div");
      label.className = "ai-label";
      label.textContent = "Thinking";

      box.appendChild(spinner);
      box.appendChild(label);
      aiOverlay.appendChild(box);

      dlg.style.position = "relative";
      dlg.appendChild(aiOverlay);
      return aiOverlay;
    }

    function showAiOverlay() {
      const ov = ensureAiOverlay();
      if (!ov) return;
      ov.hidden = false;
      const label = ov.querySelector(".ai-label");
      let step = 0;
      clearInterval(__aiDotsTimer);
      __aiDotsTimer = setInterval(() => {
        label.textContent = "Thinking" + ".".repeat(step % 4);
        step++;
      }, 350);
    }

    function hideAiOverlay(removeNode = false) {
      if (!aiOverlay) return;
      clearInterval(__aiDotsTimer);
      __aiDotsTimer = null;
      try {
        aiOverlay.hidden = true;
      } catch {}
      if (removeNode && aiOverlay.parentNode) {
        aiOverlay.parentNode.removeChild(aiOverlay);
      }
      if (removeNode) aiOverlay = null;
    }

    // === AI Enhance button into the CG modal footer (from OLD content.js) ===
    const AI_ENHANCE_URL =
      "https://auudkltdkakpnmpmddaj.supabase.co/functions/v1/ai-enhance";
    const cgmFooter = q(".cgm-footer");
    let cgmAI = q("#cgmAi"); // avoid duplicates if modal rebuilt
    if (!cgmAI && cgmFooter) {
      cgmAI = document.createElement("button");
      cgmAI.id = "cgmAi";
      cgmAI.type = "button";
      cgmAI.className = "btn";
      cgmAI.textContent = "AI Enhance";
      const before = cgmFooter.querySelector("#cgmCreate2");
      cgmFooter.insertBefore(cgmAI, before || null);
    }

    async function vgEnhanceBody() {
      const txt = (cgmBody?.value || "").trim();
      const name = (cgmName?.value || "").trim();
      if (!txt) {
        cgmBody?.focus();
        return;
      }

      const oldLabel = cgmAI?.textContent;
      if (cgmAI) {
        cgmAI.disabled = true;
        cgmAI.textContent = "Thinking…";
      }
      showAiOverlay();

      try {
        const {
          data: { session },
        } = await (window.VG?.auth?.getSession?.() ?? {
          data: { session: null },
        });

        // Always send a bearer so the Supabase Functions gateway doesn’t 401 the call.
        // Use the user JWT when available; otherwise fall back to the public anon key.
        const AT_ANON =
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dWRrbHRka2FrcG5tcG1kZGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU3MDA3NTYsImV4cCI6MjA3MTI3Njc1Nn0.ukDpH6EXksctzWHMSdakhNaWbgFZ61UqrpvzwTy03ho";

        const bearer = session?.access_token || AT_ANON;

        const res = await fetch(AI_ENHANCE_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
          },
          body: JSON.stringify({ prompt: txt, name }),
        });

        let out = {};
        try {
          out = await res.json();
        } catch (_) {}

        if (!res.ok) {
          alert("AI Enhance failed: " + (out?.error || `HTTP ${res.status}`));
          return;
        }

        if (out?.enhanced && typeof out.enhanced === "string") {
          cgmBody.value = out.enhanced;
          setTimeout(() => cgmBody?.focus(), 0);
        } else {
          alert("AI Enhance returned no text.");
        }
      } catch (err) {
        console.error("[AI Enhance] error:", err);
        alert("Network error while enhancing.");
      } finally {
        if (cgmAI) {
          cgmAI.disabled = false;
          cgmAI.textContent = oldLabel || "AI Enhance";
        }
        hideAiOverlay(true);
      }
    }

    cgmAI?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      vgEnhanceBody();
    });

    // Swallow ALL key events inside the New Custom Guard modal so page hotkeys can’t steal focus.
    cgmModal.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") e.stopPropagation();
      },
      true
    );

    // Keep Space from "clicking" footer buttons by default
    [cgmCreate2, cgmCancel2].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener("keydown", (e) => {
        if (e.key === " ") e.preventDefault();
      });
    });

    // Put modal back into Create mode (button text + handler)
    function cgModalToCreateMode() {
      if (!cgmCreate2) return;
      cgmCreate2.textContent = "Create";
      cgmCreate2.onclick = handleCgCreate;
    }

    // Open modal; if seed provided → Edit mode, else clear (Create mode)
    function openCgNewModal(seed) {
      try {
        hideAiOverlay(true);
      } catch {}
      const ov = q("#aiThinkingOverlay");
      if (ov) ov.remove();
      aiOverlay = null;

      if (cgmAI) {
        cgmAI.disabled = false;
        cgmAI.textContent = "AI Enhance";
      }

      try {
        if (seed && (seed.name != null || seed.body != null)) {
          cgmName.value = seed.name || "";
          cgmBody.value = seed.body || "";
        } else {
          cgmName.value = "";
          cgmBody.value = "";
          cgModalToCreateMode();
        }
      } catch (_) {}
      cgmModal.hidden = false;
      setTimeout(() => cgmName?.focus(), 0);
    }

    function closeCgNewModal() {
      cgmModal.hidden = true;
      cgModalToCreateMode();
    }

    async function handleCgCreate() {
      const name = (cgmName.value || "").trim() || "Custom Guard";
      const body = (cgmBody.value || "").trim();
      if (!body) {
        cgmBody.focus();
        return;
      }

      // Create without any gating — users can create unlimited prompts
      const created = await CG_create({ name, body });

      try {
        selectedCustomIds.add(created.id);
        await S_set("custom_selected", Array.from(selectedCustomIds));
      } catch (_) {}

      await cgLoadAndRender();
      closeCgNewModal();
    }

    // default 'Create' button in header; footer primary is swapped dynamically
    cgmCreate?.addEventListener("click", handleCgCreate);
    cgmCancel?.addEventListener("click", closeCgNewModal);
    cgmCancel2?.addEventListener("click", closeCgNewModal);

    cgmModal?.addEventListener("click", (ev) => {
      if (ev.target === cgmModal) closeCgNewModal();
    });

    shadow.addEventListener("keydown", (e) => {
      if (!cgmModal.hidden && e.key === "Escape") {
        e.preventDefault();
        closeCgNewModal();
      }
    });

    // Accept external "edit this prompt" requests from Quick Menu preview
    document.addEventListener(
      "vg-edit-prompt",
      (ev) => {
        try {
          const d = ev?.detail || {};
          const pid = String(d.id || "");
          const name = String(d.name || "");
          const body = String(d.body || "");

          // Land on My Prompts tab
          try {
            shadow.querySelector("#tab-advanced")?.click();
          } catch (_) {}

          // Open the New Custom Prompt modal prefilled
          openCgNewModal({ name, body });

          // If we have an id, switch primary action to Save (CG_update)
          if (pid) {
            const btn = shadow.getElementById("cgmCreate2");
            if (btn) {
              btn.textContent = "Save";
              btn.onclick = async () => {
                const newName = (cgmName.value || "").trim();
                const newBody = (cgmBody.value || "").trim();
                if (!newBody) {
                  cgmBody.focus();
                  return;
                }
                await CG_update(pid, { name: newName, body: newBody });
                await cgLoadAndRender();
                closeCgNewModal();
              };
            }
          }
        } catch (_) {
          /* no-op */
        }
      },
      { once: true }
    );
  } // ← CLOSE the function here

  // Early expose so Quick Menu buttons can call it even if some later wiring is skipped.
  try {
    window.openModal = openModal;
    window.__SB_OPEN_MODAL = openModal; // back-compat
  } catch {}

  // Immediately load guard templates from DB into QUICK_TEXTS (for Preview modal)
  vgLoadGuardTemplatesFromDB();

  // expose opener for Quick Menu gear and background deep-links
  try {
    window.openModal = openModal;
    window.__SB_OPEN_MODAL = openModal; // back-compat
  } catch {}

  try {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "VG_OPEN_BILLING") openModal("billing");
      if (msg?.type === "VG_OPEN_LIBRARY") {
        openModal("library");
        setTimeout(() => {
          document
            .getElementById(APP + "-modal-host")
            ?.shadowRoot?.querySelector("#vg-lib-search")
            ?.focus();
        }, 60);
      }
    });
  } catch {}
})(); // end: src/ui/settings.js

// volatile runtime flags
let __VG_LAST_MENU_CLOSE = 0;
