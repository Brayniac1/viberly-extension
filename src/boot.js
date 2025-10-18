// src/boot.js
(() => {
  // ---- Flags: iframe-only + kill legacy ----
  const VG = (window.__VG = window.__VG || {});
  VG.flags = VG.flags || {};
  VG.flags.useIframeHUD = true; // iframe HUD is the only renderer
  VG.flags.killLegacyPill = true; // actively disable/remove legacy pill paths

  // ==== Bolt + v0.app: never bootstrap from iframes (prevents wrong-host fetch) ====
  try {
    const isBolt = /(^|\.)bolt\.new$/i.test(location.hostname);
    const isV0App = /(^|\.)v0\.app$/i.test(location.hostname);
    if ((isBolt || isV0App) && window.top !== window) {
      return; // skip this frame; the top window will fetch placements/place HUD
    }
  } catch {}

  // ---- Globals populated by boot + background ----
  window.__VG_DB_PLACEMENT = null; // { strategy, dx, dy, gutter, pill_size }
  window.__VG_SIGNED_IN_GLOBAL = undefined; // boolean (undefined until fetched)

  // ---- Utility: run once wrapper ----
  function once(fn) {
    let done = false,
      val;
    return (...args) => {
      if (done) return val;
      done = true;
      val = fn(...args);
      return val;
    };
  }

  // ---- Ensure HUD APIs exist (succeeds even if manifest order changes) ----
  async function ensureHudLoaded() {
    if (
      typeof window.__VG_INIT_HUD__ === "function" &&
      typeof window.__VG_PLACE_HUD__ === "function"
    )
      return;
    try {
      await import(browser.runtime.getURL("src/ui/hud.js"));
    } catch (e) {
      console.error("[VG] failed to load HUD module:", e);
    }
  }

  function killLegacyPill() {
    if (!VG.flags.killLegacyPill) return;
    try {
      [
        "vibeguardian-pill-host",
        "vg-pill-host",
        "vg-pill",
        "__vg_host__",
        "__vg_legacy__",
      ].forEach((id) => document.getElementById(id)?.remove());
      if (window.__VG_LEGACY_INTERVAL__)
        clearInterval(window.__VG_LEGACY_INTERVAL__);
      if (window.__VG_LEGACY_OBSERVER__?.disconnect)
        window.__VG_LEGACY_OBSERVER__.disconnect();
      window.mountPill =
        window.vgAutoAnchorPill =
        window.vgPinPillUnderLovable =
          () => false;
    } catch (_) {}
  }

  // ---- Auth fetch ----
  function fetchAuth() {
    return new Promise((resolve) => {
      try {
        browser.runtime.sendMessage({ type: "AUTH_STATUS" }).then((r) => {
          const signed = !!r?.signedIn;
          window.__VG_SIGNED_IN_GLOBAL = signed;
          resolve(signed);
        });
      } catch (_e) {
        window.__VG_SIGNED_IN_GLOBAL = false;
        resolve(false);
      }
    });
  }

  // (composer wait helper no longer needed in boot)

  /* ---- Phase 10 helpers: live OFF/ON reaction ---- */
  function __vgTeardownHUD() {
    try {
      const frame = document.getElementById("__vg_iframe_hud__");
      if (frame) {
        // stop any watchers and drop sticky state
        try {
          frame.__VG_STICKY_CLEANUP__?.();
        } catch {}
        frame.__VG_STICKY_CLEANUP__ = null;
        frame.__VG_STICKY_HANDLERS__ = null;
        frame.__VG_LAST_P__ = null;
        frame.__VG_ANCHOR__ = null;
        frame.remove();
      }
    } catch {}
    try {
      window.__VG_DISABLED_BY_USER = true;
    } catch {}
  }

  async function __vgMountHUD() {
    try {
      window.__VG_DISABLED_BY_USER = false;
    } catch {}
    // If we already have a placement, place immediately; otherwise fetch then place
    if (window.__VG_DB_PLACEMENT) {
      await ensureHudLoaded();
      if (typeof window.__VG_PLACE_HUD__ === "function") {
        window.__VG_PLACE_HUD__(window.__VG_DB_PLACEMENT);
        return;
      }
    }
    await fetchAndApplyPlacement(); // fallback: pull placement and place
  }

  async function fetchAndApplyPlacement() {
    let host = location.hostname.toLowerCase().replace(/^www\./, "");
    let path = location.pathname || "/";
    try {
      if (
        /(^|\.)v0\.app$/i.test(location.hostname) &&
        window.top &&
        window.top !== window
      ) {
        host = String(window.top.location.hostname)
          .toLowerCase()
          .replace(/^www\./, "");
        path = window.top.location.pathname || "/";
      }
    } catch {}

    let rules = [];
    try {
      const ask = () =>
        new Promise((res) =>
          browser.runtime
            .sendMessage({ type: "VG_GET_PAGE_PLACEMENTS", host, path })
            .then(res)
        );

      let resp = await ask();
      if (!(resp && resp.ok && Array.isArray(resp.placements))) {
        await new Promise((r) => setTimeout(r, 200));
        resp = await ask();
      }
      rules =
        resp && resp.ok && Array.isArray(resp.placements)
          ? resp.placements
          : [];
    } catch (e) {
      console.warn("[VG] placement fetch failed:", e);
    }

    // DEBUG: show the first rule the page received (merged or not)
    try {
      if (typeof window !== "undefined" && Boolean(window.VG_INTENT_DEBUG)) {
        const first = Array.isArray(rules) ? rules[0] : null;
        console.debug("[CT][INIT_RULES]", {
          host,
          path,
          count: rules?.length ?? 0,
          first_dx: first?.dx,
          first_dy: first?.dy,
          first_corner: first?.anchor_corner,
          first_strat: first?.pick_strategy || first?.strategy,
        });
      }
    } catch {}

    const filtered = rules.filter((r) => {
      if (!r || r.enabled !== true) return false;
      const h = String(r.host || "")
        .toLowerCase()
        .replace(/^www\./, "")
        .trim();
      if (h !== host) return false;
      const pp = String(r.path_prefix ?? r.path ?? "/").trim() || "/";
      if (pp.includes("*")) {
        const regex = new RegExp("^" + pp.replace(/\*/g, "[^/]+"));
        return regex.test(path || "/");
      }
      return (path || "/").startsWith(pp);
    });

    filtered.sort((a, b) => {
      const al = String(a.path_prefix ?? a.path ?? "/").length;
      const bl = String(b.path_prefix ?? b.path ?? "/").length;
      if (al !== bl) return bl - al;
      const ar = Number.isFinite(+a.rank) ? +a.rank : 9999;
      const br = Number.isFinite(+b.rank) ? +b.rank : 9999;
      if (ar !== br) return ar - br;
      const at = new Date(a.updated_at || 0).getTime();
      const bt = new Date(b.updated_at || 0).getTime();
      return bt - at;
    });

    const pick = filtered[0] || null;

    if (!pick) {
      window.__VG_DB_PLACEMENT = undefined;
      return;
    }

    window.__VG_DB_PLACEMENT = {
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

    // DEBUG: confirm what we’re about to place on first paint
    if (typeof window !== "undefined" && Boolean(window.VG_INTENT_DEBUG)) {
      console.debug("[CT][INIT_PICKED]", {
        dx: window.__VG_DB_PLACEMENT.dx,
        dy: window.__VG_DB_PLACEMENT.dy,
        corner: window.__VG_DB_PLACEMENT.anchor_corner,
        strat: window.__VG_DB_PLACEMENT.strategy,
      });
    }

    await ensureHudLoaded();

    // ⛔️ Removed: re-initializing HUD here (causes auth/icon repaint flicker)
    // ⛔️ Removed: immediate iframe size reset (let HUD size during PAINT)

    if (typeof window.__VG_PLACE_HUD__ === "function") {
      window.__VG_PLACE_HUD__(window.__VG_DB_PLACEMENT);
    }
  }

  // ---- HUD init (runs once) ----
  const initHudOnce = once(async () => {
    await ensureHudLoaded(); // <— guarantee HUD functions exist
    killLegacyPill(); // <— remove/stub any legacy pill

    const signed = await fetchAuth();

    const ICON_IDLE = browser.runtime.getURL("assets/inactive-pill.svg");
    const ICON_ACTIVE = browser.runtime.getURL("assets/active-pill.svg");

    const tryInit = () => {
      if (typeof window.__VG_INIT_HUD__ === "function") {
        window.__VG_INIT_HUD__({
          iconIdle: ICON_IDLE,
          iconActive: ICON_ACTIVE,
          signedIn: !!signed,
        });
        return true;
      }
      return false;
    };

    if (!tryInit()) {
      let tries = 0;
      const tick = () => {
        if (tryInit()) return;
        if (tries++ < 50) setTimeout(tick, 100);
      };
      tick();
    }
  });

  // ---- Listen for pushed auth changes and repaint HUD only ----
  try {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type === "AUTH_STATUS_PUSH") {
        window.__VG_SIGNED_IN_GLOBAL = !!msg.signedIn;

        // Paint only (do not re-place HUD on auth change)
        const frame = document.getElementById("__vg_iframe_hud__");
        if (frame?.contentWindow) {
          const icons = frame.__VG_ICONS__ || {};
          frame.contentWindow.postMessage(
            {
              source: "VG",
              type: "PAINT_AUTH",
              signedIn: window.__VG_SIGNED_IN_GLOBAL,
              iconIdle:
                icons.iconIdle ||
                browser.runtime.getURL("assets/inactive-pill.svg"),
              iconActive:
                icons.iconActive ||
                browser.runtime.getURL("assets/active-pill.svg"),
            },
            "*"
          );
        }
      }
    });
  } catch (_e) {}

  // Re-handshake when tab becomes visible (covers missed broadcasts)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    fetchAuth()
      .then((signed) => {
        const frame = document.getElementById("__vg_iframe_hud__");
        if (!frame?.contentWindow) return;

        const icons = frame.__VG_ICONS__ || {};
        const iconIdle =
          icons.iconIdle || browser.runtime.getURL("assets/inactive-pill.svg");
        const iconActive =
          icons.iconActive || browser.runtime.getURL("assets/active-pill.svg");
        const size =
          Math.round(frame.getBoundingClientRect().width) ||
          Math.round(
            Number(
              (window.__VG_DB_PLACEMENT &&
                window.__VG_DB_PLACEMENT.pill_size) ||
                36
            )
          );

        try {
          frame.contentWindow.postMessage(
            {
              source: "VG",
              type: "PAINT_AUTH",
              signedIn: !!signed,
              size,
              pillSize: size,
              iconIdle,
              iconActive,
            },
            "*"
          );
        } catch {}
      })
      .catch(() => {});
  });

  // ---- Phase 10: live react to site-access changes (OFF/ON) ----
  try {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== "SITE_ACCESS_CHANGED") return;

      const pageHost = location.hostname.toLowerCase().replace(/^www\./, "");
      const msgHost = (msg.host || "").toLowerCase().replace(/^www\./, "");
      if (msgHost !== pageHost) return; // only react on same host

      if (msg.state === "off") {
        __vgTeardownHUD();
        return;
      }

      // state === 'on'
      __vgMountHUD();

      // Fallback: if the iframe didn't appear yet, nudge once more after DOM settles
      setTimeout(() => {
        if (!document.getElementById("__vg_iframe_hud__")) {
          // force a fresh fetch + place and re-subscribe for the current path
          try {
            window.__VG_DB_PLACEMENT = null;
          } catch {}
          fetchAndApplyPlacement()?.catch(() => {});
          try {
            const host = location.hostname.toLowerCase().replace(/^www\./, "");
            const path = location.pathname || "/";
            browser.runtime
              .sendMessage({ type: "VB_PLACEMENT_SUB", host, path })
              .then(() => {});
          } catch {}
        }
      }, 450);
    });
  } catch {}

  // Live placement updates → normalize + place (path-scoped)
  try {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== "VB_PLACEMENT_UPDATE") return;

      const hostNow = location.hostname.toLowerCase().replace(/^www\./, "");
      if ((msg.host || "").toLowerCase().replace(/^www\./, "") !== hostNow)
        return;

      const pick = msg.placement;
      if (!pick) return;

      // Normalize exactly what HUD expects
      window.__VG_DB_PLACEMENT = {
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

      // DEBUG: confirm the values applied on live update
      console.debug("[CT][VB_UPDATE]", {
        dx: window.__VG_DB_PLACEMENT.dx,
        dy: window.__VG_DB_PLACEMENT.dy,
        corner: window.__VG_DB_PLACEMENT.anchor_corner,
        strat: window.__VG_DB_PLACEMENT.strategy,
      });

      if (typeof window.__VG_PLACE_HUD__ === "function") {
        window.__VG_PLACE_HUD__(window.__VG_DB_PLACEMENT);
      }
    });
  } catch {}

  // ---- SPA route-change watcher (pushState/replaceState/popstate/hashchange + fallback) ----
  function __vgInstallRouteWatcher(onChange) {
    // avoid double-install if the file gets reloaded
    if (window.__VG_ROUTE_WATCH_INSTALLED__) return;
    window.__VG_ROUTE_WATCH_INSTALLED__ = true;

    let last = location.href;

    const fire = () => {
      const now = location.href;
      if (now === last) return;
      last = now;
      try {
        window.dispatchEvent(
          new CustomEvent("VG_ROUTE_CHANGE", { detail: { href: now } })
        );
      } catch {}
      try {
        onChange?.();
      } catch {}
    };

    const _ps = history.pushState;
    const _rs = history.replaceState;

    try {
      history.pushState = function (...a) {
        const r = _ps.apply(this, a);
        fire();
        return r;
      };
      history.replaceState = function (...a) {
        const r = _rs.apply(this, a);
        fire();
        return r;
      };
    } catch {}
    window.addEventListener("popstate", fire, { passive: true });
    window.addEventListener("hashchange", fire, { passive: true });

    // Fallback: some routers don’t surface anything reliably
    setInterval(fire, 500);
  }

  async function __vgOnRouteChange() {
    try {
      const frame = document.getElementById("__vg_iframe_hud__");
      if (frame) {
        // stop any watchers and drop sticky state
        try {
          frame.__VG_STICKY_CLEANUP__?.();
        } catch {}
        frame.__VG_STICKY_CLEANUP__ = null;
        frame.__VG_STICKY_HANDLERS__ = null;
        frame.__VG_LAST_P__ = null;
        frame.__VG_ANCHOR__ = null;

        // Hide immediately during transition
        if (frame.style.display !== "none") frame.style.display = "none";

        // Set a one-shot lock so HUD won't reveal until first successful placement
        frame.__VG_ROUTE_LOCK__ = true;
      }
    } catch {}

    // drop stale DB placement and re-pull for the new path
    window.__VG_DB_PLACEMENT = null;
    await fetchAndApplyPlacement();

    // Re-subscribe for the NEW path (keeps rows path-specific: home vs projects)
    try {
      const host = location.hostname.toLowerCase().replace(/^www\./, "");
      const path = location.pathname || "/";
      browser.runtime
        .sendMessage({ type: "VB_PLACEMENT_SUB", host, path })
        .then(() => {});
    } catch {}
  }

  // ---- Boot sequence ----
  (async function boot() {
    await initHudOnce(); // 1) iframe HUD up with correct auth + icons
    await fetchAndApplyPlacement(); // 2) DB placement applied

    // 3) Ensure Enhance underline skeleton is mounted (safe no-op if already active)
    try {
      await import(browser.runtime.getURL("src/content/enhance/index.js"));
      if (typeof window !== "undefined" && window.VG_INTENT_DEBUG) {
        console.debug("[VG] enhance underline ready (boot)");
      }
    } catch (e) {
      console.error("[VG] enhance underline failed (boot)", e);
    }

    // 3.5) Ensure global send interceptors are active (key bindings + capture)
    try {
      await import(browser.runtime.getURL("src/interceptsend.js"));
      if (typeof window !== "undefined" && window.VG_INTENT_DEBUG) {
        console.debug("[VG] interceptsend ready (boot)");
      }
    } catch (e) {
      console.error("[VG] interceptsend failed (boot)", e);
    }

    // Start live placement subscription for *this* host+path (path-scoped; safe on all sites)
    try {
      const host = location.hostname.toLowerCase().replace(/^www\./, "");
      const path = location.pathname || "/";
      browser.runtime
        .sendMessage({ type: "VB_PLACEMENT_SUB", host, path })
        .then(() => {});
    } catch {}

    // 4) NEW: treat SPA route changes like page loads
    __vgInstallRouteWatcher(__vgOnRouteChange);
    window.addEventListener("VG_ROUTE_CHANGE", __vgOnRouteChange, {
      passive: true,
    });
  })();

  // ← this closes the OUTER IIFE
})();
