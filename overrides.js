// VibeGuardian v6.4.x — overrides.js
// Text-only patcher for modal labels/copy. Safe no-op outside allowed sites.

(() => {
  // ===== Gate: decide if overrides should run on this page =====
  function decideAllowed() {
    // If content.js already decided, respect it.
    if (typeof window !== "undefined" && typeof window.__VG_ALLOWED__ === "boolean") {
      return window.__VG_ALLOWED__;
    }

    // Belt & suspenders: compute locally (in case load order flips)
    const ALLOWLIST = [
 	 { host: "lovable.dev" },
 	 { host: "replit.com" },
 	 { host: "bolt.new" },
 	 { host: "cursor.so" },
	  { host: "cursor.com" },  
	  { host: "codeium.com" },
	  { host: "sourcegraph.com" },
	  { host: "windsurf.ai" },
	  { host: "mutable.ai" },
	  { host: "aider.chat" },	
	  { host: "tabnine.com" },
	  { host: "base44.com" },
	  { host: "v0.dev" },
	  { host: "v0.app" },                              // ← add this
	  { host: "vercel.com", pathStartsWith: "/v0/" },
	  { host: "github.com", pathStartsWith: "/copilot-workspace/" },
	  { host: "githubnext.com" }
	];


    if (window.top !== window.self) return false; // skip iframes

    const h = location.hostname.toLowerCase();
    const p = location.pathname;

    const hostMatches = (allowedHost, currentHost) =>
      currentHost === allowedHost || currentHost.endsWith("." + allowedHost);

    return ALLOWLIST.some(({ host, pathStartsWith }) => {
      if (!hostMatches(host, h)) return false;
      if (pathStartsWith && !p.startsWith(pathStartsWith)) return false;
      return true;
    });
  }

  const ALLOWED = decideAllowed();
  // Mirror to window so later files can read a definitive value.
  try { window.__VG_ALLOWED__ = ALLOWED; } catch (_) {}

  if (!ALLOWED) {
    console.debug("[VG overrides] Not active here.");
    return; // hard no-op
  }

  // ===== Your existing overrides logic (unchanged) =====
  const HOST_ID = "vibeguardian-modal-host"; // APP+"-modal-host" from content.js
  const TITLE_TEXT = "Vibe Guardian";
  const BANNER_REPLACE = "Chat with Vibe Guardian Bot";
  const SECTION_TITLE = "Prompt Guards";
  const SECTION_SUB = "Select options to auto add guards to your vibe code prompt.";
  const TABLE_FIRST_TH = "Guards";

  function rewriteModalCopy() {
    try {
      const host = document.getElementById(HOST_ID);
      if (!host || !host.shadowRoot) return false;
      const $ = (sel) => host.shadowRoot.querySelector(sel);

      // Header title (preserve version span)
      const titleEl = $(".title");
      if (titleEl) {
        const ver = titleEl.querySelector(".ver");
        titleEl.textContent = TITLE_TEXT + " ";
        if (ver) titleEl.appendChild(ver);
      }

      // Banner
      const banner = $(".banner");
      if (banner) banner.innerHTML = banner.innerHTML.replace(/Chat with[^<]+/i, BANNER_REPLACE);

      // Section header + subheader
      const topRow = host.shadowRoot.querySelector(".card .toprow");
      if (topRow) {
        const hdr = topRow.querySelector("div > div[style*='font-weight']");
        if (hdr) hdr.textContent = SECTION_TITLE;
        const sub = topRow.querySelector(".muted");
        if (sub) sub.textContent = SECTION_SUB;
      }

      // Table "Protection" -> "Guards"
      const ths = host.shadowRoot.querySelectorAll("table thead th");
      if (ths && ths.length > 0) ths[0].textContent = TABLE_FIRST_TH;

      return true;
    } catch (_) {
      return false;
    }
  }

  function wrapOpener() {
    try {
      const orig = window.__SB_OPEN_MODAL;
      if (typeof orig === "function" && !orig.__vg_wrapped) {
        const wrapped = function () {
          const res = orig.apply(this, arguments);
          let tries = 0;
          const tick = setInterval(() => {
            tries++;
            if (rewriteModalCopy() || tries > 15) clearInterval(tick);
          }, 50);
          return res;
        };
        wrapped.__vg_wrapped = true;
        Object.defineProperty(window, "__SB_OPEN_MODAL", {
          configurable: true,
          enumerable: false,
          writable: false,
          value: wrapped
        });
      }
    } catch (_) {}
  }

  function bindEventListener() {
    document.addEventListener("SB_OPEN_MODAL", () => {
      let tries = 0;
      const tick = setInterval(() => {
        tries++;
        if (rewriteModalCopy() || tries > 15) clearInterval(tick);
      }, 50);
    });
  }

  function opportunisticRewrite() {
    let tries = 0;
    const tick = setInterval(() => {
      tries++;
      if (rewriteModalCopy() || tries > 10) clearInterval(tick);
    }, 100);
    setTimeout(() => clearInterval(tick), 2000);
  }

  // Boot
  wrapOpener();
  bindEventListener();
  opportunisticRewrite();

  // Also try wrapping later if base script loads after us
  const again = setInterval(wrapOpener, 300);
  setTimeout(() => clearInterval(again), 5000);
})();
