// src/ui/paywall.js — Shadow-DOM modal with dynamic tier/limit copy

const PRICE_BASIC = "price_1RyYJuCKsHaxtGkUiLlRAAd3";
const PRICE_PRO = "price_1RyYMaCKsHaxtGkUMaScJLZS";

const PLAN_LIMITS = { free: 1, basic: 3, pro: Infinity };

function prettyLimit(n) {
  return n === Infinity ? "∞" : String(n);
}
function normTier(t) {
  return String(t || "free").toLowerCase();
}
function isCGReason(r) {
  return String(r || "") === "custom_guard_limit";
}

// ---- Checkout helpers (unchanged) ----
async function startCheckoutByPlan(plan) {
  if (window.__VGBilling?.checkout) return window.__VGBilling.checkout(plan);
  const price_id = plan === "pro" ? PRICE_PRO : PRICE_BASIC;
  try {
    const {
      data: { session },
    } = await (window.VG?.auth?.getSession?.() ?? { data: { session: null } });
    if (!session?.access_token) throw new Error("Not signed in");
    const url =
      "https://auudkltdkakpnmpmddaj.supabase.co/functions/v1/create-checkout-session";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ price_id }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j?.url) throw new Error("Checkout failed");
    window.open(j.url, "_blank");
  } catch (e) {
    console.warn("[VG][paywall] checkout fallback failed:", e);
    alert("Could not start checkout. Please open Settings → Billing.");
  }
}

// Mini DOM utils
function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "style") n.style.cssText = v;
    else n.setAttribute(k, v);
  });
  children.forEach((c) => n.appendChild(c));
  return n;
}

// Plan feature cards (unchanged UI)
const FEATURES = {
  basic: {
    title: "Basic",
    price: "$4.99/mo",
    bullets: ["Up to 3 Custom Prompts", "Up to 3 Quick Adds"],
    footnote: "Cancel anytime.",
  },
  pro: {
    title: "Pro",
    price: "$9.99/mo",
    popular: true,
    bullets: ["Unlimited Custom Prompts", "Unlimited Quick Adds"],
    footnote: "Best for active builders.",
  },
};

function checkSVG() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", "16");
  s.setAttribute("height", "16");
  s.innerHTML =
    '<path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}

function planCard(kind, { locked = false } = {}) {
  const spec = FEATURES[kind];
  const card = el("div", {
    class: `plan ${kind}` + (spec.popular ? " popular" : ""),
  });

  if (spec.popular) {
    card.appendChild(el("div", { class: "badge", text: "Most popular" }));
  }

  const hdr = el("div", { class: "hdr" });
  hdr.append(
    el("div", { class: "name", text: spec.title }),
    el("div", { class: "price", text: spec.price })
  );
  card.appendChild(hdr);

  const bl = el("div", { class: "bullets" });
  spec.bullets.forEach((t) => {
    const row = el("div", { class: "bullet" });
    row.append(checkSVG(), el("div", { text: t }));
    bl.appendChild(row);
  });
  card.appendChild(bl);

  if (spec.footnote)
    card.appendChild(el("div", { class: "foot", text: spec.footnote }));

  const btnLabel = locked
    ? kind === "basic"
      ? "Current plan"
      : "Get Pro"
    : kind === "pro"
    ? "Get Pro"
    : "Get Basic";

  const planBtn = el("button", {
    class: "planBtn",
    type: "button",
    text: btnLabel,
  });
  if (locked) {
    planBtn.disabled = true;
    planBtn.setAttribute("aria-disabled", "true");
    planBtn.classList.add("locked");
  } else {
    planBtn.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        window.__VG?.log?.("paywall_click_" + kind);
      } catch {}
      startCheckoutByPlan(kind);
    });
  }
  card.appendChild(planBtn);
  return card;
}

// ---------- Resolve plan & usage from BG (SoT) ----------
async function resolvePlanAndUsage(opts = {}) {
  const reason = String(opts.reason || "");
  let tier = null,
    used = 0,
    quick = 0,
    limit = 1;

  try {
    const resp = await new Promise((res) => {
      try {
        browser.runtime
          .sendMessage({ type: "VG_ACCOUNT_SUMMARY" })
          .then((r) => res(r));
      } catch {
        res(null);
      }
    });
    if (resp?.ok && resp.summary) {
      tier = normTier(resp.summary.tier);
      used = Number(resp.summary.used || 0);
      quick = Number(resp.summary.quick || 0);
      limit =
        resp.summary.limit === Infinity
          ? Infinity
          : Number(resp.summary.limit || 1);
    }
  } catch (e) {
    console.warn("[VG][paywall] BG summary fetch failed", e);
  }

  // Respect explicit tier override if provided
  if (!tier) tier = normTier(opts.tier || "free");

  return { tier, used, quick, limit, reason };
}

