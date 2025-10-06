// src/ui/bug-buster.js
(() => {
  if (window.openBugBusterFlow) return; // idempotent

  // Turn Bug Buster off without deleting anything.
  const BUG_BUSTER_DISABLED = true;

  // ---------- tiny utils ----------
  const sendBG = (msg) =>
    new Promise((res) => {
      try {
        browser.runtime.sendMessage(msg).then((r) => res(r));
      } catch {
        res({ ok: false, error: "bridge error" });
      }
    });

  const siteHost = () => location.host;

  // Lightweight, safe collector for last N visible messages on page
  async function collectLastMessages(n = 10) {
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    let nodes = [];
    try {
      const sel = `
        [data-message-role],
        [data-testid="message"],
        .chat-message, .message, .msg, .bubble,
        article, .prose, [class*="prose"], [class*="markdown"]
      `;
      nodes = Array.from(document.querySelectorAll(sel));
      if (!nodes.length)
        nodes = Array.from(document.querySelectorAll("p,li,pre,blockquote"));
    } catch {}
    const out = [];
    for (const el of nodes.slice(-250)) {
      const txt = norm(el.innerText || el.textContent || "");
      if (!txt || txt.length < 16) continue;
      const roleAttr = (
        el.getAttribute?.("data-message-role") || ""
      ).toLowerCase();
      const role = roleAttr.includes("assistant")
        ? "assistant"
        : roleAttr.includes("user")
        ? "user"
        : (el.className || "").toLowerCase().includes("assistant")
        ? "assistant"
        : "user";
      out.push({ role, text: txt.slice(0, 4000) });
      if (out.length >= n) break;
    }
    return out.slice(-n);
  }

  // ---------- Analyzing (spinner) modal ----------
  let __BB_WAIT_HOST = null;

  function bbOpenAnalyzingModal() {
    if (__BB_WAIT_HOST) return __BB_WAIT_HOST;

    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: 2147483647,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,.55)",
    });

    const box = document.createElement("div");
    box.style.cssText = `
      width:min(560px,92vw);
      background:#0f1116; color:#e5e7eb;
      border:1px solid #242634; border-radius:16px;
      box-shadow:0 40px 100px rgba(0,0,0,.6);
      overflow:hidden;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    `;
    box.innerHTML = `
      <style>
        .bb-h{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;
              padding:14px 18px;background:#0f1116;border-bottom:1px solid #1f2230}
        .bb-title{font-weight:600;font-size:14px}
        .bb-x{background:#171a22;border:1px solid #2a2d39;border-radius:8px;padding:6px 10px;color:#cbd5e1;cursor:pointer}
        .bb-body{min-height:160px;display:flex;align-items:center;justify-content:center;padding:28px 22px}
        .center{display:flex;gap:12px;align-items:center;justify-content:center}
        .spin{width:18px;height:18px;border-radius:50%;border:2px solid #7c3aed;border-top-color:transparent;animation:vgspin .8s linear infinite}
        @keyframes vgspin{to{transform:rotate(360deg)}}
        .msg{font:600 14px/1.4 Inter, system-ui;color:#e5e7eb}
        .bb-f{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-top:1px solid #1f1f26;background:#0f1116}
        .btn{border:0;border-radius:10px;padding:10px 16px;font:600 13px/1 Inter, system-ui;cursor:pointer}
        .ghost{background:#171a22;color:#cbd5e1;border:1px solid #2a2d39}
        .primary{background:#7c3aed;color:#fff}
        .busy{opacity:.7;pointer-events:none}
      </style>
      <div class="bb-h">
        <div class="bb-title">Bug Buster</div>
        <button id="bb-x" class="bb-x" type="button">✕</button>
      </div>
      <div class="bb-body">
        <div class="center">
          <div class="spin"></div>
          <div id="bb-msg" class="msg">Analyzing the last 10 messages…</div>
        </div>
      </div>
      <div class="bb-f">
        <button id="bb-cancel" class="btn ghost" type="button">Cancel</button>
        <button id="bb-retry" class="btn primary" type="button">Retry</button>
      </div>
    `;
    host.appendChild(box);
    document.body.appendChild(host);
    __BB_WAIT_HOST = host;

    box
      .querySelector("#bb-x")
      ?.addEventListener("click", bbCloseAnalyzingModal);
    box
      .querySelector("#bb-cancel")
      ?.addEventListener("click", bbCloseAnalyzingModal);
    return host;
  }

  function bbSetAnalyzingMessage(text) {
    const el = __BB_WAIT_HOST?.querySelector("#bb-msg");
    if (el) el.textContent = text;
  }
  function bbSetRetryBusy(on) {
    const btn = __BB_WAIT_HOST?.querySelector("#bb-retry");
    if (btn) {
      btn.classList.toggle("busy", !!on);
      btn.textContent = on ? "Working…" : "Retry";
    }
  }
  function bbCloseAnalyzingModal() {
    try {
      __BB_WAIT_HOST?.remove();
    } catch {}
    __BB_WAIT_HOST = null;
  }

  // ---------- Coming soon modal ----------
  let __BB_SOON_HOST = null;

  function bbCloseComingSoonModal() {
    try {
      __BB_SOON_HOST?.remove();
    } catch {}
    __BB_SOON_HOST = null;
  }

  function bbOpenComingSoonModal() {
    if (__BB_SOON_HOST) return __BB_SOON_HOST;

    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: 2147483647,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,.55)",
    });

    const box = document.createElement("div");
    box.style.cssText = `
      width:min(560px,92vw);
      background:#0f1116; color:#e5e7eb;
      border:1px solid #242634; border-radius:16px;
      box-shadow:0 40px 100px rgba(0,0,0,.6);
      overflow:hidden;
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    `;
    box.innerHTML = `
      <style>
        .h{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;
           padding:14px 18px;background:#0f1116;border-bottom:1px solid #1f2230}
        .t{font-weight:600;font-size:14px}
        .x{background:#171a22;border:1px solid #2a2d39;border-radius:8px;padding:6px 10px;color:#cbd5e1;cursor:pointer}
        .b{min-height:140px;display:flex;align-items:center;justify-content:center;padding:28px 22px}
        .msg{font:600 15px/1.5 Inter, system-ui;color:#e5e7eb; text-align:center}
        .f{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid #1f1f26;background:#0f1116}
        .btn{background:#7c3aed;border:0;border-radius:10px;padding:10px 16px;color:#fff;font-weight:600;font-size:13px;cursor:pointer}
      </style>
      <div class="h">
        <div class="t">Bug Buster</div>
        <button id="bb-soon-x" class="x" type="button">✕</button>
      </div>
      <div class="b">
        <div class="msg">Coming soon.</div>
      </div>
      <div class="f">
        <button id="bb-soon-close" class="btn" type="button">Close</button>
      </div>
    `;

    host.appendChild(box);
    document.body.appendChild(host);
    __BB_SOON_HOST = host;

    const close = () => bbCloseComingSoonModal();
    box.querySelector("#bb-soon-x")?.addEventListener("click", close);
    box.querySelector("#bb-soon-close")?.addEventListener("click", close);
    host.addEventListener("click", (e) => {
      if (e.target === host) close();
    });

    // Esc to close
    const onEsc = (e) => {
      if (e.key === "Escape") {
        close();
        window.removeEventListener("keydown", onEsc, true);
      }
    };
    window.addEventListener("keydown", onEsc, true);

    return host;
  }

  // ---------- Intake modal (prefilled summary) ----------
  let __BB_INTAKE_HOST = null;

  function openBugBusterModal(prefilledSummary = "") {
    if (__BB_INTAKE_HOST) return;

    const host = document.createElement("div");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: 2147483646,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,.55)",
    });
    host.addEventListener("click", (e) => {
      if (e.target === host) closeBugBusterModal();
    });
    document.body.appendChild(host);
    __BB_INTAKE_HOST = host;

    const box = document.createElement("div");
    box.style.cssText = `
      width:min(920px,94vw); max-height:86vh; overflow:auto;
      background:#0f1116; color:#e5e7eb;
      border:1px solid #242634; border-radius:16px;
      box-shadow:0 40px 100px rgba(0,0,0,.6);
      font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    `;
    box.innerHTML = `
      <style>
        .h{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;
           padding:14px 18px;background:#0f1116;border-bottom:1px solid #1f2230}
        .t{font-weight:600;font-size:14px}
        .x{background:#171a22;border:1px solid #2a2d39;border-radius:8px;padding:6px 10px;color:#cbd5e1;cursor:pointer}
        .b{padding:16px 18px;display:grid;gap:14px}
        .lbl{font-weight:600;font-size:13px}
        .box{white-space:pre-wrap;font-size:13px;line-height:1.5;background:#12151d;border:1px solid #232634;border-radius:12px;padding:12px;min-height:56px}
        .ta{resize:vertical;min-height:80px;background:#0f1116;color:#e5e7eb;border:1px solid #232634;border-radius:12px;padding:10px;font-size:13px;line-height:1.4}
        .f{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid #1f1f26}
        .btn{background:#7c3aed;border:0;border-radius:10px;padding:10px 16px;color:#fff;font-weight:600;font-size:13px;cursor:pointer}
        .ghost{background:#171a22;color:#cbd5e1;border:1px solid #2a2d39}
      </style>
      <div class="h">
        <div class="t">Bug Buster</div>
        <button id="bb-i-x" class="x" type="button">✕</button>
      </div>
      <div class="b">
        <div class="lbl">Chat intro</div>
        <div id="bb-sum" class="box"></div>
        <label class="lbl" for="bb-add">Anything to add?</label>
        <textarea id="bb-add" class="ta" placeholder="Optional context…"></textarea>
      </div>
      <div class="f">
        <button id="bb-i-cancel" class="btn ghost" type="button">Cancel</button>
        <button id="bb-i-start" class="btn" type="button">Start</button>
      </div>
    `;
    host.replaceChildren(box);

    box.querySelector("#bb-sum").textContent =
      prefilledSummary || "No summary.";
    box.querySelector("#bb-i-x").onclick = closeBugBusterModal;
    box.querySelector("#bb-i-cancel").onclick = closeBugBusterModal;

    // “Start” here is a placeholder hook: persist a simple record if desired.
    box.querySelector("#bb-i-start").onclick = () => {
      // You can wire this to open AI Chat or store a session shell if needed.
      closeBugBusterModal();
      alert(
        "Bug Buster started. (Hook this to your next step, e.g., open AI Chat.)"
      );
    };
  }

  function closeBugBusterModal() {
    try {
      __BB_INTAKE_HOST?.remove();
    } catch {}
    __BB_INTAKE_HOST = null;
  }

  // ---------- Public flow ----------
  window.openBugBusterFlow = async function openBugBusterFlow() {
    // Feature flag: show Coming Soon and exit early — no network calls, no spinner.
    if (BUG_BUSTER_DISABLED) {
      bbOpenComingSoonModal();
      return;
    }

    // --- ORIGINAL FLOW (left intact for when you re-enable) ---
    // Show analyzing immediately
    bbOpenAnalyzingModal();

    // Wire Retry inside the analyzing modal
    const retryBtn = __BB_WAIT_HOST?.querySelector("#bb-retry");
    if (retryBtn && !retryBtn.__wired) {
      retryBtn.__wired = true;
      retryBtn.addEventListener("click", runSummarize);
    }

    // Kick first run
    runSummarize();

    async function runSummarize() {
      try {
        bbSetRetryBusy(true);
        bbSetAnalyzingMessage("Analyzing the last 10 messages…");

        const last10 = await collectLastMessages(10);
        const payload = last10.length
          ? last10
          : [
              {
                role: "user",
                text: "(No visible chat messages found on page)",
              },
            ];

        const ans = await sendBG({
          type: "BUG_BUSTER:SUMMARIZE",
          site: siteHost(),
          messages: payload,
        });

        let summaryText = "";
        if (typeof ans === "string") summaryText = ans.trim();
        else if (ans?.summary) summaryText = String(ans.summary).trim();
        else if (ans?.text) summaryText = String(ans.text).trim();

        if (summaryText) {
          bbCloseAnalyzingModal();
          openBugBusterModal(summaryText);
        } else {
          bbSetAnalyzingMessage("Could not analyze. Try again?");
          bbSetRetryBusy(false);
        }
      } catch (e) {
        bbSetAnalyzingMessage("Could not analyze. Try again?");
        bbSetRetryBusy(false);
      }
    }
  };
})();