// ---------- Plain-DOM fallback (usage always shown as limit/limit) ----------
async function showPlainFallback(opts = {}) {
  try {
    console.warn("[VG][paywall] using plain-DOM fallback");
    document.getElementById("vg-paywall-fallback")?.remove();

    const { tier, used, quick, limit, reason } = await resolvePlanAndUsage(
      opts
    );
    const isCG = isCGReason(reason);

    const titleHTML = isCG
      ? "You’ve hit your Custom Prompts limit"
      : "You’ve hit your Quick Adds limit";

    const noteHTML = isCG
      ? `Your current plan <b>${
          tier.charAt(0).toUpperCase() + tier.slice(1)
        }</b> allows up to <b>${prettyLimit(limit)}</b> unique custom prompts.`
      : `Your current plan <b>${
          tier.charAt(0).toUpperCase() + tier.slice(1)
        }</b> allows up to <b>${prettyLimit(limit)}</b> unique quick adds.`;

    const root = document.body || document.documentElement;
    const host = el("div", { id: "vg-paywall-fallback" }, []);
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)";
    root.appendChild(host);

    const card = el("div", {}, []);
    card.style.cssText =
      'width:min(860px,96vw);border-radius:14px;background:#0f1116;color:#e5e7eb;border:1px solid #2a2a33;box-shadow:0 40px 120px rgba(0,0,0,.6);overflow:hidden;font:13px/1.45 Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
    host.appendChild(card);

    const hdr = el("div", {}, []);
    hdr.style.cssText =
      "display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #242634;background:#14151d";
    const ic = el("img", { alt: "Viberly" }, []);
    ic.src = browser.runtime.getURL("assets/Viberly-transparent.svg");
    ic.style.cssText = "width:22px;height:22px";
    const x = el("div", { text: "✕", "aria-label": "Close" }, []);
    x.style.cssText =
      "margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#1f1f26;color:#cbd5e1;cursor:pointer";
    x.onclick = () => {
      try {
        host.remove();
      } catch {}
    };
    hdr.append(ic, x);
    card.appendChild(hdr);

    const body = el("div", {}, []);
    body.style.cssText =
      "padding:14px 16px;display:flex;flex-direction:column;gap:12px";
    body.appendChild(
      el("div", {
        html: `<div style="font-weight:700;font-size:16px">${titleHTML}</div>`,
      })
    );
    body.appendChild(el("div", { html: noteHTML, style: "color:#a1a1aa" }));

    const note = el("div", {}, []);
    note.style.cssText =
      "border:1px solid #2a2a33;border-radius:10px;background:#0c0e13;padding:10px 12px";
    const usedVal = isCG ? opts.used ?? 0 : opts.quick ?? 0;
    note.appendChild(
      el("div", {
        text: `Usage: ${prettyLimit(usedVal)} / ${prettyLimit(limit)}`,
        style: "color:#a1a1aa",
      })
    );

    note.appendChild(
      el("div", {
        html: "To continue, choose a plan below.",
        style: "margin-top:6px",
      })
    );
    body.appendChild(note);
    card.appendChild(body);

    const ftr = el("div", {}, []);
    ftr.style.cssText =
      "display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid #242634;background:#0f1116";
    const left = el("div", {}, []);
    left.style.cssText = "display:flex;gap:10px;align-items:center";
    const right = el("div", {}, []);
    right.style.cssText = "display:flex;gap:10px;align-items:center";
    const later = el("button", { text: "Not now", type: "button" }, []);
    later.style.cssText =
      "padding:10px 14px;border-radius:10px;cursor:pointer;font-weight:600;border:1px solid #2a2a33;background:#1f1f26;color:#e5e7eb";
    later.onclick = () => {
      try {
        host.remove();
      } catch {}
    };

    const onBasic = tier === "basic";
    const basic = el("button", {
      text: onBasic ? "Current plan" : "Upgrade – Basic ($4.99/mo)",
      type: "button",
    });
    basic.style.cssText =
      "padding:10px 14px;border-radius:10px;cursor:pointer;font-weight:600;border:1px solid #2a2a33;background:transparent;color:#e5e7eb";
    if (onBasic) {
      basic.disabled = true;
      basic.style.opacity = ".55";
      basic.style.cursor = "not-allowed";
    } else {
      basic.onclick = (e) => {
        e.preventDefault();
        startCheckoutByPlan("basic");
      };
    }

    const pro = el("button", {
      text: "Upgrade – Pro ($9.99/mo)",
      type: "button",
    });
    pro.style.cssText =
      "padding:10px 14px;border-radius:10px;cursor:pointer;font-weight:600;border:0;background:#7c3aed;color:#fff";
    pro.onclick = (e) => {
      e.preventDefault();
      startCheckoutByPlan("pro");
    };

    left.appendChild(later);
    right.append(basic, pro);
    ftr.append(left, right);
    card.appendChild(ftr);

    host.addEventListener("click", (ev) => {
      if (ev.target === host) {
        try {
          host.remove();
        } catch {}
      }
    });
  } catch (e) {
    console.warn("[VG][paywall] plain fallback failed:", e);
  }
}

// ---------- Shadow-DOM renderer (usage always shown as limit/limit) ----------
export async function show(opts = {}) {
  try {
    console.log("[VG][paywall] show() start", opts);

    const { tier, used, quick, limit, reason } = await resolvePlanAndUsage(
      opts
    );
    const isCG = isCGReason(reason);

    const titleHTML = isCG
      ? "You’ve hit your Custom Prompts limit"
      : "You’ve hit your Quick Adds limit";

    const noteHTML = isCG
      ? `Your current plan <b>${
          tier.charAt(0).toUpperCase() + tier.slice(1)
        }</b> allows up to <b>${prettyLimit(limit)}</b> unique custom prompts.`
      : `Your current plan <b>${
          tier.charAt(0).toUpperCase() + tier.slice(1)
        }</b> allows up to <b>${prettyLimit(limit)}</b> unique quick adds.`;

    // Clean previous
    try {
      document.getElementById("vg-paywall-host")?.remove();
    } catch {}

    const root = document.body || document.documentElement;
    if (!root) throw new Error("No document root to mount paywall");

    const host = el("div", { id: "vg-paywall-host" });
    root.appendChild(host);
    console.log("[VG][paywall] host append OK");

    const sh = host.attachShadow({ mode: "open" });
    console.log("[VG][paywall] shadow attached");

    const css = `
      .overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}
      .modal{width:min(645px,72vw);height:auto;border-radius:14px;background:#0f1116;color:#e5e7eb;border:1px solid #2a2a33;box-shadow:0 40px 120px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column;font:13px/1.45 Inter,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
      .header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #242634;background:#14151d}
      .title{font-weight:600;font-size:15px}
      .close{margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#1f1f26;color:#cbd5e1;cursor:pointer}
      .close:hover{background:#2a2a33}
      .icon{height:30px;width:auto;flex:0 0 auto}
      .body{padding:14px 16px;display:flex;flex-direction:column;gap:12px}
      .note{border:1px solid #2a2a33;border-radius:10px;background:#0c0e13;padding:10px 12px}
      .muted{color:#a1a1aa}
      .plans{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:6px}
      @media (max-width:560px){ .plans{grid-template-columns:1fr} }
      .plan{border:1px solid #2a2a33;background:#0c0e13;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;position:relative}
      .plan.popular{ border-color:#7c3aed; box-shadow:0 0 0 1px rgba(124,58,237,.35) inset; transform:translateY(-1px) }
      .plan .hdr{display:flex;align-items:baseline;gap:8px}
      .plan .hdr .name{font-weight:700;font-size:14px}
      .plan .hdr .price{color:#cbd5e1;font-weight:600}
     
	.badge.current {
	  background:#444;   /* gray background */
	  color:#fff;        /* white text */
	  font-weight:600;
	}



      .bullets{display:flex;flex-direction:column;gap:8px}
      .bullet{display:flex;gap:8px;align-items:flex-start;color:#e5e7eb}
      .bullet svg{color:#7c3aed;flex:0 0 auto;margin-top:2px}
      .foot{color:#a1a1aa;font-size:12px}
      .planBtn{margin-top:8px;display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:10px;cursor:pointer;font-weight:700;width:100%}
      .plan.basic .planBtn{background:#2a2a33;color:#e5e7eb;border:1px solid #2a2a33}
      .plan.basic .planBtn:hover{background:#7c3aed;border-color:#7c3aed;color:#fff}
      .plan.pro .planBtn{background:#7c3aed;color:#fff;border:0}
      .plan.pro .planBtn:hover{filter:brightness(1.07)}
      .planBtn[disabled], .planBtn.locked{opacity:.55;cursor:not-allowed;filter:none !important;pointer-events:none}
    `;
    sh.appendChild(el("style", { text: css }));

    // Overlay + modal
    const overlay = el("div", { class: "overlay", id: "ov" });
    const modal = el("div", {
      class: "modal",
      id: "md",
      tabindex: "-1",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "Paywall",
    });

    // Header
    const header = el("div", { class: "header" });
    const icon = el("img", { class: "icon", id: "ic", alt: "Viberly" });
    icon.src = browser.runtime.getURL("assets/Viberly-transparent.svg");
    const closeX = el("div", { class: "close", text: "✕", id: "x" });
    header.append(icon, closeX);

    // Body
    const body = el("div", { class: "body" });
    body.appendChild(
      el("div", {
        html: `<div style="font-weight:700;font-size:16px">${titleHTML}</div>`,
      })
    );
    body.appendChild(el("div", { class: "muted", html: noteHTML }));

    const note = el("div", { class: "note" });
    const usedVal = isCG ? used : quick;
    note.appendChild(
      el("div", {
        class: "muted",
        text: `Usage: ${prettyLimit(usedVal)} / ${prettyLimit(limit)}`,
      })
    );

    note.appendChild(
      el("div", {
        html: "To continue, choose a plan below.",
        style: "margin-top:6px",
      })
    );
    body.appendChild(note);

    const plans = el("div", { class: "plans" });
    const lockBasic = tier === "basic";
    plans.appendChild(planCard("basic", { locked: lockBasic }));
    plans.appendChild(planCard("pro", { locked: false }));
    body.appendChild(plans);

    modal.append(header, body);
    overlay.appendChild(modal);
    sh.appendChild(overlay);

    // Make visible + stick
    overlay.style.display = "flex";
    overlay.style.opacity = "1";
    overlay.style.zIndex = "2147483647";
    modal.style.display = "block";
    modal.style.opacity = "1";

    const enforceVisible = () => {
      overlay.style.display = "flex";
      overlay.style.opacity = "1";
      overlay.style.zIndex = "2147483647";
      modal.style.display = "block";
      modal.style.opacity = "1";
    };
    enforceVisible();
    requestAnimationFrame(enforceVisible);
    setTimeout(enforceVisible, 0);
    setTimeout(enforceVisible, 120);

    // Auto-fallback if hidden
    setTimeout(async () => {
      const r = overlay.getBoundingClientRect();
      const hidden =
        !r ||
        r.width === 0 ||
        r.height === 0 ||
        getComputedStyle(overlay).display === "none";
      if (hidden) {
        try {
          host.remove();
        } catch {}
        showPlainFallback({ tier, limit, reason });
      }
    }, 80);

    // Close handlers
    const close = () => {
      try {
        host.remove();
      } catch {}
    };
    closeX.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    try {
      modal && typeof modal.focus === "function" && modal.focus();
    } catch {}

    sh.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      },
      true
    );
    document.addEventListener(
      "keydown",
      function esc(e) {
        if (e.key === "Escape") {
          close();
          document.removeEventListener("keydown", esc, true);
        }
      },
      true
    );

    try {
      window.__VG?.log?.("paywall_shown", { reason, tier });
    } catch {}
    console.log("[VG][paywall] handlers wired (done)");
  } catch (err) {
    console.warn("[VG][paywall] render failed:", err);
    showPlainFallback(opts);
  }
}

// Export + global shim
try {
  window.VGPaywall = Object.assign(window.VGPaywall || {}, { show });
} catch {}
try {
  window.VGPaywall || (window.VGPaywall = { show });
} catch {}
export default { show };
